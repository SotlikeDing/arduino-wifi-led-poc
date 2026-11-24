/*
  ESP32-S3 Mini  -  Remote pin control over MQTT (EMQX Cloud Serverless, TLS)
  ------------------------------------------------------------------------
  Same behaviour, broker, topics and device ID as the UNO R4 WiFi firmware,
  so the existing website and phone app control this board unchanged.

  The board connects to Wi-Fi, then to the MQTT broker over TLS (port 8883),
  and listens for commands that switch GPIO13 (CONTROL_PIN below).

  Topics (BASE = "ledpoc/<DEVICE_ID>/"):
    BASE + "d13/set"    <- commands from the website / phone app: ON | OFF | TOGGLE
    BASE + "d13/state"  -> retained, current pin state:              ON | OFF
    BASE + "status"     -> retained, "online" (LWT sets "offline" when the board drops)
    BASE + "info"       -> retained JSON heartbeat every 30 s (ip, rssi, uptime, fw)

  The on-board RGB LED shows what the board is doing (it replaces the UNO's LED matrix):
    blue = joining Wi-Fi, purple = connecting to broker,
    green = pin ON, dim red = pin OFF.

  Put your Wi-Fi + broker credentials in arduino_secrets.h (see arduino_secrets.example.h).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoMqttClient.h>
#include <esp_arduino_version.h>
#include "arduino_secrets.h"
#include "broker_ca.h"

// ---------------------------------------------------------------- settings
const char    FW_VERSION[]          = "1.0.0-esp32s3";
const uint8_t CONTROL_PIN           = 13;      // GPIO13 - wire an LED + 220 ohm resistor to GND to see it
const int8_t  RGB_LED_PIN           = 48;      // on-board WS2812 RGB LED: 48 on most S3 Mini / Super Mini,
                                               // 21 on the Waveshare ESP32-S3-Zero, -1 = no status LED
const uint8_t RGB_BRIGHTNESS        = 40;      // 0..255, the WS2812 is very bright up close
const unsigned long WIFI_TIMEOUT_MS = 20000;   // give up on one Wi-Fi attempt after 20 s
const unsigned long MQTT_RETRY_MS   = 5000;    // wait between broker connection attempts
const unsigned long HEARTBEAT_MS    = 30000;   // publish "info" this often

// --------------------------------------- compile-time check: secrets filled in?
constexpr bool sameText(const char* a, const char* b) {
  return (*a == *b) && (*a == '\0' || sameText(a + 1, b + 1));
}
static_assert(!sameText(SECRET_SSID, "YOUR_WIFI_NAME"),
              "Open arduino_secrets.h and set SECRET_SSID / SECRET_PASS to your Wi-Fi network.");

// ---------------------------------------------------------------- objects
WiFiClientSecure sslClient;
MqttClient       mqtt(sslClient);

String tSet, tState, tStatus, tInfo;

bool pinOn                 = false;
bool stateDirty            = true;   // publish state on next loop
unsigned long lastMqttTry  = 0;
unsigned long lastBeat     = 0;

// ---------------------------------------------------------------- status LED
void rgb(uint8_t r, uint8_t g, uint8_t b) {
  if (RGB_LED_PIN < 0) return;
  r = (uint16_t)r * RGB_BRIGHTNESS / 255;
  g = (uint16_t)g * RGB_BRIGHTNESS / 255;
  b = (uint16_t)b * RGB_BRIGHTNESS / 255;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  rgbLedWrite(RGB_LED_PIN, r, g, b);
#else
  neopixelWrite(RGB_LED_PIN, r, g, b);
#endif
}
void showWifi()   { rgb(0, 0, 255); }
void showCloud()  { rgb(160, 0, 255); }
void showPinIcon() {
  if (pinOn) rgb(0, 255, 0);
  else       rgb(40, 0, 0);
}

// ---------------------------------------------------------------- pin control
void setPin(bool on) {
  pinOn = on;
  digitalWrite(CONTROL_PIN, on ? HIGH : LOW);
  showPinIcon();
  Serial.print(F("[PIN] GPIO13 -> "));
  Serial.println(on ? F("ON") : F("OFF"));
}

// Returns true if the command was understood.
bool handleCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd == "ON" || cmd == "1" || cmd == "HIGH" || cmd == "TRUE")       setPin(true);
  else if (cmd == "OFF" || cmd == "0" || cmd == "LOW" || cmd == "FALSE") setPin(false);
  else if (cmd == "TOGGLE")                                              setPin(!pinOn);
  else return false;
  return true;
}

// Called from inside mqtt.poll(); we only set flags here and publish from loop().
void onMqttMessage(int /*messageSize*/) {
  String topic = mqtt.messageTopic();
  String payload;
  payload.reserve(16);
  while (mqtt.available()) {
    char c = (char)mqtt.read();
    if (payload.length() < 32) payload += c;
  }
  Serial.print(F("[MQTT] <- "));
  Serial.print(topic);
  Serial.print(F(" : "));
  Serial.println(payload);

  if (topic == tSet) {
    if (!handleCommand(payload)) Serial.println(F("[MQTT] unknown command (use ON / OFF / TOGGLE)"));
    stateDirty = true;  // always answer, so the apps get an acknowledgement
  }
}

// ---------------------------------------------------------------- publishing
void publish(const String& topic, const String& payload, bool retain) {
  mqtt.beginMessage(topic, retain, 1);
  mqtt.print(payload);
  mqtt.endMessage();
}

void publishState() {
  publish(tState, pinOn ? "ON" : "OFF", true);
  stateDirty = false;
}

void publishInfo() {
  String json = "{\"fw\":\"";
  json += FW_VERSION;
  json += "\",\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\",\"rssi\":";
  json += String(WiFi.RSSI());
  json += ",\"uptime\":";
  json += String(millis() / 1000UL);
  json += ",\"pin\":13}";
  publish(tInfo, json, true);
  lastBeat = millis();
}

// ---------------------------------------------------------------- connections
bool connectWiFi() {
  showWifi();
  Serial.print(F("[WiFi] connecting to "));
  Serial.println(F(SECRET_SSID));

  WiFi.disconnect();
  WiFi.begin(SECRET_SSID, SECRET_PASS);

  unsigned long start = millis();
  // Wait for association AND a DHCP address (the IP can lag behind the status).
  while (millis() - start < WIFI_TIMEOUT_MS) {
    if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0, 0, 0, 0)) {
      Serial.print(F("[WiFi] connected, IP "));
      Serial.print(WiFi.localIP());
      Serial.print(F(", RSSI "));
      Serial.print(WiFi.RSSI());
      Serial.println(F(" dBm"));
      return true;
    }
    delay(250);
  }
  Serial.println(F("[WiFi] failed - check SSID/password, and that the network is 2.4 GHz"));
  return false;
}

bool connectMqtt() {
  showCloud();
  Serial.print(F("[MQTT] connecting to "));
  Serial.print(F(MQTT_HOST));
  Serial.print(':');
  Serial.println(MQTT_PORT);

  mqtt.stop();  // make sure the previous TLS socket is closed before a new attempt
  if (!mqtt.connect(MQTT_HOST, MQTT_PORT)) {
    Serial.print(F("[MQTT] failed, error "));
    Serial.print(mqtt.connectError());
    Serial.println(F("  (-2 = TLS/network, 4 = bad username/password, 5 = not authorised)"));
    return false;
  }
  Serial.println(F("[MQTT] connected"));

  mqtt.subscribe(tSet, 1);
  publish(tStatus, "online", true);
  publishState();
  publishInfo();
  showPinIcon();
  Serial.print(F("[MQTT] listening on "));
  Serial.println(tSet);
  return true;
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) { delay(10); }  // don't block forever without USB

  pinMode(CONTROL_PIN, OUTPUT);
  digitalWrite(CONTROL_PIN, LOW);
  rgb(0, 0, 0);

  Serial.println();
  Serial.print(F("=== ESP32-S3 pin control, fw "));
  Serial.print(FW_VERSION);
  Serial.println(F(" ==="));
  Serial.print(F("[ESP] "));
  Serial.print(ESP.getChipModel());
  Serial.print(F(" rev "));
  Serial.print(ESP.getChipRevision());
  Serial.print(F(", "));
  Serial.print(ESP.getCpuFreqMHz());
  Serial.print(F(" MHz, core "));
  Serial.println(ESP.getSdkVersion());

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_ID);
  WiFi.setSleep(false);  // modem sleep adds ~100 ms+ latency to every command

  String base = String("ledpoc/") + DEVICE_ID + "/";
  tSet    = base + "d13/set";
  tState  = base + "d13/state";
  tStatus = base + "status";
  tInfo   = base + "info";

  // Pin the broker's root certificate (DigiCert Global Root G2):
  // the board trusts ONLY this root when connecting to the broker.
  sslClient.setCACert(EMQX_ROOT_CA);

  mqtt.setId(DEVICE_ID);
  mqtt.setUsernamePassword(MQTT_USER, MQTT_PASS);
  mqtt.setKeepAliveInterval(30 * 1000L);   // ms
  mqtt.setConnectionTimeout(15 * 1000L);   // ms
  mqtt.setCleanSession(true);
  mqtt.onMessage(onMqttMessage);

  // Last Will: the broker publishes "offline" if the board disappears.
  mqtt.beginWill(tStatus, true, 1);
  mqtt.print("offline");
  mqtt.endWill();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (!connectWiFi()) { delay(2000); return; }
  }

  if (!mqtt.connected()) {
    if (lastMqttTry == 0 || millis() - lastMqttTry >= MQTT_RETRY_MS) {
      lastMqttTry = millis();
      connectMqtt();
    }
    return;
  }

  mqtt.poll();
  if (stateDirty) publishState();
  if (millis() - lastBeat >= HEARTBEAT_MS) publishInfo();
}

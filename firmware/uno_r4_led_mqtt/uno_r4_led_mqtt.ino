/*
  Arduino UNO R4 WiFi  -  Remote pin control over MQTT (EMQX Cloud Serverless, TLS)
  ------------------------------------------------------------------------
  The board connects to Wi-Fi, then to an MQTT broker over TLS (port 8883),
  and listens for commands that switch digital pin D13 (the on-board "L" LED).

  Topics (BASE = "ledpoc/<DEVICE_ID>/"):
    BASE + "d13/set"    <- commands from the website / phone app: ON | OFF | TOGGLE
    BASE + "d13/state"  -> retained, current pin state:              ON | OFF
    BASE + "status"     -> retained, "online" (LWT sets "offline" when the board drops)
    BASE + "info"       -> retained JSON heartbeat every 30 s (ip, rssi, uptime, fw)

  The 12x8 LED matrix shows what the board is doing:
    Wi-Fi arcs = joining Wi-Fi, cloud = connecting to broker,
    filled circle = D13 ON, ring = D13 OFF, X = config missing.

  Put your Wi-Fi + broker credentials in arduino_secrets.h (see arduino_secrets.example.h).
*/

#include <WiFiS3.h>
#include <ArduinoMqttClient.h>
#include <Arduino_LED_Matrix.h>
#include "arduino_secrets.h"
#include "broker_ca.h"

// ---------------------------------------------------------------- settings
const char    FW_VERSION[]          = "1.0.0";
const uint8_t CONTROL_PIN           = 13;      // D13 = on-board "L" LED
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
WiFiSSLClient    sslClient;
MqttClient       mqtt(sslClient);
ArduinoLEDMatrix matrix;

String tSet, tState, tStatus, tInfo;

bool pinOn                 = false;
volatile bool stateDirty   = true;   // publish state on next loop
unsigned long lastMqttTry  = 0;
unsigned long lastBeat     = 0;

// ---------------------------------------------------------------- matrix icons (8 rows x 12 cols)
uint8_t ICON_WIFI[8][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,0,1,1,1,1,1,1,0,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,1,0,0,1,1,1,1,0,0,1,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,0,0,1,1,0,0,0,0,0},
  {0,0,0,0,0,1,1,0,0,0,0,0},
  {0,0,0,0,0,0,0,0,0,0,0,0}};
uint8_t ICON_CLOUD[8][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,0,0,1,1,1,0,0,0,0,0},
  {0,0,0,1,1,0,1,1,1,0,0,0},
  {0,1,1,0,0,0,0,0,1,1,1,0},
  {1,0,0,0,0,0,0,0,0,0,0,1},
  {1,0,0,0,0,0,0,0,0,0,0,1},
  {0,1,1,1,1,1,1,1,1,1,1,0},
  {0,0,0,0,0,0,0,0,0,0,0,0}};
uint8_t ICON_ON[8][12] = {
  {0,0,0,0,1,1,1,1,0,0,0,0},
  {0,0,0,1,1,1,1,1,1,0,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,0,1,1,1,1,1,1,0,0,0},
  {0,0,0,0,1,1,1,1,0,0,0,0}};
uint8_t ICON_OFF[8][12] = {
  {0,0,0,0,1,1,1,1,0,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,0,1,1,1,1,0,0,0,0}};

// renderBitmap() is a macro, so it needs a plain array name (no ?: expression).
void showPinIcon() {
  if (pinOn) matrix.renderBitmap(ICON_ON, 8, 12);
  else       matrix.renderBitmap(ICON_OFF, 8, 12);
}

// ---------------------------------------------------------------- pin control
void setPin(bool on) {
  pinOn = on;
  digitalWrite(CONTROL_PIN, on ? HIGH : LOW);
  showPinIcon();
  Serial.print(F("[PIN] D13 -> "));
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
  IPAddress ip = WiFi.localIP();
  String json = "{\"fw\":\"";
  json += FW_VERSION;
  json += "\",\"ip\":\"";
  json += String(ip[0]) + "." + String(ip[1]) + "." + String(ip[2]) + "." + String(ip[3]);
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
  matrix.renderBitmap(ICON_WIFI, 8, 12);
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
  matrix.renderBitmap(ICON_CLOUD, 8, 12);
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
  while (!Serial && millis() - t0 < 2000) { }  // don't block forever without USB

  pinMode(CONTROL_PIN, OUTPUT);
  digitalWrite(CONTROL_PIN, LOW);
  matrix.begin();

  Serial.println();
  Serial.print(F("=== UNO R4 WiFi pin control, fw "));
  Serial.print(FW_VERSION);
  Serial.println(F(" ==="));

  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println(F("[WiFi] module not responding - halting"));
    while (true) { delay(1000); }
  }
  String fv = WiFi.firmwareVersion();
  Serial.print(F("[WiFi] module firmware "));
  Serial.println(fv);
  if (fv < WIFI_FIRMWARE_LATEST_VERSION) {
    Serial.print(F("[WiFi] tip: update the Wi-Fi module firmware to "));
    Serial.println(F(WIFI_FIRMWARE_LATEST_VERSION));
  }

  String base = String("ledpoc/") + DEVICE_ID + "/";
  tSet    = base + "d13/set";
  tState  = base + "d13/state";
  tStatus = base + "status";
  tInfo   = base + "info";

  // Pin the broker's root certificate (DigiCert Global Root G2), so TLS does not
  // depend on which roots happen to be in the Wi-Fi module's built-in bundle.
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

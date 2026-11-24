// Copy this file to arduino_secrets.h and fill it in.
// arduino_secrets.h is git-ignored, so your passwords never get uploaded.

// ---- Your Wi-Fi (must be 2.4 GHz - the UNO R4 WiFi cannot join 5 GHz networks)
#define SECRET_SSID "YOUR_WIFI_NAME"
#define SECRET_PASS "YOUR_WIFI_PASSWORD"

// ---- EMQX Cloud broker (Deployment Overview -> Address, TLS port 8883)
#define MQTT_HOST   "xxxxxxxx.ala.eu-central-1.emqxsl.com"
#define MQTT_PORT   8883
#define MQTT_USER   "uno-r4-device"
#define MQTT_PASS   "device-password"

// ---- Must match the Device ID entered in the website / phone app
#define DEVICE_ID   "uno-r4-xxxxxx"

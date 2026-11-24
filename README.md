# Arduino UNO R4 WiFi – remote pin control POC

Turn pin **D13** (the on-board "L" LED) on and off from a **website** or a **phone app**, from anywhere, using only free services.

```
 Website (GitHub Pages) ─┐                                                 ┌─> UNO R4 WiFi
                         ├─ wss:8084 ─> EMQX Cloud Serverless ─ tls:8883 ─┤   D13 + LED matrix
 Phone app (PWA)  ───────┘              (free MQTT broker)                 └─< state / online / info
```

| Part | Folder | Where it runs |
|---|---|---|
| Firmware | `firmware/uno_r4_led_mqtt/` | Arduino UNO R4 WiFi |
| Website | `website/` | https://sotlikeding.github.io/arduino-wifi-led-poc/website/ |
| Phone app | `phone-app/` | https://sotlikeding.github.io/arduino-wifi-led-poc/phone-app/ (install to home screen) |
| Simulator + tests | `tools/` | your PC (Node.js) |

## MQTT topics (`BASE = ledpoc/<DEVICE_ID>/`)

| Topic | Direction | Payload |
|---|---|---|
| `BASE/d13/set` | app → board | `ON`, `OFF`, `TOGGLE` (also `1`/`0`) |
| `BASE/d13/state` | board → apps, retained | `ON` / `OFF` – sent after every command (acknowledgement) |
| `BASE/status` | board → apps, retained | `online`; the broker sets `offline` (Last Will) if the board drops |
| `BASE/info` | board → apps, retained, every 30 s | `{"fw","ip","rssi","uptime","pin"}` |

## Flash the board

1. Install **Arduino IDE 2** → Boards Manager → **Arduino UNO R4 Boards**. Library Manager → **ArduinoMqttClient**.
2. Open `firmware/uno_r4_led_mqtt/uno_r4_led_mqtt.ino`.
3. Edit `arduino_secrets.h` (git-ignored): set `SECRET_SSID` / `SECRET_PASS` to your **2.4 GHz** Wi-Fi.
   The broker settings are already filled in.
4. Board: *Arduino UNO R4 WiFi*, pick the COM port, **Upload**. Open Serial Monitor at **115200**.

The LED matrix shows progress: Wi-Fi arcs → cloud → circle (filled = ON, ring = OFF).

Or from the command line:
```
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi firmware/uno_r4_led_mqtt
arduino-cli upload  --fqbn arduino:renesas_uno:unor4wifi -p COM5 firmware/uno_r4_led_mqtt
```

## Use the apps

Open the website or phone app, enter the **app password** once (it's saved only in that browser), done.
On a phone: open the phone-app link → *Add to Home Screen* (iPhone: Share button; Android: ⋮ menu / Install).

## Test without hardware

```
cd tools
npm install
npm test          # full end-to-end test against the real broker using a virtual board
npm run device    # run the virtual board; then use the website / phone app against it
```
`tools/secrets.local.json` holds the credentials (git-ignored).

## Troubleshooting (Serial Monitor)

| Message | Fix |
|---|---|
| `static assertion failed: Open arduino_secrets.h…` | Fill in your Wi-Fi name/password |
| `[WiFi] failed` | Wrong SSID/password, or the network is 5 GHz only |
| `[MQTT] failed, error -2` | TLS/network issue – update the Wi-Fi module firmware (Arduino IDE: Tools → Firmware Updater). The broker root CA is pinned in `broker_ca.h` |
| `[MQTT] failed, error 4/5` | Wrong broker username/password in `arduino_secrets.h` |
| Apps say "Board offline" | Board not powered / not on Wi-Fi |

The EMQX Serverless deployment has a **$0 spend limit** (free quota only: 1 million session-minutes + 1 GB per month, roughly 20 devices online 24/7). It can never bill you; if the quota ran out it would just pause until next month. Console: https://cloud-intl.emqx.com/console/

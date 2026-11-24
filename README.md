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

## Run the POC on a laptop without the board

The **virtual board** (`tools/virtual-uno.mjs`) is a small Node.js program that behaves exactly like the
firmware on the wire: same broker, same TLS port, same login, same topics, same Last Will. The website and
phone app can't tell it apart from the real UNO R4 WiFi, so you can try the whole system on any laptop.

### 1. One-time setup

1. Install **Node.js** 18 or newer from https://nodejs.org (the LTS version is fine). Check it with `node -v`.
2. Get this repo onto the laptop (`git clone https://github.com/SotlikeDing/arduino-wifi-led-poc.git`, or copy the folder).
3. Install the tool dependencies:
   ```
   cd tools
   npm install
   ```
4. Create **`tools/secrets.local.json`**. It is git-ignored, so it is **not** in a fresh clone – create it yourself
   with this content, using the two passwords from `SECRETS.local.md` (on the original PC) or from the EMQX console
   (Access Control → Authentication):
   ```json
   {
     "host": "k1a4d701.ala.eu-central-1.emqxsl.com",
     "tlsPort": 8883,
     "wsPort": 8084,
     "authRequired": true,
     "deviceId": "uno-r4-3f99b3",
     "deviceUser": "uno-r4-device",
     "devicePass": "PASSWORD-OF-uno-r4-device",
     "appUser": "led-app",
     "appPass": "PASSWORD-OF-led-app"
   }
   ```

### 2. Quick check: automated end-to-end test

```
cd tools
npm test
```
This starts the virtual board, connects as an app (secure WebSockets, like a browser), sends ON / OFF / TOGGLE,
checks that a second app sees the same state, then "pulls the plug" and checks the apps see **offline**.
It should end with `14 passed, 0 failed`. Takes about 15 seconds.

### 3. Hands-on: control the virtual board from the website and phone app

1. Start the virtual board and **leave this terminal open**:
   ```
   cd tools
   npm run device
   ```
   You should see `[MQTT] connected (TLS 8883)` and `listening on ledpoc/uno-r4-3f99b3/d13/set`.
2. Open the website (https://sotlikeding.github.io/arduino-wifi-led-poc/website/) and/or the phone app
   (https://sotlikeding.github.io/arduino-wifi-led-poc/phone-app/). The first time, enter the **led-app** password.
3. Both should show **Cloud connected** and **Board online**. Click **Turn ON** / the power button – the terminal prints
   `[PIN] D13 -> ON` and the apps confirm the new state. Open both apps side by side to see them stay in sync.
4. Press **Ctrl+C** in the terminal to "unplug" the virtual board – the apps switch to **Board offline**
   within a few seconds. Run `npm run device` again to bring it back.

How to tell it's the virtual board: the Device panel shows firmware **`v1.0.0-sim`** and IP `192.168.1.77`.

> **Don't run the virtual board and the real board at the same time.** They use the same device ID, so the broker
> keeps kicking one off when the other connects. Stop `npm run device` before powering the real UNO R4 WiFi.

### Troubleshooting the virtual board

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Install Node.js (step 1), then open a new terminal |
| `ENOENT … secrets.local.json` | Create `tools/secrets.local.json` (step 4) |
| `Bad username or password` | Wrong password in `secrets.local.json` or in the app's settings (gear icon) |
| Apps say "Board offline" | The `npm run device` terminal isn't running, or was stopped with Ctrl+C |
| Apps say "Connection failed" | Check internet; some company/school networks block port 8084 or 8883 |

## Troubleshooting (Serial Monitor)

| Message | Fix |
|---|---|
| `static assertion failed: Open arduino_secrets.h…` | Fill in your Wi-Fi name/password |
| `[WiFi] failed` | Wrong SSID/password, or the network is 5 GHz only |
| `[MQTT] failed, error -2` | TLS/network issue – update the Wi-Fi module firmware (Arduino IDE: Tools → Firmware Updater). The broker root CA is pinned in `broker_ca.h` |
| `[MQTT] failed, error 4/5` | Wrong broker username/password in `arduino_secrets.h` |
| Apps say "Board offline" | Board not powered / not on Wi-Fi |

The EMQX Serverless deployment has a **$0 spend limit** (free quota only: 1 million session-minutes + 1 GB per month, roughly 20 devices online 24/7). It can never bill you; if the quota ran out it would just pause until next month. Console: https://cloud-intl.emqx.com/console/

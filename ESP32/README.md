# ESP32-S3 Mini – remote pin control POC

Switch pin **GPIO13** on an **ESP32-S3 Mini** on and off from a **website** or a **phone app**, from anywhere,
using only free services.

```
 Website (GitHub Pages) ─┐                                                 ┌─> ESP32-S3 Mini
                         ├─ wss:8084 ─> EMQX Cloud Serverless ─ tls:8883 ─┤   GPIO13 + RGB status LED
 Phone app (PWA)  ───────┘              (free MQTT broker)                 └─< state / online / info
```

| Part | Where |
|---|---|
| Firmware (this folder) | `ESP32/esp32s3_led_mqtt/` |
| Website | https://sotlikeding.github.io/arduino-wifi-led-poc/website/ |
| Phone app | https://sotlikeding.github.io/arduino-wifi-led-poc/phone-app/ (install to home screen) |

> The website and phone app still say "R4" / "D13". That's only their labels: they control whichever board is
> online with device ID `uno-r4-3f99b3`, and here that's the ESP32.

---

## 1. What you need

- ESP32-S3 Mini board + a USB-C **data** cable (some cables only carry power)
- To see the pin switch: 1 LED + 1 × 220 Ω resistor (optional, the on-board RGB LED also shows the state)
- A **2.4 GHz** Wi-Fi network (the ESP32-S3 can't join 5 GHz)
- **Arduino IDE 2**: https://www.arduino.cc/en/software

### Wiring (optional LED)

```
GPIO13 ──[220 Ω]──►|── GND
                 LED (long leg towards the resistor)
```

## 2. One-time setup in Arduino IDE

1. **File → Preferences → Additional boards manager URLs**, add:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Boards Manager** → search `esp32` → install **esp32 by Espressif Systems** (version 3.x).
3. **Library Manager** → search `ArduinoMqttClient` → install it.

## 3. Secrets file

The sketch reads passwords from `esp32s3_led_mqtt/arduino_secrets.h`. That file is **git-ignored**, so it isn't in a
fresh clone. If it's missing, copy `arduino_secrets.example.h` to `arduino_secrets.h`, then fill it in:

```c
#define SECRET_SSID "YourWiFiName"          // 2.4 GHz network
#define SECRET_PASS "YourWiFiPassword"

#define MQTT_HOST   "k1a4d701.ala.eu-central-1.emqxsl.com"
#define MQTT_PORT   8883
#define MQTT_USER   "uno-r4-device"
#define MQTT_PASS   "PASSWORD-OF-uno-r4-device"   // from SECRETS.local.md or the EMQX console
#define DEVICE_ID   "uno-r4-3f99b3"               // must match the apps
```

The broker passwords are in `SECRETS.local.md` on the original PC, or in the EMQX console
(https://cloud-intl.emqx.com/console/ → Access Control → Authentication).

## 4. Flash the board

1. Open `ESP32/esp32s3_led_mqtt/esp32s3_led_mqtt.ino` in Arduino IDE.
2. **Tools** menu:

   | Setting | Value |
   |---|---|
   | Board | **ESP32S3 Dev Module** |
   | USB CDC On Boot | **Enabled** (otherwise the Serial Monitor stays empty) |
   | Flash Size | **4MB** (most S3 Mini boards; use your board's size) |
   | Port | the board's COM port |

3. Click **Upload**.
   If it doesn't connect: hold **BOOT**, tap **RESET**, release **BOOT**, upload again, then press **RESET** when done.
4. Open the **Serial Monitor** at **115200** baud. You should see:
   ```
   === ESP32-S3 pin control, fw 1.0.0-esp32s3 ===
   [WiFi] connected, IP 192.168.x.x, RSSI -55 dBm
   [MQTT] connected
   [MQTT] listening on ledpoc/uno-r4-3f99b3/d13/set
   ```

Or from the command line:
```
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc ESP32/esp32s3_led_mqtt
arduino-cli upload  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc -p COM6 ESP32/esp32s3_led_mqtt
```

### On-board RGB LED

| Colour | Meaning |
|---|---|
| Blue | Joining Wi-Fi |
| Purple | Connecting to the cloud broker |
| Green | GPIO13 is **ON** |
| Dim red | GPIO13 is **OFF** |

## 5. Use it

1. Open the website or phone app (links at the top). The first time, enter the **app password** (user `led-app`).
   It's saved only in that browser.
2. Both show **Cloud connected** and **Board online**, and the Device panel shows firmware **`v1.0.0-esp32s3`**.
3. Click **Turn ON** / the power button. The LED on GPIO13 lights, the RGB LED turns green, and the Serial Monitor prints
   `[PIN] GPIO13 -> ON`. The app shows the new state once the board confirms it.
4. Unplug the board. Within about a minute the apps switch to **Board offline**.

On a phone: open the phone-app link → *Add to Home Screen* (iPhone: Share button; Android: ⋮ menu / Install).

> **Run only one board at a time** with this device ID. If another board (or a simulator) is connected with the same
> ID, the broker keeps kicking one off when the other connects.

---

## 6. Simulate the ESP32 (no hardware)

You can run **the real firmware** on a simulated ESP32-S3 with **[Wokwi](https://wokwi.com)**. It simulates Wi-Fi with
internet access, so the simulated board really connects to the broker, and the website and phone app control it like
the real one. The simulated circuit (`diagram.json`) has the LED on GPIO13 and an RGB LED on GPIO48.

In both options below, put Wokwi's virtual Wi-Fi in `arduino_secrets.h` while simulating:
```c
#define SECRET_SSID "Wokwi-GUEST"
#define SECRET_PASS ""
```
Put your real Wi-Fi back before flashing a real board.

### Option A – VS Code (recommended, passwords stay on your PC)

1. In VS Code, install the extension **Wokwi Simulator**. Press **F1 → "Wokwi: Request a New License"** once (free).
2. Compile the firmware in Arduino IDE:
   - Tools → **USB CDC On Boot: Disabled** (the simulator's serial monitor reads the UART; turn it back to Enabled for the real board)
   - **Sketch → Export Compiled Binary**. This creates `esp32s3_led_mqtt/build/esp32.esp32.esp32s3/…` (git-ignored).
3. In VS Code, open the folder `ESP32/esp32s3_led_mqtt`, open `diagram.json`, and press **F1 → "Wokwi: Start Simulator"**.
4. The serial output appears in the simulator. After `[MQTT] connected`, use the website or phone app, and the
   simulated LED switches.

After any code change, run Export Compiled Binary again, then restart the simulator.

### Option B – in the browser on wokwi.com

1. Go to https://wokwi.com → **New Project → ESP32-S3**.
2. Paste the contents of `esp32s3_led_mqtt.ino` into `sketch.ino`.
3. Replace the contents of `diagram.json` with ours, and add a file `libraries.txt` with ours.
4. Use the tab menu → **New file** to add `broker_ca.h` and `arduino_secrets.h` (copy both from this folder).
5. Click **▶ Start**.

> ⚠ **Don't click Save** on wokwi.com with real passwords in `arduino_secrets.h`. Saved projects on the free plan
> are public. Running without saving is fine.

The simulated Wi-Fi is slower than real Wi-Fi: connecting can take 10–20 s, and commands take a moment longer to confirm.

---

## MQTT topics (`BASE = ledpoc/uno-r4-3f99b3/`)

| Topic | Direction | Payload |
|---|---|---|
| `BASE/d13/set` | app → board | `ON`, `OFF`, `TOGGLE` (also `1`/`0`) |
| `BASE/d13/state` | board → apps, retained | `ON` / `OFF`, sent after every command (acknowledgement) |
| `BASE/status` | board → apps, retained | `online`; the broker sets `offline` (Last Will) if the board drops |
| `BASE/info` | board → apps, retained, every 30 s | `{"fw","ip","rssi","uptime","pin"}` |

## Board variants

At the top of the sketch:
- `RGB_LED_PIN`: the on-board RGB LED. **48** on most "ESP32-S3 Mini / Super Mini" boards, **21** on the Waveshare
  ESP32-S3-Zero, `-1` if your board has none. If red and green look swapped, your LED uses a different colour order.
  It doesn't affect anything else.
- `CONTROL_PIN`: the pin the apps switch (default GPIO13). Avoid GPIO 0, 3, 45, 46 (strapping pins) and 19/20 (USB).

## Troubleshooting

| Problem | Fix |
|---|---|
| `static assertion failed: Open arduino_secrets.h…` | Fill in your Wi-Fi name/password |
| `arduino_secrets.h: No such file` | Copy `arduino_secrets.example.h` to `arduino_secrets.h` (step 3) |
| No COM port / upload fails | Use a data cable; hold BOOT + tap RESET to enter download mode |
| Serial Monitor stays empty | Tools → USB CDC On Boot → **Enabled**, upload again, press RESET |
| `[WiFi] failed` | Wrong SSID/password, or the network is 5 GHz only |
| `[MQTT] failed, error -2` | TLS/network issue; check that port 8883 isn't blocked. The broker root CA is pinned in `broker_ca.h` |
| `[MQTT] failed, error 4/5` | Wrong `MQTT_USER` / `MQTT_PASS` in `arduino_secrets.h` |
| Apps say "Wrong username or password" | Wrong app password; click the gear icon and re-enter it |
| Apps say "Board offline" | Board not powered / not on Wi-Fi, or another board/simulator with the same ID kicked it off |
| Wokwi stuck on `[WiFi] connecting` | SSID must be exactly `Wokwi-GUEST` with an empty password |

The EMQX broker has a **$0 spend limit** (free quota only, roughly 20 devices online 24/7). It can never bill you; if
the quota ran out, it would pause until the next month.

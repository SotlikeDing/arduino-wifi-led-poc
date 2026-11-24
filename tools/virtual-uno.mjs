// Virtual UNO R4 WiFi - behaves exactly like firmware/uno_r4_led_mqtt.ino on the wire:
//  * connects with the DEVICE credential over MQTT/TLS port 8883 (same as the real board)
//  * Last Will "offline" (retained) on BASE/status
//  * subscribes BASE/d13/set, answers every command on BASE/d13/state (retained)
//  * publishes BASE/info heartbeat (retained) every 30 s
// Usage: node virtual-uno.mjs        (reads tools/secrets.local.json)
import mqtt from "mqtt";
import { readFileSync } from "node:fs";

const S = JSON.parse(readFileSync(new URL("./secrets.local.json", import.meta.url)));
const base = `ledpoc/${S.deviceId}/`;
const T = { set: base + "d13/set", state: base + "d13/state", status: base + "status", info: base + "info" };
const started = Date.now();
let pinOn = false;

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// identical rules to handleCommand() in the firmware
function handleCommand(raw) {
  const cmd = raw.trim().toUpperCase();
  if (["ON", "1", "HIGH", "TRUE"].includes(cmd)) pinOn = true;
  else if (["OFF", "0", "LOW", "FALSE"].includes(cmd)) pinOn = false;
  else if (cmd === "TOGGLE") pinOn = !pinOn;
  else return false;
  return true;
}

const client = mqtt.connect(`mqtts://${S.host}:${S.tlsPort || 8883}`, {
  clientId: S.deviceId,
  username: S.deviceUser,
  password: S.devicePass,
  clean: true,
  keepalive: 30,
  protocolVersion: 4,
  reconnectPeriod: 5000,
  will: { topic: T.status, payload: "offline", retain: true, qos: 1 },
});

const pub = (t, p) => client.publish(t, p, { qos: 1, retain: true });
const info = () => pub(T.info, JSON.stringify({ fw: "1.0.0-sim", ip: "192.168.1.77", rssi: -58, uptime: Math.floor((Date.now() - started) / 1000), pin: 13 }));

client.on("connect", () => {
  log("[MQTT] connected (TLS 8883)");
  client.subscribe(T.set, { qos: 1 });
  pub(T.status, "online");
  pub(T.state, pinOn ? "ON" : "OFF");
  info();
  log("[MQTT] listening on", T.set);
});
client.on("message", (topic, buf) => {
  const p = buf.toString();
  log("[MQTT] <-", topic, ":", p);
  if (topic === T.set) {
    if (handleCommand(p)) log("[PIN] D13 ->", pinOn ? "ON" : "OFF");
    else log("[MQTT] unknown command");
    pub(T.state, pinOn ? "ON" : "OFF");
  }
});
client.on("error", (e) => log("[MQTT] error", e.message));
setInterval(() => client.connected && info(), 30000);
process.on("SIGINT", () => { log("power off (no clean disconnect -> broker fires Last Will)"); process.exit(0); });

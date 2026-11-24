// End-to-end test: starts the virtual UNO, then acts as the website/phone app
// (APP credential, secure WebSockets 8884 - the exact path a browser uses)
// and checks every command round-trip plus the offline (Last Will) detection.
import mqtt from "mqtt";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const S = JSON.parse(readFileSync(new URL("./secrets.local.json", import.meta.url)));
const base = `ledpoc/${S.deviceId}/`;
const T = { set: base + "d13/set", state: base + "d13/state", status: base + "status", info: base + "info" };
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appClient(user, password) {
  return mqtt.connect(`wss://${S.host}:${S.wsPort || 8884}/mqtt`, {
    username: user, password, clientId: "e2e-" + Math.random().toString(16).slice(2, 8),
    clean: true, protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 10000,
  });
}
function waitFor(client, topic, pred, ms = 5000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const h = (tp, buf) => { const m = buf.toString(); if (tp === topic && pred(m)) { done(m); } };
    const timer = setTimeout(() => done(null), ms);
    function done(m) { clearTimeout(timer); client.off("message", h); resolve(m === null ? null : { m, ms: Date.now() - t0 }); }
    client.on("message", h);
  });
}

// 1. wrong password must be rejected
if (S.authRequired !== false) await new Promise((res) => {
  const bad = appClient(S.appUser, "definitely-wrong");
  bad.on("connect", () => { ok("broker rejects wrong password", false); bad.end(true); res(); });
  bad.on("error", (e) => { ok("broker rejects wrong password", /authori|bad user/i.test(e.message), e.message); bad.end(true); res(); });
});

// 2. app connects
const app = appClient(S.appUser, S.appPass);
await new Promise((res, rej) => { app.on("connect", res); app.on("error", rej); });
ok("app connects over wss://…:8884/mqtt", true);
await new Promise((r) => app.subscribe([T.state, T.status, T.info], { qos: 1 }, r));

// 3. boot the virtual board
const dev = spawn(process.execPath, [fileURLToPath(new URL("./virtual-uno.mjs", import.meta.url))], { stdio: ["ignore", "pipe", "inherit"] });
dev.stdout.on("data", (d) => process.stdout.write("      [uno] " + d.toString().replace(/\n(?!$)/g, "\n      [uno] ")));
const online = await waitFor(app, T.status, (m) => m === "online", 15000);
ok("board comes online (TLS 8883 + device credential)", !!online);
const info = await waitFor(app, T.info, (m) => { try { return JSON.parse(m).pin === 13; } catch { return false; } }, 5000);
ok("board publishes info heartbeat", !!info);
await sleep(500);

// 4. command round-trips
const cases = [["ON", "ON"], ["OFF", "OFF"], ["TOGGLE", "ON"], ["TOGGLE", "OFF"], ["on", "ON"], ["0", "OFF"], ["garbage", "OFF"]];
const lat = [];
for (const [cmd, expect] of cases) {
  const w = waitFor(app, T.state, () => true, 5000);
  app.publish(T.set, cmd, { qos: 1 });
  const r = await w;
  if (r) lat.push(r.ms);
  ok(`send "${cmd}" -> board reports ${expect}`, r && r.m === expect, r ? `${r.m} in ${r.ms} ms` : "no reply");
}

// 5. a second app (e.g. phone + website at the same time) sees retained state
const app2 = appClient(S.appUser, S.appPass);
await new Promise((res) => app2.on("connect", res));
const w2 = waitFor(app2, T.state, () => true, 5000);
app2.subscribe(T.state, { qos: 1 });
const r2 = await w2;
ok("second client gets current state immediately (retained)", r2 && r2.m === "OFF", r2 && r2.m);
const w3 = waitFor(app2, T.state, (m) => m === "ON", 5000);
app.publish(T.set, "ON", { qos: 1 });
ok("website command is seen by phone app too", !!(await w3));
app.publish(T.set, "OFF", { qos: 1 });
await sleep(800);

// 6. pull the plug: kill the board process without a clean disconnect -> Last Will
const wOff = waitFor(app, T.status, (m) => m === "offline", 60000);
dev.kill("SIGKILL");
const off = await wOff;
ok("apps see 'offline' when the board loses power (Last Will)", !!off, off ? `${off.ms} ms` : "");

console.log(`\nmedian command round-trip: ${lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)]} ms`);
console.log(`${pass} passed, ${fail} failed`);
app.end(true); app2.end(true);
process.exit(fail ? 1 : 0);

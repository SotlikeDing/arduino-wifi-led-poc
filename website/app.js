(() => {
  "use strict";
  const STORE_KEY = "ledpoc.web.settings.v1";
  const ACK_TIMEOUT_MS = 6000;
  const STALE_MS = 75000; // device heartbeat is every 30 s

  const $ = (id) => document.getElementById(id);
  const els = {
    connPill: $("connPill"), connText: $("connText"), devicePill: $("devicePill"), deviceText: $("deviceText"),
    ledStage: $("ledStage"), stateValue: $("stateValue"), stateHint: $("stateHint"),
    toggle: $("toggle"), switchText: $("switchText"), btnOn: $("btnOn"), btnOff: $("btnOff"),
    fId: $("fId"), fIp: $("fIp"), fBars: $("fBars"), fRssi: $("fRssi"), fUp: $("fUp"), fFw: $("fFw"), fSeen: $("fSeen"),
    log: $("log"), clearLog: $("clearLog"), toast: $("toast"),
    settings: $("settings"), form: $("settingsForm"), sHost: $("sHost"), sPort: $("sPort"), sDev: $("sDev"),
    sUser: $("sUser"), sPass: $("sPass"), sCancel: $("sCancel"), settingsBtn: $("settingsBtn"),
  };

  // ------------------------------------------------------------ settings
  function loadSettings() {
    const d = window.LEDPOC_DEFAULTS || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
    return {
      host: saved.host || d.host || "",
      wsPort: Number(saved.wsPort || d.wsPort || 8084),
      username: saved.username || d.username || "",
      password: saved.password || "",
      deviceId: saved.deviceId || d.deviceId || "",
    };
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
  }
  let cfg = loadSettings();

  // ------------------------------------------------------------ state
  let client = null;
  let topics = null;
  const st = { broker: "idle", device: "unknown", pin: null, info: null, lastSeen: 0, pending: null };

  // ------------------------------------------------------------ helpers
  function log(text, kind = "") {
    const li = document.createElement("li");
    if (kind) li.className = kind;
    const t = document.createElement("time");
    t.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const s = document.createElement("span");
    s.textContent = text;
    li.append(t, s);
    els.log.prepend(li);
    while (els.log.children.length > 60) els.log.lastChild.remove();
  }
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }
  function setPill(el, textEl, kind, text) {
    el.className = "pill pill-" + kind;
    textEl.textContent = text;
  }
  function fmtUptime(sec) {
    if (sec == null) return "—";
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }
  function fmtAgo(ts) {
    if (!ts) return "—";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return new Date(ts).toLocaleTimeString();
  }
  function rssiLevel(r) { return r >= -55 ? 4 : r >= -67 ? 3 : r >= -78 ? 2 : 1; }

  // ------------------------------------------------------------ render
  function render() {
    // broker pill
    const b = st.broker;
    if (b === "connected") setPill(els.connPill, els.connText, "ok", "Cloud connected");
    else if (b === "connecting") setPill(els.connPill, els.connText, "warn", "Connecting…");
    else if (b === "error") setPill(els.connPill, els.connText, "bad", "Connection failed");
    else setPill(els.connPill, els.connText, "muted", "Not connected");

    // device pill
    const stale = st.device === "online" && st.lastSeen && Date.now() - st.lastSeen > STALE_MS;
    if (b !== "connected") setPill(els.devicePill, els.deviceText, "muted", "Device unknown");
    else if (st.device === "online" && !stale) setPill(els.devicePill, els.deviceText, "ok", "Board online");
    else if (stale) setPill(els.devicePill, els.deviceText, "warn", "Board not responding");
    else if (st.device === "offline") setPill(els.devicePill, els.deviceText, "bad", "Board offline");
    else setPill(els.devicePill, els.deviceText, "muted", "Waiting for board…");

    // pin
    const on = st.pin === true, known = st.pin !== null;
    els.ledStage.dataset.state = known ? (on ? "on" : "off") : "unknown";
    els.ledStage.classList.toggle("stale", b === "connected" && st.device === "offline");
    els.stateValue.textContent = known ? (on ? "ON" : "OFF") : "—";
    els.stateValue.className = "state-value" + (known ? (on ? " is-on" : " is-off") : "");
    els.toggle.setAttribute("aria-checked", String(on));
    els.toggle.classList.toggle("pending", !!st.pending);
    els.switchText.textContent = st.pending ? "Sending…" : on ? "LED is on" : "LED is off";

    let hint;
    if (b !== "connected") hint = cfg.password ? "Connecting to the cloud broker…" : "Open settings and enter the app password.";
    else if (st.pending) hint = `Waiting for the board to confirm ${st.pending.cmd}…`;
    else if (st.device === "offline") hint = "The board is offline – check its power and Wi-Fi.";
    else if (!known) hint = "Waiting for the board to report its state…";
    else hint = "Live state reported by the board.";
    els.stateHint.textContent = hint;

    const enabled = b === "connected" && !st.pending;
    els.toggle.disabled = els.btnOn.disabled = els.btnOff.disabled = !enabled;

    // facts
    const i = st.info || {};
    els.fId.textContent = cfg.deviceId || "—";
    els.fIp.textContent = i.ip || "—";
    els.fFw.textContent = i.fw ? "v" + i.fw : "—";
    els.fUp.textContent = fmtUptime(i.uptime);
    if (typeof i.rssi === "number") { els.fBars.dataset.level = rssiLevel(i.rssi); els.fRssi.textContent = `${i.rssi} dBm`; }
    else { els.fBars.dataset.level = 0; els.fRssi.textContent = "—"; }
    els.fSeen.textContent = fmtAgo(st.lastSeen);
  }

  // ------------------------------------------------------------ mqtt
  function connect() {
    if (client) { client.end(true); client = null; }
    st.device = "unknown"; st.pin = null; st.info = null; st.lastSeen = 0; st.pending = null;
    if (!cfg.host || !cfg.password || !cfg.deviceId) { st.broker = "idle"; render(); openSettings(); return; }

    const base = `ledpoc/${cfg.deviceId}/`;
    topics = { set: base + "d13/set", state: base + "d13/state", status: base + "status", info: base + "info" };
    const url = `wss://${cfg.host}:${cfg.wsPort}/mqtt`;
    st.broker = "connecting"; render();
    log(`Connecting to ${cfg.host}…`);

    client = mqtt.connect(url, {
      username: cfg.username,
      password: cfg.password,
      clientId: "web-" + Math.random().toString(16).slice(2, 10),
      clean: true,
      keepalive: 30,
      reconnectPeriod: 4000,
      connectTimeout: 12000,
      protocolVersion: 4,
    });

    client.on("connect", () => {
      st.broker = "connected"; render();
      log("Connected to cloud broker", "ok");
      client.subscribe([topics.state, topics.status, topics.info], { qos: 1 }, (err) => {
        if (err) log("Subscribe failed: " + err.message, "bad");
      });
    });
    client.on("reconnect", () => { st.broker = "connecting"; render(); });
    client.on("close", () => { if (st.broker === "connected") { st.broker = "connecting"; log("Connection lost – retrying…", "bad"); render(); } });
    client.on("error", (err) => {
      st.broker = "error"; render();
      const msg = /not authori[sz]ed|bad user/i.test(err.message) ? "Wrong username or password" : err.message;
      log("Broker error: " + msg, "bad");
      toast(msg);
      if (/not authori[sz]ed|bad user/i.test(err.message)) { client.end(true); openSettings(); }
    });
    client.on("message", onMessage);
  }

  function onMessage(topic, buf) {
    const msg = buf.toString().trim();
    if (topic === topics.status) {
      const prev = st.device;
      st.device = msg === "online" ? "online" : "offline";
      if (st.device === "online") st.lastSeen = Date.now();
      if (prev !== st.device) log(st.device === "online" ? "Board is online" : "Board went offline", st.device === "online" ? "ok" : "bad");
    } else if (topic === topics.state) {
      const on = msg.toUpperCase() === "ON";
      const changed = st.pin !== on;
      st.pin = on; st.lastSeen = Date.now();
      if (st.pending) {
        clearTimeout(st.pending.timer);
        log(`Board confirmed: D13 ${on ? "ON" : "OFF"}`, "ok");
        st.pending = null;
      } else if (changed) {
        log(`D13 is ${on ? "ON" : "OFF"}`);
      }
    } else if (topic === topics.info) {
      try { st.info = JSON.parse(msg); st.lastSeen = Date.now(); } catch (_) {}
    }
    render();
  }

  function send(cmd) {
    if (!client || st.broker !== "connected" || st.pending) return;
    client.publish(topics.set, cmd, { qos: 1, retain: false });
    log(`Sent ${cmd}`, "cmd");
    st.pending = {
      cmd,
      timer: setTimeout(() => {
        st.pending = null;
        log("No reply from the board", "bad");
        toast("The board didn't answer – is it powered and online?");
        render();
      }, ACK_TIMEOUT_MS),
    };
    render();
  }

  // ------------------------------------------------------------ settings dialog
  function openSettings() {
    els.sHost.value = cfg.host; els.sPort.value = cfg.wsPort; els.sDev.value = cfg.deviceId;
    els.sUser.value = cfg.username; els.sPass.value = cfg.password;
    if (!els.settings.open) els.settings.showModal();
    (cfg.password ? els.sHost : els.sPass).focus();
  }
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    cfg = {
      host: els.sHost.value.trim().replace(/^wss?:\/\//, "").replace(/[:/].*$/, ""),
      wsPort: Number(els.sPort.value) || 8084,
      deviceId: els.sDev.value.trim(),
      username: els.sUser.value.trim(),
      password: els.sPass.value,
    };
    saveSettings(cfg);
    els.settings.close();
    connect();
  });
  els.sCancel.addEventListener("click", () => els.settings.close());
  els.settingsBtn.addEventListener("click", openSettings);

  // ------------------------------------------------------------ controls
  els.toggle.addEventListener("click", () => send(st.pin ? "OFF" : "ON"));
  els.btnOn.addEventListener("click", () => send("ON"));
  els.btnOff.addEventListener("click", () => send("OFF"));
  els.clearLog.addEventListener("click", () => { els.log.innerHTML = ""; });

  setInterval(render, 5000); // keep "last heard" fresh
  render();
  connect();

  // exposed for automated tests
  window.__ledpoc = { state: st, send, get cfg() { return cfg; } };
})();

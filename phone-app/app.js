(() => {
  "use strict";
  const KEY = "r4remote.settings.v1";
  const ACK_MS = 6000, STALE_MS = 75000;
  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $("app"), devName: $("devName"), cloudChip: $("cloudChip"), cloudText: $("cloudText"),
    boardChip: $("boardChip"), boardText: $("boardText"), power: $("power"), bigState: $("bigState"),
    subState: $("subState"), qOn: $("qOn"), qOff: $("qOff"), vSig: $("vSig"), vUp: $("vUp"), vSeen: $("vSeen"),
    sheet: $("sheet"), backdrop: $("backdrop"), openSettings: $("openSettings"), closeSheet: $("closeSheet"),
    sHost: $("sHost"), sDev: $("sDev"), sUser: $("sUser"), sPass: $("sPass"), sPort: $("sPort"),
    toast: $("toast"), installTip: $("installTip"),
  };

  // ---------------------------------------------------------- settings
  function load() {
    const d = window.R4REMOTE_DEFAULTS || {};
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) {}
    return {
      host: s.host || d.host || "", wsPort: Number(s.wsPort || d.wsPort || 8084),
      username: s.username || d.username || "", password: s.password || "", deviceId: s.deviceId || d.deviceId || "",
    };
  }
  let cfg = load();

  // ---------------------------------------------------------- state
  let client = null, T = null;
  const st = { cloud: "idle", board: "unknown", pin: null, info: null, seen: 0, pending: null };

  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
  let tt;
  function toast(m) { ui.toast.textContent = m; ui.toast.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => ui.toast.classList.remove("show"), 2600); }
  function chip(el, txtEl, kind, text) { el.className = "chip" + (kind ? " " + kind : ""); txtEl.textContent = text; }
  function up(sec) {
    if (sec == null) return "—";
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m` : `${sec}s`;
  }
  function ago(ts) {
    if (!ts) return "—";
    const s = Math.round((Date.now() - ts) / 1000);
    return s < 5 ? "now" : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  }
  function sig(r) {
    if (typeof r !== "number") return "—";
    return r >= -55 ? "Excellent" : r >= -67 ? "Good" : r >= -78 ? "Fair" : "Weak";
  }

  // ---------------------------------------------------------- render
  function render() {
    ui.devName.textContent = cfg.deviceId ? `${cfg.deviceId} · pin D13` : "Not set up";
    if (st.cloud === "connected") chip(ui.cloudChip, ui.cloudText, "ok", "Cloud");
    else if (st.cloud === "connecting") chip(ui.cloudChip, ui.cloudText, "warn", "Connecting");
    else if (st.cloud === "error") chip(ui.cloudChip, ui.cloudText, "bad", "Cloud error");
    else chip(ui.cloudChip, ui.cloudText, "", "Offline");

    const stale = st.board === "online" && st.seen && Date.now() - st.seen > STALE_MS;
    if (st.cloud !== "connected") chip(ui.boardChip, ui.boardText, "", "Board unknown");
    else if (st.board === "online" && !stale) chip(ui.boardChip, ui.boardText, "ok", "Board online");
    else if (stale) chip(ui.boardChip, ui.boardText, "warn", "Board silent");
    else if (st.board === "offline") chip(ui.boardChip, ui.boardText, "bad", "Board offline");
    else chip(ui.boardChip, ui.boardText, "", "Waiting for board");

    const known = st.pin !== null, on = st.pin === true;
    ui.app.dataset.pin = known ? (on ? "on" : "off") : "unknown";
    ui.app.dataset.board = st.cloud === "connected" && st.board === "offline" ? "offline" : "ok";
    ui.bigState.textContent = known ? (on ? "ON" : "OFF") : "—";
    ui.power.setAttribute("aria-pressed", String(on));
    ui.power.classList.toggle("pending", !!st.pending);

    let sub;
    if (!cfg.password) sub = "Tap the gear to connect";
    else if (st.cloud !== "connected") sub = "Connecting to the cloud…";
    else if (st.pending) sub = `Sending ${st.pending.cmd}…`;
    else if (st.board === "offline") sub = "Board is offline";
    else if (!known) sub = "Waiting for the board…";
    else sub = on ? "D13 is on – tap to switch off" : "D13 is off – tap to switch on";
    ui.subState.textContent = sub;

    const can = st.cloud === "connected" && !st.pending;
    ui.power.disabled = ui.qOn.disabled = ui.qOff.disabled = !can;

    const i = st.info || {};
    ui.vSig.textContent = sig(i.rssi);
    ui.vUp.textContent = up(i.uptime);
    ui.vSeen.textContent = ago(st.seen);
  }

  // ---------------------------------------------------------- mqtt
  function connect() {
    if (client) { client.end(true); client = null; }
    Object.assign(st, { board: "unknown", pin: null, info: null, seen: 0, pending: null });
    if (!cfg.host || !cfg.password || !cfg.deviceId) { st.cloud = "idle"; render(); openSheet(); return; }
    const b = `ledpoc/${cfg.deviceId}/`;
    T = { set: b + "d13/set", state: b + "d13/state", status: b + "status", info: b + "info" };
    st.cloud = "connecting"; render();

    client = mqtt.connect(`wss://${cfg.host}:${cfg.wsPort}/mqtt`, {
      username: cfg.username, password: cfg.password,
      clientId: "phone-" + Math.random().toString(16).slice(2, 10),
      clean: true, keepalive: 30, reconnectPeriod: 3000, connectTimeout: 12000, protocolVersion: 4,
    });
    client.on("connect", () => {
      st.cloud = "connected"; render();
      client.subscribe([T.state, T.status, T.info], { qos: 1 });
    });
    client.on("reconnect", () => { st.cloud = "connecting"; render(); });
    client.on("close", () => { if (st.cloud === "connected") { st.cloud = "connecting"; render(); } });
    client.on("error", (e) => {
      st.cloud = "error"; render();
      const auth = /not authori[sz]ed|bad user/i.test(e.message);
      toast(auth ? "Wrong username or password" : e.message);
      if (auth) { client.end(true); openSheet(); }
    });
    client.on("message", (topic, buf) => {
      const m = buf.toString().trim();
      if (topic === T.status) { st.board = m === "online" ? "online" : "offline"; if (st.board === "online") st.seen = Date.now(); }
      else if (topic === T.state) {
        st.pin = m.toUpperCase() === "ON"; st.seen = Date.now();
        if (st.pending) { clearTimeout(st.pending.timer); st.pending = null; buzz(st.pin ? [18, 40, 18] : 18); }
      } else if (topic === T.info) { try { st.info = JSON.parse(m); st.seen = Date.now(); } catch (_) {} }
      render();
    });
  }

  function send(cmd) {
    if (!client || st.cloud !== "connected" || st.pending) return;
    buzz(10);
    client.publish(T.set, cmd, { qos: 1, retain: false });
    st.pending = { cmd, timer: setTimeout(() => { st.pending = null; toast("No reply from the board"); buzz([60, 60, 60]); render(); }, ACK_MS) };
    render();
  }

  // ---------------------------------------------------------- sheet
  function openSheet() {
    ui.sHost.value = cfg.host; ui.sDev.value = cfg.deviceId; ui.sUser.value = cfg.username; ui.sPass.value = cfg.password; ui.sPort.value = cfg.wsPort;
    ui.backdrop.hidden = false; ui.sheet.classList.add("open"); ui.sheet.setAttribute("aria-hidden", "false");
  }
  function closeSheet() { ui.backdrop.hidden = true; ui.sheet.classList.remove("open"); ui.sheet.setAttribute("aria-hidden", "true"); }
  ui.sheet.addEventListener("submit", (e) => {
    e.preventDefault();
    cfg = {
      host: ui.sHost.value.trim().replace(/^wss?:\/\//, "").replace(/[:/].*$/, ""),
      wsPort: Number(ui.sPort.value) || 8084, deviceId: ui.sDev.value.trim(),
      username: ui.sUser.value.trim(), password: ui.sPass.value,
    };
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {}
    document.activeElement && document.activeElement.blur();
    closeSheet(); connect();
  });
  ui.openSettings.addEventListener("click", openSheet);
  ui.closeSheet.addEventListener("click", closeSheet);
  ui.backdrop.addEventListener("click", closeSheet);

  ui.power.addEventListener("click", () => send(st.pin ? "OFF" : "ON"));
  ui.qOn.addEventListener("click", () => send("ON"));
  ui.qOff.addEventListener("click", () => send("OFF"));

  // reconnect fast when the phone wakes the app up again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && client && !client.connected) client.reconnect();
  });

  // ---------------------------------------------------------- install (PWA)
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!standalone) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    ui.installTip.hidden = false;
    ui.installTip.textContent = ios ? "Install: tap Share → “Add to Home Screen”." : "Install: browser menu → “Add to Home screen” / “Install app”.";
  }
  let deferred;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    ui.installTip.hidden = false; ui.installTip.innerHTML = "";
    const btn = document.createElement("button");
    btn.textContent = "＋ Install R4 Remote on this phone";
    btn.style.cssText = "color:var(--accent);font-weight:800";
    btn.onclick = async () => { deferred.prompt(); await deferred.userChoice; ui.installTip.hidden = true; };
    ui.installTip.append(btn);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  setInterval(render, 5000);
  render();
  connect();
  window.__r4remote = { state: st, send };
})();

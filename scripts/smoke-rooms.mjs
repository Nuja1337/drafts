// End-to-end smoke test for live draft rooms against a running Worker (wrangler dev / vite dev).
// Usage: node scripts/smoke-rooms.mjs [baseUrl]   (default http://127.0.0.1:8792)
// Needs Node 22+ (global fetch + WebSocket). Takes ~40s because it waits for real turn timers.

const BASE = (process.argv[2] ?? process.env.ROOMS_BASE ?? "http://127.0.0.1:8792").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

let passed = 0;
function check(cond, label) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  passed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- format orders (mirrors src/shared/formats.ts; F = first side) ------------------------------
const ORDERS = {
  "lol-tournament": "Fb Sb Fb Sb Fb Sb Fp Sp Sp Fp Fp Sp Sb Fb Sb Fb Sp Fp Fp Sp",
  "dota2-cm": "Fb Fb Sb Sb Fb Sb Sb Fp Sp Fb Fb Sb Sp Fp Fp Sp Sp Fp Fb Sb Fb Sb Fp Sp",
};
const steps = (formatId, firstSide) =>
  ORDERS[formatId].split(" ").map((t) => ({
    side: t[0] === "F" ? firstSide : firstSide === "blue" ? "red" : "blue",
    type: t[1] === "p" ? "pick" : "ban",
  }));

const LOL = (
  "Aatrox Ahri Akali Alistar Amumu Anivia Annie Ashe Azir Bard Blitzcrank Brand Braum Caitlyn Camille Cassiopeia " +
  "Corki Darius Diana Draven Ekko Elise Evelynn Ezreal Fiora Fizz Galio Garen Gnar Gragas Graves Hecarim Irelia Janna " +
  "JarvanIV Jax Jayce Jhin Jinx Kaisa Karma Karthus Kassadin Katarina Kayle"
).split(" ");
const DOTA = (
  "antimage axe bane bloodseeker crystal_maiden drow_ranger earthshaker juggernaut mirana morphling nevermore " +
  "phantom_lancer puck pudge razor sand_king storm_spirit sven tiny vengefulspirit windrunner zuus kunkka lina lion " +
  "shadow_shaman slardar tidehunter witch_doctor lich riki enigma tinker sniper necrolyte warlock beastmaster " +
  "queenofpain venomancer faceless_void skeleton_king death_prophet phantom_assassin pugna templar_assassin viper luna " +
  "dragon_knight dazzle rattletrap"
).split(" ");

// ---- tiny client --------------------------------------------------------------------------------
class Client {
  /**
   * Like useRoom: a key is sent as the first frame of a `?auth=1` socket, never in the URL.
   * opts.query overrides the query string (e.g. the legacy "?key=…"); opts.ip sets cf-connecting-ip (local only).
   */
  constructor(name, roomId, key, opts = {}) {
    this.name = name;
    this.msgs = [];
    this.cursor = 0;
    this.closed = null;
    const query = opts.query ?? (key ? "?auth=1" : "");
    const init = opts.ip ? { headers: { "cf-connecting-ip": opts.ip } } : undefined;
    this.ws = new WebSocket(`${WS_BASE}/api/rooms/${roomId}/ws${query}`, init);
    this.ws.addEventListener("open", () => {
      if (key && opts.query === undefined) this.ws.send(JSON.stringify({ t: "auth", key }));
    });
    this.ws.addEventListener("message", (ev) => {
      if (ev.data === "ka") return this.msgs.push({ t: "ka" });
      this.msgs.push(JSON.parse(ev.data));
    });
    this.ws.addEventListener("close", (ev) => (this.closed = ev.code));
  }
  get state() {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].state) return this.msgs[i].state;
    return null;
  }
  mark() {
    this.cursor = this.msgs.length;
  }
  send(msg) {
    this.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
    this.lastSend = Date.now();
  }
  /** Keeps scripted traffic under the per-socket limit (15 msgs/s). */
  async pace() {
    const wait = (this.lastSend ?? 0) + 85 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  async until(pred, label, ms = 5000) {
    const end = Date.now() + ms;
    for (;;) {
      while (this.cursor < this.msgs.length) {
        const m = this.msgs[this.cursor++];
        if (pred(m)) return m;
      }
      if (Date.now() > end) throw new Error(`timeout waiting for ${label} on ${this.name}`);
      await sleep(15);
    }
  }
  untilState(pred, label, ms) {
    return this.until((m) => m.state && pred(m.state), label, ms).then((m) => m.state);
  }
  /** Sends and expects an error with `code` (label documents the violation). */
  async expectError(msg, code, label) {
    await this.pace();
    this.mark();
    this.send(msg);
    const m = await this.until((x) => x.t === "error", `error ${code}`);
    check(m.code === code, `${label} → ${code} (got ${m.code}: ${m.message})`);
  }
  /** Sends and waits until this client sees a state satisfying pred. */
  async act(msg, pred, label) {
    await this.pace();
    this.mark();
    this.send(msg);
    const m = await this.until((x) => (x.state && pred(x.state)) || x.t === "error", label);
    if (m.t === "error") throw new Error(`FAILED: ${label}: server error ${m.code}: ${m.message}`);
    passed++;
    return m.state;
  }
  close() {
    this.ws.close(1000);
  }
}

async function connect(name, roomId, key, opts) {
  const c = new Client(name, roomId, key, opts);
  const w = await c.until((m) => m.t === "welcome" || m.t === "error", `welcome for ${name}`);
  if (w.t !== "welcome") throw new Error(`${name} could not join: ${w.code}`);
  c.you = w.you;
  return c;
}

/** Waits until the socket is closed; returns the close code. */
async function closedCode(c, ms = 3000) {
  const end = Date.now() + ms;
  while (c.closed === null && Date.now() < end) await sleep(20);
  return c.closed;
}

async function createRoom(config) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config }),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const baseConfig = (over) => ({
  game: "lol",
  formatId: "lol-tournament",
  mode: "captains",
  bestOf: 3,
  fearless: "soft",
  timer: { enabled: true, pickSeconds: 60, banSeconds: 60 },
  teams: { A: { name: "Alpha", profileId: null }, B: { name: "Bravo", profileId: null } },
  ...over,
});

const capFor = (state, side, caps) => caps[state.sides[side]];
const otherCap = (state, side, caps) => caps[state.sides[side === "blue" ? "red" : "blue"]];

// ---- 1. captains-mode LoL room ----------------------------------------------------------------------
async function captainsLol() {
  console.log("• captains-mode LoL tournament room (soft fearless, Bo3)");
  const room = await createRoom(baseConfig());
  check(room.captainKeys?.A && room.captainKeys?.B, "captain keys issued");
  const host = await connect("host", room.roomId, room.hostKey);
  const A = await connect("capA", room.roomId, room.captainKeys.A);
  const B = await connect("capB", room.roomId, room.captainKeys.B);
  const spec = await connect("spec", room.roomId, null);
  check(host.you.kind === "host", "host role");
  check(A.you.kind === "captain" && A.you.slot === "A", "captain A role");
  check(B.you.kind === "captain" && B.you.slot === "B", "captain B role");
  check(spec.you.kind === "spectator", "spectator role");

  const bad = new Client("badkey", room.roomId, "cap_notavalidkey");
  const bw = await bad.until((m) => m.t === "welcome", "bad key welcome");
  check(bw.you.kind === "spectator", "bad key joins as spectator");
  await bad.until((m) => m.t === "error" && m.code === "bad_key", "bad_key error");
  passed++;

  const p = await host.untilState((s) => s.presence.spectators === 2 && s.presence.A === 1 && s.presence.B === 1, "presence");
  check(p.presence.host === 1, "presence counts per role");
  bad.close();
  await host.untilState((s) => s.presence.spectators === 1, "presence after disconnect");
  passed++;

  const http = await (await fetch(`${BASE}/api/rooms/${room.roomId}`)).json();
  check(http.id === room.roomId && http.status === "lobby" && http.presence.host === 1, "GET /api/rooms/:id with live presence");

  // lobby permissions + protocol hygiene
  await spec.expectError({ t: "ready", ready: true }, "forbidden", "spectator ready");
  await A.expectError({ t: "start" }, "forbidden", "captain start");
  await A.expectError({ t: "setTeam", slot: "B", name: "Hijack" }, "forbidden", "captain renames other team");
  await host.expectError({ t: "lock", championId: "Ahri" }, "not_drafting", "lock in lobby");
  await spec.expectError("not json", "bad_message", "non-JSON message");
  await spec.expectError({ t: "lock", championId: "x".repeat(3000) }, "too_large", "oversized message");
  await spec.expectError({ t: "explode" }, "bad_message", "unknown message type");
  await A.act({ t: "setTeam", slot: "A", name: "  Alpha   Squad " }, (s) => s.config.teams.A.name === "Alpha Squad", "captain renames own team");

  // ping / pong
  host.mark();
  host.send({ t: "ping" });
  const pong = await host.until((m) => m.t === "pong", "pong");
  check(Math.abs(pong.serverTime - Date.now()) < 5000, "pong carries server time");

  // ready → auto-start
  await A.act({ t: "ready", ready: true }, (s) => s.ready.A, "A ready");
  let s = await B.act({ t: "ready", ready: true }, (st) => st.status === "drafting", "B ready auto-starts");
  check(s.turnDeadline > Date.now() + 50_000, "turn deadline set on start");

  // draft game 1 with violations along the way
  const caps = { A, B };
  const order = steps("lol-tournament", "blue");
  let champ = 0;
  const game1Picks = { A: [], B: [] };
  for (let i = 0; i < order.length; i++) {
    const st = order[i];
    const cur = host.state;
    const actor = capFor(cur, st.side, caps);
    const wrong = otherCap(cur, st.side, caps);
    if (i === 0) {
      await wrong.expectError({ t: "lock", championId: "Zed" }, "not_your_turn", "wrong captain locks");
      await spec.expectError({ t: "lock", championId: "Zed" }, "forbidden", "spectator locks");
      await wrong.expectError({ t: "hover", championId: "Zed" }, "not_your_turn", "wrong captain hovers");
      await actor.expectError({ t: "lock", championId: "no spaces!" }, "bad_champion", "invalid champion id");
      await actor.act({ t: "hover", championId: LOL[champ] }, (x) => x.hovers.blue === LOL[champ], "captain hovers");
    }
    if (i === 1) {
      await actor.expectError({ t: "lock", championId: LOL[0] }, "unavailable", "lock already-banned champion");
      // skip this ban on purpose
      await actor.act({ t: "lock", championId: null }, (x) => x.actions.length === 2, "skip ban with null");
      continue;
    }
    if (i === 6) await actor.expectError({ t: "lock", championId: null }, "pick_required", "null pick");
    if (i === 8) {
      // host undo: lock then undo then relock
      await actor.act({ t: "lock", championId: "Teemo" }, (x) => x.actions.length === 9, "lock before undo");
      await A.expectError({ t: "undo" }, "forbidden", "captain undo");
      await host.act({ t: "undo" }, (x) => x.actions.length === 8, "host undo");
      // pause / resume keeps remaining time
      const before = host.state.turnDeadline;
      const paused = await host.act({ t: "pause" }, (x) => x.status === "paused", "host pause");
      check(paused.pausedRemainingMs > 0 && paused.pausedRemainingMs <= before - Date.now() + 1000, "paused keeps remaining ms");
      await actor.expectError({ t: "lock", championId: "Teemo" }, "not_drafting", "lock while paused");
      await B.expectError({ t: "resume" }, "forbidden", "captain resume");
      await sleep(300);
      const resumed = await host.act({ t: "resume" }, (x) => x.status === "drafting", "host resume");
      const expected = Date.now() + paused.pausedRemainingMs;
      check(Math.abs(resumed.turnDeadline - expected) < 1500, "resume restores remaining time");
    }
    if (i === 10) {
      // host may act for any side (admin override)
      const id = LOL[++champ];
      await host.act({ t: "lock", championId: id }, (x) => x.actions.length === i + 1, "host locks for a side");
      game1Picks[cur.sides[st.side]].push(id);
      continue;
    }
    const id = i === 0 ? LOL[0] : LOL[++champ];
    s = await actor.act({ t: "lock", championId: id }, (x) => x.actions.length === i + 1, `step ${i} ${st.side} ${st.type}`);
    check(s.actions[i].side === st.side && s.actions[i].type === st.type, `step ${i} follows tournament order`);
    if (st.type === "pick") game1Picks[cur.sides[st.side]].push(id);
  }
  s = host.state;
  check(s.actions.length === 20, "20 actions");
  check(s.actions.filter((a) => a.type === "pick" && a.side === "blue").length === 5, "blue has 5 picks");
  check(s.actions.filter((a) => a.type === "pick" && a.side === "red").length === 5, "red has 5 picks");
  check(s.actions[1].championId === null, "skipped ban recorded as null");
  check(s.turnDeadline === null && s.status === "drafting", "complete draft: no deadline");
  await A.expectError({ t: "lock", championId: "Yasuo" }, "draft_complete", "lock after completion");

  // result + next game (swap sides)
  await A.expectError({ t: "setWinner", winner: "A" }, "forbidden", "captain setWinner");
  s = await host.act({ t: "setWinner", winner: "A" }, (x) => x.history.length === 1, "host setWinner");
  check(s.history[0].winner === "A" && s.status === "drafting", "result recorded, series continues");
  await host.expectError({ t: "nextGame", sides: { blue: "A", red: "A" }, firstSide: "blue" }, "bad_sides", "invalid sides");
  s = await host.act(
    { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" },
    (x) => x.gameNumber === 2,
    "nextGame with swapped sides",
  );
  check(s.status === "lobby" && s.actions.length === 0 && s.sides.blue === "B", "game 2 lobby with swapped sides");
  await A.act({ t: "ready", ready: true }, (x) => x.ready.A, "A ready g2");
  await B.act({ t: "ready", ready: true }, (x) => x.status === "drafting", "B ready g2");

  // soft fearless: B is blue now. Ban an A game-1 pick (bans are never locked).
  s = await B.act({ t: "lock", championId: game1Picks.A[0] }, (x) => x.actions.length === 1, "ban a fearless champion");
  // run the remaining bans as skips (host override)
  while (steps("lol-tournament", "blue")[host.state.actions.length].type === "ban") {
    const n = host.state.actions.length;
    await host.act({ t: "lock", championId: null }, (x) => x.actions.length === n + 1, "skip ban g2");
  }
  // blue (B) first pick: its own game-1 champion is locked, A's is fine
  await B.expectError({ t: "lock", championId: game1Picks.B[0] }, "fearless_locked", "soft: team re-picks own champion");
  await B.act({ t: "lock", championId: game1Picks.A[1] }, (x) => x.actions.length === 7, "soft: pick opponent's old champion");
  // red (A): its own old picks are locked even though it switched sides
  await A.expectError({ t: "lock", championId: game1Picks.A[2] }, "fearless_locked", "soft: locks follow the team across sides");
  await A.act({ t: "lock", championId: game1Picks.B[1] }, (x) => x.actions.length === 8, "soft: A takes B's old champion");

  // reset + reconnect keeps state
  await host.act({ t: "reset" }, (x) => x.status === "lobby" && x.actions.length === 0, "host reset");
  host.close();
  const host2 = await connect("host2", room.roomId, room.hostKey);
  check(host2.you.kind === "host" && host2.state.gameNumber === 2 && host2.state.history.length === 1, "reconnect restores persisted state");

  for (const c of [host2, A, B, spec]) c.close();
}

// ---- 2. timers ------------------------------------------------------------------------------------
async function timers() {
  console.log("• turn timer: auto-lock hover, skip ban, pause on empty pick (~35s)");
  const room = await createRoom(baseConfig({ bestOf: 1, fearless: "off", timer: { enabled: true, pickSeconds: 10, banSeconds: 10 } }));
  const host = await connect("host", room.roomId, room.hostKey);
  const A = await connect("capA", room.roomId, room.captainKeys.A);
  const B = await connect("capB", room.roomId, room.captainKeys.B);
  await host.act({ t: "start" }, (x) => x.status === "drafting", "host force start");
  await A.act({ t: "hover", championId: "Ahri" }, (x) => x.hovers.blue === "Ahri", "hover before timeout");
  host.mark();
  let s = await host.untilState((x) => x.actions.length === 1, "auto-lock hovered ban", 14_000);
  check(s.actions[0].championId === "Ahri" && s.actions[0].auto === true, "timeout locks the hover (auto)");
  s = await host.untilState((x) => x.actions.length === 2, "auto-skip ban", 14_000);
  check(s.actions[1].championId === null && s.actions[1].auto === true, "timeout skips a ban without hover");
  for (let n = 2; n < 6; n++) await host.act({ t: "lock", championId: null }, (x) => x.actions.length === n + 1, "skip bans");
  host.mark();
  const err = await host.until((m) => m.t === "error" && m.code === "timer_expired", "timer_expired broadcast", 14_000);
  check(/paused/.test(err.message), "timer_expired error broadcast");
  s = host.state;
  check(s.status === "paused" && s.actions.length === 6, "pick timeout without hover pauses the draft");
  s = await host.act({ t: "resume" }, (x) => x.status === "drafting", "resume after timeout");
  check(Math.abs(s.turnDeadline - (Date.now() + 10_000)) < 1500, "resume after timeout grants a full turn");
  await sleep(3000);
  s = await host.act({ t: "pause" }, (x) => x.status === "paused", "pause mid-turn");
  check(s.pausedRemainingMs > 5000 && s.pausedRemainingMs < 8000, `pause keeps ~7s (${s.pausedRemainingMs}ms)`);
  const remaining = s.pausedRemainingMs;
  s = await host.act({ t: "resume" }, (x) => x.status === "drafting", "resume mid-turn");
  check(Math.abs(s.turnDeadline - (Date.now() + remaining)) < 1500, "resume restores the remaining time");
  // rate limit: a burst of pings is cut off
  B.mark();
  for (let i = 0; i < 30; i++) B.send({ t: "ping" });
  await B.until((m) => m.t === "error" && m.code === "rate_limited", "rate limit");
  passed++;
  for (const c of [host, A, B]) c.close();
}

// ---- 3. Dota CM, host mode, hard fearless ----------------------------------------------------------
async function dotaHostMode() {
  console.log("• Dota 2 Captains Mode in host mode (hard fearless, Bo3)");
  const room = await createRoom(
    baseConfig({ game: "dota2", formatId: "dota2-cm", mode: "host", fearless: "hard", timer: { enabled: false, pickSeconds: 30, banSeconds: 30 } }),
  );
  check(room.captainKeys === undefined, "no captain keys in host mode");
  const host = await connect("host", room.roomId, room.hostKey);
  const spec = await connect("spec", room.roomId, null);
  await host.act({ t: "start" }, (x) => x.status === "drafting" && x.turnDeadline === null, "start without timer");
  await spec.expectError({ t: "lock", championId: "axe" }, "forbidden", "spectator locks in host mode");
  const order = steps("dota2-cm", "blue");
  const g1 = [];
  for (let i = 0; i < order.length; i++) {
    const s = await host.act({ t: "lock", championId: DOTA[i] }, (x) => x.actions.length === i + 1, `cm step ${i}`);
    check(s.actions[i].side === order[i].side && s.actions[i].type === order[i].type, `cm step ${i} matches 7.40 order`);
    if (order[i].type === "pick") g1.push(DOTA[i]);
  }
  check(host.state.actions.filter((a) => a.type === "ban").length === 14, "CM has 14 bans");
  await host.act({ t: "setWinner", winner: "B" }, (x) => x.history.length === 1, "setWinner g1");
  await host.act({ t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "red" }, (x) => x.gameNumber === 2, "nextGame, Dire first");
  let s = await host.act({ t: "start" }, (x) => x.status === "drafting", "start g2");
  // red acts first now; banning a fearless-locked hero is allowed
  s = await host.act({ t: "lock", championId: g1[0] }, (x) => x.actions.length === 1, "hard: ban an old pick");
  check(s.actions[0].side === "red", "first side red acts first");
  for (let n = 1; n < 7; n++) await host.act({ t: "lock", championId: null }, (x) => x.actions.length === n + 1, "skip bans g2");
  await host.expectError({ t: "lock", championId: g1[1] }, "fearless_locked", "hard: any old pick is locked (first side)");
  await host.act({ t: "lock", championId: DOTA[40] }, (x) => x.actions.length === 8, "fresh pick ok");
  await host.expectError({ t: "lock", championId: g1[2] }, "fearless_locked", "hard: any old pick is locked (other side)");
  await host.act({ t: "undo" }, (x) => x.actions.length === 7, "undo in host mode");
  for (const c of [host, spec]) c.close();
}

// ---- 4. auth, capacity, captain link rotation, write budget --------------------------------------
async function accessControl() {
  console.log("• keys over the socket, per-role capacity, link rotation, write budget");
  const room = await createRoom(baseConfig({ bestOf: 1, fearless: "off", timer: { enabled: false, pickSeconds: 30, banSeconds: 30 } }));

  // keys never in the URL: an old-style ?key= socket only gets spectator access
  const legacy = new Client("legacy", room.roomId, null, { query: `?key=${encodeURIComponent(room.hostKey)}` });
  const lw = await legacy.until((m) => m.t === "welcome", "legacy welcome");
  check(lw.you.kind === "spectator", "?key= in the URL is ignored (spectator)");
  await legacy.until((m) => m.t === "error" && m.code === "reload_required", "reload_required");
  passed++;
  // a spectator socket can sign in later and gets a fresh welcome
  legacy.mark();
  legacy.send({ t: "auth", key: room.hostKey });
  const re = await legacy.until((m) => m.t === "welcome", "welcome after late auth");
  check(re.you.kind === "host", "late auth upgrades the socket to host");
  legacy.close();
  // a ?auth socket must sign in before anything else
  const early = new Client("early", room.roomId, null, { query: "?auth=1" });
  await new Promise((r) => early.ws.addEventListener("open", r));
  early.send({ t: "ready", ready: true });
  const ar = await early.until((m) => m.t === "error" || m.t === "welcome", "auth_required");
  check(ar.t === "error" && ar.code === "auth_required", `pending socket can't act before auth (got ${ar.t} ${ar.code})`);
  early.send({ t: "auth", key: room.captainKeys.A });
  const ew = await early.until((m) => m.t === "welcome", "welcome after auth");
  check(ew.you.kind === "captain" && ew.you.slot === "A", "pending socket welcomed in its key's role");
  early.close();

  // spectator flood from one network: capped per network; keyed roles still get in
  const flood = [];
  for (let i = 0; i < 24; i++) flood.push(new Client(`spec${i}`, room.roomId, null));
  const results = await Promise.all(flood.map((c) => c.until((m) => m.t === "welcome" || m.t === "error", `flood ${c.name}`)));
  const welcomed = results.filter((m) => m.t === "welcome").length;
  const full = results.filter((m) => m.t === "error" && m.code === "room_full").length;
  check(welcomed === 20 && full === 4, `20 spectators per network, the rest room_full (${welcomed} welcomed, ${full} full)`);
  const rejected = flood.find((c, i) => results[i].t === "error");
  check((await closedCode(rejected)) === 4429, "room_full closes with 4429");
  const host = await connect("host", room.roomId, room.hostKey);
  const A = await connect("capA", room.roomId, room.captainKeys.A);
  check(host.you.kind === "host" && A.you.kind === "captain", "host and captain join a spectator-full room");
  const badWhenFull = new Client("bad-full", room.roomId, "cap_notavalidkey");
  const bf = await badWhenFull.until((m) => m.t === "error" || m.t === "welcome", "bad key when full");
  check(bf.t === "error" && bf.code === "room_full", "a bad key can't use the keyed path to skip the spectator cap");
  for (const c of flood) c.close();

  // one key, too many sockets: the oldest is replaced (4409, final) instead of refusing the new one
  const hosts = [];
  for (let i = 0; i < 10; i++) hosts.push(await connect(`host${i}`, room.roomId, room.hostKey));
  check((await closedCode(host)) === 4409, "11th host socket replaces the oldest (4409)");
  check(host.msgs.some((m) => m.t === "error" && m.code === "replaced"), "replaced socket is told why");
  const pres = await hosts[9].untilState((s) => s.presence.host === 10 && s.presence.spectators === 0, "presence after flood", 5000);
  check(pres.presence.A === 1, "presence per role after replacement");

  // captain link rotation
  await A.expectError({ t: "rotateKey", slot: "B" }, "forbidden", "captain rotates a link");
  const h = hosts[9];
  h.mark();
  h.send({ t: "rotateKey", slot: "A" });
  const rot = await h.until((m) => m.t === "keyRotated", "keyRotated");
  check(rot.slot === "A" && rot.key.startsWith("cap_") && rot.key !== room.captainKeys.A, "host gets a new captain A key");
  check(!hosts.slice(0, 9).some((c) => c.msgs.some((m) => m.t === "keyRotated")), "only the calling socket receives the new key");
  check((await closedCode(A)) === 4001, "old captain A socket closed with 4001");
  const oldA = new Client("oldA", room.roomId, room.captainKeys.A);
  const ow = await oldA.until((m) => m.t === "welcome", "old key welcome");
  check(ow.you.kind === "spectator", "old captain key now joins as spectator");
  await oldA.until((m) => m.t === "error" && m.code === "bad_key", "old key bad_key");
  passed++;
  const newA = await connect("newA", room.roomId, rot.key);
  check(newA.you.kind === "captain" && newA.you.slot === "A", "new captain key works");

  // write budget per role: a burst across many sockets of one key is cut off, other roles are unaffected
  await h.act({ t: "start" }, (x) => x.status === "drafting", "start for budget test");
  const champs = ["Ahri", "Zed", "Lux", "Jinx", "Garen", "Annie"];
  for (const c of hosts) c.mark();
  let sent = 0;
  for (let round = 0; round < 6; round++) {
    for (const c of hosts) c.send({ t: "hover", championId: champs[sent++ % champs.length] });
  }
  await sleep(600);
  const limited = hosts.reduce((n, c) => n + c.msgs.slice(c.cursor).filter((m) => m.t === "error" && m.code === "rate_limited").length, 0);
  check(sent === 60 && limited >= 15, `host burst of ${sent} hovers over 10 sockets: ${limited} rejected by the role budget`);
  // team A is on blue, which acts first
  await newA.act({ t: "hover", championId: "Teemo" }, (x) => x.hovers.blue === "Teemo", "other role unaffected by the host's budget");
  for (const c of [...hosts, oldA, newA, badWhenFull]) c.close();
}

async function missingRoom() {
  const c = new Client("ghost", "zzzzzzzz", null);
  const m = await c.until((x) => x.t === "error", "not_found over ws");
  check(m.code === "not_found", "unknown room explained over the socket");
  for (let i = 0; i < 100 && c.closed === null; i++) await sleep(20);
  check(c.closed === 4404, `unknown room closes with 4404 (got ${c.closed})`);
}

try {
  await missingRoom();
  await accessControl();
  await captainsLol();
  await dotaHostMode();
  await timers();
  console.log(`\nOK — ${passed} checks passed`);
  process.exit(0);
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}\n(${passed} checks passed before the failure)`);
  process.exit(1);
}

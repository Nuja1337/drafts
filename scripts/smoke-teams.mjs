// End-to-end smoke test for the Teams API against a running local Worker (it creates and deletes its own teams).
//   npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state-teams
//   CF_PERSIST=.wrangler/state-teams npx vite --port 8791      (or any `wrangler dev` serving /api on that port)
//   node scripts/smoke-teams.mjs [baseUrl]                     (default http://127.0.0.1:8791)
// Each request carries a distinct cf-connecting-ip so the local WRITE_LIMITER (40/min per IP) doesn't trip mid-run;
// the last section deliberately trips it from one IP.
const BASE = (process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:8791").replace(/\/+$/, "");

let passed = 0;
let failed = 0;
let ip = 0;

async function call(method, path, { body, key, raw, sameIp } = {}) {
  const headers = { "cf-connecting-ip": sameIp ?? `10.${(ip >> 8) & 255}.${ip++ & 255}.1` };
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

/** Asserts status (and an optional predicate on the JSON), returns the response. */
async function expect(name, promise, status, pred) {
  const r = await promise;
  let ok = r.status === status;
  let why = `status ${r.status} (want ${status}) ${r.text.slice(0, 300)}`;
  if (ok && pred) {
    try {
      ok = !!pred(r.json);
      if (!ok) why = `predicate failed: ${r.text.slice(0, 400)}`;
    } catch (e) {
      ok = false;
      why = `predicate threw ${e}: ${r.text.slice(0, 300)}`;
    }
  }
  check(name, ok, ok ? "" : why);
  return r;
}

const errCode = (code) => (j) => j?.error?.code === code;
const noSecrets = (j) => !/key_?hash|ownerKeyHash|owner_key/i.test(JSON.stringify(j));
const section = (s) => console.log(`\n${s}`);

async function main() {
  section("health");
  await expect("GET /health", call("GET", "/health"), 200, (j) => j.ok === true);

  section("create team — validation");
  await expect("missing name → 422", call("POST", "/teams", { body: { game: "lol" } }), 422, errCode("invalid"));
  await expect("name too long → 422", call("POST", "/teams", { body: { name: "x".repeat(41), game: "lol" } }), 422);
  await expect("blank name → 422", call("POST", "/teams", { body: { name: "   ", game: "lol" } }), 422);
  await expect("bad game → 422", call("POST", "/teams", { body: { name: "A", game: "chess" } }), 422);
  await expect("tag too long → 422", call("POST", "/teams", { body: { name: "A", game: "lol", tag: "123456789" } }), 422);
  await expect("unknown field → 422", call("POST", "/teams", { body: { name: "A", game: "lol", admin: true } }), 422, (j) =>
    /Unrecognized key/.test(j.error.message),
  );
  await expect("name with control char → 422", call("POST", "/teams", { body: { name: "A\u0007B", game: "lol" } }), 422);
  await expect("invalid JSON → 400", call("POST", "/teams", { raw: "{nope" }), 400, errCode("bad_json"));
  await expect("empty body → 400", call("POST", "/teams", { raw: "" }), 400);
  await expect("array body → 422", call("POST", "/teams", { body: [] }), 422);
  await expect("70KB body → 413", call("POST", "/teams", { raw: JSON.stringify({ name: "A", game: "lol", pad: "x".repeat(70_000) }) }), 413, errCode("too_large"));

  section("create team");
  const created = await expect(
    "POST /teams (lol) → 201",
    call("POST", "/teams", { body: { name: "  Smoke Squad  ", game: "lol", tag: "SMK" } }),
    201,
    (j) =>
      j.team.name === "Smoke Squad" &&
      j.team.kind === "team" &&
      j.team.players.length === 0 &&
      j.ownerKey.startsWith("own_") &&
      j.viewKey.startsWith("view_") &&
      /^[a-z0-9]{8}$/.test(j.inviteCode) &&
      noSecrets(j),
  );
  const T = created.json.team.id;
  let ownerKey = created.json.ownerKey;
  let viewKey = created.json.viewKey;
  let invite = created.json.inviteCode;
  const other = await expect("POST /teams (dota2 scout) → 201", call("POST", "/teams", { body: { name: "Rivals", game: "dota2", kind: "scout" } }), 201, (j) => j.team.kind === "scout");
  const T2 = other.json.team.id;
  const owner2 = other.json.ownerKey;

  section("get team — auth");
  await expect("unknown team → 404", call("GET", "/teams/zzzzzzzzzz", { key: ownerKey }), 404, errCode("team_not_found"));
  await expect("malformed id → 404", call("GET", "/teams/NOT_AN_ID!", { key: ownerKey }), 404);
  await expect("no key → 401", call("GET", `/teams/${T}`), 401, errCode("unauthorized"));
  await expect("garbage key → 401", call("GET", `/teams/${T}`, { key: "own_garbage" }), 401, errCode("invalid_key"));
  await expect("other team's owner key → 401", call("GET", `/teams/${T}`, { key: owner2 }), 401);
  const og = await expect("owner → 200 with inviteCode/viewKey", call("GET", `/teams/${T}`, { key: ownerKey }), 200, (j) =>
    j.you.kind === "owner" && j.inviteCode === invite && j.viewKey === viewKey && noSecrets(j),
  );
  check("no-store cache header", og.headers.get("cache-control") === "no-store");
  await expect("viewer → 200 without secrets", call("GET", `/teams/${T}`, { key: viewKey }), 200, (j) =>
    j.you.kind === "viewer" && j.inviteCode === undefined && j.viewKey === undefined,
  );

  section("patch team");
  await expect("viewer PATCH → 403", call("PATCH", `/teams/${T}`, { key: viewKey, body: { name: "Hacked" } }), 403);
  await expect("no key PATCH → 401", call("PATCH", `/teams/${T}`, { body: { name: "Hacked" } }), 401);
  await expect("bad archetype → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { preferredArchetypes: ["turtle"] } }), 422);
  await expect("dup archetype → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { preferredArchetypes: ["poke", "poke"] } }), 422);
  await expect("override a==b → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { overrides: [{ a: "Ahri", b: "Ahri", adv: 0.2 }] } }), 422);
  await expect("override adv 2 → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { overrides: [{ a: "Ahri", b: "Zed", adv: 2 }] } }), 422);
  await expect("override bad id → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { overrides: [{ a: "Ah ri", b: "Zed", adv: 0 }] } }), 422);
  const many = Array.from({ length: 301 }, (_, i) => ({ a: `C${i}`, b: "Zed", adv: 0 }));
  await expect("301 overrides → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { overrides: many } }), 422, (j) => /At most 300/.test(j.error.message));
  await expect("notes 4001 → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { notes: "n".repeat(4001) } }), 422);
  await expect("locked non-bool → 422", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { locked: "yes" } }), 422);
  await expect(
    "owner PATCH → 200",
    call("PATCH", `/teams/${T}`, {
      key: ownerKey,
      body: {
        name: "Smoke Squad Prime",
        notes: "Play around bot.",
        preferredArchetypes: ["engage", "protect"],
        avoidArchetypes: ["split"],
        overrides: [{ a: "Ahri", b: "Zed", adv: -0.3, note: "we lose this" }],
      },
    }),
    200,
    (j) => j.team.name === "Smoke Squad Prime" && j.team.overrides.length === 1 && j.team.preferredArchetypes.length === 2,
  );
  await expect("no-op PATCH → 200", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { name: "Smoke Squad Prime" } }), 200);

  section("players + invites");
  const add = await expect("owner adds Alice → 201", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "Alice" } }), 201, (j) =>
    j.team.players.some((p) => p.id === j.playerId && p.name === "Alice" && p.claimed === false),
  );
  const aliceId = add.json.playerId;
  await expect("duplicate name (case-insensitive) → 409", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "ALICE" } }), 409, errCode("name_taken"));
  await expect("viewer add player → 403", call("POST", `/teams/${T}/players`, { key: viewKey, body: { name: "Mallory" } }), 403);
  await expect("player name too long → 422", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "p".repeat(33) } }), 422);
  await expect("name with bidi override → 422", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "Al\u202Eice" } }), 422);

  await expect("invite info → 200", call("GET", `/invites/${T}/${invite}`), 200, (j) =>
    j.teamId === T && j.teamName === "Smoke Squad Prime" && j.game === "lol" && j.locked === false && j.openSlots.length === 1 && j.openSlots[0].id === aliceId && j.canCreate === true,
  );
  await expect("wrong invite code → 404", call("GET", `/invites/${T}/wrongcode`), 404, errCode("invite_not_found"));
  await expect("join with neither → 422", call("POST", `/invites/${T}/${invite}/join`, { body: {} }), 422);
  await expect("join unknown field → 422", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Bob", owner: true } }), 422);
  const bobJoin = await expect("join as new player Bob → 200", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Bob" } }), 200, (j) =>
    j.playerKey.startsWith("ply_") && j.team.players.find((p) => p.id === j.playerId)?.claimed === true && noSecrets(j),
  );
  const bobId = bobJoin.json.playerId;
  const bobKey = bobJoin.json.playerKey;
  await expect("join duplicate name → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "bob" } }), 409, errCode("name_taken"));
  const aliceJoin = await expect("claim Alice slot → 200", call("POST", `/invites/${T}/${invite}/join`, { body: { playerId: aliceId } }), 200, (j) =>
    j.playerId === aliceId && j.team.players.find((p) => p.id === aliceId)?.claimed === true,
  );
  const aliceKey = aliceJoin.json.playerKey;
  await expect("claim taken slot → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { playerId: aliceId } }), 409, errCode("slot_taken"));
  await expect("claim unknown slot → 404", call("POST", `/invites/${T}/${invite}/join`, { body: { playerId: "zzzzzzzzzz" } }), 404);
  // impersonation: invisible characters are invalid; look-alikes and system names are taken
  for (const [label, name] of [["zero-width space", "Alice​"], ["zero-width joiner", "Al‍ice"], ["soft hyphen", "Ali­ce"], ["Hangul filler", "Aliceㅤ"]]) {
    await expect(`join as "Alice"+${label} → 422`, call("POST", `/invites/${T}/${invite}/join`, { body: { name } }), 422);
  }
  await expect("join as Cyrillic look-alike of Alice → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Аlice" } }), 409, errCode("name_taken"));
  await expect("join as 'B o b' → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "B o b" } }), 409, errCode("name_taken"));
  await expect("join as 'Owner' → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Owner" } }), 409, errCode("name_taken"));
  await expect("owner adds 'owner' → 409", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "owner" } }), 409, errCode("name_taken"));
  await expect("rename to reserved name → 409", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { name: "System" } }), 409, errCode("name_taken"));
  await expect("invite info: no open slots", call("GET", `/invites/${T}/${invite}`), 200, (j) => j.openSlots.length === 0);

  section("player edits");
  await expect("player GET → you.kind player, no secrets", call("GET", `/teams/${T}`, { key: bobKey }), 200, (j) =>
    j.you.kind === "player" && j.you.playerId === bobId && j.inviteCode === undefined,
  );
  const bobProfile = {
    roles: [{ role: "mid", pref: "main" }, { role: "top", pref: "fill" }],
    pool: [
      { championId: "Ahri", comfort: 5, roles: ["mid"], note: "signature" },
      { championId: "Orianna", comfort: 3 },
    ],
    playstyles: ["control-mage", "teamfighter"],
    strengths: ["laning", "vs-poke"],
    weaknesses: ["vs-burst"],
    avoid: [{ championId: "Zed", severity: 3, note: "  " }],
    notes: "Likes to play safe.",
  };
  await expect("player edits own profile → 200", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: bobProfile }), 200, (j) => {
    const b = j.team.players.find((p) => p.id === bobId);
    return b.pool.length === 2 && b.roles[0].role === "mid" && b.avoid[0].note === undefined && b.playstyles.includes("control-mage");
  });
  await expect("player edits other player → 403", call("PUT", `/teams/${T}/players/${aliceId}`, { key: bobKey, body: { notes: "griefed" } }), 403, errCode("forbidden"));
  await expect("viewer edits player → 403", call("PUT", `/teams/${T}/players/${bobId}`, { key: viewKey, body: { notes: "x" } }), 403);
  await expect("dota role on lol team → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { roles: [{ role: "pos1", pref: "main" }] } }), 422);
  await expect("comfort 6 → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { pool: [{ championId: "Ahri", comfort: 6 }] } }), 422);
  await expect("severity 4 → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { avoid: [{ championId: "Zed", severity: 4 }] } }), 422);
  await expect("bad playstyle → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { playstyles: ["afk"] } }), 422);
  await expect("bad trait → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { strengths: ["flaming"] } }), 422);
  await expect("dup pool champ → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { pool: [{ championId: "Ahri", comfort: 1 }, { championId: "Ahri", comfort: 2 }] } }), 422);
  const bigPool = Array.from({ length: 81 }, (_, i) => ({ championId: `C${i}`, comfort: 3 }));
  await expect("81 pool entries → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { pool: bigPool } }), 422);
  const bigAvoid = Array.from({ length: 51 }, (_, i) => ({ championId: `C${i}`, severity: 1 }));
  await expect("51 avoid entries → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { avoid: bigAvoid } }), 422);
  await expect("bad champion id → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { pool: [{ championId: "Kai'Sa", comfort: 3 }] } }), 422);
  await expect("unknown player field → 422", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { claimed: false } }), 422);
  await expect("rename to taken name → 409", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { name: "alice" } }), 409);
  await expect("unknown player (owner) → 404", call("PUT", `/teams/${T}/players/zzzzzzzzzz`, { key: ownerKey, body: { notes: "x" } }), 404);
  await expect("player PATCH team → 403", call("PATCH", `/teams/${T}`, { key: bobKey, body: { name: "Mine now" } }), 403);
  await expect("player rotate keys → 403", call("POST", `/teams/${T}/keys/rotate`, { key: bobKey, body: { which: "owner" } }), 403);
  await expect("player delete team → 403", call("DELETE", `/teams/${T}`, { key: bobKey }), 403);
  await expect("player release other → 403", call("POST", `/teams/${T}/players/${aliceId}/release`, { key: bobKey }), 403);

  section("dota2 roles");
  const d2p = await expect("add dota player → 201", call("POST", `/teams/${T2}/players`, { key: owner2, body: { name: "Carry" } }), 201);
  await expect("pos1 on dota team → 200", call("PUT", `/teams/${T2}/players/${d2p.json.playerId}`, { key: owner2, body: { roles: [{ role: "pos1", pref: "main" }], pool: [{ championId: "antimage", comfort: 4, roles: ["pos1"] }] } }), 200);
  await expect("lol role on dota team → 422", call("PUT", `/teams/${T2}/players/${d2p.json.playerId}`, { key: owner2, body: { roles: [{ role: "top", pref: "main" }] } }), 422);
  await expect("cross-team: owner2 edits team 1 player → 401", call("PUT", `/teams/${T}/players/${bobId}`, { key: owner2, body: { notes: "x" } }), 401);

  section("lock");
  await expect("owner locks → 200", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { locked: true } }), 200, (j) => j.team.locked === true);
  await expect("player edit while locked → 403", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { notes: "sneaky" } }), 403, errCode("team_locked"));
  await expect("invite shows locked", call("GET", `/invites/${T}/${invite}`), 200, (j) => j.locked === true);
  await expect("join while locked → 403", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Carol" } }), 403, errCode("team_locked"));
  await expect("owner edits Bob while locked → 200", call("PUT", `/teams/${T}/players/${bobId}`, { key: ownerKey, body: { notes: "Owner note" } }), 200, (j) =>
    j.team.players.find((p) => p.id === bobId).notes === "Owner note",
  );
  await expect("owner unlocks → 200", call("PATCH", `/teams/${T}`, { key: ownerKey, body: { locked: false } }), 200, (j) => j.team.locked === false);
  await expect("player edit after unlock → 200", call("PUT", `/teams/${T}/players/${bobId}`, { key: bobKey, body: { pool: [{ championId: "Ahri", comfort: 5 }] } }), 200);

  section("audit");
  await expect("viewer audit → 403", call("GET", `/teams/${T}/audit`, { key: viewKey }), 403);
  await expect("no key audit → 401", call("GET", `/teams/${T}/audit`), 401);
  await expect("limit=0 → 422", call("GET", `/teams/${T}/audit?limit=0`, { key: ownerKey }), 422);
  await expect("limit=51 → 422", call("GET", `/teams/${T}/audit?limit=51`, { key: ownerKey }), 422);
  await expect("before=garbage → 422", call("GET", `/teams/${T}/audit?before=yesterday-ish`, { key: ownerKey }), 422);
  await expect("player audit → 200", call("GET", `/teams/${T}/audit`, { key: bobKey }), 200, (j) => j.entries.length > 0);
  const full = await expect("owner audit → 200", call("GET", `/teams/${T}/audit?limit=50`, { key: ownerKey }), 200, (j) =>
    j.entries.length >= 9 && j.nextBefore === undefined && noSecrets(j) && !JSON.stringify(j).includes(invite),
  );
  const entries = full.json.entries;
  check("audit newest first", entries.every((e, i) => i === 0 || entries[i - 1].createdAt >= e.createdAt));
  check("audit list carries no snapshots", entries.every((e) => !("before" in e) && !("after" in e)));
  check("audit has create entry (not revertible)", entries.some((e) => e.action === "team.create" && e.revertible === false));
  check("audit attributes player edits", entries.some((e) => e.action === "player.update" && e.actor === `player:${bobId}` && e.actorName === "Bob"));
  check("audit has join + claim", entries.some((e) => e.action === "player.join") && entries.some((e) => e.action === "player.claim"));
  // Pagination: walk in pages of 3 and compare with the full list.
  const seen = [];
  let before;
  for (let i = 0; i < 20; i++) {
    const r = await call("GET", `/teams/${T}/audit?limit=3${before ? `&before=${encodeURIComponent(before)}` : ""}`, { key: ownerKey });
    if (r.status !== 200) break;
    seen.push(...r.json.entries.map((e) => e.id));
    if (!r.json.nextBefore) break;
    before = r.json.nextBefore;
  }
  check("paginated walk == full list", JSON.stringify(seen) === JSON.stringify(entries.map((e) => e.id)), `${seen.length} vs ${entries.length}`);

  section("revert");
  const createEntry = entries.find((e) => e.action === "team.create");
  await expect("revert non-revertible → 409", call("POST", `/teams/${T}/audit/${createEntry.id}/revert`, { key: ownerKey }), 409, errCode("not_revertible"));
  await expect("revert unknown → 404", call("POST", `/teams/${T}/audit/zzzzzzzzzz/revert`, { key: ownerKey }), 404);
  await expect("player revert → 403", call("POST", `/teams/${T}/audit/${createEntry.id}/revert`, { key: bobKey }), 403);
  const renameEntry = entries.find((e) => e.action === "team.update" && e.summary.includes('the team to "Smoke Squad Prime"'));
  const rv = await expect("revert team rename → 200", call("POST", `/teams/${T}/audit/${renameEntry.id}/revert`, { key: ownerKey }), 200, (j) =>
    j.team.name === "Smoke Squad" && j.team.overrides.length === 0 && j.team.locked === false,
  );
  await expect("revert same entry again → 409 nothing", call("POST", `/teams/${T}/audit/${renameEntry.id}/revert`, { key: ownerKey }), 409, errCode("nothing_to_revert"));
  const a2 = (await call("GET", `/teams/${T}/audit?limit=1`, { key: ownerKey })).json.entries[0];
  check("revert wrote audit entry", a2.action === "audit.revert" && a2.revertible === true && a2.summary.startsWith("Reverted: "), JSON.stringify(a2));
  await expect("revert the revert → 200", call("POST", `/teams/${T}/audit/${a2.id}/revert`, { key: ownerKey }), 200, (j) => j.team.name === "Smoke Squad Prime" && j.team.overrides.length === 1);
  check("revert kept unrelated fields", rv.json.team.tag === "SMK");
  const bobEdit = entries.find((e) => e.action === "player.update" && e.actor === `player:${bobId}` && e.summary === "Updated Bob: champion pool (-1)");
  await expect("revert Bob's pool edit → 200", call("POST", `/teams/${T}/audit/${bobEdit.id}/revert`, { key: ownerKey }), 200, (j) =>
    j.team.players.find((p) => p.id === bobId).pool.length === 2,
  );
  const claimEntry = entries.find((e) => e.action === "player.claim");
  await expect("revert Alice's claim → releases key", call("POST", `/teams/${T}/audit/${claimEntry.id}/revert`, { key: ownerKey }), 200, (j) =>
    j.team.players.find((p) => p.id === aliceId).claimed === false,
  );
  await expect("Alice's old key → 401", call("GET", `/teams/${T}`, { key: aliceKey }), 401);
  const aliceRejoin = await expect("Alice re-claims with rename → 200", call("POST", `/invites/${T}/${invite}/join`, { body: { playerId: aliceId, name: "Alice B" } }), 200, (j) =>
    j.team.players.find((p) => p.id === aliceId).name === "Alice B",
  );
  const aliceKey2 = aliceRejoin.json.playerKey;

  section("rotate keys");
  const rotInv = await expect("rotate invite → 200", call("POST", `/teams/${T}/keys/rotate`, { key: ownerKey, body: { which: "invite" } }), 200, (j) =>
    /^[a-z0-9]{8}$/.test(j.inviteCode) && j.inviteCode !== invite && j.viewKey === undefined,
  );
  await expect("old invite info → 404", call("GET", `/invites/${T}/${invite}`), 404);
  await expect("old invite join → 404", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Dave" } }), 404);
  invite = rotInv.json.inviteCode;
  await expect("new invite works", call("GET", `/invites/${T}/${invite}`), 200);
  await expect("rotate bad which → 422", call("POST", `/teams/${T}/keys/rotate`, { key: ownerKey, body: { which: "all" } }), 422);
  const rotView = await expect("rotate view → 200", call("POST", `/teams/${T}/keys/rotate`, { key: ownerKey, body: { which: "view" } }), 200, (j) => j.viewKey.startsWith("view_"));
  await expect("old view key → 401", call("GET", `/teams/${T}`, { key: viewKey }), 401);
  viewKey = rotView.json.viewKey;
  await expect("new view key → 200", call("GET", `/teams/${T}`, { key: viewKey }), 200, (j) => j.you.kind === "viewer");
  const rotOwner = await expect("rotate owner → 200", call("POST", `/teams/${T}/keys/rotate`, { key: ownerKey, body: { which: "owner" } }), 200, (j) => j.ownerKey.startsWith("own_"));
  await expect("old owner key → 401", call("GET", `/teams/${T}`, { key: ownerKey }), 401);
  ownerKey = rotOwner.json.ownerKey;
  await expect("new owner key → 200", call("GET", `/teams/${T}`, { key: ownerKey }), 200, (j) => j.you.kind === "owner" && j.inviteCode === invite && j.viewKey === viewKey);
  const rotAudit = (await call("GET", `/teams/${T}/audit?limit=5`, { key: ownerKey })).json;
  check("rotations audited without key values", rotAudit.entries.filter((e) => e.action === "keys.rotate").length === 3 && !JSON.stringify(rotAudit).includes(viewKey) && !JSON.stringify(rotAudit).includes(invite));

  section("release + remove + revert removal");
  await expect("release Alice → 200", call("POST", `/teams/${T}/players/${aliceId}/release`, { key: ownerKey }), 200, (j) =>
    j.team.players.find((p) => p.id === aliceId).claimed === false,
  );
  await expect("Alice key after release → 401", call("PUT", `/teams/${T}/players/${aliceId}`, { key: aliceKey2, body: { notes: "x" } }), 401);
  await expect("release again → 409", call("POST", `/teams/${T}/players/${aliceId}/release`, { key: ownerKey }), 409, errCode("not_claimed"));
  await expect("released slot is open", call("GET", `/invites/${T}/${invite}`), 200, (j) => j.openSlots.some((s) => s.id === aliceId));
  await expect("remove Bob → 200", call("DELETE", `/teams/${T}/players/${bobId}`, { key: ownerKey }), 200, (j) => !j.team.players.some((p) => p.id === bobId));
  await expect("Bob key after removal → 401", call("GET", `/teams/${T}`, { key: bobKey }), 401);
  await expect("remove Bob again → 404", call("DELETE", `/teams/${T}/players/${bobId}`, { key: ownerKey }), 404);
  const rmEntry = (await call("GET", `/teams/${T}/audit?limit=1`, { key: ownerKey })).json.entries[0];
  check("removal audited", rmEntry.action === "player.remove" && rmEntry.revertible);
  await expect("revert removal → Bob back, unclaimed", call("POST", `/teams/${T}/audit/${rmEntry.id}/revert`, { key: ownerKey }), 200, (j) => {
    const b = j.team.players.find((p) => p.id === bobId);
    return b && b.claimed === false && b.pool.length === 2 && b.notes === "Owner note";
  });
  await expect("revert removal twice → 409", call("POST", `/teams/${T}/audit/${rmEntry.id}/revert`, { key: ownerKey }), 409, errCode("player_exists"));
  await expect("Bob's old key still dead", call("GET", `/teams/${T}`, { key: bobKey }), 401);
  const joinEntry = entries.find((e) => e.action === "player.join");
  await expect("revert Bob's join → removes Bob", call("POST", `/teams/${T}/audit/${joinEntry.id}/revert`, { key: ownerKey }), 200, (j) => !j.team.players.some((p) => p.id === bobId));
  await expect("revert update of removed player → 409", call("POST", `/teams/${T}/audit/${bobEdit.id}/revert`, { key: ownerKey }), 409, errCode("player_removed"));

  section("roster cap");
  let count = (await call("GET", `/teams/${T}`, { key: ownerKey })).json.team.players.length;
  let capOk = true;
  while (count < 11) {
    const r = await call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: `Sub ${count}` } });
    if (r.status !== 201) {
      capOk = false;
      break;
    }
    count++;
  }
  check("filled to 11 via owner", capOk);
  await expect("12th via invite join → 200", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Twelve" } }), 200, (j) => j.team.players.length === 12);
  await expect("invite info at cap → canCreate false", call("GET", `/invites/${T}/${invite}`), 200, (j) => j.canCreate === false);
  await expect("13th via owner → 409", call("POST", `/teams/${T}/players`, { key: ownerKey, body: { name: "Thirteen" } }), 409, errCode("team_full"));
  await expect("13th via join → 409", call("POST", `/invites/${T}/${invite}/join`, { body: { name: "Thirteen" } }), 409, errCode("team_full"));
  await expect("claim open slot at cap still works", call("POST", `/invites/${T}/${invite}/join`, { body: { playerId: aliceId } }), 200);

  section("delete");
  await expect("viewer delete → 403", call("DELETE", `/teams/${T}`, { key: viewKey }), 403);
  await expect("owner delete → 200", call("DELETE", `/teams/${T}`, { key: ownerKey }), 200, (j) => j.ok === true);
  await expect("GET deleted → 404", call("GET", `/teams/${T}`, { key: ownerKey }), 404);
  await expect("invite of deleted → 404", call("GET", `/invites/${T}/${invite}`), 404);
  await expect("delete team 2 → 200", call("DELETE", `/teams/${T2}`, { key: owner2 }), 200);

  section("audit coalescing: a player can't flush the log");
  const fl = await expect("create team 3 → 201", call("POST", "/teams", { body: { name: "Flush Test", game: "lol" } }), 201);
  const T3 = fl.json.team.id;
  const owner3 = fl.json.ownerKey;
  const slot = await expect("owner adds Faker", call("POST", `/teams/${T3}/players`, { key: owner3, body: { name: "Faker" } }), 201);
  const fakerId = slot.json.playerId;
  const prepared = ["Ahri", "Zed", "Syndra", "Orianna", "LeBlanc", "Azir", "Ryze", "Galio"].map((championId) => ({ championId, comfort: 5 }));
  await expect("owner prepares Faker's pool", call("PUT", `/teams/${T3}/players/${fakerId}`, { key: owner3, body: { pool: prepared, notes: "Scouting notes" } }), 200);
  const grief = await expect("griefer claims the slot", call("POST", `/invites/${T3}/${fl.json.inviteCode}/join`, { body: { playerId: fakerId } }), 200);
  const gk = grief.json.playerKey;
  await expect("griefer wipes the slot", call("PUT", `/teams/${T3}/players/${fakerId}`, { key: gk, body: { pool: [], notes: "" } }), 200);
  let spam = 0;
  for (let i = 0; i < 25; i++) {
    const r = await call("PUT", `/teams/${T3}/players/${fakerId}`, { key: gk, body: { notes: i % 2 ? "a" : "b", roles: i % 3 ? [] : [{ role: "mid", pref: "main" }] } });
    if (r.status === 200) spam++;
  }
  check("spam edits accepted", spam === 25, `${spam}/25`);
  const log3 = (await call("GET", `/teams/${T3}/audit?limit=50`, { key: owner3 })).json.entries;
  const griefEntries = log3.filter((e) => e.action === "player.update" && e.actor === `player:${fakerId}`);
  check("player's burst folded into one entry", griefEntries.length === 1 && log3.length === 5, `${griefEntries.length} player entries, ${log3.length} total`);
  await expect("owner reverts the burst → prepared data back", call("POST", `/teams/${T3}/audit/${griefEntries[0].id}/revert`, { key: owner3 }), 200, (j) => {
    const f = j.team.players.find((p) => p.id === fakerId);
    return f.pool.length === 8 && f.notes === "Scouting notes" && f.roles.length === 0;
  });
  await expect("next player edit after the owner's revert starts a new entry", call("PUT", `/teams/${T3}/players/${fakerId}`, { key: gk, body: { notes: "again" } }), 200);
  const log3b = (await call("GET", `/teams/${T3}/audit?limit=50`, { key: owner3 })).json.entries;
  check("new entry after revert", log3b.filter((e) => e.action === "player.update" && e.actor === `player:${fakerId}`).length === 2);
  await expect("delete team 3", call("DELETE", `/teams/${T3}`, { key: owner3 }), 200);

  section("daily team creation cap (one network)");
  const net = `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const made = [];
  let capHit = null;
  for (let i = 0; i < 12 && !capHit; i++) {
    const r = await call("POST", "/teams", { body: { name: `Cap ${i}`, game: "lol" }, sameIp: net });
    if (r.status === 201) made.push(r.json);
    else capHit = r;
  }
  check("10 teams per network per day, then 429 daily_limit", made.length === 10 && capHit?.status === 429 && capHit.json?.error?.code === "daily_limit", `${made.length} created, then ${capHit?.status} ${capHit?.text}`);
  await expect("another network can still create", call("POST", "/teams", { body: { name: "Other net", game: "lol" } }), 201, (j) => made.push(j) > 0);
  for (const t of made) await call("DELETE", `/teams/${t.team.id}`, { key: t.ownerKey });

  section("rate limit (one IP)");
  let limited = false;
  for (let i = 0; i < 45 && !limited; i++) {
    const r = await call("POST", "/teams", { body: {}, sameIp: "203.0.113.7" });
    if (r.status === 429) limited = r.json?.error?.code === "rate_limited";
  }
  check("WRITE_LIMITER returns 429 rate_limited", limited);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

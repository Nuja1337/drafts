// Teams API (D1): team profiles, player slots, invites, keys and the audit log with revert. Routes are relative to /api.
// Every request is at most two D1 round trips (one batched read, one batched write) to stay inside the free-tier CPU budget.
// Writes carry their preconditions into SQL guards so lock/release/rotation races can't slip an edit through.
import { Hono } from "hono";
import type {
  AuditRes,
  CreateTeamRes,
  GetTeamRes,
  InviteInfoRes,
  JoinRes,
  RotateKeyRes,
  TeamRes,
} from "../../shared/api";
import type { Principal } from "../../shared/types";
import { noteDbSize, storageNearlyFull } from "../lib/d1size";
import { ApiError, nowIso, randomId, randomKey, rateLimit, safeEqual, sha256, type AppContext, type AppEnv } from "../lib/http";
import { takeDaily } from "../lib/quota";
import { auditEntryStmt, auditMergeStmts, auditPageStmt, auditStmts, lastTargetEntryStmt } from "./audit";
import {
  clip,
  coalesceEdit,
  describePlayerChange,
  describeTeamChange,
  diff,
  rowToEntry,
  toAuditPage,
  type LastTargetRow,
} from "./auditFormat";
import { readBody, validate } from "./body";
import { actorOf, requirePrincipal } from "./principal";
import {
  ID_RE,
  MAX_PLAYERS,
  addPlayerSchema,
  auditQuerySchema,
  createTeamSchema,
  isReservedName,
  joinSchema,
  nameKey,
  playerSchema,
  rotateKeySchema,
  updateTeamSchema,
} from "./schema";
import {
  PLAYER_FIELD_KEYS,
  andGuards,
  deletePlayerStmt,
  deleteTeamStmts,
  emptyPlayerFields,
  guards,
  insertPlayerStmt,
  insertTeamStmt,
  loadTeam,
  pickPlayerFields,
  pickTeamFields,
  setTeamKeysStmt,
  toPlayerProfile,
  toTeamProfile,
  touchTeamStmt,
  updatePlayerStmt,
  updateTeamStmt,
  type PlayerFields,
  type PlayerRecord,
  type TeamFields,
  type TeamRecord,
} from "./store";

export const teamsApp = new Hono<AppEnv>();

// ---- Helpers ----------------------------------------------------------------

/** JSON response that is never cached (owner responses carry the invite code and view key). */
function json<T>(body: T, status: 200 | 201 = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" },
  });
}

/** Teams one network (IPv4 address or IPv6 /64) may create per UTC day — creation is anonymous and teams don't expire. */
const TEAMS_PER_DAY = 10;

const teamNotFound = () => new ApiError(404, "team_not_found", "No team with that id.");
const inviteNotFound = () => new ApiError(404, "invite_not_found", "This invite link is invalid or has been replaced.");
const teamFull = () =>
  new ApiError(409, "team_full", `Teams are capped at ${MAX_PLAYERS} players. Remove or reuse a slot first.`);
const conflict = (msg = "The team changed at the same time. Reload and try again.") => new ApiError(409, "conflict", msg);

function param(c: AppContext, name: string, notFound: () => ApiError): string {
  const v = c.req.param(name);
  if (!v || !ID_RE.test(v)) throw notFound();
  return v;
}

async function getTeam(c: AppContext, extra: D1PreparedStatement[] = []) {
  const teamId = param(c, "teamId", teamNotFound);
  const res = await loadTeam(c.env.DB, teamId, extra);
  if (!res.team) throw teamNotFound();
  return { team: res.team, extra: res.extra };
}

function findPlayer(team: TeamRecord, playerId: string | undefined): PlayerRecord {
  const p = playerId ? team.players.find((x) => x.id === playerId) : undefined;
  if (!p) throw new ApiError(404, "player_not_found", "No such player on this team.");
  return p;
}

/**
 * Names are unique per team by look (case, width, invisible characters, spacing and Cyrillic/Greek look-alikes are
 * ignored — see nameKey) so nobody can pose as a teammate, and can't be a system actor name like "Owner".
 */
function assertNameFree(team: TeamRecord, name: string, exceptId?: string): void {
  if (isReservedName(name)) throw new ApiError(409, "name_taken", `"${name}" is reserved. Pick another name.`);
  const k = nameKey(name);
  const clash = team.players.find((p) => p.id !== exceptId && nameKey(p.name) === k);
  if (clash) throw new ApiError(409, "name_taken", `There's already a player named "${clash.name}" on this team.`);
}

/** New teams/players are refused while the database is close to the free tier's size cap (lib/d1size.ts). */
function assertStorageRoom(): void {
  if (storageNearlyFull()) {
    throw new ApiError(503, "storage_full", "Storage is nearly full, so new teams and players are paused. Existing teams still work.");
  }
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const newInviteCode = () => randomId(8);

/** Constant-time invite code check (compare hashes so lengths always match). */
async function inviteMatches(team: TeamRecord, code: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(code), sha256(team.inviteCode)]);
  return safeEqual(a, b);
}

const changed = (r: D1Result | undefined) => (r?.meta.changes ?? 0) > 0;

const newPlayer = (fields: PlayerFields, id: string, keyHash: string | null, now: string): PlayerRecord => ({
  id,
  ...fields,
  keyHash,
  createdAt: now,
  updatedAt: now,
});

/** Removes a player (route DELETE and reverting a creation). The audit row is inserted first, guarded on the row still existing. */
async function removePlayer(
  c: AppContext,
  team: TeamRecord,
  player: PlayerRecord,
  p: Principal,
  action: string,
  summary: string,
): Promise<Response> {
  const db = c.env.DB;
  const now = nowIso();
  const audit = auditStmts(
    db,
    team.id,
    { ...actorOf(p, team), action, target: `player:${player.id}`, summary, before: toPlayerProfile(player), after: null, revertible: true },
    now,
    guards.playerExists(team.id, player.id),
  );
  const res = await db.batch([...audit.stmts, deletePlayerStmt(db, team.id, player.id), touchTeamStmt(db, team.id, now)]);
  if (!changed(res[audit.stmts.length])) throw new ApiError(404, "player_not_found", "That player was already removed.");
  team.players = team.players.filter((x) => x.id !== player.id);
  team.updatedAt = now;
  return json<TeamRes>({ team: toTeamProfile(team) });
}

// ---- Teams ------------------------------------------------------------------

teamsApp.post("/teams", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const body = await readBody(c, createTeamSchema);
  assertStorageRoom();
  if (!(await takeDaily(c, "team", TEAMS_PER_DAY))) {
    throw new ApiError(429, "daily_limit", `Only ${TEAMS_PER_DAY} new teams per day can be created from one network. Try again tomorrow.`);
  }
  const db = c.env.DB;
  const now = nowIso();
  const ownerKey = randomKey("own");
  const viewKey = randomKey("view");
  const inviteCode = newInviteCode();
  const team: TeamRecord = {
    id: randomId(),
    kind: body.kind ?? "team",
    game: body.game,
    name: body.name,
    tag: body.tag ?? "",
    notes: "",
    preferredArchetypes: [],
    avoidArchetypes: [],
    overrides: [],
    locked: false,
    ownerKeyHash: await sha256(ownerKey),
    viewKey,
    inviteCode,
    createdAt: now,
    updatedAt: now,
    players: [],
  };
  const audit = auditStmts(
    db,
    team.id,
    {
      actor: "owner",
      actorName: "Owner",
      action: "team.create",
      target: "team",
      summary: `Created ${team.kind === "scout" ? "scouting profile" : "team"} "${team.name}"`,
      before: null,
      after: pickTeamFields(team),
      revertible: false,
    },
    now,
  );
  noteDbSize(await db.batch([insertTeamStmt(db, team), ...audit.stmts]));
  return json<CreateTeamRes>({ team: toTeamProfile(team), ownerKey, inviteCode, viewKey }, 201);
});

teamsApp.get("/teams/:teamId", async (c) => {
  const { team } = await getTeam(c);
  const you = await requirePrincipal(c, team, ["owner", "player", "viewer"]);
  const res: GetTeamRes = { team: toTeamProfile(team), you };
  if (you.kind === "owner") {
    res.inviteCode = team.inviteCode;
    res.viewKey = team.viewKey;
  }
  return json(res);
});

teamsApp.patch("/teams/:teamId", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  const p = await requirePrincipal(c, team, ["owner"]);
  const patch: Partial<TeamFields> = await readBody(c, updateTeamSchema);
  const d = diff(pickTeamFields(team), patch);
  if (!d.keys.length) return json<TeamRes>({ team: toTeamProfile(team) });
  const db = c.env.DB;
  const now = nowIso();
  const audit = auditStmts(
    db,
    team.id,
    {
      ...actorOf(p, team),
      action: "team.update",
      target: "team",
      summary: describeTeamChange(d.before, d.after),
      before: d.before,
      after: d.after,
      revertible: true,
    },
    now,
  );
  await db.batch([updateTeamStmt(db, team.id, d.after, now), ...audit.stmts]);
  Object.assign(team, d.after, { updatedAt: now });
  return json<TeamRes>({ team: toTeamProfile(team) });
});

teamsApp.delete("/teams/:teamId", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  await requirePrincipal(c, team, ["owner"]);
  await c.env.DB.batch(deleteTeamStmts(c.env.DB, team.id));
  return json({ ok: true as const });
});

// ---- Players ----------------------------------------------------------------

teamsApp.post("/teams/:teamId/players", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  const p = await requirePrincipal(c, team, ["owner"]);
  const { name } = await readBody(c, addPlayerSchema);
  if (team.players.length >= MAX_PLAYERS) throw teamFull();
  assertNameFree(team, name);
  assertStorageRoom();
  const db = c.env.DB;
  const now = nowIso();
  const player = newPlayer(emptyPlayerFields(name), randomId(), null, now);
  const exists = guards.playerExists(team.id, player.id);
  const audit = auditStmts(
    db,
    team.id,
    {
      ...actorOf(p, team),
      action: "player.add",
      target: `player:${player.id}`,
      summary: `Added player "${name}"`,
      before: null,
      after: toPlayerProfile(player),
      revertible: true,
    },
    now,
    exists,
  );
  const [ins] = await db.batch([
    insertPlayerStmt(db, team.id, player, andGuards(guards.hasRoom(team.id, MAX_PLAYERS), guards.nameFree(team.id, name))),
    touchTeamStmt(db, team.id, now, exists),
    ...audit.stmts,
  ]);
  if (!changed(ins)) throw conflict();
  team.players.push(player);
  team.updatedAt = now;
  return json<TeamRes & { playerId: string }>({ team: toTeamProfile(team), playerId: player.id }, 201);
});

teamsApp.put("/teams/:teamId/players/:playerId", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const teamId = param(c, "teamId", teamNotFound);
  const playerId = c.req.param("playerId");
  // The slot's newest audit entry rides along in the load batch: a player's rapid self-edits fold into it.
  const { team, extra } = await getTeam(c, [lastTargetEntryStmt(c.env.DB, teamId, `player:${playerId}`)]);
  const p = await requirePrincipal(c, team, ["owner", "player"]);
  if (p.kind === "player") {
    if (p.playerId !== playerId) throw new ApiError(403, "forbidden", "Players can only edit their own profile.");
    if (team.locked) throw new ApiError(403, "team_locked", "The team is locked, so only the owner can edit right now.");
  }
  const player = findPlayer(team, playerId);
  const patch: Partial<PlayerFields> = await readBody(c, playerSchema(team.game));
  const d = diff(pickPlayerFields(player), patch);
  if (!d.keys.length) return json<TeamRes>({ team: toTeamProfile(team) });
  if (d.after.name !== undefined) assertNameFree(team, d.after.name, player.id);

  const db = c.env.DB;
  const now = nowIso();
  // A player's edit only lands if their key is still current and the team is still unlocked at write time.
  const guard = andGuards(
    p.kind === "player" && player.keyHash
      ? andGuards(guards.playerKey(team.id, player.id, player.keyHash), guards.unlocked(team.id))
      : guards.playerExists(team.id, player.id),
    d.after.name !== undefined ? guards.nameFree(team.id, d.after.name, player.id) : null,
  );
  const actor = actorOf(p, team);
  const draft = {
    ...actor,
    action: "player.update",
    target: `player:${player.id}`,
    summary: describePlayerChange(player.name, d.before, d.after),
    before: d.before,
    after: d.after,
    revertible: true,
  };
  // Within COALESCE_MS a player's edits rewrite their previous entry (earliest `before` kept), so spamming edits can't
  // flush the entry the owner needs to revert out of the log.
  const merge =
    p.kind === "player" ? coalesceEdit(extra[0]?.results[0] as LastTargetRow | undefined, actor.actor, now, d.before, d.after) : null;
  const auditWrite = merge
    ? auditMergeStmts(
        db,
        team.id,
        merge.seq,
        { ...draft, summary: describePlayerChange(player.name, merge.before, merge.after), before: merge.before, after: merge.after },
        now,
        guard,
      )
    : auditStmts(db, team.id, draft, now, guard).stmts;
  const res = await db.batch([
    updatePlayerStmt(db, team.id, player.id, d.after, now, { guard }),
    touchTeamStmt(db, team.id, now, guard),
    ...auditWrite,
  ]);
  if (!changed(res[0])) {
    throw conflict(
      p.kind === "player"
        ? "The team was just locked or your slot was released. Reload and try again."
        : "That player changed at the same time. Reload and try again.",
    );
  }
  // The entry to fold into disappeared between read and write (pruned or reverted away): log this edit on its own.
  if (merge && !changed(res[2])) await db.batch(auditStmts(db, team.id, draft, now).stmts);
  Object.assign(player, d.after, { updatedAt: now });
  team.updatedAt = now;
  return json<TeamRes>({ team: toTeamProfile(team) });
});

teamsApp.delete("/teams/:teamId/players/:playerId", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  const p = await requirePrincipal(c, team, ["owner"]);
  const player = findPlayer(team, c.req.param("playerId"));
  return removePlayer(c, team, player, p, "player.remove", `Removed player "${player.name}"`);
});

teamsApp.post("/teams/:teamId/players/:playerId/release", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  const p = await requirePrincipal(c, team, ["owner"]);
  const player = findPlayer(team, c.req.param("playerId"));
  if (!player.keyHash) throw new ApiError(409, "not_claimed", "That slot hasn't been claimed, so there's no key to release.");
  const db = c.env.DB;
  const now = nowIso();
  const guard = guards.playerKey(team.id, player.id, player.keyHash);
  const audit = auditStmts(
    db,
    team.id,
    {
      ...actorOf(p, team),
      action: "player.release",
      target: `player:${player.id}`,
      summary: `Released ${player.name}'s player key, so the slot can be claimed again`,
      before: { claimed: true },
      after: { claimed: false },
      revertible: false,
    },
    now,
    guard,
  );
  const res = await db.batch([
    ...audit.stmts,
    updatePlayerStmt(db, team.id, player.id, {}, now, { keyHash: null, guard }),
    touchTeamStmt(db, team.id, now),
  ]);
  if (!changed(res[audit.stmts.length])) throw conflict();
  player.keyHash = null;
  player.updatedAt = now;
  team.updatedAt = now;
  return json<TeamRes>({ team: toTeamProfile(team) });
});

// ---- Keys -------------------------------------------------------------------

teamsApp.post("/teams/:teamId/keys/rotate", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team } = await getTeam(c);
  const p = await requirePrincipal(c, team, ["owner"]);
  const { which } = await readBody(c, rotateKeySchema);
  const db = c.env.DB;
  const now = nowIso();
  let res: RotateKeyRes;
  let stmt: D1PreparedStatement;
  let summary: string;
  switch (which) {
    case "invite": {
      const inviteCode = newInviteCode();
      stmt = setTeamKeysStmt(db, team.id, { invite_code: inviteCode });
      res = { inviteCode };
      summary = "Rotated the invite code, so old invite links no longer work";
      break;
    }
    case "view": {
      const viewKey = randomKey("view");
      stmt = setTeamKeysStmt(db, team.id, { view_key: viewKey });
      res = { viewKey };
      summary = "Rotated the view key, so old view links no longer work";
      break;
    }
    case "owner": {
      const ownerKey = randomKey("own");
      stmt = setTeamKeysStmt(db, team.id, { owner_key_hash: await sha256(ownerKey) });
      res = { ownerKey };
      summary = "Rotated the owner key, so the old owner key no longer works";
      break;
    }
  }
  // Key values never go into the audit log (players can read it).
  const audit = auditStmts(
    db,
    team.id,
    { ...actorOf(p, team), action: "keys.rotate", target: "team", summary, before: null, after: { which }, revertible: false },
    now,
  );
  await db.batch([stmt, ...audit.stmts]);
  return json(res);
});

// ---- Audit ------------------------------------------------------------------

teamsApp.get("/teams/:teamId/audit", async (c) => {
  const raw: Record<string, string> = {};
  const before = c.req.query("before");
  const limit = c.req.query("limit");
  if (before !== undefined) raw.before = before;
  if (limit !== undefined) raw.limit = limit;
  const q = validate(auditQuerySchema, raw);
  const teamId = param(c, "teamId", teamNotFound);
  const { team, extra } = await getTeam(c, [auditPageStmt(c.env.DB, teamId, q.before, q.limit)]);
  await requirePrincipal(c, team, ["owner", "player"]);
  return json<AuditRes>(toAuditPage(extra[0]?.results ?? [], q.limit));
});

teamsApp.post("/teams/:teamId/audit/:entryId/revert", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const teamId = param(c, "teamId", teamNotFound);
  const entryNotFound = () => new ApiError(404, "entry_not_found", "No such audit entry (it may have been pruned).");
  const entryId = param(c, "entryId", entryNotFound);
  const { team, extra } = await getTeam(c, [auditEntryStmt(c.env.DB, teamId, entryId)]);
  const p = await requirePrincipal(c, team, ["owner"]);
  const row = extra[0]?.results[0];
  if (!row) throw entryNotFound();
  const entry = rowToEntry(row);
  if (!entry.revertible) throw new ApiError(409, "not_revertible", "That change can't be reverted.");
  const summary = clip(`Reverted: ${entry.summary}`);
  if (entry.target === "team") return revertTeam(c, team, p, entry.before, summary);
  if (entry.target.startsWith("player:")) {
    return revertPlayer(c, team, p, entry.target.slice("player:".length), entry.before, entry.after, summary);
  }
  throw new ApiError(409, "not_revertible", "That change can't be reverted.");
});

const staleSnapshot = () =>
  new ApiError(409, "stale_snapshot", "That entry's snapshot no longer fits the current rules, so it can't be restored.");
const nothingToRevert = () => new ApiError(409, "nothing_to_revert", "Nothing to revert. The current values already match.");

async function revertTeam(c: AppContext, team: TeamRecord, p: Principal, before: unknown, summary: string) {
  const snap = asObject(before);
  const parsed = snap ? updateTeamSchema.safeParse(snap) : null;
  if (!parsed?.success) throw staleSnapshot();
  const d = diff(pickTeamFields(team), parsed.data as Partial<TeamFields>);
  if (!d.keys.length) throw nothingToRevert();
  const db = c.env.DB;
  const now = nowIso();
  const audit = auditStmts(
    db,
    team.id,
    { ...actorOf(p, team), action: "audit.revert", target: "team", summary, before: d.before, after: d.after, revertible: true },
    now,
  );
  await db.batch([updateTeamStmt(db, team.id, d.after, now), ...audit.stmts]);
  Object.assign(team, d.after, { updatedAt: now });
  return json<TeamRes>({ team: toTeamProfile(team) });
}

/** Parses the editable player fields out of a snapshot with the current validation rules. */
function parsePlayerSnapshot(team: TeamRecord, snap: Record<string, unknown>): Partial<PlayerFields> {
  const fields: Record<string, unknown> = {};
  for (const k of PLAYER_FIELD_KEYS) if (snap[k] !== undefined) fields[k] = snap[k];
  const parsed = playerSchema(team.game).safeParse(fields);
  if (!parsed.success) throw staleSnapshot();
  return parsed.data;
}

async function revertPlayer(
  c: AppContext,
  team: TeamRecord,
  p: Principal,
  playerId: string,
  before: unknown,
  after: unknown,
  summary: string,
): Promise<Response> {
  const db = c.env.DB;
  const existing = team.players.find((x) => x.id === playerId);

  // Creation (add / join) → remove the player again, which also revokes their key.
  if (before === null) {
    if (!existing) throw new ApiError(409, "already_removed", "That player has already been removed.");
    return removePlayer(c, team, existing, p, "audit.revert", summary);
  }

  const snap = asObject(before);
  if (!snap) throw staleSnapshot();

  // Removal → re-create the slot, unclaimed (the old key stays dead).
  if (after === null) {
    if (existing) throw new ApiError(409, "player_exists", "That player is already on the roster.");
    if (team.players.length >= MAX_PLAYERS) throw teamFull();
    const fields = parsePlayerSnapshot(team, snap);
    if (!fields.name) throw staleSnapshot();
    assertNameFree(team, fields.name);
    const now = nowIso();
    const player = newPlayer({ ...emptyPlayerFields(fields.name), ...fields }, playerId, null, now);
    const exists = guards.playerExists(team.id, playerId);
    const audit = auditStmts(
      db,
      team.id,
      {
        ...actorOf(p, team),
        action: "audit.revert",
        target: `player:${playerId}`,
        summary,
        before: null,
        after: toPlayerProfile(player),
        revertible: true,
      },
      now,
      exists,
    );
    const [ins] = await db.batch([
      insertPlayerStmt(
        db,
        team.id,
        player,
        andGuards(guards.hasRoom(team.id, MAX_PLAYERS), guards.playerMissing(team.id, playerId), guards.nameFree(team.id, fields.name)),
      ),
      touchTeamStmt(db, team.id, now, exists),
      ...audit.stmts,
    ]);
    if (!changed(ins)) throw conflict();
    team.players.push(player);
    team.updatedAt = now;
    return json<TeamRes>({ team: toTeamProfile(team) });
  }

  // Field change (edit / claim) → restore the changed fields; restoring "unclaimed" revokes the key.
  if (!existing) throw new ApiError(409, "player_removed", "That player was removed. Revert the removal first.");
  if (snap.claimed === true) throw new ApiError(409, "not_revertible", "A released player key can't be restored.");
  const fields = parsePlayerSnapshot(team, snap);
  const d = diff(pickPlayerFields(existing), fields);
  const release = snap.claimed === false && existing.keyHash !== null;
  if (!d.keys.length && !release) throw nothingToRevert();
  if (d.after.name !== undefined) assertNameFree(team, d.after.name, existing.id);
  const now = nowIso();
  const guard = andGuards(
    guards.playerExists(team.id, existing.id),
    d.after.name !== undefined ? guards.nameFree(team.id, d.after.name, existing.id) : null,
  );
  const audit = auditStmts(
    db,
    team.id,
    {
      ...actorOf(p, team),
      action: "audit.revert",
      target: `player:${existing.id}`,
      summary,
      before: release ? { ...d.before, claimed: true } : d.before,
      after: release ? { ...d.after, claimed: false } : d.after,
      // Undoing this would need the revoked key back, which we never store.
      revertible: !release,
    },
    now,
    guard,
  );
  const [upd] = await db.batch([
    updatePlayerStmt(db, team.id, existing.id, d.after, now, { guard, keyHash: release ? null : undefined }),
    touchTeamStmt(db, team.id, now, guard),
    ...audit.stmts,
  ]);
  if (!changed(upd)) throw conflict();
  Object.assign(existing, d.after, { updatedAt: now });
  if (release) existing.keyHash = null;
  team.updatedAt = now;
  return json<TeamRes>({ team: toTeamProfile(team) });
}

// ---- Invites ----------------------------------------------------------------

async function getInviteTeam(c: AppContext): Promise<{ team: TeamRecord; code: string }> {
  const teamId = param(c, "teamId", inviteNotFound);
  const code = param(c, "code", inviteNotFound);
  const { team } = await loadTeam(c.env.DB, teamId);
  if (!team || !(await inviteMatches(team, code))) throw inviteNotFound();
  return { team, code };
}

teamsApp.get("/invites/:teamId/:code", async (c) => {
  const { team } = await getInviteTeam(c);
  return json<InviteInfoRes>({
    teamId: team.id,
    teamName: team.name,
    game: team.game,
    kind: team.kind,
    locked: team.locked,
    openSlots: team.players.filter((p) => !p.keyHash).map((p) => ({ id: p.id, name: p.name })),
    canCreate: team.players.length < MAX_PLAYERS,
  });
});

teamsApp.post("/invites/:teamId/:code/join", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "teams");
  const { team, code } = await getInviteTeam(c);
  const body = await readBody(c, joinSchema);
  if (team.locked) throw new ApiError(403, "team_locked", "This team is locked. Ask the owner to unlock it before joining.");
  const db = c.env.DB;
  const now = nowIso();
  const playerKey = randomKey("ply");
  const keyHash = await sha256(playerKey);
  // The invite must still be current and the team unlocked when the write lands.
  const base = andGuards(guards.unlocked(team.id), guards.inviteCode(team.id, code));

  if (body.playerId !== undefined) {
    const slot = team.players.find((x) => x.id === body.playerId);
    if (!slot) throw new ApiError(404, "slot_not_found", "That slot no longer exists. Reload the invite.");
    if (slot.keyHash) throw new ApiError(409, "slot_taken", "That slot has already been claimed.");
    const rename = body.name !== undefined && body.name !== slot.name ? body.name : undefined;
    if (rename !== undefined) assertNameFree(team, rename, slot.id);
    const claimed = guards.playerKey(team.id, slot.id, keyHash);
    const audit = auditStmts(
      db,
      team.id,
      {
        actor: `player:${slot.id}`,
        actorName: rename ?? slot.name,
        action: "player.claim",
        target: `player:${slot.id}`,
        summary: rename !== undefined ? `"${rename}" claimed the "${slot.name}" slot via invite` : `${slot.name} claimed their slot via invite`,
        before: rename !== undefined ? { name: slot.name, claimed: false } : { claimed: false },
        after: rename !== undefined ? { name: rename, claimed: true } : { claimed: true },
        revertible: true,
      },
      now,
      claimed,
    );
    const [upd] = await db.batch([
      updatePlayerStmt(db, team.id, slot.id, rename !== undefined ? { name: rename } : {}, now, {
        keyHash,
        onlyUnclaimed: true,
        guard: andGuards(base, rename !== undefined ? guards.nameFree(team.id, rename, slot.id) : null),
      }),
      touchTeamStmt(db, team.id, now, claimed),
      ...audit.stmts,
    ]);
    if (!changed(upd)) throw conflict("That slot was just taken, or the team was locked. Reload the invite and try again.");
    if (rename !== undefined) slot.name = rename;
    slot.keyHash = keyHash;
    slot.updatedAt = now;
    team.updatedAt = now;
    return json<JoinRes>({ team: toTeamProfile(team), playerId: slot.id, playerKey });
  }

  const name = body.name as string; // joinSchema guarantees playerId or name
  if (team.players.length >= MAX_PLAYERS) throw teamFull();
  assertNameFree(team, name);
  assertStorageRoom();
  const player = newPlayer(emptyPlayerFields(name), randomId(), keyHash, now);
  const exists = guards.playerExists(team.id, player.id);
  const audit = auditStmts(
    db,
    team.id,
    {
      actor: `player:${player.id}`,
      actorName: name,
      action: "player.join",
      target: `player:${player.id}`,
      summary: `${name} joined via invite`,
      before: null,
      after: toPlayerProfile(player),
      revertible: true,
    },
    now,
    exists,
  );
  const [ins] = await db.batch([
    insertPlayerStmt(db, team.id, player, andGuards(base, guards.hasRoom(team.id, MAX_PLAYERS), guards.nameFree(team.id, name))),
    touchTeamStmt(db, team.id, now, exists),
    ...audit.stmts,
  ]);
  if (!changed(ins)) throw conflict("The team filled up, was locked, or the invite changed. Reload the invite and try again.");
  team.players.push(player);
  team.updatedAt = now;
  return json<JoinRes>({ team: toTeamProfile(team), playerId: player.id, playerKey });
});

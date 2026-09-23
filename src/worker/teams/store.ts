// D1 access for teams and players: row ↔ domain mapping, the single-batch team loader and statement builders.
// Column names only ever come from the fixed maps below, never from request data.
import type { GameId, PlayerProfile, TeamKind, TeamProfile } from "../../shared/types";
import { noteDbSize } from "../lib/d1size";

/** Team fields an owner can edit (and that audit snapshots / reverts deal in). */
export type TeamFields = Pick<
  TeamProfile,
  "name" | "tag" | "notes" | "preferredArchetypes" | "avoidArchetypes" | "overrides" | "locked"
>;
/** Player profile fields editable through PUT /players/:id. */
export type PlayerFields = Pick<
  PlayerProfile,
  "name" | "roles" | "pool" | "playstyles" | "strengths" | "weaknesses" | "avoid" | "notes"
>;

export interface PlayerRecord extends PlayerFields {
  id: string;
  /** SHA-256 of the player key; null = unclaimed slot. */
  keyHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRecord extends TeamFields {
  id: string;
  kind: TeamKind;
  game: GameId;
  ownerKeyHash: string;
  viewKey: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
  players: PlayerRecord[];
}

interface TeamRow {
  id: string;
  kind: TeamKind;
  game: GameId;
  name: string;
  tag: string;
  notes: string;
  preferred_archetypes: string;
  avoid_archetypes: string;
  overrides: string;
  locked: number;
  owner_key_hash: string;
  view_key: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

interface PlayerRow {
  id: string;
  name: string;
  roles: string;
  pool: string;
  playstyles: string;
  strengths: string;
  weaknesses: string;
  avoid: string;
  notes: string;
  key_hash: string | null;
  created_at: string;
  updated_at: string;
}

const TEAM_COLUMNS: Record<keyof TeamFields, string> = {
  name: "name",
  tag: "tag",
  notes: "notes",
  preferredArchetypes: "preferred_archetypes",
  avoidArchetypes: "avoid_archetypes",
  overrides: "overrides",
  locked: "locked",
};
export const TEAM_FIELD_KEYS = Object.keys(TEAM_COLUMNS) as (keyof TeamFields)[];

const PLAYER_COLUMNS: Record<keyof PlayerFields, string> = {
  name: "name",
  roles: "roles",
  pool: "pool",
  playstyles: "playstyles",
  strengths: "strengths",
  weaknesses: "weaknesses",
  avoid: "avoid",
  notes: "notes",
};
export const PLAYER_FIELD_KEYS = Object.keys(PLAYER_COLUMNS) as (keyof PlayerFields)[];

/** Stored JSON is written only by this module, but parse defensively so one bad cell can't 500 a team. */
function jsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const encode = (v: unknown): string | number => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "string" ? v : JSON.stringify(v));

function toPlayerRecord(r: PlayerRow): PlayerRecord {
  return {
    id: r.id,
    name: r.name,
    roles: jsonArray(r.roles),
    pool: jsonArray(r.pool),
    playstyles: jsonArray(r.playstyles),
    strengths: jsonArray(r.strengths),
    weaknesses: jsonArray(r.weaknesses),
    avoid: jsonArray(r.avoid),
    notes: r.notes,
    keyHash: r.key_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toTeamRecord(r: TeamRow, players: PlayerRow[]): TeamRecord {
  return {
    id: r.id,
    kind: r.kind,
    game: r.game,
    name: r.name,
    tag: r.tag,
    notes: r.notes,
    preferredArchetypes: jsonArray(r.preferred_archetypes),
    avoidArchetypes: jsonArray(r.avoid_archetypes),
    overrides: jsonArray(r.overrides),
    locked: r.locked === 1,
    ownerKeyHash: r.owner_key_hash,
    viewKey: r.view_key,
    inviteCode: r.invite_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    players: players.map(toPlayerRecord),
  };
}

const PLAYER_SELECT =
  "SELECT id, name, roles, pool, playstyles, strengths, weaknesses, avoid, notes, key_hash, created_at, updated_at FROM players WHERE team_id = ? ORDER BY created_at, id";

/**
 * Loads a team and its players in one round trip. `extra` statements ride along in the same batch
 * (e.g. an audit page) and their results are returned in order.
 */
export async function loadTeam(
  db: D1Database,
  teamId: string,
  extra: D1PreparedStatement[] = [],
): Promise<{ team: TeamRecord | null; extra: D1Result[] }> {
  const [teamRes, playersRes, ...rest] = await db.batch([
    db.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId),
    db.prepare(PLAYER_SELECT).bind(teamId),
    ...extra,
  ]);
  noteDbSize([teamRes]);
  const row = (teamRes.results as TeamRow[])[0];
  return { team: row ? toTeamRecord(row, playersRes.results as PlayerRow[]) : null, extra: rest };
}

// ---- Public shapes (never include key material) ---------------------------

export function toPlayerProfile(p: PlayerRecord): PlayerProfile {
  return {
    id: p.id,
    name: p.name,
    roles: p.roles,
    pool: p.pool,
    playstyles: p.playstyles,
    strengths: p.strengths,
    weaknesses: p.weaknesses,
    avoid: p.avoid,
    notes: p.notes,
    claimed: p.keyHash !== null,
    updatedAt: p.updatedAt,
  };
}

export function toTeamProfile(t: TeamRecord): TeamProfile {
  return {
    id: t.id,
    kind: t.kind,
    game: t.game,
    name: t.name,
    tag: t.tag,
    notes: t.notes,
    preferredArchetypes: t.preferredArchetypes,
    avoidArchetypes: t.avoidArchetypes,
    overrides: t.overrides,
    locked: t.locked,
    players: t.players.map(toPlayerProfile),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const pickTeamFields = (t: TeamRecord): TeamFields => ({
  name: t.name,
  tag: t.tag,
  notes: t.notes,
  preferredArchetypes: t.preferredArchetypes,
  avoidArchetypes: t.avoidArchetypes,
  overrides: t.overrides,
  locked: t.locked,
});

export const pickPlayerFields = (p: PlayerFields): PlayerFields => ({
  name: p.name,
  roles: p.roles,
  pool: p.pool,
  playstyles: p.playstyles,
  strengths: p.strengths,
  weaknesses: p.weaknesses,
  avoid: p.avoid,
  notes: p.notes,
});

export const emptyPlayerFields = (name: string): PlayerFields => ({
  name,
  roles: [],
  pool: [],
  playstyles: [],
  strengths: [],
  weaknesses: [],
  avoid: [],
  notes: "",
});

// ---- Statements -----------------------------------------------------------

/** A SQL boolean expression + binds that later statements in a batch can require (atomic preconditions). */
export interface Guard {
  sql: string;
  binds: unknown[];
}

export const andGuards = (...guards: (Guard | null | undefined)[]): Guard | null => {
  const g = guards.filter((x): x is Guard => !!x);
  if (!g.length) return null;
  return { sql: g.map((x) => `(${x.sql})`).join(" AND "), binds: g.flatMap((x) => x.binds) };
};

export const guards = {
  playerExists: (teamId: string, playerId: string): Guard => ({
    sql: "EXISTS (SELECT 1 FROM players WHERE team_id = ? AND id = ?)",
    binds: [teamId, playerId],
  }),
  playerMissing: (teamId: string, playerId: string): Guard => ({
    sql: "NOT EXISTS (SELECT 1 FROM players WHERE team_id = ? AND id = ?)",
    binds: [teamId, playerId],
  }),
  playerKey: (teamId: string, playerId: string, keyHash: string): Guard => ({
    sql: "EXISTS (SELECT 1 FROM players WHERE team_id = ? AND id = ? AND key_hash = ?)",
    binds: [teamId, playerId, keyHash],
  }),
  unlocked: (teamId: string): Guard => ({ sql: "(SELECT locked FROM teams WHERE id = ?) = 0", binds: [teamId] }),
  inviteCode: (teamId: string, code: string): Guard => ({
    sql: "(SELECT invite_code FROM teams WHERE id = ?) = ?",
    binds: [teamId, code],
  }),
  hasRoom: (teamId: string, max: number): Guard => ({
    sql: "(SELECT COUNT(*) FROM players WHERE team_id = ?) < ?",
    binds: [teamId, max],
  }),
  nameFree: (teamId: string, name: string, exceptPlayerId = ""): Guard => ({
    sql: "NOT EXISTS (SELECT 1 FROM players WHERE team_id = ? AND lower(name) = lower(?) AND id <> ?)",
    binds: [teamId, name, exceptPlayerId],
  }),
};

export function insertTeamStmt(db: D1Database, t: TeamRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO teams (id, kind, game, name, tag, notes, preferred_archetypes, avoid_archetypes, overrides, locked,
        owner_key_hash, view_key, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.id,
      t.kind,
      t.game,
      t.name,
      t.tag,
      t.notes,
      encode(t.preferredArchetypes),
      encode(t.avoidArchetypes),
      encode(t.overrides),
      encode(t.locked),
      t.ownerKeyHash,
      t.viewKey,
      t.inviteCode,
      t.createdAt,
      t.updatedAt,
    );
}

/** UPDATE teams SET <changed fields>, updated_at. */
export function updateTeamStmt(db: D1Database, teamId: string, fields: Partial<TeamFields>, now: string): D1PreparedStatement {
  const cols: string[] = [];
  const binds: unknown[] = [];
  for (const k of TEAM_FIELD_KEYS) {
    if (fields[k] === undefined) continue;
    cols.push(`${TEAM_COLUMNS[k]} = ?`);
    binds.push(encode(fields[k]));
  }
  cols.push("updated_at = ?");
  binds.push(now, teamId);
  return db.prepare(`UPDATE teams SET ${cols.join(", ")} WHERE id = ?`).bind(...binds);
}

type KeyColumn = "owner_key_hash" | "view_key" | "invite_code";

/** Replaces key material. Not a profile change, so updated_at is left alone. */
export function setTeamKeysStmt(db: D1Database, teamId: string, keys: Partial<Record<KeyColumn, string>>): D1PreparedStatement {
  const entries = Object.entries(keys) as [KeyColumn, string][];
  return db
    .prepare(`UPDATE teams SET ${entries.map(([col]) => `${col} = ?`).join(", ")} WHERE id = ?`)
    .bind(...entries.map(([, v]) => v), teamId);
}

/** Conditional insert: the row is only written when `guard` holds at execution time. */
export function insertPlayerStmt(
  db: D1Database,
  teamId: string,
  p: PlayerRecord,
  guard: Guard | null = null,
): D1PreparedStatement {
  const values = [
    teamId,
    p.id,
    p.name,
    encode(p.roles),
    encode(p.pool),
    encode(p.playstyles),
    encode(p.strengths),
    encode(p.weaknesses),
    encode(p.avoid),
    p.notes,
    p.keyHash,
    p.createdAt,
    p.updatedAt,
  ];
  return db
    .prepare(
      `INSERT INTO players (team_id, id, name, roles, pool, playstyles, strengths, weaknesses, avoid, notes, key_hash, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard ? guard.sql : "1"}`,
    )
    .bind(...values, ...(guard?.binds ?? []));
}

/** UPDATE players SET <changed fields>[, key_hash], updated_at WHERE … [AND guard]. */
export function updatePlayerStmt(
  db: D1Database,
  teamId: string,
  playerId: string,
  fields: Partial<PlayerFields>,
  now: string,
  opts: { keyHash?: string | null; guard?: Guard | null; onlyUnclaimed?: boolean } = {},
): D1PreparedStatement {
  const cols: string[] = [];
  const binds: unknown[] = [];
  for (const k of PLAYER_FIELD_KEYS) {
    if (fields[k] === undefined) continue;
    cols.push(`${PLAYER_COLUMNS[k]} = ?`);
    binds.push(encode(fields[k]));
  }
  if (opts.keyHash !== undefined) {
    cols.push("key_hash = ?");
    binds.push(opts.keyHash);
  }
  cols.push("updated_at = ?");
  binds.push(now, teamId, playerId);
  let where = "team_id = ? AND id = ?";
  if (opts.onlyUnclaimed) where += " AND key_hash IS NULL";
  if (opts.guard) where += ` AND ${opts.guard.sql}`;
  return db.prepare(`UPDATE players SET ${cols.join(", ")} WHERE ${where}`).bind(...binds, ...(opts.guard?.binds ?? []));
}

export const deletePlayerStmt = (db: D1Database, teamId: string, playerId: string) =>
  db.prepare("DELETE FROM players WHERE team_id = ? AND id = ?").bind(teamId, playerId);

/** Bumps the team's updatedAt (player edits count as team changes) when `guard` holds. */
export function touchTeamStmt(db: D1Database, teamId: string, now: string, guard: Guard | null = null) {
  const where = guard ? ` AND ${guard.sql}` : "";
  return db.prepare(`UPDATE teams SET updated_at = ? WHERE id = ?${where}`).bind(now, teamId, ...(guard?.binds ?? []));
}

export const deleteTeamStmts = (db: D1Database, teamId: string) => [
  db.prepare("DELETE FROM audit WHERE team_id = ?").bind(teamId),
  db.prepare("DELETE FROM players WHERE team_id = ?").bind(teamId),
  db.prepare("DELETE FROM teams WHERE id = ?").bind(teamId),
];

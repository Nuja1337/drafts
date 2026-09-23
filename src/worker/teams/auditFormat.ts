// Pure audit-log helpers: row ↔ AuditEntry mapping, cursor paging, field diffs and human summaries.
// No Workers APIs here, so it's unit-testable in node (see teams.test.ts).
import type { AuditEntry } from "../../shared/types";

const MAX_SUMMARY = 240;

/** A row of the `audit` table (migrations/0001_init.sql). */
export interface AuditRow {
  id: string;
  team_id: string;
  actor: string;
  actor_name: string | null;
  action: string;
  target: string;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  revertible: number;
  created_at: string;
}

/** A row of the audit list query, which leaves the snapshots out (auditPageStmt). */
export type AuditListRow = Omit<AuditRow, "before_json" | "after_json">;

export const encodeSnapshot = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

function decodeSnapshot(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** When an entry's two snapshots together exceed this many characters, `after` is stored as a summary. */
export const FULL_AFTER_MAX_CHARS = 8 * 1024;

/**
 * Summary of an update's `after` snapshot: arrays become { count }, long text { chars }. Revert only restores
 * `before` (and checks `after` for null to spot removals), so large entries keep undo at roughly half the bytes.
 */
export function compactAfter(after: unknown): unknown {
  const obj = asRecord(after);
  if (!obj) return after;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? { count: v.length } : typeof v === "string" && v.length > 200 ? { chars: v.length } : v;
  }
  return out;
}

/** JSON for an entry's snapshots; a large `after` next to a `before` is summarised (see compactAfter). */
export function encodeSnapshots(before: unknown, after: unknown): { before: string | null; after: string | null } {
  const b = encodeSnapshot(before);
  let a = encodeSnapshot(after);
  if (b !== null && a !== null && b.length + a.length > FULL_AFTER_MAX_CHARS) a = encodeSnapshot(compactAfter(after));
  return { before: b, after: a };
}

export const clip = (s: string, max = MAX_SUMMARY) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Full entry, snapshots included (revert). */
export function rowToEntry(row: unknown): AuditEntry {
  const r = row as AuditRow;
  return {
    ...rowToListEntry(r),
    before: decodeSnapshot(r.before_json),
    after: decodeSnapshot(r.after_json),
  };
}

/** Entry for the activity list: no snapshots (the UI never shows them, and they can be tens of KB per row). */
export function rowToListEntry(row: unknown): AuditEntry {
  const r = row as AuditListRow;
  return {
    id: r.id,
    teamId: r.team_id,
    actor: r.actor,
    ...(r.actor_name !== null ? { actorName: r.actor_name } : {}),
    action: r.action,
    target: r.target,
    summary: r.summary,
    before: undefined,
    after: undefined,
    revertible: r.revertible === 1,
    createdAt: r.created_at,
  };
}

/**
 * Turns limit + 1 rows (newest first) into a page and a `nextBefore` cursor. The cursor is a timestamp, so rows
 * sharing the boundary timestamp are held back for the next page instead of being skipped by `created_at < cursor`.
 */
export function toAuditPage(rows: unknown[], limit: number): { entries: AuditEntry[]; nextBefore?: string } {
  const all = rows as AuditListRow[];
  if (all.length <= limit) return { entries: all.map(rowToListEntry) };
  const boundary = all[limit].created_at;
  let page = all.slice(0, limit);
  const trimmed = page.filter((r) => r.created_at !== boundary);
  if (trimmed.length) page = trimmed;
  return { entries: page.map(rowToListEntry), nextBefore: page[page.length - 1].created_at };
}

// ---- Coalescing a player's rapid self-edits -------------------------------

/** A player's edits to their own slot within this window fold into one audit entry. */
export const COALESCE_MS = 15 * 60_000;

/** The newest audit row of one target (lastTargetEntryStmt). */
export interface LastTargetRow {
  seq: number;
  actor: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  revertible: number;
  created_at: string;
}

/**
 * Folds a player's new self-edit into their previous entry for the same slot when it is theirs, recent and revertible.
 * `before` keeps the earliest value of every field, so one revert undoes the whole burst — and a burst of no-op edits
 * can't push the entry that holds the pre-vandalism snapshot out of the log. Returns null to write a new entry.
 */
export function coalesceEdit(
  prev: LastTargetRow | undefined,
  actor: string,
  now: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { seq: number; before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!prev || prev.actor !== actor || prev.action !== "player.update" || prev.revertible !== 1) return null;
  const age = Date.parse(now) - Date.parse(prev.created_at);
  if (!(Math.abs(age) < COALESCE_MS)) return null;
  const prevBefore = asRecord(decodeSnapshot(prev.before_json));
  const prevAfter = asRecord(decodeSnapshot(prev.after_json));
  if (!prevBefore || !prevAfter) return null;
  return { seq: prev.seq, before: { ...before, ...prevBefore }, after: { ...prevAfter, ...after } };
}

// ---- Diffs and human summaries ---------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keeps only the patch keys whose values differ from `current`; returns matching before/after snapshots. */
export function diff<T extends object>(current: T, patch: Partial<T>): { keys: (keyof T)[]; before: Partial<T>; after: Partial<T> } {
  const keys: (keyof T)[] = [];
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) {
    const next = patch[k];
    if (next === undefined || same(current[k], next)) continue;
    keys.push(k);
    before[k] = current[k];
    after[k] = next as T[keyof T];
  }
  return { keys, before, after };
}

/** "+2/-1" style change count for id-keyed lists (nothing when a side isn't a list, e.g. a summarised snapshot). */
function listDelta<T>(before: T[] | undefined, after: T[] | undefined, key: (v: T) => string): string {
  if ((before !== undefined && !Array.isArray(before)) || !Array.isArray(after)) return "";
  const b = new Set((before ?? []).map(key));
  const a = new Set(after.map(key));
  let added = 0;
  let removed = 0;
  for (const k of a) if (!b.has(k)) added++;
  for (const k of b) if (!a.has(k)) removed++;
  const parts = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`-${removed}`);
  return parts.length ? ` (${parts.join("/")})` : "";
}

const PLAYER_LABELS: Record<string, string> = {
  name: "name",
  roles: "roles",
  pool: "champion pool",
  playstyles: "playstyles",
  strengths: "strengths",
  weaknesses: "weaknesses",
  avoid: "avoid list",
  notes: "notes",
  claimed: "slot claim",
};

type Pair = { a: string; b: string };
type Champ = { championId: string };

export function describeTeamChange(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    const v = after[k];
    switch (k) {
      case "name":
        parts.push(`renamed the team to "${String(v)}"`);
        break;
      case "tag":
        parts.push(v ? `set the tag to "${String(v)}"` : "cleared the tag");
        break;
      case "notes":
        parts.push("edited team notes");
        break;
      case "preferredArchetypes":
        parts.push("changed preferred comps");
        break;
      case "avoidArchetypes":
        parts.push("changed comps to avoid");
        break;
      case "overrides":
        parts.push(`edited matchup overrides${listDelta(before.overrides as Pair[] | undefined, v as Pair[], (o) => `${o.a}>${o.b}`)}`);
        break;
      case "locked":
        parts.push(v ? "locked the team (owner-only edits)" : "unlocked the team");
        break;
    }
  }
  const s = parts.join(", ") || "updated the team";
  return s[0].toUpperCase() + s.slice(1);
}

export function describePlayerChange(playerName: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const parts = Object.keys(after).map((k) => {
    if (k === "name") return `name → "${String(after.name)}"`;
    if (k === "pool") return `champion pool${listDelta(before.pool as Champ[] | undefined, after.pool as Champ[], (p) => p.championId)}`;
    if (k === "avoid") return `avoid list${listDelta(before.avoid as Champ[] | undefined, after.avoid as Champ[], (p) => p.championId)}`;
    return PLAYER_LABELS[k] ?? k;
  });
  return `Updated ${playerName}: ${parts.join(", ")}`;
}

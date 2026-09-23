// Audit log statements: every team mutation writes one entry in the same D1 batch as the change itself.
// Snapshots hold only what changed (full PlayerProfile for creations/removals) so rows stay small and a
// revert undoes exactly one change without clobbering later edits to other fields.
// Storage is bounded per team (AUDIT_KEEP rows and AUDIT_MAX_CHARS of snapshots) and large `after` snapshots are
// summarised (revert only needs `before`), so the log can't be used to fill the free-tier D1 database.
import type { AuditEntry } from "../../shared/types";
import { storageNearlyFull } from "../lib/d1size";
import { randomId } from "../lib/http";
import { clip, encodeSnapshots } from "./auditFormat";
import type { Guard } from "./store";

export const AUDIT_KEEP = 300;
/** Snapshot characters kept per team; older entries beyond this are pruned even under AUDIT_KEEP rows. */
export const AUDIT_MAX_CHARS = 2_000_000;
/** Prune on roughly one write in N so the table stays near its limits without a delete per request... */
const PRUNE_EVERY = 16;
/** ...and on every write whose snapshots are at least this large. */
const PRUNE_ALWAYS_CHARS = 8 * 1024;

export interface AuditDraft {
  actor: string;
  actorName?: string;
  action: string;
  target: string;
  summary: string;
  before: unknown;
  after: unknown;
  revertible: boolean;
}

/** Snapshot JSON for a draft. Near the database size cap entries are written without snapshots (not revertible). */
function snapshotsOf(draft: AuditDraft): { before: string | null; after: string | null; revertible: boolean } {
  if (storageNearlyFull()) return { before: null, after: null, revertible: false };
  return { ...encodeSnapshots(draft.before, draft.after), revertible: draft.revertible };
}

const snapshotChars = (s: { before: string | null; after: string | null }) => (s.before?.length ?? 0) + (s.after?.length ?? 0);

const maybePrune = (db: D1Database, teamId: string, chars: number): D1PreparedStatement[] =>
  chars >= PRUNE_ALWAYS_CHARS || Math.random() < 1 / PRUNE_EVERY ? [pruneStmt(db, teamId)] : [];

/**
 * Builds the INSERT for an audit entry plus (sometimes) a prune of old rows, to append to a mutation batch.
 * With a guard, the entry is only written if the guarded mutation's precondition still holds.
 */
export function auditStmts(
  db: D1Database,
  teamId: string,
  draft: AuditDraft,
  now: string,
  guard: Guard | null = null,
): { stmts: D1PreparedStatement[]; entry: AuditEntry } {
  const snap = snapshotsOf(draft);
  const entry: AuditEntry = {
    id: randomId(),
    teamId,
    actor: draft.actor,
    actorName: draft.actorName,
    action: draft.action,
    target: draft.target,
    summary: clip(draft.summary),
    before: draft.before ?? null,
    after: draft.after ?? null,
    revertible: snap.revertible,
    createdAt: now,
  };
  const insert = db
    .prepare(
      `INSERT INTO audit (team_id, id, actor, actor_name, action, target, summary, before_json, after_json, revertible, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard ? guard.sql : "1"}`,
    )
    .bind(
      teamId,
      entry.id,
      entry.actor,
      entry.actorName ?? null,
      entry.action,
      entry.target,
      entry.summary,
      snap.before,
      snap.after,
      snap.revertible ? 1 : 0,
      entry.createdAt,
      ...(guard?.binds ?? []),
    );
  return { stmts: [insert, ...maybePrune(db, teamId, snapshotChars(snap))], entry };
}

/**
 * Rewrites entry `seq` in place (coalescing a player's rapid self-edits, see coalesceEdit), bumping it to `now`.
 * Guarded like auditStmts' insert; also re-checks actor + target so a pruned-and-reused seq can't be hit.
 * Near the database size cap the stored snapshots are kept as they are (never replaced by nothing).
 */
export function auditMergeStmts(
  db: D1Database,
  teamId: string,
  seq: number,
  draft: AuditDraft,
  now: string,
  guard: Guard | null = null,
): D1PreparedStatement[] {
  const snap = storageNearlyFull() ? null : encodeSnapshots(draft.before, draft.after);
  const sets = snap ? "actor_name = ?, summary = ?, before_json = ?, after_json = ?, created_at = ?" : "actor_name = ?, summary = ?, created_at = ?";
  const values = snap ? [snap.before, snap.after] : [];
  const update = db
    .prepare(`UPDATE audit SET ${sets} WHERE team_id = ? AND seq = ? AND actor = ? AND target = ? AND ${guard ? guard.sql : "1"}`)
    .bind(
      draft.actorName ?? null,
      clip(draft.summary),
      ...values,
      now,
      teamId,
      seq,
      draft.actor,
      draft.target,
      ...(guard?.binds ?? []),
    );
  return [update, ...(snap ? maybePrune(db, teamId, snapshotChars(snap)) : [])];
}

/** Deletes a team's entries beyond the newest AUDIT_KEEP, or beyond AUDIT_MAX_CHARS of snapshots (newest first). */
export const pruneStmt = (db: D1Database, teamId: string) =>
  db
    .prepare(
      `DELETE FROM audit WHERE team_id = ?1 AND seq IN (
         SELECT seq FROM (
           SELECT seq,
             ROW_NUMBER() OVER w AS rn,
             SUM(length(coalesce(before_json, '')) + length(coalesce(after_json, ''))) OVER w AS chars
           FROM audit WHERE team_id = ?1
           WINDOW w AS (ORDER BY created_at DESC, seq DESC)
         ) WHERE rn > ?2 OR chars > ?3
       )`,
    )
    .bind(teamId, AUDIT_KEEP, AUDIT_MAX_CHARS);

/** Newest entry of one target (e.g. "player:<id>"), to decide whether an edit coalesces into it. */
export const lastTargetEntryStmt = (db: D1Database, teamId: string, target: string) =>
  db
    .prepare(
      `SELECT seq, actor, action, before_json, after_json, revertible, created_at FROM audit
       WHERE team_id = ? AND target = ? ORDER BY created_at DESC, seq DESC LIMIT 1`,
    )
    .bind(teamId, target);

/** Columns of the list query: everything except the snapshots (AuditListRow / rowToListEntry). */
const LIST_COLUMNS = "seq, id, team_id, actor, actor_name, action, target, summary, revertible, created_at";

/** Page query (fetches limit + 1 rows so toAuditPage knows whether more exist); runs inside the team-load batch. */
export function auditPageStmt(db: D1Database, teamId: string, before: string | undefined, limit: number) {
  return before
    ? db
        .prepare(`SELECT ${LIST_COLUMNS} FROM audit WHERE team_id = ? AND created_at < ? ORDER BY created_at DESC, seq DESC LIMIT ?`)
        .bind(teamId, before, limit + 1)
    : db
        .prepare(`SELECT ${LIST_COLUMNS} FROM audit WHERE team_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?`)
        .bind(teamId, limit + 1);
}

/** One full entry, snapshots included (revert). */
export const auditEntryStmt = (db: D1Database, teamId: string, entryId: string) =>
  db.prepare("SELECT * FROM audit WHERE team_id = ? AND id = ?").bind(teamId, entryId);

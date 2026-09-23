// Daily D1 housekeeping, run from the cron: drops past days' per-client counters (lib/quota.ts) and audit entries older
// than AUDIT_MAX_AGE_DAYS, and reports the database size (lib/d1size.ts warns as it nears the free tier's 500 MB cap).
// Teams themselves never expire — scouting profiles legitimately sit untouched for months; new-team creation is capped
// per network instead (teams/index.ts).
import { dbSize, noteDbSize } from "./lib/d1size";
import { utcDay } from "./lib/quota";

const DAY_MS = 86_400_000;
const AUDIT_MAX_AGE_DAYS = 180;
/** The cron fires every 20 minutes; only the run in the first 20 minutes of a UTC day does the (table-scanning) cleanup. */
const RUN_WINDOW_MS = 20 * 60_000;

/** Cron entry. Never throws. */
export async function runMaintenance(env: Env, now: number): Promise<void> {
  if (now % DAY_MS >= RUN_WINDOW_MS) return;
  try {
    const db = env.DB;
    const res = await db.batch([
      db.prepare("DELETE FROM daily_usage WHERE day < ?").bind(utcDay(now)),
      db.prepare("DELETE FROM audit WHERE created_at < ?").bind(new Date(now - AUDIT_MAX_AGE_DAYS * DAY_MS).toISOString()),
    ]);
    noteDbSize(res);
    console.log(
      `maintenance: removed ${res[0].meta.changes} counter rows and ${res[1].meta.changes} old audit entries; D1 size ${Math.round(dbSize() / 1e6)} MB`,
    );
  } catch (e) {
    console.error("maintenance failed", e);
  }
}

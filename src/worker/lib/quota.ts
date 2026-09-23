// Per-client daily counters in D1 (migrations/0002_limits.sql), for limits the Rate Limiting binding can't express
// (it only has 10 s / 60 s windows). One upsert per counted action; the daily cron deletes past days.
import { noteDbSize } from "./d1size";
import { clientKey, sha256, type AppContext } from "./http";

/** UTC calendar day, "YYYY-MM-DD". */
export const utcDay = (ms = Date.now()): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Counts one use of `scope` by the caller's network (IPv4 address or IPv6 /64) today and returns whether it was
 * within `limit`. The counter stores only a hash of scope + network. Fails open (a broken counter shouldn't take the
 * feature down) but logs.
 */
export async function takeDaily(c: AppContext, scope: string, limit: number): Promise<boolean> {
  try {
    const k = (await sha256(`${scope}|${clientKey(c)}`)).slice(0, 32);
    const res = await c.env.DB.prepare(
      `INSERT INTO daily_usage (day, k, n) VALUES (?1, ?2, 1)
       ON CONFLICT (day, k) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n`,
    )
      .bind(utcDay(), k, limit)
      .all();
    noteDbSize([res]);
    return res.results.length > 0;
  } catch (e) {
    console.warn(`daily counter "${scope}" unavailable:`, e instanceof Error ? e.message : e);
    return true;
  }
}

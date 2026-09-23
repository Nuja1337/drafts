// D1 size watch: every D1 result reports the database size (meta.size_after). Remember the latest value this isolate
// saw so storage-growing endpoints can back off before the free tier's 500 MB cap makes every write fail — unlike the
// daily quotas, a full database doesn't recover on its own.

/** Log a warning past this size. */
const WARN_BYTES = 350_000_000;
/** Refuse new teams/players and drop audit snapshots past this size (existing teams stay editable). */
const GUARD_BYTES = 400_000_000;

let lastSize = 0;
let warned = false;

export function noteDbSize(results: readonly ({ meta?: { size_after?: number } } | undefined)[]): void {
  for (const r of results) {
    const size = r?.meta?.size_after;
    if (typeof size === "number" && size > 0) lastSize = size;
  }
  if (lastSize > WARN_BYTES && !warned) {
    warned = true;
    console.warn(`D1 database is ${Math.round(lastSize / 1e6)} MB — the free tier caps it at 500 MB`);
  }
}

/** Last seen database size in bytes (0 until this isolate has run a D1 query). */
export const dbSize = (): number => lastSize;

export const storageNearlyFull = (): boolean => lastSize > GUARD_BYTES;

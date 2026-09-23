// Live data: GET /api/live/:game (edge-cached KV passthrough) and the cron refresh (OpenDota → KV).
//
// KV layout (binding CACHE) — one key per game, one write per cron run at most:
//   key   "live:<game>"
//   value the exact JSON body served by GET /api/live/<game> (a LiveDataRes), always in this order:
//           {"game":"dota2","updatedAt":"<ISO>","meta":{…},"matchups":"<blob>"}
//         "matchups" is the LAST property so the cron splices it with plain string ops (no big JSON parse).
//         meta: { [heroId (short name)]: { winRate, pickRate, banRate, games } } — pubs brackets 6-8 + pro bans,
//         rebuilt from /heroStats at most every 6h.
//   meta  KV metadata (≤ 1 KB, returned with the value): { v: 1, c: cursor, s: heroStatsFetchedAtMs, ids: "1,2,3,…" }
//
// Blob grammar (only digits and ":,;|", so it needs no JSON escaping):
//   blob  = line *( "|" line )
//   line  = heroId ":" entry *( ";" entry )
//   entry = vsHeroId "," games "," wins        ; wins of heroId vs vsHeroId in OpenDota pro matches
//   e.g.  "1:17,103,54;129,91,49|2:1,88,41;…"   (hero ids = Champion.key in /data/dota2.json)
// Clients parse it with parseMatchupBlob() (src/shared/matchupMath.ts) and blend it into the static bundle.
//
// Budget (free tier): each run fetches ≤ 10 hero matchup lists + heroStats when due (≤ 11 subrequests),
// does string work only, and writes KV once (72 writes/day at */20). A full rotation of ~127 heroes takes ~4.5h.
import { Hono } from "hono";
import { dotaMetaNumbers, dotaShortName, type OpenDotaHeroStat } from "../shared/derive";
import type { LiveDataRes } from "../shared/api";
import { GAME_IDS, type GameId } from "../shared/types";
import { ApiError, type AppEnv } from "./lib/http";

const OPENDOTA = "https://api.opendota.com/api";
const HEROES_PER_RUN = 10;
const STATS_EVERY_MS = 6 * 3600_000;
const FETCH_TIMEOUT_MS = 10_000;
const FORMAT_VERSION = 1;
const CACHE_SECONDS = 900;
/** In-isolate copy of each game's payload, in front of the Cache API (which may not persist on *.workers.dev). */
const MEMO_MS = 5 * 60_000;

const kvKey = (game: GameId) => `live:${game}`;

const memo = new Map<GameId, { body: string; expires: number }>();

const liveResponse = (body: string, maxAge: number) =>
  new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` },
  });

interface LiveKvMeta {
  v: number;
  /** Rotation cursor into ids. */
  c: number;
  /** Last heroStats refresh (ms). */
  s: number;
  /** Comma-separated hero ids to rotate over. */
  ids: string;
}

export const liveApp = new Hono<AppEnv>();

liveApp.get("/live/:game", async (c) => {
  const game = c.req.param("game") as GameId;
  if (!GAME_IDS.includes(game)) throw new ApiError(404, "unknown_game", "Unknown game.");

  // This isolate's copy, then the edge cache: most requests never touch KV.
  const now = Date.now();
  const kept = memo.get(game);
  if (kept && kept.expires > now) return liveResponse(kept.body, Math.ceil((kept.expires - now) / 1000));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(new URL(`/api/live/${game}`, c.req.url).toString(), { method: "GET" });
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  let body = await c.env.CACHE.get(kvKey(game), "text").catch(() => null);
  let maxAge = CACHE_SECONDS;
  if (!body || !body.startsWith("{")) {
    const empty: LiveDataRes = { game, updatedAt: null };
    body = JSON.stringify(empty);
    maxAge = 60; // nothing refreshed yet: don't pin the empty answer for long
  }
  memo.set(game, { body, expires: now + Math.min(MEMO_MS, maxAge * 1000) });
  const res = liveResponse(body, maxAge);
  if (cache) {
    const put = cache.put(cacheKey, res.clone()).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put; // no execution context (tests)
    }
  }
  return res;
});

/** Cron entry (wrangler.jsonc triggers every 20 min). Never throws. */
export async function runScheduled(env: Env, controller: ScheduledController): Promise<void> {
  try {
    const summary = await refreshDota(env, controller.scheduledTime || Date.now());
    console.log(`live refresh: ${summary}`);
  } catch (e) {
    console.error("live refresh failed", e);
  }
}

// ---------------------------------------------------------------------------
// Dota refresh
// ---------------------------------------------------------------------------

interface Stored {
  meta: string;
  lines: Map<number, string>;
}

/** Split a stored payload into its meta JSON text and blob lines using string ops only. */
export function splitPayload(text: string | null): Stored {
  const empty: Stored = { meta: "{}", lines: new Map() };
  if (!text) return empty;
  const mi = text.indexOf(',"meta":');
  const bi = text.lastIndexOf(',"matchups":"');
  if (mi < 0 || bi < mi || !text.endsWith('"}')) return empty;
  const meta = text.slice(mi + 8, bi);
  const blob = text.slice(bi + 13, -2);
  if (!meta.startsWith("{") || !meta.endsWith("}") || /[^0-9:,;|]/.test(blob)) return empty;
  const lines = new Map<number, string>();
  if (blob) {
    for (const line of blob.split("|")) {
      const id = Number(line.slice(0, line.indexOf(":")));
      if (Number.isInteger(id) && id > 0) lines.set(id, line);
    }
  }
  return { meta, lines };
}

/** Assemble the served payload (matchups last — see the format notes above). */
export function buildPayload(updatedAt: string, meta: string, lines: Map<number, string>): string {
  const blob = [...lines.keys()]
    .sort((a, b) => a - b)
    .map((id) => lines.get(id)!)
    .join("|");
  return `{"game":"dota2","updatedAt":${JSON.stringify(updatedAt)},"meta":${meta},"matchups":"${blob}"}`;
}

function readKvMeta(m: unknown): LiveKvMeta | null {
  const x = m as Partial<LiveKvMeta> | null;
  if (!x || x.v !== FORMAT_VERSION || typeof x.ids !== "string" || typeof x.c !== "number" || typeof x.s !== "number") return null;
  return x as LiveKvMeta;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "drafts/1.0 (+live refresh)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

/** One matchup line "heroId:vs,games,wins;…" from /heroes/{id}/matchups. */
async function fetchMatchupLine(heroId: number, known: Set<number>): Promise<string> {
  const rows = await getJson(`${OPENDOTA}/heroes/${heroId}/matchups`);
  if (!Array.isArray(rows)) throw new Error(`bad matchups payload for ${heroId}`);
  const parts: string[] = [];
  for (const r of rows as { hero_id?: unknown; games_played?: unknown; wins?: unknown }[]) {
    const vs = r?.hero_id;
    const g = r?.games_played;
    const w = r?.wins;
    if (typeof vs !== "number" || typeof g !== "number" || typeof w !== "number") continue;
    if (!Number.isInteger(vs) || vs === heroId || !known.has(vs) || g <= 0 || w < 0 || w > g) continue;
    parts.push(`${vs},${Math.round(g)},${Math.round(w)}`);
  }
  if (!parts.length) throw new Error(`no matchups for ${heroId}`);
  return `${heroId}:${parts.join(";")}`;
}

/** heroStats → hero ids + compact meta JSON keyed by short name. */
async function fetchHeroStats(): Promise<{ ids: number[]; meta: string }> {
  const rows = await getJson(`${OPENDOTA}/heroStats`);
  if (!Array.isArray(rows)) throw new Error("bad heroStats payload");
  const heroes = (rows as OpenDotaHeroStat[]).filter(
    (h) => h && typeof h.id === "number" && h.id > 0 && typeof h.name === "string" && h.name.startsWith("npc_dota_hero_"),
  );
  if (heroes.length < 50) throw new Error(`heroStats returned only ${heroes.length} heroes`);
  const numbers = dotaMetaNumbers(heroes);
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const meta: NonNullable<LiveDataRes["meta"]> = {};
  for (const h of heroes) {
    const n = numbers.get(h.id)!;
    meta[dotaShortName(h.name)] = { winRate: r4(n.winRate), pickRate: r4(n.pickRate), banRate: r4(n.banRate), games: n.games };
  }
  return { ids: heroes.map((h) => h.id).sort((a, b) => a - b), meta: JSON.stringify(meta) };
}

/** One refresh step. Returns a short summary for logs. */
export async function refreshDota(env: Env, now: number): Promise<string> {
  const key = kvKey("dota2");
  const { value, metadata } = await env.CACHE.getWithMetadata<LiveKvMeta>(key, "text");
  const state = readKvMeta(metadata);
  const stored = state ? splitPayload(value) : splitPayload(null);
  let ids = state?.ids ? state.ids.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  let statsAt = state?.s ?? 0;
  let cursor = state?.c ?? 0;
  let meta = stored.meta;
  let statsRefreshed = false;

  if (!ids.length || now - statsAt >= STATS_EVERY_MS) {
    try {
      const stats = await fetchHeroStats();
      ids = stats.ids;
      meta = stats.meta;
      statsAt = now;
      statsRefreshed = true;
    } catch (e) {
      console.warn("heroStats refresh failed", e);
      if (!ids.length) return "no hero list yet; skipped";
    }
  }

  if (cursor >= ids.length) cursor = 0;
  const batch: number[] = [];
  for (let i = 0; i < Math.min(HEROES_PER_RUN, ids.length); i++) batch.push(ids[(cursor + i) % ids.length]);
  const known = new Set(ids);
  const results = await Promise.allSettled(batch.map((id) => fetchMatchupLine(id, known)));
  const lines = stored.lines;
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      lines.set(batch[i], r.value);
      ok++;
    } else console.warn(`matchups ${batch[i]} failed:`, r.reason);
  });
  if (!ok && !statsRefreshed) return `all ${batch.length} fetches failed; nothing written`;

  for (const id of [...lines.keys()]) if (!known.has(id)) lines.delete(id);
  const next: LiveKvMeta = { v: FORMAT_VERSION, c: (cursor + batch.length) % ids.length, s: statsAt, ids: ids.join(",") };
  await env.CACHE.put(key, buildPayload(new Date(now).toISOString(), meta, lines), { metadata: next });
  return `${ok}/${batch.length} heroes refreshed (cursor ${cursor}→${next.c}), ${lines.size} lines stored${statsRefreshed ? ", heroStats refreshed" : ""}`;
}

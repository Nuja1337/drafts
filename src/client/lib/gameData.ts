// Loads the static game data bundle (/data/<game>.json), cached per session, then applies a non-blocking live
// overlay: LoL — newer Data Dragon patch (portrait URLs + brand-new champions via derive.ts); Dota 2 — fresher
// OpenDota matchups/meta from /api/live/dota2. Overlay failures are silent and keep the static data.
import { useEffect, useState } from "react";
import type { LiveDataRes } from "../../shared/api";
import { compareVersions, DDRAGON, ddragonImageUrl, deriveLolChampion, type DDragonChampion } from "../../shared/derive";
import { baseRate, excessWins, MIN_ADV, MIN_DATA_ADV, parseMatchupBlob, refreshAdv, round3, type H2H } from "../../shared/matchupMath";
import type { Champion, GameDataBundle, GameId, MatchupCell } from "../../shared/types";

export interface GameData extends GameDataBundle {
  byId: Map<string, Champion>;
  /** Set when a live overlay changed something. */
  live?: {
    /** e.g. "Data Dragon 16.19.1" or "OpenDota live". */
    source: string;
    /** LoL: live Data Dragon version; Dota: live data timestamp. */
    version: string;
    /** Champion ids added by the overlay (derived, curated: false). */
    added: string[];
    /** Matchup pairs updated by the overlay. */
    updatedPairs: number;
  };
}

/** Whether a bundle carries win-rate stats at all (the LoL bundle has meta tiers only). */
export const hasWinRates = (champions: readonly Champion[]): boolean => champions.some((c) => Object.values(c.meta).some((m) => m?.winRate !== undefined));

const staticCache = new Map<GameId, Promise<GameData>>();
const liveCache = new Map<GameId, Promise<GameData>>();
const liveResolved = new Map<GameId, GameData>();

const withIndex = (bundle: GameDataBundle, live?: GameData["live"]): GameData => ({
  ...bundle,
  byId: new Map(bundle.champions.map((c) => [c.id, c])),
  ...(live ? { live } : {}),
});

/** The static bundle as built (fast; never includes live overlays). */
export function loadGameData(game: GameId): Promise<GameData> {
  let p = staticCache.get(game);
  if (!p) {
    p = fetch(`/data/${game}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${game} data (${r.status})`);
        return r.json() as Promise<GameDataBundle>;
      })
      .then((bundle) => {
        if (!bundle || !Array.isArray(bundle.champions) || !bundle.matchups) throw new Error(`Invalid ${game} data`);
        return withIndex(bundle);
      });
    p.catch(() => staticCache.delete(game));
    staticCache.set(game, p);
  }
  return p;
}

/** The static bundle plus the live overlay. Resolves to the static data when the overlay fails or adds nothing. */
export function loadLiveGameData(game: GameId): Promise<GameData> {
  let p = liveCache.get(game);
  if (!p) {
    p = loadGameData(game).then(async (data) => {
      let out = data;
      try {
        out = (game === "lol" ? await lolOverlay(data) : await dotaOverlay(data)) ?? data;
      } catch {
        out = data; // live data is best-effort
      }
      liveResolved.set(game, out);
      return out;
    });
    p.catch(() => liveCache.delete(game));
    liveCache.set(game, p);
  }
  return p;
}

/** Game data for React: the static bundle as soon as it loads, then (at most once) the live-overlaid version. */
export function useGameData(game: GameId | null | undefined): { data: GameData | null; error: Error | null; loading: boolean } {
  const [state, setState] = useState<{ data: GameData | null; error: Error | null }>(() => ({
    data: (game && liveResolved.get(game)) || null,
    error: null,
  }));
  useEffect(() => {
    if (!game) return;
    let alive = true;
    const ready = liveResolved.get(game);
    if (ready) {
      setState({ data: ready, error: null });
      return;
    }
    setState({ data: null, error: null });
    loadGameData(game).then(
      (data) => {
        if (!alive) return;
        setState({ data, error: null });
        loadLiveGameData(game).then(
          (live) => alive && live !== data && setState({ data: live, error: null }),
          () => undefined,
        );
      },
      (error: Error) => alive && setState({ data: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [game]);
  return { ...state, loading: !!game && !state.data && !state.error };
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isDDragonChampion = (c: unknown): c is DDragonChampion => {
  const x = c as DDragonChampion | null;
  return !!x && typeof x.id === "string" && typeof x.key === "string" && typeof x.name === "string" && Array.isArray(x.tags);
};

/** LoL: when Data Dragon has a newer patch, point portraits at it and add champions the bundle doesn't know yet. */
export async function lolOverlay(data: GameData): Promise<GameData | null> {
  const versions = await fetchJson<unknown>(`${DDRAGON}/api/versions.json`, 6000);
  if (!Array.isArray(versions)) return null;
  const latest = versions.find((v): v is string => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v));
  if (!latest || compareVersions(latest, data.version) <= 0) return null;
  const file = await fetchJson<{ data?: Record<string, unknown> }>(`${DDRAGON}/cdn/${latest}/data/en_US/champion.json`, 12000);
  const sources = Object.values(file?.data ?? {}).filter(isDDragonChampion);
  if (sources.length < 100) return null;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const champions = data.champions.map((c) => {
    const file = byId.get(c.id)?.image?.full;
    return { ...c, image: file ? ddragonImageUrl(latest, file) : c.image.replace(`/cdn/${data.version}/`, `/cdn/${latest}/`) };
  });
  const added = sources.filter((s) => !data.byId.has(s.id)).map((s) => deriveLolChampion(s, latest));
  champions.push(...added);
  champions.sort((a, b) => a.name.localeCompare(b.name));
  return withIndex(
    { ...data, champions, sources: [...data.sources, `Data Dragon ${latest} (live)`] },
    { source: `Data Dragon ${latest}`, version: latest, added: added.map((c) => c.id), updatedPairs: 0 },
  );
}

/**
 * Dota: blend fresher OpenDota pro matchups (same shrinkage math as the build, via refreshAdv) and
 * refresh meta numbers (tiers stay as built).
 */
export async function dotaOverlay(data: GameData, fetchLive: () => Promise<LiveDataRes | null> = () => fetchJson<LiveDataRes>("/api/live/dota2", 8000)): Promise<GameData | null> {
  const live = await fetchLive();
  if (!live || live.game !== "dota2" || !live.updatedAt) return null;
  if (Date.parse(live.updatedAt) <= Date.parse(data.generatedAt)) return null;

  const { matchups, updatedPairs } = typeof live.matchups === "string" ? blendMatchups(data, parseMatchupBlob(live.matchups)) : { matchups: data.matchups, updatedPairs: 0 };

  let metaChanged = false;
  let champions = data.champions;
  if (live.meta && typeof live.meta === "object") {
    champions = data.champions.map((c) => {
      const m = live.meta![c.id];
      if (!m || typeof m !== "object") return c;
      metaChanged = true;
      const meta: Champion["meta"] = {};
      for (const [role, stat] of Object.entries(c.meta)) {
        if (!stat) continue;
        meta[role] = { ...stat };
        for (const k of ["winRate", "pickRate", "banRate", "games"] as const) {
          const v = m[k];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) meta[role]![k] = v;
        }
      }
      return { ...c, meta };
    });
  }
  if (!updatedPairs && !metaChanged) return null;
  return withIndex(
    { ...data, champions, matchups, sources: [...data.sources, `OpenDota live ${live.updatedAt}`] },
    { source: "OpenDota live", version: live.updatedAt, added: [], updatedPairs },
  );
}

/**
 * Share of the roster that must have a live line before matchups are blended: base rates come from each
 * hero's own line, and a partial rotation (first hours after deploy) would skew them.
 */
export const MIN_LIVE_COVERAGE = 0.9;

/** Copy-on-write blend of head-to-head lines into the bundle's matchup matrix (both directions). */
export function blendMatchups(data: GameDataBundle, h2h: Map<number, H2H>): { matchups: GameDataBundle["matchups"]; updatedPairs: number } {
  const idByKey = new Map(data.champions.map((c) => [c.key, c.id]));
  let covered = 0;
  for (const k of h2h.keys()) if (idByKey.has(k)) covered++;
  if (covered < data.champions.length * MIN_LIVE_COVERAGE) return { matchups: data.matchups, updatedPairs: 0 };
  // Base win rate per hero from its own line, else mirrored from everyone else's lines against it.
  const mirrored = new Map<number, [number, number]>();
  for (const line of h2h.values())
    for (const [vs, [g, w]] of line) {
      const acc = mirrored.get(vs) ?? [0, 0];
      acc[0] += g;
      acc[1] += g - w;
      mirrored.set(vs, acc);
    }
  const baseCache = new Map<number, number>();
  const base = (k: number): number => {
    let b = baseCache.get(k);
    if (b === undefined) {
      const m = mirrored.get(k);
      b = h2h.has(k) ? baseRate(h2h.get(k)) : m && m[0] > 0 ? m[1] / m[0] : 0.5;
      baseCache.set(k, b);
    }
    return b;
  };

  const out: GameDataBundle["matchups"] = { ...data.matchups };
  const copied = new Set<string>();
  const row = (id: string) => {
    if (!copied.has(id)) {
      out[id] = { ...(out[id] ?? {}) };
      copied.add(id);
    }
    return out[id];
  };
  let updatedPairs = 0;
  for (const [ka, line] of h2h) {
    const a = idByKey.get(ka);
    if (!a) continue;
    for (const [kb, [games, wins]] of line) {
      // Each unordered pair once: from the lower id's line when both lines exist.
      if (kb === ka || (h2h.get(kb)?.has(ka) && kb < ka)) continue;
      const b = idByKey.get(kb);
      if (!b) continue;
      const cell: MatchupCell | undefined = data.matchups[a]?.[b];
      const staticGames = cell?.n ?? 0;
      if (games <= staticGames) continue;
      const adv = round3(refreshAdv(cell?.adv ?? 0, staticGames, excessWins(games, wins, base(ka), base(kb)), games));
      const floor = cell ? MIN_ADV : MIN_DATA_ADV;
      if (Math.abs(adv) < floor) {
        if (!cell) continue;
        delete row(a)[b];
        delete row(b)[a];
      } else {
        const lane = cell?.lane ? { lane: true } : {};
        row(a)[b] = { adv, n: games, ...lane };
        row(b)[a] = { adv: -adv || 0, n: games, ...lane };
      }
      updatedPairs++;
    }
  }
  return { matchups: updatedPairs ? out : data.matchups, updatedPairs };
}

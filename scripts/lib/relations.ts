// Turns curated relations (+ optional head-to-head data) into the bundle's sparse matchup/synergy matrices.
import type { CuratedChampion, GameDataBundle, MatchupCell } from "../../src/shared/types";
import { baseRate, dataAdv, excessWins, MIN_ADV, REL_ADV, round3, SYN_VALUE, type H2H } from "../../src/shared/matchupMath";

/** Directed estimate a→b (adv from a's perspective) with a lane flag. */
export interface PairEstimate {
  adv: number;
  lane: boolean;
}

const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;
const splitKey = (k: string): [string, string] => k.split("\u0000") as [string, string];

/**
 * Curated strongVs/weakVs → one adv per unordered pair, stored under the lexicographically smaller id first.
 * When both champions state the relation (or one states it twice), the estimates are averaged.
 */
export function curatedPairs(curated: Iterable<CuratedChampion>): Map<string, PairEstimate> {
  const acc = new Map<string, { sum: number; count: number; lane: boolean }>();
  const add = (x: string, y: string, v: number, lane: boolean) => {
    const [a, b, adv] = x < y ? [x, y, v] : [y, x, -v];
    const k = pairKey(a, b);
    const cur = acc.get(k) ?? { sum: 0, count: 0, lane: false };
    cur.sum += adv;
    cur.count++;
    cur.lane ||= lane;
    acc.set(k, cur);
  };
  for (const c of curated) {
    for (const r of c.strongVs) add(c.id, r.id, REL_ADV[r.s], !!r.lane);
    for (const r of c.weakVs) add(c.id, r.id, -REL_ADV[r.s], !!r.lane);
  }
  const out = new Map<string, PairEstimate>();
  for (const [k, v] of acc) out.set(k, { adv: v.sum / v.count, lane: v.lane });
  return out;
}

/** Curated estimate for the ordered pair a→b (undefined when no relation is stated). */
export function curatedAdv(pairs: Map<string, PairEstimate>, a: string, b: string): PairEstimate | undefined {
  if (a < b) return pairs.get(pairKey(a, b));
  const p = pairs.get(pairKey(b, a));
  return p ? { adv: -p.adv, lane: p.lane } : undefined;
}

/** Write a cell and its mirror (b→a = -adv). */
export function setPair(m: GameDataBundle["matchups"], a: string, b: string, cell: MatchupCell): void {
  const adv = round3(cell.adv);
  (m[a] ??= {})[b] = { ...cell, adv };
  (m[b] ??= {})[a] = { ...cell, adv: -adv || 0 };
}

/** Matchups from curated relations only (LoL). */
export function curatedMatchups(pairs: Map<string, PairEstimate>, ids: Set<string>): GameDataBundle["matchups"] {
  const m: GameDataBundle["matchups"] = {};
  for (const [k, p] of pairs) {
    const [a, b] = splitKey(k);
    if (!ids.has(a) || !ids.has(b) || Math.abs(p.adv) < MIN_ADV) continue;
    const cell: MatchupCell = { adv: p.adv };
    if (p.lane) cell.lane = true;
    setPair(m, a, b, cell);
  }
  return sortMatrix(m);
}

export interface DataMatchupOptions {
  /** Numeric key → champion id. */
  idByKey: Map<number, string>;
  /** Head-to-head lines per numeric key. */
  h2h: Map<number, H2H>;
  pairs: Map<string, PairEstimate>;
  /** Minimum |adv| for cells without a curated relation (raise to shrink the bundle). */
  minDataAdv: number;
}

/** Pair counts by evidence (kept in the matrix), plus data-only pairs dropped as noise. */
export interface DataMatchupStats {
  dataPairs: number;
  blendedPairs: number;
  curatedPairs: number;
  droppedPairs: number;
}

/**
 * Head-to-head data (Dota pro matchups) blended with curated relations: excess wins over the log5
 * expectation, shrunk toward the curated adv (or 0). Curated-only pairs keep their curated adv.
 */
export function dataMatchups(opts: DataMatchupOptions): { matchups: GameDataBundle["matchups"]; stats: DataMatchupStats } {
  const { idByKey, h2h, pairs, minDataAdv } = opts;
  const base = new Map<number, number>();
  for (const key of idByKey.keys()) base.set(key, baseRate(h2h.get(key)));
  const m: GameDataBundle["matchups"] = {};
  const stats: DataMatchupStats = { dataPairs: 0, blendedPairs: 0, curatedPairs: 0, droppedPairs: 0 };
  const keys = [...idByKey.keys()].sort((x, y) => x - y);
  for (const ka of keys) {
    for (const kb of keys) {
      if (ka >= kb) continue;
      const a = idByKey.get(ka)!;
      const b = idByKey.get(kb)!;
      // Prefer a's own line; fall back to b's line mirrored.
      let games = 0;
      let wins = 0;
      const ab = h2h.get(ka)?.get(kb);
      const ba = h2h.get(kb)?.get(ka);
      if (ab && (!ba || ab[0] >= ba[0])) [games, wins] = ab;
      else if (ba) [games, wins] = [ba[0], ba[0] - ba[1]];
      const cur = curatedAdv(pairs, a, b);
      if (!games && !cur) continue;
      const adv = games > 0 ? dataAdv(excessWins(games, wins, base.get(ka)!, base.get(kb)!), games, cur?.adv ?? 0) : cur!.adv;
      if (Math.abs(adv) < (cur ? MIN_ADV : Math.max(MIN_ADV, minDataAdv))) {
        if (!cur) stats.droppedPairs++;
        continue;
      }
      if (!games) stats.curatedPairs++;
      else if (cur) stats.blendedPairs++;
      else stats.dataPairs++;
      const cell: MatchupCell = { adv };
      if (games > 0) cell.n = games;
      if (cur?.lane) cell.lane = true;
      setPair(m, a, b, cell);
    }
  }
  return { matchups: sortMatrix(m), stats };
}

/** Curated synergies → symmetric strengths (max of both directions). */
export function curatedSynergies(curated: Iterable<CuratedChampion>, ids: Set<string>): GameDataBundle["synergies"] {
  const s: GameDataBundle["synergies"] = {};
  for (const c of curated) {
    if (!ids.has(c.id)) continue;
    for (const r of c.synergies) {
      if (!ids.has(r.id) || r.id === c.id) continue;
      const v = SYN_VALUE[r.s];
      const prev = s[c.id]?.[r.id] ?? 0;
      if (v <= prev) continue;
      (s[c.id] ??= {})[r.id] = v;
      (s[r.id] ??= {})[c.id] = v;
    }
  }
  return sortMatrix(s);
}

/** Stable key order for reproducible output. */
export function sortMatrix<T>(m: Record<string, Record<string, T>>): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = {};
  for (const a of Object.keys(m).sort()) {
    out[a] = {};
    for (const b of Object.keys(m[a]).sort()) out[a][b] = m[a][b];
  }
  return out;
}

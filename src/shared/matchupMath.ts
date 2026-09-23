// Matchup/synergy math shared by the data build (scripts/build-data.ts), the client live overlay
// (src/client/lib/gameData.ts) and tests. Pure functions, no imports.
//
// Data-driven Dota matchups are measured as "excess wins": how many more games A won against B than
// expected from both heroes' overall win rates (log5). This keeps generally strong heroes from looking
// like they counter everything — the engine scores meta strength separately.

/** Curated relation strength (1..3) → matchup advantage. */
export const REL_ADV: Record<1 | 2 | 3, number> = { 1: 0.12, 2: 0.25, 3: 0.4 };
/** Curated synergy strength (1..3) → synergy value. */
export const SYN_VALUE: Record<1 | 2 | 3, number> = { 1: 0.33, 2: 0.66, 3: 1 };

/** Scale from win-rate delta to adv: a +10% excess win rate maps to adv 0.4 (a curated "hard counter"). */
export const ADV_SCALE = 4;
/**
 * Bayesian prior strength in pseudo-games: pulls samples toward the prior (even, or the curated relation).
 * Deliberately strong: an empirical-Bayes check on OpenDota pro matchups (≈8k pairs, median 50 games) found
 * the spread of excess win rates is almost entirely binomial noise (true-effect SD ≲ 1%). With 30 pseudo-games
 * half of all pairs would show |adv| ≥ 0.1 from noise alone; with 300 only large, lopsided samples move a cell.
 */
export const PRIOR_GAMES = 300;
/** Cells with |adv| below this carry no signal and are omitted from bundles. */
export const MIN_ADV = 0.02;
/** Floor for cells backed only by match data (no curated relation): weaker cells are indistinguishable from noise. */
export const MIN_DATA_ADV = 0.05;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const round3 = (x: number): number => Math.round(x * 1000) / 1000 || 0;

/** Expected win probability of A vs B from their overall win rates (log5 / Bradley-Terry). */
export function log5(pa: number, pb: number): number {
  const a = clamp(pa, 0.01, 0.99);
  const b = clamp(pb, 0.01, 0.99);
  const num = a * (1 - b);
  return num / (num + b * (1 - a));
}

/**
 * Advantage of A over B from `games` head-to-head games with `excess` = wins - expected wins,
 * shrunk toward `priorAdv` (0 = even, or a curated relation) with PRIOR_GAMES pseudo-games.
 * games = 0 returns the prior.
 */
export function dataAdv(excess: number, games: number, priorAdv = 0, prior = PRIOR_GAMES, k = ADV_SCALE): number {
  const n = Math.max(0, games);
  const priorDelta = clamp(priorAdv, -1, 1) / k;
  return clamp((k * (excess + prior * priorDelta)) / (n + prior), -1, 1);
}

/**
 * Update a bundle cell (built from `staticGames` games) with fresher counts over `games` games that
 * include the older sample. Only the new games (share 1 - staticGames/games) add evidence; the static
 * adv keeps its accumulated weight. With staticGames = 0 this equals dataAdv(excess, games, staticAdv).
 * Returns the static adv unchanged when the fresh sample is not larger.
 */
export function refreshAdv(staticAdv: number, staticGames: number, excess: number, games: number, prior = PRIOR_GAMES, k = ADV_SCALE): number {
  const ns = Math.max(0, staticGames);
  if (games <= ns) return staticAdv;
  const newShare = 1 - ns / games;
  return clamp((k * excess * newShare + staticAdv * (ns + prior)) / (games + prior), -1, 1);
}

/** Pro/pub head-to-head counts for one hero: vsId → [games, wins]. */
export type H2H = Map<number, [games: number, wins: number]>;

/** Overall win rate of a hero from its head-to-head line (sum of wins / sum of games), 0.5 when empty. */
export function baseRate(line: H2H | undefined): number {
  if (!line) return 0.5;
  let g = 0;
  let w = 0;
  for (const [games, wins] of line.values()) {
    g += games;
    w += wins;
  }
  return g > 0 ? w / g : 0.5;
}

/** Excess wins of A vs B given head-to-head counts and both base rates. */
export const excessWins = (games: number, wins: number, baseA: number, baseB: number): number => wins - games * log5(baseA, baseB);

/**
 * Parse the compact live matchup blob (format documented in src/worker/live.ts):
 * "heroId:vsId,games,wins;vsId,games,wins|heroId:…". Malformed entries are skipped.
 */
export function parseMatchupBlob(blob: string): Map<number, H2H> {
  const out = new Map<number, H2H>();
  if (!blob) return out;
  for (const line of blob.split("|")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const hero = Number(line.slice(0, colon));
    if (!Number.isInteger(hero) || hero <= 0) continue;
    const h2h: H2H = new Map();
    for (const entry of line.slice(colon + 1).split(";")) {
      const [v, g, w] = entry.split(",");
      const vs = Number(v);
      const games = Number(g);
      const wins = Number(w);
      if (!Number.isInteger(vs) || vs <= 0 || vs === hero) continue;
      if (!Number.isFinite(games) || !Number.isFinite(wins) || games <= 0 || wins < 0 || wins > games) continue;
      h2h.set(vs, [games, wins]);
    }
    if (h2h.size) out.set(hero, h2h);
  }
  return out;
}

/** Serialize head-to-head lines to the compact blob format (sorted for stable output). */
export function formatMatchupLine(hero: number, h2h: Iterable<[number, number, number]>): string {
  const parts: string[] = [];
  for (const [vs, games, wins] of h2h) if (games > 0) parts.push(`${vs},${games},${wins}`);
  return `${hero}:${parts.join(";")}`;
}

// Dota 2 bundle: OpenDota heroStats (roster, images, roles, pub/pro stats) + per-hero pro matchups
// + curated knowledge. OpenDota's free tier allows 60 req/min (~2-3k/day): requests are throttled and
// every raw response is cached on disk for 24h, so re-runs are free.
import { join } from "node:path";
import { blendTiers, deriveDotaChampion, dotaMetaNumbers, dotaShortName, mergeCurated, tiersByPercentile, type OpenDotaHeroStat } from "../../src/shared/derive";
import { MIN_DATA_ADV, type H2H } from "../../src/shared/matchupMath";
import type { Champion, GameDataBundle, MetaStat, Role } from "../../src/shared/types";
import { loadCurated } from "./curated";
import type { CachedFetcher } from "./fetchCache";
import { countCells, type BuildContext, type BuildReport } from "./common";
import { curatedPairs, curatedSynergies, dataMatchups } from "./relations";

const OPENDOTA = "https://api.opendota.com/api";
const DAY = 24 * 3600_000;

interface MatchupRow {
  hero_id: number;
  games_played: number;
  wins: number;
}

const isHeroStats = (x: unknown): x is OpenDotaHeroStat[] =>
  Array.isArray(x) && x.length > 50 && x.every((h) => h && typeof h.id === "number" && typeof h.name === "string" && Array.isArray(h.roles));
const isMatchups = (x: unknown): x is MatchupRow[] =>
  Array.isArray(x) && x.every((m) => m && typeof m.hero_id === "number" && typeof m.games_played === "number" && typeof m.wins === "number");
const isPatches = (x: unknown): x is { name: string }[] => Array.isArray(x) && x.length > 0 && x.every((p) => p && typeof p.name === "string");

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

export interface DotaBuildOptions {
  /** Byte budget for the serialized bundle; data-only matchup cells are pruned (weakest first) to fit. */
  maxBytes: number;
}

export async function buildDota(ctx: BuildContext & { opendota: CachedFetcher }, opts: DotaBuildOptions): Promise<BuildReport> {
  const cacheDir = join(ctx.root, "data", "cache", "opendota");
  const od = ctx.opendota;

  const patches = await od.json(`${OPENDOTA}/constants/patch`, join(cacheDir, "patch.json"), DAY, isPatches);
  const patch = patches.data[patches.data.length - 1].name;
  const stats = await od.json(`${OPENDOTA}/heroStats`, join(cacheDir, "heroStats.json"), DAY, isHeroStats);
  const rows = stats.data.filter((h) => h.id > 0 && h.name.startsWith("npc_dota_hero_"));
  ctx.log(`OpenDota patch ${patch}, heroStats ${rows.length} heroes (${stats.from})`);

  // Pro head-to-head matchups, one request per hero (cached).
  const h2h = new Map<number, H2H>();
  const idSet = new Set(rows.map((r) => r.id));
  let fromNet = 0;
  let failed = 0;
  for (const [i, row] of rows.entries()) {
    try {
      const res = await od.json(`${OPENDOTA}/heroes/${row.id}/matchups`, join(cacheDir, `matchups-${row.id}.json`), DAY, isMatchups);
      if (res.from !== "cache") fromNet++;
      const line: H2H = new Map();
      for (const m of res.data) {
        if (!idSet.has(m.hero_id) || m.hero_id === row.id || m.games_played <= 0) continue;
        line.set(m.hero_id, [m.games_played, Math.max(0, Math.min(m.wins, m.games_played))]);
      }
      h2h.set(row.id, line);
    } catch (e) {
      failed++;
      ctx.warn(`matchups for ${row.localized_name} unavailable: ${(e as Error).message}`);
    }
    if ((i + 1) % 20 === 0 || i + 1 === rows.length) ctx.log(`  matchups ${i + 1}/${rows.length} (${fromNet} fetched, ${failed} failed)`);
  }

  const idByKey = new Map(rows.map((r) => [r.id, dotaShortName(r.name)]));
  const ids = new Set(idByKey.values());
  const curated = loadCurated(join(ctx.root, "data", "dota2", "curated"), "dota2", ids, ctx.warn);

  // Meta: data tier by percentile of a pub/pro composite score, blended with curated per-role tiers.
  const numbers = dotaMetaNumbers(rows);
  const tiers = tiersByPercentile(new Map([...numbers].map(([id, n]) => [id, n.score])));
  const champions: Champion[] = rows.map((row) => {
    const base = deriveDotaChampion(row);
    const cur = curated.byId.get(base.id);
    const champ = cur ? mergeCurated(base, cur) : base;
    const n = numbers.get(row.id)!;
    const dataTier = tiers.get(row.id) ?? "B";
    const meta: Partial<Record<Role, MetaStat>> = {};
    for (const role of champ.roles) {
      const curTier = cur?.meta?.[role];
      meta[role] = {
        tier: curTier ? blendTiers(dataTier, curTier, curTier) : dataTier,
        winRate: r4(n.winRate),
        pickRate: r4(n.pickRate),
        banRate: r4(n.banRate),
        games: n.games,
      };
    }
    champ.meta = meta;
    return champ;
  });
  champions.sort((a, b) => a.name.localeCompare(b.name));

  const curatedList = [...curated.byId.values()];
  const pairs = curatedPairs(curatedList);
  const synergies = curatedSynergies(curatedList, ids);

  // Prune weak data-only cells until the bundle fits the byte budget.
  const make = (minDataAdv: number) => {
    const { matchups, stats: mstats } = dataMatchups({ idByKey, h2h, pairs, minDataAdv });
    const bundle: GameDataBundle = {
      game: "dota2",
      version: patch,
      generatedAt: new Date().toISOString(),
      sources: ["OpenDota heroStats (brackets 6-8 + pro)", "OpenDota pro hero matchups", `curated (${curated.byId.size} heroes)`],
      champions,
      matchups,
      synergies,
    };
    return { bundle, mstats, size: Buffer.byteLength(JSON.stringify(bundle)) };
  };
  let minDataAdv = MIN_DATA_ADV;
  let built = make(minDataAdv);
  while (built.size > opts.maxBytes && minDataAdv < 0.2) {
    minDataAdv = Math.round((minDataAdv + 0.01) * 100) / 100;
    built = make(minDataAdv);
  }

  const derived = champions.filter((c) => !c.curated).map((c) => c.id);
  const tierCounts = champions.reduce<Record<string, number>>((acc, c) => {
    const t = c.meta[c.roles[0]]?.tier ?? "?";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  return {
    bundle: built.bundle,
    lines: [
      `heroes: ${champions.length} (curated ${champions.length - derived.length}, derived ${derived.length})`,
      `curated files: ${curated.files} read, ${curated.skippedFiles} skipped; entries skipped ${curated.skippedEntries}, cleaned ${curated.cleaned}`,
      `matchup lines: ${h2h.size}/${rows.length} heroes (${fromNet} fetched now, ${failed} failed)`,
      `matchups: ${countCells(built.bundle.matchups)} directed cells — pairs: data+curated ${built.mstats.blendedPairs}, curated-only ${built.mstats.curatedPairs}, data-only ${built.mstats.dataPairs} (|adv| ≥ ${minDataAdv}; ${built.mstats.droppedPairs} weaker dropped)`,
      `synergy cells: ${countCells(synergies)}`,
      `primary-role tiers: ${["S", "A", "B", "C", "D"].map((t) => `${t} ${tierCounts[t] ?? 0}`).join(", ")}`,
      derived.length && derived.length <= 40 ? `derived: ${derived.join(", ")}` : "",
    ].filter(Boolean),
  };
}

// League of Legends bundle: Data Dragon (roster, names, images, class tags) + curated knowledge.
import { join } from "node:path";
import { DDRAGON, deriveLolChampion, lolMeta, mergeCurated, type DDragonChampion } from "../../src/shared/derive";
import type { Champion, GameDataBundle } from "../../src/shared/types";
import { loadCurated } from "./curated";
import { countCells, type BuildContext, type BuildReport } from "./common";
import { curatedMatchups, curatedPairs, curatedSynergies } from "./relations";

const HOUR = 3600_000;

const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === "string");
const isChampionFile = (x: unknown): x is { data: Record<string, DDragonChampion> } =>
  !!x && typeof x === "object" && !!(x as { data?: unknown }).data && typeof (x as { data: unknown }).data === "object";

export async function buildLol(ctx: BuildContext): Promise<BuildReport> {
  const cacheDir = join(ctx.root, "data", "cache", "ddragon");
  const versions = await ctx.fetcher.json(`${DDRAGON}/api/versions.json`, join(cacheDir, "versions.json"), 6 * HOUR, isStringArray);
  const version = versions.data.find((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (!version) throw new Error("Data Dragon versions.json has no release version");
  ctx.log(`Data Dragon ${version} (${versions.from})`);

  const file = await ctx.fetcher.json(
    `${DDRAGON}/cdn/${version}/data/en_US/champion.json`,
    join(cacheDir, `champion-${version}.json`),
    24 * HOUR,
    isChampionFile,
  );
  const sources = Object.values(file.data.data).filter((c) => c && typeof c.id === "string" && Array.isArray(c.tags));
  if (sources.length < 100) throw new Error(`Data Dragon returned only ${sources.length} champions`);
  const ids = new Set(sources.map((c) => c.id));

  const curated = loadCurated(join(ctx.root, "data", "lol", "curated"), "lol", ids, ctx.warn);
  const champions: Champion[] = sources.map((src) => {
    const base = deriveLolChampion(src, version);
    const cur = curated.byId.get(src.id);
    const champ = cur ? mergeCurated(base, cur) : base;
    champ.meta = lolMeta(champ, cur);
    return champ;
  });
  champions.sort((a, b) => a.name.localeCompare(b.name));

  const curatedList = [...curated.byId.values()];
  const pairs = curatedPairs(curatedList);
  const matchups = curatedMatchups(pairs, ids);
  const synergies = curatedSynergies(curatedList, ids);

  const bundle: GameDataBundle = {
    game: "lol",
    version,
    generatedAt: new Date().toISOString(),
    sources: [`Data Dragon ${version}`, `curated (${curated.byId.size} champions)`],
    champions,
    matchups,
    synergies,
  };
  const derived = champions.filter((c) => !c.curated).map((c) => c.id);
  return {
    bundle,
    lines: [
      `champions: ${champions.length} (curated ${champions.length - derived.length}, derived ${derived.length})`,
      `curated files: ${curated.files} read, ${curated.skippedFiles} skipped; entries skipped ${curated.skippedEntries}, cleaned ${curated.cleaned}`,
      `matchup pairs: ${pairs.size} curated → ${countCells(matchups)} directed cells`,
      `synergy cells: ${countCells(synergies)}`,
      derived.length && derived.length <= 40 ? `derived: ${derived.join(", ")}` : "",
    ].filter(Boolean),
  };
}

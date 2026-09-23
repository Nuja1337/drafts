// Builds the static game data bundles served at /data/<game>.json.
//   npx tsx scripts/build-data.ts [lol|dota2|all] [--refresh]
// LoL: Data Dragon + data/lol/curated/*.json. Dota 2: OpenDota (heroStats + pro matchups) + data/dota2/curated/*.json.
// Raw API responses are cached in data/cache/ (gitignored, 24h TTL); --refresh ignores fresh cache entries.
// Also writes src/shared/rosters/<game>.json (champion ids the DraftRoom accepts) — commit it with the bundle.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { GameDataBundle, GameId } from "../src/shared/types";
import type { BuildContext, BuildReport } from "./lib/common";
import { buildDota } from "./lib/dota";
import { CachedFetcher } from "./lib/fetchCache";
import { buildLol } from "./lib/lol";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 400_000;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const target = args.find((a) => !a.startsWith("--")) ?? "all";
if (!["lol", "dota2", "all"].includes(target)) {
  console.error(`usage: npx tsx scripts/build-data.ts [lol|dota2|all] [--refresh]`);
  process.exit(2);
}
const games: GameId[] = target === "all" ? ["lol", "dota2"] : [target as GameId];

/** Structural sanity checks so a broken bundle never gets written. */
function checkBundle(b: GameDataBundle): string[] {
  const errors: string[] = [];
  const ids = new Set(b.champions.map((c) => c.id));
  if (ids.size !== b.champions.length) errors.push("duplicate champion ids");
  for (const c of b.champions) {
    if (!c.roles.length) errors.push(`${c.id}: no roles`);
    if (!c.image.startsWith("https://")) errors.push(`${c.id}: bad image URL`);
    if (!c.archetypes.length) errors.push(`${c.id}: no archetypes`);
  }
  for (const [a, row] of Object.entries(b.matchups)) {
    if (!ids.has(a)) errors.push(`matchups: unknown ${a}`);
    for (const [x, cell] of Object.entries(row)) {
      if (!ids.has(x)) errors.push(`matchups: unknown ${x}`);
      const back = b.matchups[x]?.[a];
      if (!back || Math.abs(back.adv + cell.adv) > 1e-9) errors.push(`matchups: ${a}→${x} not mirrored`);
      if (!(Math.abs(cell.adv) <= 1)) errors.push(`matchups: ${a}→${x} adv out of range`);
    }
  }
  for (const [a, row] of Object.entries(b.synergies))
    for (const [x, v] of Object.entries(row)) if (b.synergies[x]?.[a] !== v || !(v > 0 && v <= 1)) errors.push(`synergies: ${a}/${x} invalid`);
  return errors.slice(0, 10);
}

async function main(): Promise<void> {
  const log = (msg: string) => console.log(msg);
  const warn = (msg: string) => console.warn(`  ! ${msg}`);
  const ctx: BuildContext = { root: ROOT, fetcher: new CachedFetcher({ minGapMs: 0, refresh, log: warn }), log, warn };
  // OpenDota free tier: 60 requests/minute — stay just under with a 1.1s gap.
  const opendota = new CachedFetcher({ minGapMs: 1100, refresh, log: warn });
  let failed = false;

  for (const game of games) {
    const started = Date.now();
    log(`\n== ${game} ==`);
    let report: BuildReport;
    try {
      report = game === "lol" ? await buildLol(ctx) : await buildDota({ ...ctx, opendota }, { maxBytes: MAX_BYTES });
    } catch (e) {
      console.error(`${game}: build failed — ${(e as Error).message}`);
      failed = true;
      continue;
    }
    const errors = checkBundle(report.bundle);
    if (errors.length) {
      console.error(`${game}: bundle failed sanity checks, not written:\n  ${errors.join("\n  ")}`);
      failed = true;
      continue;
    }
    const json = JSON.stringify(report.bundle);
    const out = join(ROOT, "public", "data", `${game}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(`${out}.tmp`, json);
    renameSync(`${out}.tmp`, out);
    // Ids only: the DraftRoom validates locks against these (src/shared/rosters.ts) without loading the bundle.
    const roster = join(ROOT, "src", "shared", "rosters", `${game}.json`);
    writeFileSync(`${roster}.tmp`, `${JSON.stringify(report.bundle.champions.map((c) => c.id))}\n`);
    renameSync(`${roster}.tmp`, roster);
    for (const line of report.lines) log(`  ${line}`);
    const raw = Buffer.byteLength(json);
    const gz = gzipSync(json).length;
    log(`  wrote public/data/${game}.json — ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip${raw > MAX_BYTES ? " (over budget!)" : ""} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  log(`\nnetwork calls: ${ctx.fetcher.networkCalls} Data Dragon, ${opendota.networkCalls} OpenDota`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

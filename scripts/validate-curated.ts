// Validates curated data files: npx tsx scripts/validate-curated.ts [lol|dota2] [file...]
// Checks schema, enum values, id validity against data/sources/<game>-roster.json, duplicates, and self-references.
// Also warns (without failing) about lane relations that look reversed or join champions that never lane, and reports
// how many same-role S/A-tier pairs have any matchup relation.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LANE_OPPONENTS } from "../src/shared/games";
import { ARCHETYPES, ATTRIBUTE_KEYS } from "../src/shared/types";

const game = (process.argv[2] ?? "lol") as "lol" | "dota2";
const files = process.argv.slice(3);
const ROLES = game === "lol" ? ["top", "jungle", "mid", "bot", "support"] : ["pos1", "pos2", "pos3", "pos4", "pos5"];
const roster: { id: string }[] =
  game === "lol"
    ? JSON.parse(readFileSync("data/sources/lol-roster.json", "utf8")).champions
    : JSON.parse(readFileSync("data/sources/dota2-roster.json", "utf8")).heroes;
const ids = new Set(roster.map((r) => r.id));

const score = z.number().int().min(0).max(3);
const rel = z.object({ id: z.string(), s: z.union([z.literal(1), z.literal(2), z.literal(3)]), lane: z.boolean().optional(), note: z.string().max(140).optional() }).strict();
const role = z.enum(ROLES as [string, ...string[]]);
const champ = z
  .object({
    id: z.string(),
    roles: z.array(role).min(1).max(5),
    damage: z.enum(["physical", "magic", "mixed"]),
    range: z.enum(["melee", "ranged"]),
    attributes: z.object(Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, score])) as Record<(typeof ATTRIBUTE_KEYS)[number], typeof score>).strict(),
    powerCurve: z.object({ early: score, mid: score, late: score }).strict(),
    archetypes: z.array(z.enum(ARCHETYPES)).min(1).max(4),
    strongVs: z.array(rel).max(14),
    weakVs: z.array(rel).max(14),
    synergies: z.array(rel).max(10),
    meta: z.partialRecord(role, z.enum(["S", "A", "B", "C", "D"])).optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    notes: z.string().max(400).optional(),
  })
  .strict();

const dir = join("data", game, "curated");
const targets = files.length ? files : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
let errors = 0;
const seen = new Map<string, string>();
const valid = new Map<string, z.infer<typeof champ>>();
for (const file of targets) {
  let arr: unknown;
  try {
    arr = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file}: invalid JSON — ${(e as Error).message}`);
    errors++;
    continue;
  }
  if (!Array.isArray(arr)) {
    console.error(`${file}: top level must be an array`);
    errors++;
    continue;
  }
  for (const raw of arr) {
    const r = champ.safeParse(raw);
    const id = (raw as { id?: string })?.id ?? "?";
    if (!r.success) {
      errors++;
      console.error(`${file} ${id}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const c = r.data;
    valid.set(c.id, c);
    if (!ids.has(c.id)) (errors++, console.error(`${file} ${c.id}: unknown id`));
    if (seen.has(c.id)) (errors++, console.error(`${file} ${c.id}: duplicate (also in ${seen.get(c.id)})`));
    seen.set(c.id, file);
    for (const k of ["strongVs", "weakVs", "synergies"] as const) {
      const local = new Set<string>();
      for (const ref of c[k]) {
        if (!ids.has(ref.id)) (errors++, console.error(`${file} ${c.id}.${k}: unknown id "${ref.id}"`));
        if (ref.id === c.id) (errors++, console.error(`${file} ${c.id}.${k}: references itself`));
        if (local.has(ref.id)) (errors++, console.error(`${file} ${c.id}.${k}: duplicate "${ref.id}"`));
        local.add(ref.id);
      }
    }
    const both = c.strongVs.filter((a) => c.weakVs.some((b) => b.id === a.id));
    if (both.length) (errors++, console.error(`${file} ${c.id}: in both strongVs and weakVs: ${both.map((b) => b.id).join(", ")}`));
    for (const r2 of Object.keys(c.meta ?? {})) if (!c.roles.includes(r2)) (errors++, console.error(`${file} ${c.id}: meta for role ${r2} not in roles`));
  }
}
// ---- Warnings: lane relations worth a second look (legitimate ones exist, e.g. Malphite > Jayce, Vayne > Darius top).
let warnings = 0;
const warn = (msg: string) => (warnings++, console.warn(`warning: ${msg}`));
const lanes: Record<string, string[]> = LANE_OPPONENTS[game];
const facesInLane = (a: { roles: string[] }, b: { roles: string[] }) => a.roles.some((ra) => b.roles.some((rb) => lanes[ra]?.includes(rb)));
const checked = new Set<string>();
for (const c of valid.values()) {
  for (const k of ["strongVs", "weakVs"] as const) {
    for (const ref of c[k]) {
      const o = valid.get(ref.id);
      if (!ref.lane || !o) continue;
      const [win, lose] = k === "strongVs" ? [c, o] : [o, c];
      if (checked.has(`${win.id}>${lose.id}`)) continue;
      checked.add(`${win.id}>${lose.id}`);
      if (win.powerCurve.early <= 1 && lose.powerCurve.early >= 3)
        warn(`${win.id} (early ${win.powerCurve.early}) beats ${lose.id} (early ${lose.powerCurve.early}) "in lane" — a late-game edge? (${c.id}.${k})`);
      if (!facesInLane(win, lose)) warn(`${win.id} [${win.roles}] vs ${lose.id} [${lose.roles}] is marked lane but they never lane against each other (${c.id}.${k})`);
    }
  }
}
// ---- Coverage: same-role S/A-tier pairs with any matchup relation (either direction).
const related = new Set<string>();
for (const c of valid.values()) for (const ref of [...c.strongVs, ...c.weakVs]) related.add([c.id, ref.id].sort().join("|"));
const coverage = ROLES.map((role) => {
  const top = [...valid.values()].filter((c) => ["S", "A"].includes(c.meta?.[role] ?? "")).map((c) => c.id);
  let pairs = 0;
  let covered = 0;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) (pairs++, related.has([top[i], top[j]].sort().join("|")) && covered++);
  return `${role} ${pairs ? Math.round((100 * covered) / pairs) : 0}% (${covered}/${pairs})`;
});
console.log(`${game}: same-role S/A pairs with a matchup relation: ${coverage.join(", ")}`);

const missing = [...ids].filter((id) => !seen.has(id));
console.log(`${game}: ${seen.size}/${ids.size} curated, ${errors} error(s), ${warnings} warning(s)${missing.length && !files.length ? `, missing: ${missing.join(", ")}` : ""}`);
process.exit(errors ? 1 : 0);

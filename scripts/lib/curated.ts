// Tolerant loader for data/<game>/curated/*.json (CuratedChampion[]). Curated files may be missing,
// half-written or partly invalid: bad files/entries are skipped with a warning and bad relations are
// dropped individually, so one mistake never blocks a build. Strict checks live in validate-curated.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { roleIds } from "../../src/shared/games";
import { ARCHETYPES, ATTRIBUTE_KEYS, TIERS } from "../../src/shared/types";
import type { Archetype, AttributeKey, CuratedChampion, GameId, RelationRef, Role, Tier } from "../../src/shared/types";

const score = z.number().min(0).max(3).transform((x) => Math.round(x));
const core = z.object({
  id: z.string().min(1),
  roles: z.array(z.string()),
  damage: z.enum(["physical", "magic", "mixed"]),
  range: z.enum(["melee", "ranged"]),
  attributes: z.record(z.string(), z.unknown()),
  powerCurve: z.object({ early: score, mid: score, late: score }),
});

export interface NormalizeResult {
  value: CuratedChampion | null;
  /** Non-fatal problems (dropped relations, unknown attribute keys, …) or the reason it was rejected. */
  problems: string[];
}

function normalizeRefs(raw: unknown, self: string, validIds: Set<string>, field: string, problems: string[]): RelationRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${field} is not an array`);
    return [];
  }
  const out: RelationRef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const ref = r as Partial<RelationRef> | null;
    const id = typeof ref?.id === "string" ? ref.id : "";
    const s = ref?.s;
    if (!id || !validIds.has(id)) {
      problems.push(`${field}: unknown id "${id || "?"}"`);
      continue;
    }
    if (id === self || seen.has(id)) {
      problems.push(`${field}: ${id === self ? "self reference" : `duplicate ${id}`}`);
      continue;
    }
    if (s !== 1 && s !== 2 && s !== 3) {
      problems.push(`${field}: ${id} has invalid strength`);
      continue;
    }
    seen.add(id);
    const cleaned: RelationRef = { id, s };
    if (ref?.lane === true) cleaned.lane = true;
    out.push(cleaned);
  }
  return out;
}

/** Validate and clean one curated entry. Returns null value when the core fields are unusable. */
export function normalizeCurated(raw: unknown, game: GameId, validIds: Set<string>): NormalizeResult {
  const problems: string[] = [];
  const parsed = core.safeParse(raw);
  if (!parsed.success) {
    return { value: null, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "entry"}: ${i.message}`) };
  }
  const c = parsed.data;
  if (!validIds.has(c.id)) return { value: null, problems: [`unknown id "${c.id}"`] };

  const validRoles = new Set(roleIds(game));
  const roles = [...new Set(c.roles.filter((r) => validRoles.has(r)))] as Role[];
  if (roles.length < c.roles.length) problems.push(`dropped invalid roles`);
  if (!roles.length) return { value: null, problems: [...problems, "no valid roles"] };

  const attributes = {} as Record<AttributeKey, number>;
  const missing: string[] = [];
  for (const k of ATTRIBUTE_KEYS) {
    const v = c.attributes[k];
    if (typeof v === "number" && Number.isFinite(v)) attributes[k] = Math.max(0, Math.min(3, Math.round(v)));
    else {
      attributes[k] = 0;
      missing.push(k);
    }
  }
  if (missing.length) problems.push(`attributes missing (set to 0): ${missing.join(", ")}`);
  for (const k of Object.keys(c.attributes)) if (!(ATTRIBUTE_KEYS as readonly string[]).includes(k)) problems.push(`unknown attribute ${k}`);

  const rawObj = raw as Record<string, unknown>;
  const archetypes = (Array.isArray(rawObj.archetypes) ? rawObj.archetypes : []).filter((a): a is Archetype =>
    (ARCHETYPES as readonly string[]).includes(a as string),
  );

  const strongVs = normalizeRefs(rawObj.strongVs, c.id, validIds, "strongVs", problems);
  let weakVs = normalizeRefs(rawObj.weakVs, c.id, validIds, "weakVs", problems);
  const clash = new Set(strongVs.map((r) => r.id).filter((id) => weakVs.some((w) => w.id === id)));
  if (clash.size) {
    problems.push(`in both strongVs and weakVs (dropped from both): ${[...clash].join(", ")}`);
    weakVs = weakVs.filter((r) => !clash.has(r.id));
  }
  const synergies = normalizeRefs(rawObj.synergies, c.id, validIds, "synergies", problems);

  const meta: Partial<Record<Role, Tier>> = {};
  if (rawObj.meta && typeof rawObj.meta === "object") {
    for (const [role, tier] of Object.entries(rawObj.meta as Record<string, unknown>)) {
      if (roles.includes(role) && (TIERS as readonly unknown[]).includes(tier)) meta[role] = tier as Tier;
      else problems.push(`meta.${role} ignored`);
    }
  }

  const value: CuratedChampion = {
    id: c.id,
    roles,
    damage: c.damage,
    range: c.range,
    attributes,
    powerCurve: c.powerCurve,
    archetypes: [...new Set(archetypes)].slice(0, 4),
    strongVs: strongVs.filter((r) => !clash.has(r.id)),
    weakVs,
    synergies,
  };
  if (Object.keys(meta).length) value.meta = meta;
  const d = rawObj.difficulty;
  if (d === 1 || d === 2 || d === 3) value.difficulty = d;
  if (typeof rawObj.notes === "string" && rawObj.notes.trim()) value.notes = rawObj.notes.trim().slice(0, 400);
  return { value, problems };
}

export interface CuratedLoad {
  byId: Map<string, CuratedChampion>;
  files: number;
  skippedFiles: number;
  skippedEntries: number;
  /** Entries accepted with non-fatal cleanups. */
  cleaned: number;
}

/** Load every *.json in `dir` (missing dir = no curated data). First occurrence of an id wins. */
export function loadCurated(dir: string, game: GameId, validIds: Set<string>, warn: (msg: string) => void): CuratedLoad {
  const out: CuratedLoad = { byId: new Map(), files: 0, skippedFiles: 0, skippedEntries: 0, cleaned: 0 };
  if (!existsSync(dir)) {
    warn(`no curated directory at ${dir}`);
    return out;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const file = join(dir, f);
    let arr: unknown;
    try {
      arr = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      warn(`${file}: skipped (invalid JSON: ${(e as Error).message.slice(0, 120)})`);
      out.skippedFiles++;
      continue;
    }
    if (!Array.isArray(arr)) {
      warn(`${file}: skipped (top level must be an array)`);
      out.skippedFiles++;
      continue;
    }
    out.files++;
    for (const raw of arr) {
      const id = (raw as { id?: unknown } | null)?.id;
      const { value, problems } = normalizeCurated(raw, game, validIds);
      if (!value) {
        out.skippedEntries++;
        warn(`${f} ${typeof id === "string" ? id : "?"}: skipped (${problems.slice(0, 3).join("; ")})`);
        continue;
      }
      if (out.byId.has(value.id)) {
        out.skippedEntries++;
        warn(`${f} ${value.id}: duplicate id, keeping the first occurrence`);
        continue;
      }
      if (problems.length) {
        out.cleaned++;
        const shown = problems.slice(0, 3);
        warn(`${f} ${value.id}: ${shown.join("; ")}${problems.length > shown.length ? ` (+${problems.length - shown.length} more)` : ""}`);
      }
      out.byId.set(value.id, value);
    }
  }
  return out;
}

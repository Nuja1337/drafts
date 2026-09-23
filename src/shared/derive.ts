// Heuristic Champion defaults for champions/heroes without curated data, plus the helpers that turn
// source records (Data Dragon / OpenDota) into bundle Champions. Pure TS: used by the data build, the
// client live overlay (new LoL champions) and the Worker (Dota meta numbers).
import { ARCHETYPE_DEFS, emptyAttributes } from "./games";
import type {
  Archetype,
  AttributeKey,
  Attributes,
  Champion,
  CuratedChampion,
  DamageType,
  GameId,
  MetaStat,
  PowerCurve,
  RangeType,
  Role,
  Tier,
} from "./types";
import { ATTRIBUTE_KEYS, TIERS } from "./types";

// ---------------------------------------------------------------------------
// Source record shapes (only the fields we use)
// ---------------------------------------------------------------------------

/** One entry of Data Dragon champion.json `data`. */
export interface DDragonChampion {
  id: string;
  /** Numeric id as a string, e.g. "266". */
  key: string;
  name: string;
  title?: string;
  tags: string[];
  info?: { attack?: number; defense?: number; magic?: number; difficulty?: number };
  partype?: string;
  image?: { full?: string };
  stats?: { attackrange?: number };
}

/** One row of OpenDota /api/heroStats. Bracket fields are "1_pick".."8_pick" / "1_win".."8_win". */
export interface OpenDotaHeroStat {
  id: number;
  /** "npc_dota_hero_antimage" */
  name: string;
  localized_name: string;
  primary_attr: "str" | "agi" | "int" | "all" | string;
  attack_type: "Melee" | "Ranged" | string;
  roles: string[];
  /** "/apps/dota2/images/dota_react/heroes/antimage.png?" */
  img: string;
  pro_pick?: number | null;
  pro_win?: number | null;
  pro_ban?: number | null;
  [bracket: string]: unknown;
}

export const DDRAGON = "https://ddragon.leagueoflegends.com";
export const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com";

export const ddragonImageUrl = (version: string, file: string): string => `${DDRAGON}/cdn/${version}/img/champion/${file}`;

/** "npc_dota_hero_antimage" → "antimage" */
export const dotaShortName = (name: string): string => name.replace(/^npc_dota_hero_/, "");

/** OpenDota img path → absolute Steam CDN URL (drops the trailing cache-buster "?"). */
export function dotaImageUrl(img: string): string {
  const path = img.replace(/\?.*$/, "");
  return /^https?:\/\//.test(path) ? path : `${STEAM_CDN}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Compare dotted versions numerically ("16.18.1" vs "16.9.1"). Positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

const clampInt = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(x)));

/** Attribute profile from class tags: the first two tags count fully, later tags one point less. */
function attrsFromTags(tags: string[], table: Record<string, Partial<Attributes>>): Attributes {
  const out = emptyAttributes();
  tags.forEach((tag, i) => {
    const add = table[tag];
    if (!add) return;
    const penalty = i < 2 ? 0 : 1;
    for (const k of Object.keys(add) as AttributeKey[]) out[k] = Math.max(out[k], (add[k] ?? 0) - penalty);
  });
  for (const k of ATTRIBUTE_KEYS) out[k] = clampInt(out[k], 0, 3);
  return out;
}

function curveFromTags(tags: string[], table: Record<string, PowerCurve>, fallback: PowerCurve): PowerCurve {
  const known = tags.map((t) => table[t]).filter((c): c is PowerCurve => !!c);
  if (!known.length) return { ...fallback };
  // Weight the primary tag double so e.g. Marksman/Assassin still reads as a late-game carry.
  const weights = known.map((_, i) => (i === 0 ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const avg = (k: keyof PowerCurve) => known.reduce((s, c, i) => s + c[k] * weights[i], 0) / total;
  return { early: clampInt(avg("early"), 0, 3), mid: clampInt(avg("mid"), 0, 3), late: clampInt(avg("late"), 0, 3) };
}

/** Best-fitting composition archetypes (1-3) for an attribute profile + power curve. */
export function deriveArchetypes(game: GameId, attrs: Attributes, curve: PowerCurve): Archetype[] {
  const scored = ARCHETYPE_DEFS.filter((d) => d.games.includes(game)).map((d) => {
    const wants = Object.entries(d.wants) as [AttributeKey, number][];
    const wSum = wants.reduce((s, [, w]) => s + w, 0);
    const fit = wSum ? wants.reduce((s, [k, w]) => s + (w * attrs[k]) / 3, 0) / wSum : 0;
    const curveEntries = Object.entries(d.curve ?? {}) as [keyof PowerCurve, number][];
    const cSum = curveEntries.reduce((s, [, w]) => s + w, 0);
    const curveFit = cSum ? curveEntries.reduce((s, [k, w]) => s + (w * curve[k]) / 3, 0) / cSum : 0;
    const score = cSum && wSum ? 0.6 * fit + 0.4 * curveFit : cSum ? 0.8 * curveFit : fit;
    return { id: d.id, score };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = scored[0]?.score ?? 0;
  const picked = scored.filter((s, i) => i === 0 || (s.score >= best * 0.75 && s.score > 0.25)).slice(0, 3);
  return picked.map((s) => s.id);
}

/** Difficulty 1..3 from a 1..10 scale (0/unknown → 2). */
const difficultyFrom10 = (d: number | undefined): 1 | 2 | 3 => (!d ? 2 : d <= 3 ? 1 : d <= 6 ? 2 : 3);

// ---------------------------------------------------------------------------
// League of Legends
// ---------------------------------------------------------------------------

const LOL_TAG_ATTRS: Record<string, Partial<Attributes>> = {
  Tank: { frontline: 3, engage: 2, cc: 2, peel: 1 },
  Fighter: { frontline: 1, dps: 2, splitpush: 2, sustain: 1, mobility: 1 },
  Mage: { burst: 2, poke: 1, waveclear: 2, cc: 1 },
  Assassin: { burst: 2, mobility: 2, pick: 2 },
  Marksman: { dps: 3, siege: 2, poke: 1, waveclear: 1 },
  Support: { peel: 2, sustain: 1, cc: 1 },
};

const LOL_TAG_CURVES: Record<string, PowerCurve> = {
  Marksman: { early: 1, mid: 2, late: 3 },
  Assassin: { early: 2, mid: 3, late: 1 },
  Fighter: { early: 2, mid: 2, late: 2 },
  Tank: { early: 1, mid: 2, late: 2 },
  Mage: { early: 1, mid: 2, late: 2 },
  Support: { early: 2, mid: 2, late: 2 },
};

/** Likely positions from Data Dragon class tags (primary tag first). */
export function lolRolesFromTags(tags: string[]): Role[] {
  const [primary, secondary] = tags;
  const has = (t: string) => tags.includes(t);
  let roles: Role[];
  switch (primary) {
    case "Marksman":
      roles = secondary === "Assassin" || secondary === "Mage" ? ["bot", "mid"] : ["bot"];
      break;
    case "Support":
      roles = secondary === "Mage" ? ["support", "mid"] : ["support"];
      break;
    case "Mage":
      roles = has("Support") ? ["support", "mid"] : ["mid"];
      break;
    case "Assassin":
      roles = ["mid", "jungle"];
      break;
    case "Tank":
      roles = has("Support") ? ["support", "top"] : ["top", "jungle"];
      break;
    case "Fighter":
      roles = has("Tank") || has("Assassin") ? ["top", "jungle"] : ["top"];
      break;
    default:
      roles = ["mid"];
  }
  return roles;
}

function lolDamage(tags: string[], info: DDragonChampion["info"], partype: string | undefined): DamageType {
  const attack = info?.attack ?? 0;
  const magic = info?.magic ?? 0;
  if (magic >= attack + 2) return "magic";
  if (attack >= magic + 2) return "physical";
  // Close ratings: tanks/supports/mages mostly scale AP; manaless fighters and marksmen AD.
  const primary = tags[0];
  if (primary === "Mage" || primary === "Support" || primary === "Tank") return partype && partype !== "Mana" && primary === "Tank" ? "physical" : "magic";
  return "physical";
}

function lolRange(tags: string[], stats: DDragonChampion["stats"]): RangeType {
  const r = stats?.attackrange;
  if (typeof r === "number" && r > 0) return r > 300 ? "ranged" : "melee";
  return tags[0] === "Marksman" || tags[0] === "Mage" || (tags[0] === "Support" && !tags.includes("Tank")) ? "ranged" : "melee";
}

/** Heuristic Champion for a Data Dragon record with no curated data (curated: false, meta B in its primary role). */
export function deriveLolChampion(src: DDragonChampion, version: string): Champion {
  const tags = Array.isArray(src.tags) ? src.tags : [];
  const info = src.info ?? {};
  const attributes = attrsFromTags(tags, LOL_TAG_ATTRS);
  // Info ratings (0..10) sharpen the tag profile a little.
  if ((info.defense ?? 0) >= 8) attributes.frontline = Math.max(attributes.frontline, 2);
  if ((info.magic ?? 0) >= 9 && attributes.burst < 3 && tags[0] !== "Support") attributes.burst = Math.max(attributes.burst, 2);
  if ((info.attack ?? 0) >= 9 && attributes.dps < 3) attributes.dps = Math.max(attributes.dps, 2);
  const powerCurve = curveFromTags(tags, LOL_TAG_CURVES, { early: 2, mid: 2, late: 2 });
  const roles = lolRolesFromTags(tags);
  const key = Number.parseInt(src.key, 10);
  return {
    id: src.id,
    key: Number.isFinite(key) ? key : 0,
    name: src.name,
    title: src.title,
    image: ddragonImageUrl(version, src.image?.full || `${src.id}.png`),
    roles,
    tags,
    damage: lolDamage(tags, info, src.partype),
    range: lolRange(tags, src.stats),
    attributes,
    powerCurve,
    archetypes: deriveArchetypes("lol", attributes, powerCurve),
    meta: { [roles[0]]: { tier: "B" } },
    difficulty: difficultyFrom10(info.difficulty),
    curated: false,
  };
}

// ---------------------------------------------------------------------------
// Dota 2
// ---------------------------------------------------------------------------

const DOTA_TAG_ATTRS: Record<string, Partial<Attributes>> = {
  Carry: { dps: 2, splitpush: 1 },
  Support: { peel: 1, sustain: 1 },
  Nuker: { burst: 2, waveclear: 1 },
  Disabler: { cc: 2, pick: 1 },
  Initiator: { engage: 2, cc: 1 },
  Durable: { frontline: 2 },
  Escape: { mobility: 2 },
  Pusher: { siege: 2, waveclear: 1, splitpush: 1 },
  Jungler: { waveclear: 1 },
};

const DOTA_TAG_CURVES: Record<string, PowerCurve> = {
  Carry: { early: 1, mid: 2, late: 3 },
  Support: { early: 2, mid: 2, late: 1 },
  Nuker: { early: 2, mid: 2, late: 1 },
  Initiator: { early: 1, mid: 3, late: 2 },
  Durable: { early: 2, mid: 2, late: 2 },
  Pusher: { early: 2, mid: 3, late: 1 },
  Escape: { early: 1, mid: 2, late: 2 },
  Disabler: { early: 2, mid: 2, late: 2 },
  Jungler: { early: 2, mid: 2, late: 1 },
};

/** Likely positions (pos1..pos5) from OpenDota roles + primary attribute. */
export function dotaRolesFromTags(tags: string[], primaryAttr: string): Role[] {
  const has = (t: string) => (tags.includes(t) ? 1 : 0);
  const scores: [Role, number][] = [
    ["pos1", has("Carry") * 3 + (primaryAttr === "agi" ? 1 : 0) - has("Support") * 3],
    ["pos2", has("Nuker") + has("Escape") + has("Carry") + (primaryAttr === "int" || primaryAttr === "agi" ? 0.5 : 0)],
    ["pos3", has("Durable") * 2 + has("Initiator") * 2 + (primaryAttr === "str" ? 1 : 0) - has("Support")],
    ["pos4", has("Support") * 2 + has("Initiator") + has("Disabler") + (has("Escape") + has("Nuker")) * 0.5],
    ["pos5", has("Support") * 3 + has("Disabler") + (primaryAttr === "int" ? 0.5 : 0) - has("Carry") * 2],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const best = scores[0][1];
  const roles = scores.filter(([, s], i) => i === 0 || (s >= 2 && s >= best * 0.7)).slice(0, 3);
  return roles.map(([r]) => r);
}

function dotaDamage(tags: string[], primaryAttr: string): DamageType {
  const nuker = tags.includes("Nuker");
  const carry = tags.includes("Carry");
  if (primaryAttr === "int") return carry && !nuker ? "mixed" : "magic";
  if (nuker) return carry ? "mixed" : primaryAttr === "all" ? "magic" : "mixed";
  return "physical";
}

/** Heuristic Champion for an OpenDota hero with no curated data. `meta` is filled by the caller. */
export function deriveDotaChampion(src: OpenDotaHeroStat): Champion {
  const tags = Array.isArray(src.roles) ? src.roles : [];
  const attributes = attrsFromTags(tags, DOTA_TAG_ATTRS);
  const powerCurve = curveFromTags(tags, DOTA_TAG_CURVES, { early: 2, mid: 2, late: 2 });
  return {
    id: dotaShortName(src.name),
    key: src.id,
    name: src.localized_name,
    image: dotaImageUrl(src.img),
    roles: dotaRolesFromTags(tags, src.primary_attr),
    tags,
    damage: dotaDamage(tags, src.primary_attr),
    range: src.attack_type === "Ranged" ? "ranged" : "melee",
    attributes,
    powerCurve,
    archetypes: deriveArchetypes("dota2", attributes, powerCurve),
    meta: {},
    difficulty: 2,
    curated: false,
  };
}

/** Overall stats for a hero from OpenDota heroStats: high-bracket pubs (6-8) + pro. */
export interface DotaMetaNumbers {
  /** Pub win rate in brackets 6-8. */
  winRate: number;
  /** Share of brackets 6-8 matches the hero appears in. */
  pickRate: number;
  /** Share of pro matches the hero was banned in. */
  banRate: number;
  /** Pub games in brackets 6-8. */
  games: number;
  /** Composite strength score (higher = stronger meta pick); only meaningful relative to other heroes. */
  score: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Meta numbers for every hero. Score blends high-bracket pub win rate and popularity with pro presence
 * (pick+ban) and a shrunk pro win rate; pro weight scales with how many pro matches the sample has.
 */
export function dotaMetaNumbers(rows: OpenDotaHeroStat[], brackets: number[] = [6, 7, 8]): Map<number, DotaMetaNumbers> {
  const pub = rows.map((r) => {
    let picks = 0;
    let wins = 0;
    for (const b of brackets) {
      picks += num(r[`${b}_pick`]);
      wins += num(r[`${b}_win`]);
    }
    return { picks, wins: Math.min(wins, picks) };
  });
  const pubMatches = pub.reduce((s, p) => s + p.picks, 0) / 10;
  const proMatches = rows.reduce((s, r) => s + num(r.pro_pick), 0) / 10;
  const raw = rows.map((r, i) => {
    const { picks, wins } = pub[i];
    const winRate = picks ? (wins + 0.5 * 200) / (picks + 200) : 0.5; // light shrink for tiny samples
    const pickRate = pubMatches ? picks / pubMatches : 0;
    const proPick = num(r.pro_pick);
    const proBan = num(r.pro_ban);
    const banRate = proMatches ? Math.min(1, proBan / proMatches) : 0;
    const presence = proMatches ? Math.min(1, (proPick + proBan) / proMatches) : 0;
    const proWr = (Math.min(num(r.pro_win), proPick) + 5) / (proPick + 10);
    return { winRate, pickRate, banRate, presence, proWr, games: picks };
  });
  const z = (xs: number[]): number[] => {
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return xs.map((x) => (x - mean) / sd);
  };
  const zWin = z(raw.map((r) => r.winRate));
  const zPop = z(raw.map((r) => Math.log(r.pickRate + 0.001)));
  const zPres = z(raw.map((r) => r.presence));
  const zProWr = z(raw.map((r) => r.proWr));
  const proWeight = Math.min(1, proMatches / 50);
  const out = new Map<number, DotaMetaNumbers>();
  rows.forEach((r, i) => {
    const score = zWin[i] + 0.5 * zPop[i] + proWeight * (0.7 * zPres[i] + 0.25 * zProWr[i]);
    const { winRate, pickRate, banRate, games } = raw[i];
    out.set(r.id, { winRate, pickRate, banRate, games, score });
  });
  return out;
}

/** Share of the roster per tier, best first (matches the curation guide: S 5%, A 20%, B 40%, C 25%, D 10%). */
export const TIER_SHARES: Record<Tier, number> = { S: 0.05, A: 0.2, B: 0.4, C: 0.25, D: 0.1 };

/** Assign tiers by percentile of score (higher score = better tier). Ties keep input order. */
export function tiersByPercentile<K>(scores: Map<K, number>): Map<K, Tier> {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map<K, Tier>();
  const n = sorted.length;
  let cum = 0;
  const cutoffs = TIERS.map((t) => (cum += TIER_SHARES[t]));
  sorted.forEach(([k], i) => {
    const pct = (i + 0.5) / n;
    const idx = cutoffs.findIndex((c) => pct <= c + 1e-9);
    out.set(k, TIERS[idx === -1 ? TIERS.length - 1 : idx]);
  });
  return out;
}

/** Average two tiers on the S..D scale; ties round toward `prefer`. */
export function blendTiers(a: Tier, b: Tier, prefer: Tier = b): Tier {
  const ia = TIERS.indexOf(a);
  const ib = TIERS.indexOf(b);
  const avg = (ia + ib) / 2;
  const idx = Number.isInteger(avg) ? avg : TIERS.indexOf(prefer) < avg ? Math.floor(avg) : Math.ceil(avg);
  return TIERS[idx];
}

// ---------------------------------------------------------------------------
// Curated merge
// ---------------------------------------------------------------------------

/** Overlay curated knowledge onto a source/derived champion. Meta is left to the caller (game-specific). */
export function mergeCurated(base: Champion, cur: CuratedChampion): Champion {
  const attributes = emptyAttributes();
  for (const k of ATTRIBUTE_KEYS) attributes[k] = clampInt(cur.attributes[k] ?? 0, 0, 3);
  const merged: Champion = {
    ...base,
    roles: cur.roles.length ? [...cur.roles] : base.roles,
    damage: cur.damage,
    range: cur.range,
    attributes,
    powerCurve: {
      early: clampInt(cur.powerCurve.early, 0, 3),
      mid: clampInt(cur.powerCurve.mid, 0, 3),
      late: clampInt(cur.powerCurve.late, 0, 3),
    },
    archetypes: cur.archetypes.length ? [...cur.archetypes] : base.archetypes,
    difficulty: cur.difficulty ?? base.difficulty,
    curated: true,
  };
  if (cur.notes) merged.notes = cur.notes;
  return merged;
}

/** LoL meta: curated tier per curated role ("B" when missing). Derived champions keep their fallback. */
export function lolMeta(champ: Champion, cur: CuratedChampion | undefined): Partial<Record<Role, MetaStat>> {
  if (!cur) return champ.meta;
  const meta: Partial<Record<Role, MetaStat>> = {};
  for (const role of champ.roles) meta[role] = { tier: cur.meta?.[role] ?? "B" };
  return meta;
}

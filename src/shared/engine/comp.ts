// Composition model: attribute sums, a concave "needs" utility, damage balance, archetype fit and CompAnalysis.
import { ARCHETYPE_DEFS, GAMES } from "../games";
import type { ArchetypeDef } from "../games";
import { ATTRIBUTE_KEYS } from "../types";
import type { Attributes, AttributeKey, Role, Side } from "../types";
import { N_ATTR } from "./context";
import type { AvgProfile, ChampInfo, Ctx } from "./context";
import { clamp, round2, ScoreAcc } from "./explain";
import { CORE_ATTRS, NEEDS, TUNING } from "./tuning";
import type { CompAnalysis } from "./types";

const NEED = ATTRIBUTE_KEYS.map((k) => NEEDS[k]);
const NEED_SUM = NEED.reduce((s, x) => s + x, 0);
const ATTR_LABEL: Record<AttributeKey, string> = {
  engage: "engage",
  disengage: "disengage",
  peel: "peel",
  poke: "poke",
  burst: "burst",
  dps: "sustained damage",
  frontline: "frontline",
  cc: "crowd control",
  mobility: "mobility",
  waveclear: "waveclear",
  splitpush: "split push",
  pick: "pick potential",
  sustain: "sustain",
  siege: "siege",
};
export const attrLabel = (k: AttributeKey): string => ATTR_LABEL[k];

export interface CompState {
  /** Champions with data. */
  infos: ChampInfo[];
  n: number;
  sum: number[];
  phys: number;
  curve: [number, number, number];
}

export function compState(ctx: Ctx, ids: (string | null)[]): CompState {
  const infos = ids.map((id) => (id ? ctx.idx.info.get(id) : undefined)).filter((x): x is ChampInfo => !!x);
  const sum = new Array<number>(N_ATTR).fill(0);
  const curve: [number, number, number] = [0, 0, 0];
  let phys = 0;
  for (const i of infos) {
    for (let k = 0; k < N_ATTR; k++) sum[k] += i.a[k];
    phys += i.phys;
    curve[0] += i.curve[0];
    curve[1] += i.curve[1];
    curve[2] += i.curve[2];
  }
  return { infos, n: infos.length, sum, phys, curve };
}

/** Concave saturation: marginal value 2 at 0, 0 at the target. */
export const sat = (x: number): number => (x >= 1 ? 1 : x <= 0 ? 0 : x * (2 - x));

/** Needs utility of an attribute-sum vector, 0..NEED_SUM. */
export function utility(v: number[], targets: number[]): number {
  let u = 0;
  for (let k = 0; k < N_ATTR; k++) u += NEED[k] * sat(v[k] / targets[k]);
  return u;
}

/** 0..1 damage imbalance penalty from a physical share. */
export const damagePenalty = (phys: number): number => {
  const x = Math.max(0, Math.abs(phys - 0.5) - 0.15) / 0.35;
  return x * x;
};

/** Expected contribution of the still-open roles (per-role average champions). */
export interface Rest {
  a: number[];
  phys: number;
  count: number;
}

export function restOf(ctx: Ctx, roleIdx: number[]): Rest {
  const a = new Array<number>(N_ATTR).fill(0);
  let phys = 0;
  for (const r of roleIdx) {
    const avg = ctx.idx.roleAvg.get(ctx.roles[r]) ?? ctx.idx.allAvg;
    for (let k = 0; k < N_ATTR; k++) a[k] += avg.a[k];
    phys += avg.phys;
  }
  return { a, phys, count: roleIdx.length };
}

const TAG_W = [1, 0.75, 0.5, 0.35];

/** 0..1 fit of a single champion to an archetype. */
export function archFit(ci: ChampInfo, def: ArchetypeDef): number {
  const idx = ci.c.archetypes.indexOf(def.id);
  const tag = idx < 0 ? 0 : TAG_W[Math.min(idx, TAG_W.length - 1)];
  let wn = 0;
  let wd = 0;
  for (const [k, w] of Object.entries(def.wants)) {
    const i = ATTRIBUTE_KEYS.indexOf(k as AttributeKey);
    if (i < 0 || !w) continue;
    wn += (w * ci.a[i]) / 3;
    wd += w;
  }
  const wants = wd > 0 ? wn / wd : 0;
  if (!def.curve) return 0.6 * tag + 0.4 * wants;
  let cn = 0;
  let cd = 0;
  const ph = ["early", "mid", "late"] as const;
  ph.forEach((p, i) => {
    const w = def.curve?.[p];
    if (w) {
      cn += (w * ci.curve[i]) / 3;
      cd += w;
    }
  });
  return 0.55 * tag + 0.3 * wants + 0.15 * (cd > 0 ? cn / cd : 0);
}

export const archetypesFor = (ctx: Ctx): ArchetypeDef[] => ARCHETYPE_DEFS.filter((d) => d.games.includes(ctx.game));

/** Archetype scores 0..100 for a comp: attribute sums vs a complete comp, champion archetype tags, curve. */
export function archetypeScores(ctx: Ctx, s: CompState): { id: ArchetypeDef["id"]; score: number }[] {
  const defs = archetypesFor(ctx);
  if (s.n === 0) return defs.map((d) => ({ id: d.id, score: 0 }));
  const targets = ctx.idx.targets;
  const out = defs.map((def, order) => {
    let an = 0;
    let ad = 0;
    for (const [k, w] of Object.entries(def.wants)) {
      const i = ATTRIBUTE_KEYS.indexOf(k as AttributeKey);
      if (i < 0 || !w) continue;
      an += w * sat(s.sum[i] / targets[i]);
      ad += w;
    }
    const attr = ad > 0 ? an / ad : 0;
    let tag = 0;
    for (const ci of s.infos) {
      const idx = ci.c.archetypes.indexOf(def.id);
      if (idx >= 0) tag += TAG_W[Math.min(idx, TAG_W.length - 1)];
    }
    tag /= s.n;
    let score: number;
    if (def.curve) {
      let cn = 0;
      let cd = 0;
      (["early", "mid", "late"] as const).forEach((p, i) => {
        const w = def.curve?.[p];
        if (w) {
          cn += (w * (s.curve[i] / s.n)) / 3;
          cd += w;
        }
      });
      score = 0.45 * attr + 0.35 * tag + 0.2 * (cd > 0 ? cn / cd : 0);
    } else score = 0.55 * attr + 0.45 * tag;
    return { id: def.id, score: Math.round(100 * clamp(score, 0, 1)), order };
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.map(({ id, score }) => ({ id, score }));
}

/** Leading archetype of a partial comp, when it has a clear identity. */
export function leadArchetype(ctx: Ctx, s: CompState): ArchetypeDef | null {
  if (s.n < 2) return null;
  const top = archetypeScores(ctx, s)[0];
  return top && top.score >= 45 ? (ARCHETYPE_DEFS.find((d) => d.id === top.id) ?? null) : null;
}

/**
 * Composition value of adding `ci` at `role`, measured against an average champion for the role being filled, with
 * the other open roles projected as role averages (so needs sharpen as the draft fills up). Adds needs / damage /
 * curve / archetype parts under the "composition" weight. `baseRole` is the open role a re-shuffle really fills
 * (e.g. top, when a support candidate moves our locked support there); it defaults to `role`.
 */
export function addComposition(
  acc: ScoreAcc,
  ctx: Ctx,
  s: CompState,
  rest: Rest,
  ci: ChampInfo,
  role: Role,
  lead: ArchetypeDef | null,
  who: "our" | "their",
  positiveOnly = false,
  baseRole: Role = role,
): void {
  const avg: AvgProfile = ctx.idx.roleAvg.get(baseRole) ?? ctx.idx.allAvg;
  const roleName = GAMES[ctx.game].roles.find((r) => r.id === baseRole)?.label ?? baseRole;
  // Needs sharpen as the comp takes shape: early picks leave room to compensate later.
  const progress = 0.35 + 0.65 * Math.min(1, s.n / Math.max(1, ctx.roles.length - 1));
  const add = (kind: "composition" | "archetype", pts: number, text: () => string) => {
    if (!positiveOnly || pts > 0) acc.add("composition", kind, pts, text);
  };
  const T = ctx.idx.targets;
  // Needs utility.
  let delta = 0;
  let bestK = -1;
  let bestV = 0;
  let worstK = -1;
  let worstV = 0;
  for (let k = 0; k < N_ATTR; k++) {
    const base = s.sum[k] + rest.a[k];
    const d = NEED[k] * (sat((base + ci.a[k]) / T[k]) - sat((base + avg.a[k]) / T[k]));
    delta += d;
    if (d > bestV) {
      bestV = d;
      bestK = k;
    }
    if (d < worstV) {
      worstV = d;
      worstK = k;
    }
  }
  const needsPts = clamp(TUNING.compScale * delta * progress, -TUNING.compNeedsCap, TUNING.compNeedsCap);
  add("composition", needsPts, () => {
    if (needsPts >= 0 && bestK >= 0) {
      const k = ATTRIBUTE_KEYS[bestK];
      const lacking = s.sum[bestK] < T[bestK] * (s.n / 5) * 0.6;
      const second = secondBest(ctx, s, rest, ci, avg, bestK);
      const what = second ? `${attrLabel(k)} and ${attrLabel(second)}` : attrLabel(k);
      return lacking && s.n > 0 ? `Adds ${what} ${who} comp lacks` : `Adds ${what} to ${who} comp`;
    }
    const k = worstK >= 0 ? ATTRIBUTE_KEYS[worstK] : null;
    return k ? `Less ${attrLabel(k)} than a typical ${roleName} pick` : `Adds less than a typical ${roleName} pick`;
  });
  // Damage balance.
  const known = s.n + 1 + rest.count;
  const physC = (s.phys + ci.phys + rest.phys) / known;
  const physA = (s.phys + avg.phys + rest.phys) / known;
  const dmg = -TUNING.damageScale * progress * (damagePenalty(physC) - damagePenalty(physA));
  if (Math.abs(dmg) >= 0.05 && s.n > 0) {
    const ours = s.phys / s.n;
    const kind = ci.phys >= 0.75 ? "physical" : ci.phys <= 0.25 ? "magic" : "mixed";
    add("composition", dmg, () =>
      dmg > 0
        ? `Adds ${kind} damage (${who} comp is mostly ${ours >= 0.5 ? "physical" : "magic"})`
        : `Another ${kind} threat — ${who} damage gets one-sided`,
    );
  }
  // Power-curve coherence.
  if (s.n >= 2) {
    const lean = (s.curve[0] - s.curve[2]) / s.n;
    if (Math.abs(lean) >= 0.6) {
      const l = clamp(ci.curve[0] - ci.curve[2], -2, 2) / 2;
      const pts = TUNING.curveScale * Math.sign(lean) * l;
      add("composition", pts, () =>
        pts > 0
          ? lean > 0
            ? `Matches ${who} early-game power curve`
            : `Matches ${who} late-game scaling`
          : lean > 0
            ? `Late-game pick in an early comp`
            : `Early-game pick in a scaling comp`,
      );
    }
  }
  // Fit to the comp's emerging identity.
  if (lead) {
    const pts = clamp(TUNING.archetypeScale * (archFit(ci, lead) - 0.3), -2, 5);
    add("archetype", pts, () => (pts > 0 ? `Fits ${who} ${lead.label} comp` : `Off-plan for ${who} ${lead.label} comp`));
  }
}

function secondBest(ctx: Ctx, s: CompState, rest: Rest, ci: ChampInfo, avg: AvgProfile, exclude: number): AttributeKey | null {
  const T = ctx.idx.targets;
  let best = -1;
  let bestV = 0.02;
  for (let k = 0; k < N_ATTR; k++) {
    if (k === exclude) continue;
    const base = s.sum[k] + rest.a[k];
    const d = NEED[k] * (sat((base + ci.a[k]) / T[k]) - sat((base + avg.a[k]) / T[k]));
    if (d > bestV) {
      bestV = d;
      best = k;
    }
  }
  return best >= 0 ? ATTRIBUTE_KEYS[best] : null;
}

/** Projected needs utility of a comp (open slots filled with average champions), 0..1. */
export function projectedQuality(ctx: Ctx, s: CompState): number {
  const v = s.sum.slice();
  const missing = Math.max(0, ctx.roles.length - s.n);
  for (let k = 0; k < N_ATTR; k++) v[k] += missing * ctx.idx.allAvg.a[k];
  return utility(v, ctx.idx.targets) / NEED_SUM;
}

const toAttributes = (v: number[]): Attributes => Object.fromEntries(ATTRIBUTE_KEYS.map((k, i) => [k, v[i]])) as Attributes;

/** Full comp analysis for one side; `enemy` enables matchup-aware warnings. */
export function analyzeComp(ctx: Ctx, side: Side, ids: string[], s: CompState, enemy: CompState): CompAnalysis {
  const T = ctx.idx.targets;
  const n = s.n;
  const attrScores = s.sum.map((v, k) => Math.round(clamp((100 * v) / T[k], 0, 100)));
  const physShare = n ? s.phys / n : 0;
  const damage = n ? { physical: round2(physShare), magic: round2(1 - round2(physShare)) } : { physical: 0, magic: 0 };
  const curve = n
    ? { early: round2(s.curve[0] / n), mid: round2(s.curve[1] / n), late: round2(s.curve[2] / n) }
    : { early: 0, mid: 0, late: 0 };
  const archetypes = archetypeScores(ctx, s);
  const enemyArch = enemy.n ? archetypeScores(ctx, enemy)[0] : null;
  const ec = enemy.n ? { early: enemy.curve[0] / enemy.n, late: enemy.curve[2] / enemy.n } : null;
  const at = (k: AttributeKey) => s.sum[ATTRIBUTE_KEYS.indexOf(k)];
  const tgt = (k: AttributeKey) => T[ATTRIBUTE_KEYS.indexOf(k)];
  /** Enemy champions strong (≥ 2) in every one of `keys`. */
  const enemyWith = (...keys: AttributeKey[]) => enemy.infos.filter((i) => keys.every((k) => i.a[ATTRIBUTE_KEYS.indexOf(k)] >= 2)).length;

  // Warnings, most important first.
  const warnings: string[] = [];
  if (n >= 3 && physShare >= 0.9) warnings.push("All physical damage — enemies can stack armor");
  else if (n >= 3 && physShare <= 0.1) warnings.push("All magic damage — enemies can stack magic resist");
  else if (n >= 4 && physShare >= 0.78) warnings.push("Mostly physical damage — armor stacking hurts");
  else if (n >= 4 && physShare <= 0.22) warnings.push("Mostly magic damage — magic resist stacking hurts");
  if (n >= 3 && at("frontline") <= 1.5) warnings.push("No frontline");
  else if (n >= 4 && at("frontline") < 0.45 * tgt("frontline")) warnings.push("Little frontline");
  if (n >= 4 && at("engage") <= 1.5) warnings.push("No reliable engage");
  if (ec && n >= 2 && enemy.n >= 2) {
    const ours = s.curve[0] / n;
    if (ours < ec.early - 0.5 && (enemyArch?.id === "early" || ec.early >= 2)) warnings.push("Weak early game vs early-snowball comp");
    const late = s.curve[2] / n;
    if (late < ec.late - 0.5 && ec.late >= 2.2) warnings.push("Outscaled in the late game");
  }
  // Needs most of our comp (peel/sustain often arrive with the last picks). The enemy has to actually lean that way:
  // two real pokers / divers or that identity, not just average attribute sums.
  if (enemy.n >= 3 && n >= 4) {
    const poke = enemyWith("poke") >= 2 || enemyArch?.id === "poke";
    if (poke && at("engage") < 0.5 * tgt("engage") && at("sustain") < 0.5 * tgt("sustain"))
      warnings.push("Vulnerable to poke — little engage or sustain");
    const dive = enemyWith("burst", "mobility") >= 2 || enemyArch?.id === "dive";
    if (dive && at("peel") < 0.4 * tgt("peel")) warnings.push("Vulnerable to dive — little peel");
  }
  if (n >= 4 && at("waveclear") < 0.45 * tgt("waveclear")) warnings.push("Little waveclear");
  if (n >= 4 && at("cc") < 0.4 * tgt("cc")) warnings.push("Little crowd control");
  if (n >= 4 && at("dps") + at("burst") < 0.45 * (tgt("dps") + tgt("burst"))) warnings.push("Low damage output");
  if (n >= 4 && at("peel") < 0.3 * tgt("peel") && s.infos.some((i) => i.a[ATTRIBUTE_KEYS.indexOf("dps")] >= 3 && i.curve[2] >= 2.5))
    warnings.push("Little peel for the carry");

  // Strengths, most notable first.
  const strengths: string[] = [];
  const lead = archetypes[0];
  if (n >= 2 && lead && lead.score >= 55) {
    const def = ARCHETYPE_DEFS.find((d) => d.id === lead.id);
    if (def) strengths.push(`Clear identity: ${def.label}`);
  }
  const STRONG: [AttributeKey, string][] = [
    ["engage", "Strong engage"],
    ["frontline", "Solid frontline"],
    ["cc", "Lots of crowd control"],
    ["peel", "Strong peel"],
    ["poke", "Heavy poke"],
    ["burst", "High burst"],
    ["dps", "High sustained damage"],
    ["waveclear", "Strong waveclear"],
    ["siege", "Strong siege"],
    ["splitpush", "Split-push pressure"],
    ["pick", "Pick potential"],
    ["disengage", "Good disengage"],
    ["sustain", "Good sustain"],
    ["mobility", "Very mobile"],
  ];
  if (n >= 2) {
    const hits = STRONG.map(([k, label]) => ({ label, r: at(k) / tgt(k) }))
      .filter((x) => x.r >= 1)
      .sort((a, b) => b.r - a.r);
    for (const h of hits.slice(0, 3)) strengths.push(h.label);
  }
  if (n >= 3 && physShare >= 0.35 && physShare <= 0.65) strengths.push("Balanced damage");
  if (n >= 2 && s.curve[0] / n >= 2.2) strengths.push("Strong early game");
  if (n >= 2 && s.curve[2] / n >= 2.4) strengths.push("Scales well into the late game");

  const missing = n >= 2 ? CORE_ATTRS.filter((k) => at(k) < tgt(k) * (n / 5) * 0.5) : [];

  return {
    side,
    championIds: ids.slice(),
    attributes: toAttributes(s.sum.map(round2)),
    attributeScores: toAttributes(attrScores),
    damage,
    curve,
    archetypes,
    strengths,
    warnings,
    missing,
  };
}

// Player-facing scoring pieces: pool comfort, playstyle fit, and how traits (TRAITS) interact with champions.
import type { PlaystyleDef, TraitDef } from "../games";
import type { PowerCurve, Role } from "../types";
import { ATTR_INDEX } from "./context";
import type { ChampInfo, PlayerInfo } from "./context";
import { clamp } from "./explain";
import { poolRoleOk } from "./roles";
import { MITIGATION, TUNING } from "./tuning";

const PHASE: Record<keyof PowerCurve, 0 | 1 | 2> = { early: 0, mid: 1, late: 2 };

export interface ChampComfort {
  /** Score points at weight 1. */
  pts: number;
  /** Pool comfort 1..5, or 0 when not in the pool. */
  comfort: number;
  roleOk: boolean;
  /** Playstyle that explains an off-pool bonus. */
  style: PlaystyleDef | null;
  hardOffPool: boolean;
  /** Not in the pool of a player who has a real pool for this role (TUNING.offPoolPts applies). */
  offPool: boolean;
}

/** 0..1 fit of a champion to a playstyle (attribute affinity, curve, archetypes). */
export function styleFit(style: PlaystyleDef, ci: ChampInfo): number {
  let score = 0;
  let wsum = 0;
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(style.affinity)) {
    const i = ATTR_INDEX[k];
    if (i === undefined || !w) continue;
    num += (w * ci.a[i]) / 3;
    den += w;
  }
  if (den > 0) {
    score += (0.6 * num) / den;
    wsum += 0.6;
  }
  if (style.curve) {
    let cn = 0;
    let cd = 0;
    for (const [phase, w] of Object.entries(style.curve) as [keyof PowerCurve, number][]) {
      if (!w) continue;
      cn += (w * ci.curve[PHASE[phase]]) / 3;
      cd += w;
    }
    if (cd > 0) {
      score += (0.2 * cn) / cd;
      wsum += 0.2;
    }
  }
  if (style.archetypes?.length) {
    const hit = ci.c.archetypes.findIndex((a) => style.archetypes!.includes(a));
    score += 0.2 * (hit < 0 ? 0 : hit === 0 ? 1 : 0.7);
    wsum += 0.2;
  }
  return wsum > 0 ? score / wsum : 0;
}

/** How comfortable a player is on a champion in a role (pool comfort, else playstyle affinity). */
export function champComfort(p: PlayerInfo, ci: ChampInfo, role: Role): ChampComfort {
  const e = p.pool.get(ci.c.id);
  if (e) {
    const roleOk = poolRoleOk(p, ci.c.id, ci, role);
    const pts = TUNING.comfortPts[e.comfort] * (roleOk ? 1 : TUNING.comfortOffRoleFactor);
    return { pts, comfort: e.comfort, roleOk, style: null, hardOffPool: false, offPool: false };
  }
  let best: PlaystyleDef | null = null;
  let bestFit = 0;
  for (const s of p.styles) {
    const f = styleFit(s, ci);
    if (f > bestFit + 1e-9) {
      bestFit = f;
      best = s;
    }
  }
  const stylePts = TUNING.playstyleMax * clamp((bestFit - 0.4) / 0.5, 0, 1);
  const hard = (ci.c.difficulty ?? 2) >= 3 && p.pool.size >= 3 && !p.mechanics;
  // A player with a real pool for this role should get their own champions ahead of off-pool meta picks.
  const offPool = (p.poolInRole.get(role) ?? 0) >= 2;
  return {
    pts: stylePts + (hard ? TUNING.hardOffPool : 0) + (offPool ? TUNING.offPoolPts : 0),
    comfort: 0,
    roleOk: true,
    style: stylePts > 0 ? best : null,
    hardOffPool: hard,
    offPool,
  };
}

export const comfortWord = (c: number): string => (c >= 5 ? "signature pick" : c >= 3 ? "comfort pick" : "pool pick");

/** 0..1: how strongly an enemy champion matches a trait's `enemy` spec (e.g. vs-poke → poke ≥ 2). */
export function traitEnemyMatch(t: TraitDef, e: ChampInfo): number {
  const spec = t.enemy;
  if (!spec) return 0;
  let m = 0;
  if (spec.attr) {
    const v = e.a[ATTR_INDEX[spec.attr]] ?? 0;
    if (v >= 2) m = Math.max(m, (v - 1) / 2);
  }
  if (spec.range && e.c.range === spec.range) m = Math.max(m, 1);
  if (spec.curve) {
    const v = e.curve[PHASE[spec.curve]];
    if (v >= 2) m = Math.max(m, (v - 1) / 2);
  }
  return m;
}

/** 0..1: how much a champion leans on a trait's `team` spec (archetypes / curve / attributes). */
export function traitTeamMatch(t: TraitDef, ci: ChampInfo): number {
  const spec = t.team;
  if (!spec) return 0;
  let m = 0;
  if (spec.archetypes?.length) {
    const hit = ci.c.archetypes.findIndex((a) => spec.archetypes!.includes(a));
    if (hit >= 0) m = Math.max(m, hit === 0 ? 1 : 0.6);
  }
  if (spec.curve) {
    for (const [phase, w] of Object.entries(spec.curve) as [keyof PowerCurve, number][]) {
      if (!w) continue;
      const v = ci.curve[PHASE[phase]];
      if (v >= 2.5) m = Math.max(m, 1);
      else if (v >= 2) m = Math.max(m, 0.5);
    }
  }
  if (spec.attrs) {
    for (const [k, w] of Object.entries(spec.attrs)) {
      const v = ci.a[ATTR_INDEX[k]] ?? 0;
      if (w && v >= 2) m = Math.max(m, (v - 1) / 2);
    }
  }
  return m;
}

/** 0..1: how well a candidate mitigates a weakness trait (needs a clearly strong mitigating attribute). */
export function mitigation(traitId: string, ci: ChampInfo): { value: number; via: string } {
  const m = MITIGATION[traitId];
  if (!m) return { value: 0, via: "" };
  let best = 0;
  let via = "";
  for (const k of m.attrs) {
    const v = ci.a[ATTR_INDEX[k]] / 3;
    if (v > best + 1e-9) {
      best = v;
      via = k;
    }
  }
  if (m.ranged && ci.c.range === "ranged" && best < 0.67) {
    best = 0.67;
    via = "range";
  }
  return best >= 0.66 ? { value: best, via } : { value: 0, via: "" };
}

export const traitLabel = (traitId: string, fallback: string): string => MITIGATION[traitId]?.label ?? fallback.toLowerCase();

/** Verb phrase for an avoid entry severity. */
export const avoidPhrase = (sev: number): string => (sev >= 3 ? "hates facing" : sev === 2 ? "struggles against" : "dislikes facing");

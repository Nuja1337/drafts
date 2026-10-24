// Lane matchups and the bounded draft win estimate.
import { LANE_PAIR } from "../games";
import { damagePenalty, projectedQuality } from "./comp";
import { nameOf } from "./context";
import { clamp, round2 } from "./explain";
import { laneWeight, matchup, strengthWord } from "./matchups";
import type { Model, SideModel } from "./scoring";
import { TUNING } from "./tuning";
import type { LaneMatchup } from "./types";

/** Suffix of a lane text when both champions are known but no matchup data exists. */
export const NO_MATCHUP_DATA = "no matchup data";

/** Per blue role: blue's champion vs red's champion in the role it lanes against, adv from blue's side (confidence-weighted). */
export function laneMatchups(m: Model): LaneMatchup[] {
  const ctx = m.ctx;
  const blue = m.bySide.blue.assign.champAt;
  const red = m.bySide.red.assign.champAt;
  return ctx.roles.map((role, ri) => {
    const vs = LANE_PAIR[ctx.game][role] ?? role;
    const b = blue[ri];
    const r = red[ctx.roles.indexOf(vs)] ?? null;
    if (!b || !r) {
      const text = !b && !r ? "Not picked yet" : `${b ? nameOf(ctx, b) : "?"} vs ${r ? nameOf(ctx, r) : "?"}`;
      return { role, vs, blue: b, red: r, adv: null, text };
    }
    const mu = matchup(ctx, b, r);
    if (!mu) return { role, vs, blue: b, red: r, adv: 0, text: `${nameOf(ctx, b)} vs ${nameOf(ctx, r)}: ${NO_MATCHUP_DATA}` };
    const adv = round2(clamp(mu.adv * mu.conf, -1, 1));
    const winner = adv >= 0 ? nameOf(ctx, b) : nameOf(ctx, r);
    const w = strengthWord(adv);
    const tail = mu.override ? " (team note)" : mu.n !== undefined && mu.n < TUNING.lowSample ? " (low sample)" : "";
    const text =
      Math.abs(adv) < 0.05
        ? `Even: ${nameOf(ctx, b)} vs ${nameOf(ctx, r)}${tail}`
        : `${w === "hard" ? `${winner} strongly favored` : w === "clear" ? `${winner} favored` : `${winner} slightly favored`}${tail}`;
    return { role, vs, blue: b, red: r, adv, text };
  });
}

function synergyTotal(m: Model, s: SideModel): number {
  const syn = m.ctx.data.synergies;
  let total = 0;
  for (let i = 0; i < s.slots.length; i++) {
    for (let j = i + 1; j < s.slots.length; j++) {
      const a = s.slots[i].id;
      const b = s.slots[j].id;
      const v = syn?.[a]?.[b] ?? syn?.[b]?.[a];
      if (typeof v === "number" && Number.isFinite(v)) total += clamp(v, 0, 1);
    }
  }
  return total;
}

function metaTotal(m: Model, s: SideModel): number {
  let t = 0;
  for (const slot of s.slots) {
    const stat = slot.ci?.c.meta?.[m.ctx.roles[slot.ri]];
    const pts = stat ? TUNING.tierPts[stat.tier] : undefined;
    if (pts !== undefined) t += pts / TUNING.tierPts.S;
  }
  return t;
}

/**
 * Player comfort relative to a neutral 3/5: a known player on a signature pick counts positive, off-pool slightly
 * negative, and a slot without a known player (an unscouted enemy, a player with no pool) counts as average — so
 * having only our own profile doesn't inflate our estimate.
 */
function comfortTotal(s: SideModel): number {
  const base = TUNING.comfortPts[3] / TUNING.comfortPts[5];
  let t = 0;
  for (const slot of s.slots) {
    const p = s.playerAt[slot.ri];
    if (!p || p.pool.size === 0) continue;
    const e = p.pool.get(slot.id);
    t += (e ? TUNING.comfortPts[e.comfort] / TUNING.comfortPts[5] : 0) - base;
  }
  return t;
}

/**
 * Heuristic draft advantage for the perspective side: lane-weighted matchups, projected comp quality, damage
 * balance, synergy, meta strength, player comfort and overall power budget. 0.5 = even, clamped to 0.2..0.8.
 */
export function winEstimate(m: Model): number {
  const ctx = m.ctx;
  const us = m.us;
  const them = m.them;
  if (!us.slots.length && !them.slots.length) return 0.5;
  let x = 0;
  let cross = 0;
  for (const a of us.slots) {
    for (const b of them.slots) {
      const mu = matchup(ctx, a.id, b.id);
      if (!mu) continue;
      cross += laneWeight(ctx, ctx.roles[a.ri], ctx.roles[b.ri], mu.lane).w * mu.adv * mu.conf;
    }
  }
  x += 0.03 * cross;
  x += 0.25 * (projectedQuality(ctx, us.comp) - projectedQuality(ctx, them.comp));
  const dmg = (s: SideModel) => (s.comp.n >= 3 ? damagePenalty(s.comp.phys / s.comp.n) : 0);
  x += 0.04 * (dmg(them) - dmg(us));
  x += 0.02 * (synergyTotal(m, us) - synergyTotal(m, them));
  x += 0.01 * (metaTotal(m, us) - metaTotal(m, them));
  x += 0.03 * (comfortTotal(us) - comfortTotal(them));
  const power = (s: SideModel) => (s.comp.n ? (s.comp.curve[0] + s.comp.curve[1] + s.comp.curve[2]) / s.comp.n : 0);
  if (us.comp.n && them.comp.n) x += 0.01 * (power(us) - power(them));
  return round2(clamp(0.5 + x, 0.2, 0.8));
}

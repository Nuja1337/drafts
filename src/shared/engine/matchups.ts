// Matchup lookups (dataset + the perspective team's overrides), sample confidence and lane weighting.
import { LANE_OPPONENTS } from "../games";
import type { MatchupCell, Role } from "../types";
import type { Ctx } from "./context";
import { clamp } from "./explain";
import { TUNING } from "./tuning";

export interface Matchup {
  /** a over b in [-1, 1]. */
  adv: number;
  /** 0.5..1 sample confidence (1 for curated cells and overrides). */
  conf: number;
  /** Cell flagged as a lane-specific matchup. */
  lane: boolean;
  /** Value comes from the perspective team's override. */
  override: boolean;
  n?: number;
}

/** Builders already shrink adv toward the prior; thin samples still get a mild extra discount. */
export function sampleConf(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 1;
  const m = Math.max(0, n);
  return 0.5 + (0.5 * m) / (m + TUNING.sampleConfPrior);
}

const validCell = (x: unknown): x is MatchupCell =>
  typeof x === "object" && x !== null && typeof (x as MatchupCell).adv === "number" && Number.isFinite((x as MatchupCell).adv);

function cellOf(ctx: Ctx, a: string, b: string): MatchupCell | null {
  const row = ctx.data.matchups?.[a];
  if (!row || typeof row !== "object") return null;
  const cell = row[b];
  return validCell(cell) ? cell : null;
}

/** Directed matchup a vs b (positive = a favored); overrides replace dataset values. Null when unknown. */
export function matchup(ctx: Ctx, a: string, b: string): Matchup | null {
  if (a === b) return null;
  const direct = cellOf(ctx, a, b);
  const reverse = direct ? null : cellOf(ctx, b, a);
  const o = ctx.overrides.get(`${a}\u0001${b}`);
  const lane = !!(direct?.lane ?? reverse?.lane);
  if (o !== undefined) return { adv: o, conf: 1, lane, override: true };
  if (direct) return { adv: clamp(direct.adv, -1, 1), conf: sampleConf(direct.n), lane, override: false, n: direct.n };
  if (reverse) return { adv: -clamp(reverse.adv, -1, 1), conf: sampleConf(reverse.n), lane, override: false, n: reverse.n };
  return null;
}

export interface Beater {
  id: string;
  /** Effective advantage (adv × conf) of `id` over the champion, > 0. */
  adv: number;
  lane: boolean;
}

/**
 * Champions favored against `id`, from its matchup row plus the perspective team's overrides.
 * Relies on builders writing both directions of each cell (GameDataBundle contract).
 */
export function beatenBy(ctx: Ctx, id: string): Beater[] {
  const out = new Map<string, Beater>();
  const row = ctx.data.matchups?.[id];
  if (row && typeof row === "object") {
    for (const other in row) {
      const cell = row[other];
      if (other === id || !validCell(cell) || cell.adv >= 0) continue;
      out.set(other, { id: other, adv: -clamp(cell.adv, -1, 1) * sampleConf(cell.n), lane: !!cell.lane });
    }
  }
  const ov = ctx.overridesBy.get(id);
  if (ov) {
    for (const o of ov) {
      if (o.adv < 0) out.set(o.id, { id: o.id, adv: -o.adv, lane: out.get(o.id)?.lane ?? !!cellOf(ctx, id, o.id)?.lane });
      else out.delete(o.id);
    }
  }
  return [...out.values()];
}

export interface LaneWeight {
  w: number;
  /** The two champions actually face each other in lane. */
  lane: boolean;
  primary: boolean;
}

/** Weight of a matchup given where both champions play (null = unknown role). */
export function laneWeight(ctx: Ctx, mine: Role | null, theirs: Role | null, cellLane: boolean): LaneWeight {
  if (mine && theirs) {
    const opp = LANE_OPPONENTS[ctx.game][mine];
    const i = opp ? opp.indexOf(theirs) : -1;
    if (i === 0) return { w: TUNING.lanePrimaryW, lane: true, primary: true };
    if (i > 0) return { w: TUNING.laneSecondaryW, lane: true, primary: false };
    return { w: cellLane ? TUNING.offLaneLaneCellW : TUNING.generalW, lane: false, primary: false };
  }
  return { w: cellLane ? 0.6 : TUNING.generalW, lane: false, primary: false };
}

/** Human strength word for an effective advantage magnitude (curated hard counter ≈ 0.4). */
export function strengthWord(adv: number): "hard" | "clear" | "slight" {
  const a = Math.abs(adv);
  return a >= 0.3 ? "hard" : a >= 0.17 ? "clear" : "slight";
}

/** Roles (of the other team) that `role` lanes against. */
export const laneOpponents = (ctx: Ctx, role: Role): Role[] => LANE_OPPONENTS[ctx.game][role] ?? [];

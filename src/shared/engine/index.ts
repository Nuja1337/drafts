// Scoring engine: analyzeDraft(input) → EngineOutput. Pure, synchronous and deterministic.
//
// Pipeline: validate input + derive turn order (context.ts) → assign roles/players per side (roles.ts) →
// composition state and analysis (comp.ts) → score enemy picks, our picks and our bans (scoring.ts) →
// lane matchups + win estimate (summary.ts). Every score is a sum of weighted, explained parts (explain.ts).
import { analyzeComp } from "./comp";
import { buildContext } from "./context";
import { buildModel, scoreAll } from "./scoring";
import { laneMatchups, winEstimate } from "./summary";
import type { EngineInput, EngineOutput, RoleSlot } from "./types";
import type { Side } from "../types";

export function analyzeDraft(input: EngineInput): EngineOutput {
  const ctx = buildContext(input);
  const m = buildModel(ctx);

  const roles = {} as Record<Side, RoleSlot[]>;
  for (const side of ["blue", "red"] as const) {
    const s = m.bySide[side];
    roles[side] = s.slots.map((slot) => {
      const j = s.assign.playerAt[slot.ri];
      const p = j === null || j === undefined ? undefined : s.players[j];
      return { championId: slot.id, role: ctx.roles[slot.ri], ...(p ? { playerId: p.profile.id, playerName: p.name } : {}) };
    });
  }
  const comps = {
    blue: analyzeComp(ctx, "blue", roles.blue.map((r) => r.championId), m.bySide.blue.comp, m.bySide.red.comp),
    red: analyzeComp(ctx, "red", roles.red.map((r) => r.championId), m.bySide.red.comp, m.bySide.blue.comp),
  };
  m.ourMissing = new Set(comps[ctx.perspective].missing);

  const { picks, picksByRole, bans, enemyThreats } = scoreAll(m);
  return {
    next: ctx.next,
    picks,
    picksByRole,
    bans,
    enemyThreats,
    roles,
    comps,
    lanes: laneMatchups(m),
    winEstimate: winEstimate(m),
    unavailable: [...ctx.unavailable[ctx.perspective]].sort(),
  };
}

export { buildCoachContext } from "./coach";
export { explainScore, topReasons } from "./explain";
export { bundleIndex, deriveSteps } from "./context";
export { TUNING } from "./tuning";
export { DEFAULT_WEIGHTS } from "./types";
export type * from "./types";

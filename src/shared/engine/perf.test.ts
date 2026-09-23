import { describe, expect, it } from "vitest";
import { actions, format } from "./__fixtures__/build";
import { syntheticBundle, syntheticTeam } from "./__fixtures__/synthetic";
import { analyzeDraft } from "./index";
import type { EngineInput } from "./types";

/** Median of `runs` timed calls after a warm-up (the client calls the engine on every draft change). */
function medianMs(input: EngineInput, runs = 9): number {
  analyzeDraft(input);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    analyzeDraft(input);
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe("performance", () => {
  const cases = [
    { label: "LoL, 170 champions, sparse matchups", data: syntheticBundle("lol", 170, 30), fmt: format("lol-tournament") },
    { label: "Dota 2, 126 heroes, dense matchups with samples", data: syntheticBundle("dota2", 126, 126, 3, true), fmt: format("dota2-cm") },
  ];
  for (const { label, data, fmt } of cases) {
    it(`${label}: every draft state under 30ms with full team profiles`, () => {
      const all = data.champions.map((c) => c.id);
      const teams = { blue: syntheticTeam(data.game, all.length, 11, "a"), red: syntheticTeam(data.game, all.length, 12, "b") };
      for (const k of [0, 6, 9, 12, 16, fmt.steps.length - 1]) {
        for (const perspective of ["blue", "red"] as const) {
          const input: EngineInput = {
            data,
            format: fmt,
            firstSide: "blue",
            actions: actions(fmt, "blue", all.slice(0, k)),
            unavailable: { blue: all.slice(100, 110), red: [] },
            perspective,
            teams,
          };
          const out = analyzeDraft(input);
          expect(out.picks.length + out.bans.length + out.enemyThreats.length).toBeGreaterThan(0);
          expect(medianMs(input)).toBeLessThan(30);
        }
      }
    });
  }
});

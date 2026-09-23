import { describe, expect, it } from "vitest";
import { ADV_SCALE, baseRate, dataAdv, excessWins, formatMatchupLine, log5, parseMatchupBlob, PRIOR_GAMES, refreshAdv, round3, type H2H } from "./matchupMath";

describe("log5", () => {
  it("is 0.5 for equal teams and symmetric", () => {
    expect(log5(0.5, 0.5)).toBeCloseTo(0.5);
    expect(log5(0.55, 0.48)).toBeCloseTo(1 - log5(0.48, 0.55));
    expect(log5(0.6, 0.5)).toBeCloseTo(0.6);
  });
});

describe("dataAdv", () => {
  it("returns the prior with no games and shrinks thin samples", () => {
    expect(dataAdv(0, 0)).toBe(0);
    expect(dataAdv(0, 0, 0.25)).toBeCloseTo(0.25);
    // 10 games, 3 excess wins: heavily shrunk toward even
    const thin = dataAdv(3, 10);
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(0.05);
  });
  it("approaches the raw excess rate for large samples and is antisymmetric", () => {
    const big = dataAdv(0.1 * 100000, 100000);
    expect(big).toBeCloseTo(0.1 * ADV_SCALE, 2);
    expect(dataAdv(-12, 80, -0.12)).toBeCloseTo(-dataAdv(12, 80, 0.12));
  });
  it("clamps to [-1, 1]", () => {
    expect(dataAdv(1e9, 1e9)).toBe(1);
    expect(dataAdv(-1e9, 1e9)).toBe(-1);
  });
});

describe("refreshAdv", () => {
  it("equals dataAdv when the static cell had no games", () => {
    expect(refreshAdv(0.25, 0, 7, 60)).toBeCloseTo(dataAdv(7, 60, 0.25));
  });
  it("keeps the static value when the fresh sample is not larger", () => {
    expect(refreshAdv(0.2, 100, 50, 100)).toBe(0.2);
    expect(refreshAdv(0.2, 100, 50, 80)).toBe(0.2);
  });
  it("matches a full rebuild when the old sample had the same excess rate", () => {
    // Build: 100 games at +5% excess; live: 200 games at +5% excess → same as dataAdv over 200 games.
    const built = dataAdv(5, 100);
    expect(refreshAdv(built, 100, 10, 200)).toBeCloseTo(dataAdv(10, 200), 6);
  });
  it("moves toward new evidence without double counting", () => {
    const built = dataAdv(0, 100); // even
    const fresh = refreshAdv(built, 100, 20, 300); // new games strongly favor A
    expect(fresh).toBeGreaterThan(0);
    expect(fresh).toBeLessThan(dataAdv(20, 300) * 1.01 + 0.001);
  });
});

describe("baseRate / excessWins", () => {
  it("computes a hero's overall win rate from its line", () => {
    const line: H2H = new Map([
      [2, [10, 6]],
      [3, [30, 14]],
    ]);
    expect(baseRate(line)).toBeCloseTo(20 / 40);
    expect(baseRate(undefined)).toBe(0.5);
    expect(excessWins(10, 6, 0.5, 0.5)).toBeCloseTo(1);
  });
});

describe("matchup blob", () => {
  it("round-trips lines and skips malformed entries", () => {
    const blob = [formatMatchupLine(1, [[17, 103, 54], [129, 91, 49]]), formatMatchupLine(2, [[1, 88, 41]]), "x:1,2,3", "5:6,2,9;7,a,1;5,3,1"].join("|");
    const parsed = parseMatchupBlob(blob);
    expect([...parsed.keys()]).toEqual([1, 2]);
    expect(parsed.get(1)!.get(17)).toEqual([103, 54]);
    expect(parsed.get(2)!.get(1)).toEqual([88, 41]);
    expect(parseMatchupBlob("").size).toBe(0);
  });
  it("uses the documented default prior", () => {
    expect(PRIOR_GAMES).toBeGreaterThanOrEqual(30);
    expect(round3(0.12345)).toBe(0.123);
    expect(Object.is(round3(-0.0001), 0)).toBe(true);
  });
});

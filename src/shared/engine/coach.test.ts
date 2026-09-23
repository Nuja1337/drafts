import { describe, expect, it } from "vitest";
import { actions, format } from "./__fixtures__/build";
import { dotaBundle, dotaRadiantTeam } from "./__fixtures__/dota2";
import { lolBlueTeam, lolBundle, lolRedTeam } from "./__fixtures__/lol";
import { analyzeDraft, buildCoachContext } from "./index";
import type { EngineInput } from "./types";

const LOL = lolBundle();
const TOURNEY = format("lol-tournament");

describe("buildCoachContext", () => {
  // Bans: Soraka, Kennen, Jax, Graves, Syndra, Varus. Picks: B Ornn, R Zed, R Leona, B LeeSin, B Jinx, R Caitlyn.
  const input: EngineInput = {
    data: LOL,
    format: TOURNEY,
    firstSide: "blue",
    actions: actions(TOURNEY, "blue", ["Soraka", "Kennen", "Jax", "Graves", "Syndra", "Varus", "Ornn", "Zed", "Leona", "LeeSin", "Jinx", "Caitlyn"]),
    unavailable: { blue: [], red: [] },
    perspective: "blue",
    teams: { blue: lolBlueTeam(), red: lolRedTeam() },
  };
  const output = analyzeDraft(input);
  const ctx = buildCoachContext(input, output, { our: "Aurora", enemy: "Rivals" }, "Ban phase 2");

  it("uses names, role labels and player names", () => {
    expect(ctx.ourTeamName).toBe("Aurora");
    expect(ctx.enemyTeamName).toBe("Rivals");
    expect(ctx.phase).toBe("Ban phase 2");
    expect(ctx.nextAction).toBe("Enemy ban (Red side)");
    expect(ctx.ourPicks).toEqual([
      { name: "Ornn", role: "Top", player: "Tank" },
      { name: "Lee Sin", role: "Jungle", player: "Hunter" },
      { name: "Jinx", role: "Bot (ADC)", player: "Carry" },
    ]);
    expect(ctx.enemyPicks.map((p) => [p.name, p.role, p.player])).toEqual([
      ["Zed", "Mid", "Ace"],
      ["Caitlyn", "Bot (ADC)", "Bolt"],
      ["Leona", "Support", "Anchor"],
    ]);
    expect(ctx.bans).toContain("Soraka (by us)");
    expect(ctx.bans).toContain("Kennen (by them)");
  });

  it("summarizes comps, suggestions and lanes as short strings", () => {
    expect(ctx.ourComp.damage).toMatch(/^\d+% physical \/ \d+% magic$/);
    expect(ctx.ourComp.curve).toMatch(/^early \d\.\d · mid \d\.\d · late \d\.\d/);
    expect(ctx.topPickSuggestions.length).toBeGreaterThan(0);
    expect(ctx.topPickSuggestions.length).toBeLessThanOrEqual(5);
    for (const s of [...ctx.topPickSuggestions, ...ctx.topBanSuggestions]) {
      expect(s.name).not.toBe("LeeSin"); // display names, not ids
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.reasons.length).toBeLessThanOrEqual(3);
      for (const r of s.reasons) expect(r).toMatch(/\([+-]\d+(\.\d)?\)$/);
    }
    expect(ctx.topPickSuggestions[0].role).not.toBeNull();
    expect(ctx.laneMatchups?.find((l) => l.role === "Bot (ADC)")).toEqual({ role: "Bot (ADC)", ours: "Jinx", theirs: "Caitlyn", verdict: "Unfavored" });
  });

  it("adds grounded player notes", () => {
    expect(ctx.playerNotes).toContain("Mage hates facing Zed (enemy picked)");
    expect(ctx.playerNotes?.some((n) => n.startsWith("Carry's weaknesses: vs. poke"))).toBe(true);
    expect(ctx.playerNotes?.some((n) => n.startsWith("Their Wolf"))).toBe(false); // Lee Sin taken, Graves banned
    expect(ctx.playerNotes?.some((n) => n.startsWith("Their Brick is comfortable on Darius (5/5)"))).toBe(true);
    for (const n of ctx.playerNotes ?? []) expect(n.length).toBeLessThanOrEqual(160);
  });

  it("works for Dota without an enemy profile and for an empty draft", () => {
    const data = dotaBundle();
    const cm = format("dota2-cm");
    const dInput: EngineInput = { data, format: cm, firstSide: "red", actions: [], unavailable: { blue: [], red: [] }, perspective: "blue", teams: { blue: dotaRadiantTeam() } };
    const dCtx = buildCoachContext(dInput, analyzeDraft(dInput), { our: "", enemy: "" }, "Ban phase 1");
    expect(dCtx.ourTeamName).toBe("Radiant");
    expect(dCtx.enemyTeamName).toBe("Dire");
    expect(dCtx.nextAction).toBe("Enemy ban (Dire side)");
    expect(dCtx.ourPicks).toEqual([]);
    expect(dCtx.ourComp).toEqual({ archetypes: [], strengths: [], warnings: [], damage: "n/a", curve: "n/a" });
    expect(dCtx.laneMatchups).toBeUndefined();
    expect(dCtx.topBanSuggestions.length).toBe(5);
    expect(dCtx.topPickSuggestions[0].role).toMatch(/Pos \d/);
  });
});

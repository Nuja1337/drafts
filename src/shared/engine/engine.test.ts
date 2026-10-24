import { describe, expect, it } from "vitest";
import type { Champion, GameDataBundle } from "../types";
import { actions, format, team } from "./__fixtures__/build";
import { dotaBundle, dotaRadiantTeam } from "./__fixtures__/dota2";
import { lolBlueTeam, lolBundle, lolRedTeam } from "./__fixtures__/lol";
import { analyzeDraft, explainScore, topReasons } from "./index";
import type { EngineInput, EngineOutput, Suggestion } from "./types";

const LOL = lolBundle();
const TOURNEY = format("lol-tournament");
/** Neutral opening bans (steps 0-5) that keep the test champions available. */
const BANS = ["Soraka", "Jax", "KSante", "Graves", "Syndra", "Varus"];

function lol(ids: (string | null)[], extra: Partial<EngineInput> = {}): EngineInput {
  return {
    data: LOL,
    format: TOURNEY,
    firstSide: "blue",
    actions: actions(TOURNEY, "blue", ids),
    unavailable: { blue: [], red: [] },
    perspective: "blue",
    teams: {},
    ...extra,
  };
}

const ids = (xs: Suggestion[]) => xs.map((s) => s.championId);
const find = (xs: Suggestion[], id: string) => xs.find((s) => s.championId === id);
const roleOf = (out: EngineOutput, side: "blue" | "red", id: string) => out.roles[side].find((r) => r.championId === id);

function expectSane(out: EngineOutput) {
  const all = [...out.picks, ...out.bans, ...out.enemyThreats, ...Object.values(out.picksByRole).flat()];
  for (const s of all) {
    expect(Number.isFinite(s.score)).toBe(true);
    for (const r of s.reasons) {
      expect(Number.isFinite(r.delta)).toBe(true);
      expect(r.text.length).toBeGreaterThan(0);
    }
  }
  expect(out.winEstimate).toBeGreaterThanOrEqual(0.2);
  expect(out.winEstimate).toBeLessThanOrEqual(0.8);
}

describe("turn order", () => {
  it("derives the next step from format steps, first side and completed actions", () => {
    expect(analyzeDraft(lol([], { firstSide: "red" })).next).toEqual({ index: 0, type: "ban", side: "red" });
    expect(analyzeDraft(lol(BANS)).next).toEqual({ index: 6, type: "pick", side: "blue" });
    expect(analyzeDraft(lol([...BANS, "Ornn"])).next).toEqual({ index: 7, type: "pick", side: "red" });
    // Skipped bans (null) still complete their step.
    expect(analyzeDraft(lol([null, null, null])).next).toEqual({ index: 3, type: "ban", side: "red" });
  });

  it("returns no suggestions for a side whose roles are all filled", () => {
    const full = [...BANS, "Ornn", "Darius", "LeeSin", "Sejuani", "Ahri", "Caitlyn", "Viktor", "Kennen", "Orianna", "Fiora", "Leona", "Jinx", "Lulu", "Zed"];
    const out = analyzeDraft(lol(full));
    expect(out.next).toBeNull();
    expect(out.picks).toEqual([]);
    expect(out.picksByRole).toEqual({});
    expect(out.bans).toEqual([]);
    expect(out.enemyThreats).toEqual([]);
    expectSane(out);
  });
});

describe("role assignment", () => {
  it("assigns picked champions to their best distinct roles", () => {
    // B6 Jinx, R7 Sejuani, R8 Ahri, B9 Leona, B10 Darius
    const out = analyzeDraft(lol([...BANS, "Jinx", "Sejuani", "Ahri", "Leona", "Darius"]));
    expect(out.roles.blue.map((r) => [r.championId, r.role])).toEqual([
      ["Darius", "top"],
      ["Jinx", "bot"],
      ["Leona", "support"],
    ]);
    expect(out.roles.red.map((r) => [r.championId, r.role])).toEqual([
      ["Sejuani", "jungle"],
      ["Ahri", "mid"],
    ]);
  });

  it("moves a flex pick to its secondary role when a specialist takes its primary", () => {
    const one = analyzeDraft(lol([...BANS, "Gragas"]));
    expect(roleOf(one, "blue", "Gragas")?.role).toBe("jungle");
    const two = analyzeDraft(lol([...BANS, "Gragas", "Darius", "Ahri", "Sejuani"]));
    expect(roleOf(two, "blue", "Gragas")?.role).toBe("top");
    expect(roleOf(two, "blue", "Sejuani")?.role).toBe("jungle");
  });

  it("assigns players by role preference and pool comfort", () => {
    const teams = { blue: lolBlueTeam() };
    const one = analyzeDraft(lol([...BANS, "Gragas"], { teams }));
    // Hunter plays Gragas jungle (comfort 4, jungle-only entry) over Tank's top Gragas (comfort 3).
    expect(roleOf(one, "blue", "Gragas")).toMatchObject({ role: "jungle", playerName: "Hunter" });
    const two = analyzeDraft(lol([...BANS, "Gragas", "Darius", "Ahri", "LeeSin"], { teams }));
    expect(roleOf(two, "blue", "Gragas")).toMatchObject({ role: "top", playerName: "Tank" });
    expect(roleOf(two, "blue", "LeeSin")).toMatchObject({ role: "jungle", playerName: "Hunter" });
  });

  it("suggests specialists for a flex champion's role with the re-shuffle explained", () => {
    const out = analyzeDraft(lol([...BANS, "Gragas", "Darius", "Ahri"]));
    expect(Object.keys(out.picksByRole)).toEqual(["top", "mid", "bot", "support"]);
    const sej = find(out.picks, "Sejuani") ?? find(analyzeDraft(lol([...BANS, "Gragas", "Darius", "Ahri"], { limit: 40 })).picks, "Sejuani");
    expect(sej?.role).toBe("jungle");
    expect(sej?.reasons.some((r) => r.kind === "role-filled" && r.text.includes("Gragas moves to Top"))).toBe(true);
  });
});

describe("open roles and availability", () => {
  const draft = [...BANS, "Darius", "Ahri", "Jinx", "Sejuani"]; // blue: Darius top, Sejuani jungle
  it("only suggests champions for open roles", () => {
    const out = analyzeDraft(lol(draft, { limit: 40 }));
    expect(Object.keys(out.picksByRole)).toEqual(["mid", "bot", "support"]);
    for (const s of out.picks) expect(["mid", "bot", "support"]).toContain(s.role);
    expect(ids(out.picks)).not.toContain("Garen");
    expect(ids(out.picks)).not.toContain("LeeSin");
  });

  it("never suggests picked, banned or fearless-locked champions", () => {
    const out = analyzeDraft(lol(draft, { limit: 40, unavailable: { blue: ["Orianna", "Leona"], red: ["Zed", "Kaisa"] } }));
    const all = [...ids(out.picks), ...Object.values(out.picksByRole).flatMap(ids)];
    for (const gone of [...draft, "Orianna", "Leona"]) expect(all).not.toContain(gone);
    expect(out.unavailable).toEqual(expect.arrayContaining([...draft, "Orianna", "Leona"]));
    expect(out.unavailable).not.toContain("Zed");
    // Locked for red: not a threat and not worth a ban, but still pickable by us.
    expect(ids(out.enemyThreats)).not.toContain("Zed");
    expect(ids(out.bans)).not.toContain("Zed");
    expect(ids(out.bans)).not.toContain("Kaisa");
    expect(all).toContain("Zed");
  });

  it("still suggests banning a champion only we are fearless-locked out of (bans ignore fearless)", () => {
    const out = analyzeDraft(lol(BANS, { limit: 200, unavailable: { blue: ["Zed"], red: [] } }));
    expect(ids(out.picks)).not.toContain("Zed");
    expect(ids(out.enemyThreats)).toContain("Zed");
    expect(ids(out.bans)).toContain("Zed");
    for (const gone of BANS) expect(ids(out.bans)).not.toContain(gone);
  });
});

describe("pick scoring", () => {
  it("prefers a comfort pick over a slightly stronger meta pick", () => {
    const out = analyzeDraft(lol(["Soraka", "Jax", "KSante", "Graves", "Kennen", "Varus"], { teams: { blue: lolBlueTeam() } }));
    const mid = ids(out.picksByRole.mid);
    expect(mid.indexOf("Orianna")).toBeGreaterThanOrEqual(0);
    expect(mid.indexOf("Orianna")).toBeLessThan(mid.indexOf("Syndra")); // B-tier comfort 4 vs A-tier off-pool
    const ori = find(out.picksByRole.mid, "Orianna")!;
    expect(ori.playerName).toBe("Mage");
    expect(ori.reasons.some((r) => r.kind === "comfort" && r.text.includes("(4/5)"))).toBe(true);
  });

  it("ranks a comfort-5, A-tier pick that counters its lane opponent first", () => {
    // R7 Xerath (mid), R8 Leona.
    const out = analyzeDraft(lol([...BANS, "Gragas", "Xerath", "Leona"], { teams: { blue: lolBlueTeam() } }));
    const top = out.picks[0];
    expect(top.championId).toBe("Ahri");
    expect(top.role).toBe("mid");
    expect(top.reasons.some((r) => r.kind === "counter" && r.text.includes("Xerath") && r.delta > 0)).toBe(true);
    expect(top.reasons.some((r) => r.kind === "comfort" && r.delta > 0)).toBe(true);
  });

  it("finds the lane counter on the last pick, with no blind-pick risk", () => {
    // Blue: Ornn, Sejuani, Xerath, Jinx, Lulu. Red: Darius, LeeSin, Caitlyn, Leona — red last-picks mid.
    const draft = [...BANS, "Ornn", "Darius", "LeeSin", "Sejuani", "Xerath", "Caitlyn", "Viktor", "Kennen", "Orianna", "Fiora", "Leona", "Jinx", "Lulu"];
    const out = analyzeDraft(lol(draft, { perspective: "red", teams: { red: lolRedTeam() } }));
    expect(out.next).toEqual({ index: 19, type: "pick", side: "red" });
    expect(Object.keys(out.picksByRole)).toEqual(["mid"]);
    expect(out.picks[0].championId).toBe("Zed");
    expect(out.picks[0].reasons.some((r) => r.kind === "counter" && r.text.includes("Xerath") && r.text.includes("in lane"))).toBe(true);
    for (const s of out.picks) expect(s.reasons.some((r) => r.kind === "blind-risk")).toBe(false);
  });

  it("penalizes counterable blind picks early and rewards flex picks", () => {
    const early = analyzeDraft(lol(BANS, { limit: 40 }));
    const sej = find(early.picks, "Sejuani")!;
    const risk = sej.reasons.find((r) => r.kind === "blind-risk");
    expect(risk?.delta).toBeLessThan(0);
    expect(risk?.text).toContain("Lee Sin");
    expect(find(early.picks, "Gragas")!.reasons.some((r) => r.kind === "flex" && r.delta > 0)).toBe(true);

    // Once the enemy jungler is locked in, Sejuani's lane counters are gone.
    const later = analyzeDraft(lol([...BANS, "Ornn", "Vi", "Ahri"], { limit: 40 }));
    const sejLater = find(later.picks, "Sejuani")!;
    const riskLater = sejLater.reasons.find((r) => r.kind === "blind-risk");
    expect(Math.abs(riskLater?.delta ?? 0)).toBeLessThan(Math.abs(risk!.delta));
  });

  it("rewards synergy and damage balance", () => {
    // Blue: Darius top, LeeSin jungle, Zed mid, Jinx bot (all physical) — support open.
    const draft = [...BANS, "Darius", "Sejuani", "Viktor", "LeeSin", "Zed", "Caitlyn", "Kennen", "Garen", "Janna", "Fiora", "Nautilus", "Jinx"];
    const out = analyzeDraft(lol(draft, { limit: 40 }));
    expect(Object.keys(out.picksByRole)).toEqual(["support"]);
    const leona = find(out.picksByRole.support, "Leona")!;
    const pyke = find(out.picksByRole.support, "Pyke")!;
    expect(leona.reasons.some((r) => r.kind === "composition" && r.text.includes("magic damage") && r.delta > 0)).toBe(true);
    expect(pyke.reasons.some((r) => r.kind === "composition" && r.text.includes("physical threat") && r.delta < 0)).toBe(true);
    expect(out.comps.blue.warnings).toContain("All physical damage, so enemies can stack armor");
    expect(find(out.picksByRole.support, "Lulu")!.reasons.some((r) => r.kind === "synergy" && r.text === "Strong synergy with Jinx")).toBe(true);
  });

  it("honours team matchup overrides over the dataset", () => {
    const draft = [...BANS, "Ahri", "Darius"]; // red picks Darius top
    const base = analyzeDraft(lol(draft, { limit: 40 }));
    const garenBase = find(base.picksByRole.top, "Garen")!;
    expect(garenBase.reasons.some((r) => r.kind === "countered" && r.text.includes("Darius"))).toBe(true);

    const blue = team("lol", "t-o", "Override", [], { overrides: [{ a: "Garen", b: "Darius", adv: 0.4, note: "we win this" }] });
    const over = analyzeDraft(lol(draft, { limit: 40, teams: { blue } }));
    const garen = find(over.picksByRole.top, "Garen")!;
    const r = garen.reasons.find((x) => x.kind === "override");
    expect(r?.delta).toBeGreaterThan(0);
    expect(r?.text).toContain("team note");
    expect(garen.score).toBeGreaterThan(garenBase.score);

    // Lanes use the same belief once Garen is locked.
    const locked = analyzeDraft(lol([...draft, "Sejuani", "Garen"], { teams: { blue } }));
    const topLane = locked.lanes.find((l) => l.role === "top")!;
    expect(topLane.adv).toBeGreaterThan(0);
    expect(topLane.text).toContain("team note");
  });

  it("uses player weaknesses and hated matchups", () => {
    // Red picks Zed mid, whom our Mage hates facing and whose burst exploits Mage's weakness.
    const bans = ["Soraka", "Jax", "KSante", "Graves", "Kennen", "Varus"];
    const out = analyzeDraft(lol([...bans, "Ornn", "Zed", "Leona"], { teams: { blue: lolBlueTeam() }, limit: 40 }));
    const syndra = find(out.picksByRole.mid, "Syndra")!;
    const answer = syndra.reasons.find((r) => r.kind === "avoid");
    expect(answer?.delta).toBeGreaterThan(0);
    expect(answer?.text).toBe("Answers Zed, whom Mage hates facing");
    const ori = find(out.picksByRole.mid, "Orianna")!;
    expect(ori.reasons.find((r) => r.kind === "avoid")?.delta).toBeLessThan(0);
    expect(ori.reasons.some((r) => r.kind === "weakness" && r.delta > 0 && r.text.includes("Zed") && r.text.includes("burst"))).toBe(true);
  });
});

describe("ban suggestions", () => {
  it("targets champions our players hate and spares our own comfort picks", () => {
    const out = analyzeDraft(lol([], { teams: { blue: lolBlueTeam() }, limit: 10 }));
    const bans = ids(out.bans);
    expect(bans).toContain("Zed");
    expect(bans).toContain("Kennen");
    expect(find(out.bans, "Zed")!.reasons.some((r) => r.kind === "avoid" && r.text.includes("Mage"))).toBe(true);
    for (const ours of ["Ahri", "Ornn", "Sejuani", "Jinx", "Lulu"]) expect(bans).not.toContain(ours);
  });

  it("uses scouted enemy comfort and targets the enemy's open roles in phase 2", () => {
    // After pick phase 1 red has Darius (top), LeeSin (jungle), Caitlyn (bot).
    const draft = [...BANS, "Ornn", "Darius", "LeeSin", "Sejuani", "Xerath", "Caitlyn"];
    const out = analyzeDraft(lol(draft, { teams: { blue: lolBlueTeam(), red: lolRedTeam() } }));
    expect(out.next).toEqual({ index: 12, type: "ban", side: "red" });
    for (const s of out.bans) expect(["mid", "support"]).toContain(s.role);
    const zed = find(out.bans, "Zed")!;
    expect(zed.reasons.some((r) => r.kind === "deny" && r.text.includes("Ace"))).toBe(true);
    expect(out.bans[0].championId).toBe("Zed");
    // Threats come from the enemy's perspective with their players.
    expect(out.enemyThreats[0].playerName).toBeDefined();
    for (const s of out.enemyThreats) expect(["mid", "support"]).toContain(s.role);
  });
});

describe("suggestion quality", () => {
  const withMeta = (id: string, role: string, tier: "S" | "A" | "B" | "C" | "D"): GameDataBundle => ({
    ...LOL,
    champions: LOL.champions.map((c) => (c.id === id ? { ...c, meta: { ...c.meta, [role]: { tier } } } : c)),
  });

  it("charges a re-shuffle for the tier the moved champion loses", () => {
    const draft = [...BANS, "Gragas", "Darius", "Ahri"]; // Gragas jungle (B) → top (B) when Sejuani takes jungle
    const reshuffle = (data: GameDataBundle) =>
      find(analyzeDraft(lol(draft, { data, limit: 40 })).picks, "Sejuani")!.reasons.find((r) => r.kind === "role-filled")!;
    const base = reshuffle(LOL);
    expect(base.text).toBe("Gragas moves to Top");
    const weak = reshuffle(withMeta("Gragas", "top", "D"));
    expect(weak.text).toBe("Gragas moves to Top (tier B to D)");
    expect(weak.delta).toBeCloseTo(base.delta - 12, 5); // B (+3) → D (-9)
  });

  it("only counts B-tier-or-better roles as flex", () => {
    const early = analyzeDraft(lol(BANS, { limit: 40 }));
    // Gragas: jungle B, top B, mid C → a two-way flex; Malphite: top B, support C, mid C → no flex.
    expect(find(early.picks, "Gragas")!.reasons.find((r) => r.kind === "flex")).toMatchObject({ delta: 3, text: "Flex pick (Jungle/Top) hides our lineup" });
    expect(find(early.picks, "Malphite")!.reasons.some((r) => r.kind === "flex")).toBe(false);
  });

  it("doesn't hold a champion's generic pick value against banning it", () => {
    const out = analyzeDraft(lol([], { limit: 40 }));
    for (const s of out.bans) expect(s.reasons.some((r) => r.kind === "comfort")).toBe(false);
    // Only our players' comfort picks are spared.
    const team = analyzeDraft(lol([], { teams: { blue: lolBlueTeam() }, limit: 40 }));
    for (const s of team.bans) for (const r of s.reasons.filter((x) => x.kind === "comfort")) expect(r.text).toMatch(/^We'd rather pick it \(\w+ [345]\/5\)$/);
  });

  it("marks champions outside a player's role pool", () => {
    const out = analyzeDraft(lol(BANS, { teams: { blue: lolBlueTeam() }, limit: 40 }));
    const darius = find(out.picksByRole.top, "Darius")!;
    expect(darius.reasons.find((r) => r.text === "Not in Tank's pool")?.delta).toBe(-4);
    expect(find(out.picksByRole.top, "Ornn")!.reasons.some((r) => r.text.startsWith("Not in"))).toBe(false);
  });

  it("uses scouted enemy players' hated matchups and weaknesses for our picks", () => {
    const draft = [...BANS, "Ornn", "Zed", "Leona"]; // red Zed (Ace) mid; blue picks next
    const scouted = lolRedTeam();
    scouted.players = scouted.players.map((p) => (p.name === "Ace" ? { ...p, avoid: [{ championId: "Orianna", severity: 3 }], weaknesses: ["vs-burst"] } : p));
    const plain = find(analyzeDraft(lol(draft, { teams: { red: lolRedTeam() }, limit: 40 })).picksByRole.mid, "Orianna")!;
    const ori = find(analyzeDraft(lol(draft, { teams: { red: scouted }, limit: 40 })).picksByRole.mid, "Orianna")!;
    expect(ori.reasons.find((r) => r.kind === "avoid")).toMatchObject({ text: "Their Ace hates facing Orianna" });
    expect(ori.reasons.some((r) => r.kind === "weakness" && r.text === "Exploits their Ace's weakness vs burst" && r.delta > 0)).toBe(true);
    expect(ori.score).toBeGreaterThan(plain.score + 5);
  });

  it("warns about dive only against real divers", () => {
    const bans = ["Soraka", "Jax", "KSante", "Thresh", "Lulu", "Varus"];
    // Blue Darius/LeeSin/Zed/Jinx (no peel) vs a bursty red with a single diver (Ahri), then with two (Ahri, Kai'Sa).
    const vs = (red3: string) => analyzeDraft(lol([...bans, "Darius", "Ahri", "Syndra", "LeeSin", "Zed", red3, "Garen", "Janna", "Fiora", "Nautilus", "Yasuo", "Jinx"]));
    expect(vs("Graves").comps.blue.warnings).not.toContain("Vulnerable to dive, with little peel");
    expect(vs("Kaisa").comps.blue.warnings).toContain("Vulnerable to dive, with little peel");
  });

  it("doesn't favour a side just because only its profile is known", () => {
    // Blue: Kennen, LeeSin, Zed, Leona, Caitlyn.
    const draft = [...BANS, "Kennen", "Darius", "Sejuani", "LeeSin", "Zed", "Xerath", "Viktor", "Ahri", "Orianna", "Fiora", "Janna", "Leona", "Caitlyn", "Jinx"];
    const roster = (comfort: 3 | 5) =>
      team("lol", "t-w", "W", [
        { id: "w1", name: "T", roles: [["top", "main"]], pool: [["Kennen", comfort]] },
        { id: "w2", name: "J", roles: [["jungle", "main"]], pool: [["LeeSin", comfort]] },
        { id: "w3", name: "M", roles: [["mid", "main"]], pool: [["Zed", comfort]] },
        { id: "w4", name: "B", roles: [["bot", "main"]], pool: [["Caitlyn", comfort]] },
        { id: "w5", name: "S", roles: [["support", "main"]], pool: [["Leona", comfort]] },
      ]);
    const none = analyzeDraft(lol(draft)).winEstimate;
    expect(analyzeDraft(lol(draft, { teams: { blue: roster(3) } })).winEstimate).toBe(none); // average comfort = no information
    const five = analyzeDraft(lol(draft, { teams: { blue: roster(5) } })).winEstimate;
    expect(five).toBeGreaterThan(none);
    expect(five - none).toBeLessThanOrEqual(0.09);
  });
});

describe("robustness", () => {
  it("degrades gracefully with missing and malformed data", () => {
    const messy: GameDataBundle = {
      ...LOL,
      champions: [
        ...LOL.champions.map((c, i) => (i % 3 === 0 ? { ...c, meta: {} } : c)),
        // Uncurated, partial attributes, a bogus role and no curve.
        { ...LOL.champions[0], id: "Newbie", name: "Newbie", curated: false, roles: ["mid", "nowhere"], attributes: { poke: 2 } as unknown as Champion["attributes"], powerCurve: undefined as unknown as Champion["powerCurve"], archetypes: [] },
        // Duplicate id is ignored.
        { ...LOL.champions[1] },
      ],
      matchups: { Darius: { Garen: { adv: Number.NaN }, Mystery: { adv: 3 } } } as GameDataBundle["matchups"],
      synergies: undefined as unknown as GameDataBundle["synergies"],
    };
    const blue = team("lol", "t-m", "Messy", [
      { id: "m1", name: "", roles: [["top", "main"], ["nowhere", "main"]], pool: [["Mystery", 5], ["Newbie", 3, ["mid"]]], playstyles: ["nope"], strengths: ["??"], avoid: [["Mystery", 3]] },
      { id: "m2", name: "Sub", roles: [] },
    ]);
    const input = lol([...BANS, "Mystery", "Darius", "Garen", "Newbie"], {
      data: messy,
      teams: { blue, red: { ...lolRedTeam(), game: "dota2" } },
      weights: { counter: Number.NaN, meta: -3, synergy: 99 },
      limit: Number.NaN,
    });
    const out = analyzeDraft(input);
    expectSane(out);
    expect(out.roles.blue.map((r) => r.championId).sort()).toEqual(["Mystery", "Newbie"]);
    expect(out.picks.length).toBeGreaterThan(0);
    expect(out.picks.length).toBeLessThanOrEqual(12);
    for (const s of out.picks) expect(s.reasons.some((r) => r.kind === "meta" && r.delta !== 0)).toBe(false); // meta weight clamped to 0
  });

  it("handles an empty bundle and a format without steps", () => {
    const empty: GameDataBundle = { ...LOL, champions: [], matchups: {}, synergies: {} };
    const out = analyzeDraft(lol(["Ahri"], { data: empty }));
    expect(out.picks).toEqual([]);
    expect(out.bans).toEqual([]);
    expectSane(out);
    const none = analyzeDraft({ ...lol([]), format: { ...TOURNEY, steps: [] } });
    expect(none.next).toBeNull();
  });
});

describe("Dota 2", () => {
  const DOTA = dotaBundle();
  const CM = format("dota2-cm");
  // CM: Fb Fb Sb Sb Fb Sb Sb | Fp Sp | Fb Fb Sb | Sp Fp Fp Sp Sp Fp | Fb Sb Sb Fb | Fp Sp
  const dota = (picks: string[], extra: Partial<EngineInput> = {}): EngineInput => ({
    data: DOTA,
    format: CM,
    firstSide: "blue",
    actions: actions(CM, "blue", picks),
    unavailable: { blue: [], red: [] },
    perspective: "blue",
    teams: {},
    ...extra,
  });
  const BANS7 = ["pudge", "tidehunter", "lina", "rubick", "puck", "dazzle", "nevermore"];

  it("assigns positions and computes lanes with Dota roles", () => {
    // Fp antimage, Sp phantom_lancer, bans x3, Sp invoker, Fp crystal_maiden, Fp axe
    const out = analyzeDraft(dota([...BANS7, "antimage", "phantom_lancer", "mirana", "tusk", "witch_doctor", "invoker", "crystal_maiden", "axe"], { teams: { blue: dotaRadiantTeam() } }));
    expect(out.roles.blue.map((r) => [r.championId, r.role, r.playerName])).toEqual([
      ["antimage", "pos1", "Carry"],
      ["axe", "pos3", "Offlane"],
      ["crystal_maiden", "pos5", "Five"],
    ]);
    expect(out.roles.red.map((r) => r.role)).toEqual(["pos1", "pos2"]);
    expect(Object.keys(out.picksByRole)).toEqual(["pos2", "pos4"]);
    expect(out.lanes.map((l) => l.role)).toEqual(["pos1", "pos2", "pos3", "pos4", "pos5"]);
    // Dota lanes pair the safe lane with the enemy offlane: blue pos1 vs red pos3, blue pos3 vs red pos1.
    expect(out.lanes.map((l) => l.vs)).toEqual(["pos3", "pos2", "pos1", "pos5", "pos4"]);
    expect(out.lanes[0]).toMatchObject({ role: "pos1", vs: "pos3", blue: "antimage", red: null, adv: null });
    expect(out.lanes[2]).toMatchObject({ role: "pos3", vs: "pos1", blue: "axe", red: "phantom_lancer" });
    expect(out.lanes[1]).toMatchObject({ role: "pos2", vs: "pos2", red: "invoker" });
    expectSane(out);
  });

  it("weights real lane opponents and shrinks thin samples", () => {
    // Red has phantom_lancer (pos1) and storm_spirit (pos2); blue still needs an offlaner and supports.
    const out = analyzeDraft(dota([...BANS7, "juggernaut", "phantom_lancer", "mirana", "tusk", "witch_doctor", "storm_spirit"], { limit: 30 }));
    const axe = find(out.picksByRole.pos3, "axe")!;
    expect(axe.reasons.some((r) => r.kind === "counter" && r.text.includes("Phantom Lancer in lane"))).toBe(true);
    const lowSample = analyzeDraft(dota(["tidehunter", "lina", "rubick", "puck", "dazzle", "nevermore", "mirana", "juggernaut", "storm_spirit"], { limit: 30 }));
    const pudge = find(lowSample.picksByRole.pos4, "pudge")!;
    expect(pudge.reasons.some((r) => r.text.includes("Storm Spirit") && r.text.includes("low sample"))).toBe(true);
  });
});

describe("comps, lanes and win estimate", () => {
  it("analyzes compositions", () => {
    const draft = [...BANS, "Ornn", "Darius", "LeeSin", "Sejuani", "Orianna", "Caitlyn", "Viktor", "Kennen", "Ezreal", "Fiora", "Leona", "Jinx", "Lulu", "Zed"];
    const out = analyzeDraft(lol(draft));
    const blue = out.comps.blue;
    expect(blue.championIds).toHaveLength(5);
    expect(blue.damage.physical + blue.damage.magic).toBeCloseTo(1, 5);
    const scores = blue.archetypes.map((a) => a.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const s of scores) expect(s).toBeGreaterThanOrEqual(0), expect(s).toBeLessThanOrEqual(100);
    for (const v of Object.values(blue.attributeScores)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    expect(blue.strengths.length).toBeGreaterThan(0);
    // Red: Darius, LeeSin, Caitlyn, Leona, Zed — all physical carries, early-leaning.
    expect(out.comps.red.warnings.some((w) => /physical/i.test(w))).toBe(true);
    expect(out.lanes.every((l) => l.adv !== null)).toBe(true);
    expect(out.lanes.find((l) => l.role === "mid")!.text).toMatch(/Zed/);
  });

  it("keeps the win estimate neutral when empty, symmetric, bounded and moved by matchups", () => {
    expect(analyzeDraft(lol([])).winEstimate).toBe(0.5);
    // Blue wins top, jungle, mid and bot lane.
    const draft = [...BANS, "Kennen", "Darius", "Sejuani", "LeeSin", "Zed", "Xerath", "Viktor", "Ahri", "Orianna", "Fiora", "Janna", "Leona", "Caitlyn", "Jinx"];
    const blue = analyzeDraft(lol(draft));
    const red = analyzeDraft(lol(draft, { perspective: "red" }));
    expect(blue.winEstimate + red.winEstimate).toBeCloseTo(1, 1);
    const noMatchups = analyzeDraft(lol(draft, { data: { ...LOL, matchups: {} } }));
    expect(blue.winEstimate).toBeGreaterThan(noMatchups.winEstimate);
    expectSane(blue);
  });
});

describe("determinism, weights and explanations", () => {
  const input = lol([...BANS, "Gragas", "Xerath", "Leona"], { teams: { blue: lolBlueTeam(), red: lolRedTeam() } });

  it("is deterministic and sorted", () => {
    const a = analyzeDraft(input);
    const b = analyzeDraft(structuredClone(input));
    expect(b).toEqual(a);
    for (const list of [a.picks, a.bans, a.enemyThreats, ...Object.values(a.picksByRole)]) {
      for (let i = 1; i < list.length; i++) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score);
      for (const s of list) {
        const mags = s.reasons.map((r) => Math.abs(r.delta));
        expect([...mags].sort((x, y) => y - x)).toEqual(mags);
      }
    }
  });

  it("applies weights per component", () => {
    const out = analyzeDraft({ ...input, weights: { counter: 0, comfort: 0 } });
    for (const s of out.picks) expect(s.reasons.some((r) => r.kind === "counter" || r.kind === "countered" || r.kind === "comfort")).toBe(false);
    const doubled = analyzeDraft({ ...input, weights: { counter: 2 } });
    const base = analyzeDraft(input);
    const c1 = find(base.picks, "Ahri")!.reasons.find((r) => r.kind === "counter")!;
    const c2 = find(doubled.picks, "Ahri")!.reasons.find((r) => r.kind === "counter")!;
    expect(c2.delta).toBeCloseTo(c1.delta * 2, 0);
  });

  it("explains scores", () => {
    const s = analyzeDraft(input).picks[0];
    expect(topReasons(s, 2)).toHaveLength(2);
    expect(explainScore(s)).toMatch(/^\d+ · [+-]/);
  });
});

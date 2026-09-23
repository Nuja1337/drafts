import { describe, expect, it } from "vitest";
import { emptyAttributes } from "../../src/shared/games";
import { dataAdv, excessWins, REL_ADV, type H2H } from "../../src/shared/matchupMath";
import type { CuratedChampion, RelationRef } from "../../src/shared/types";
import { normalizeCurated } from "./curated";
import { curatedMatchups, curatedPairs, curatedSynergies, dataMatchups } from "./relations";

const champ = (id: string, rel: { strongVs?: RelationRef[]; weakVs?: RelationRef[]; synergies?: RelationRef[] } = {}): CuratedChampion => ({
  id,
  roles: ["top"],
  damage: "physical",
  range: "melee",
  attributes: emptyAttributes(),
  powerCurve: { early: 1, mid: 2, late: 2 },
  archetypes: ["split"],
  strongVs: rel.strongVs ?? [],
  weakVs: rel.weakVs ?? [],
  synergies: rel.synergies ?? [],
});

describe("curated matchups", () => {
  it("writes both directions with mirrored adv and keeps the lane flag", () => {
    const pairs = curatedPairs([champ("Malphite", { strongVs: [{ id: "Tryndamere", s: 3, lane: true }] })]);
    const m = curatedMatchups(pairs, new Set(["Malphite", "Tryndamere"]));
    expect(m.Malphite.Tryndamere).toEqual({ adv: REL_ADV[3], lane: true });
    expect(m.Tryndamere.Malphite).toEqual({ adv: -REL_ADV[3], lane: true });
  });
  it("averages when both sides state the relation", () => {
    const pairs = curatedPairs([
      champ("A", { strongVs: [{ id: "B", s: 3 }] }), // A beats B strongly: +0.4
      champ("B", { strongVs: [{ id: "A", s: 1 }] }), // B claims a slight edge on A: A→B -0.12
    ]);
    const m = curatedMatchups(pairs, new Set(["A", "B"]));
    expect(m.A.B.adv).toBeCloseTo((REL_ADV[3] - REL_ADV[1]) / 2, 3);
    expect(m.B.A.adv).toBeCloseTo(-m.A.B.adv, 9);
  });
  it("treats weakVs as the reverse relation and agrees with the other side's strongVs", () => {
    const pairs = curatedPairs([champ("A", { weakVs: [{ id: "B", s: 2 }] }), champ("B", { strongVs: [{ id: "A", s: 2 }] })]);
    const m = curatedMatchups(pairs, new Set(["A", "B"]));
    expect(m.B.A.adv).toBeCloseTo(REL_ADV[2]);
    expect(m.A.B.adv).toBeCloseTo(-REL_ADV[2]);
  });
  it("skips ids outside the roster and relations that cancel out", () => {
    const pairs = curatedPairs([champ("A", { strongVs: [{ id: "B", s: 2 }, { id: "Z", s: 3 }] }), champ("B", { strongVs: [{ id: "A", s: 2 }] })]);
    const m = curatedMatchups(pairs, new Set(["A", "B"]));
    expect(m.A?.B).toBeUndefined();
    expect(m.A?.Z).toBeUndefined();
  });
});

describe("synergies", () => {
  it("is symmetric and keeps the stronger statement", () => {
    const s = curatedSynergies([champ("Yasuo", { synergies: [{ id: "Malphite", s: 3 }] }), champ("Malphite", { synergies: [{ id: "Yasuo", s: 1 }] })], new Set(["Yasuo", "Malphite"]));
    expect(s.Yasuo.Malphite).toBe(1);
    expect(s.Malphite.Yasuo).toBe(1);
  });
});

describe("data matchups", () => {
  // 8 heroes, every pair 100 games at 50%, except antimage (1) crushing axe (2) over 400 games.
  const names = ["antimage", "axe", "bane", "bloodseeker", "crystal_maiden", "drow_ranger", "earthshaker", "juggernaut"];
  const idByKey = new Map(names.map((n, i) => [i + 1, n] as [number, string]));
  const h2h = new Map<number, H2H>();
  for (let a = 1; a <= 8; a++) {
    const line: H2H = new Map();
    for (let b = 1; b <= 8; b++) if (a !== b) line.set(b, [100, 50]);
    h2h.set(a, line);
  }
  h2h.get(1)!.set(2, [400, 280]);
  h2h.get(2)!.set(1, [400, 120]);
  const plain = () => dataMatchups({ idByKey, h2h, pairs: new Map(), minDataAdv: 0 });

  it("finds the lopsided pair and mirrors it with n", () => {
    const { matchups } = plain();
    // Base rates include the pair itself, which dampens it in a tiny roster (negligible with ~126 opponents).
    expect(matchups.antimage.axe.adv).toBeGreaterThan(0.08);
    expect(matchups.axe.antimage).toEqual({ adv: -matchups.antimage.axe.adv, n: 400 });
  });
  it("matches the shared helper formula", () => {
    const { matchups } = plain();
    const baseA = (6 * 50 + 280) / 1000;
    const baseB = (6 * 50 + 120) / 1000;
    expect(matchups.antimage.axe.adv).toBeCloseTo(dataAdv(excessWins(400, 280, baseA, baseB), 400), 3);
  });
  it("shrinks toward curated priors and keeps their lane flag", () => {
    const before = plain().matchups.bane.bloodseeker?.adv ?? 0;
    const pairs = curatedPairs([champ("bane", { strongVs: [{ id: "bloodseeker", s: 2, lane: true }] })]);
    const { matchups, stats } = dataMatchups({ idByKey, h2h, pairs, minDataAdv: 0.05 });
    expect(matchups.bane.bloodseeker.adv).toBeGreaterThan(before + 0.1);
    expect(matchups.bane.bloodseeker).toMatchObject({ n: 100, lane: true });
    expect(matchups.bloodseeker.bane.adv).toBe(-matchups.bane.bloodseeker.adv);
    expect(stats.blendedPairs).toBe(1);
  });
  it("drops weak data-only cells below the floor", () => {
    const { matchups, stats } = dataMatchups({ idByKey, h2h, pairs: new Map(), minDataAdv: 0.05 });
    expect(matchups.bane?.juggernaut).toBeUndefined();
    expect(matchups.antimage.axe).toBeDefined();
    expect(stats.droppedPairs).toBeGreaterThan(0);
    expect(stats.dataPairs + stats.droppedPairs).toBe((8 * 7) / 2);
  });
});

describe("normalizeCurated", () => {
  const ids = new Set(["Malphite", "Yasuo", "Sylas", "Kennen"]);
  const good = {
    id: "Malphite",
    roles: ["top", "support", "adc"],
    damage: "magic",
    range: "melee",
    attributes: { ...emptyAttributes(), engage: 3, frontline: 3 },
    powerCurve: { early: 1, mid: 3, late: 2 },
    archetypes: ["engage", "wombo"],
    strongVs: [{ id: "Yasuo", s: 2, lane: true }, { id: "Nobody", s: 3 }, { id: "Kennen", s: 1 }],
    weakVs: [{ id: "Sylas", s: 2 }, { id: "Kennen", s: 2 }, { id: "Malphite", s: 1 }],
    synergies: [{ id: "Yasuo", s: 3 }, { id: "Yasuo", s: 2 }],
    meta: { top: "B", mid: "A", support: "Z" },
    difficulty: 1,
    notes: "  Point-and-click engage.  ",
  };
  it("keeps a usable entry and drops only the bad parts", () => {
    const { value, problems } = normalizeCurated(good, "lol", ids);
    expect(value).not.toBeNull();
    expect(value!.roles).toEqual(["top", "support"]);
    expect(value!.archetypes).toEqual(["engage"]);
    expect(value!.strongVs).toEqual([{ id: "Yasuo", s: 2, lane: true }]);
    expect(value!.weakVs).toEqual([{ id: "Sylas", s: 2 }]);
    expect(value!.synergies).toEqual([{ id: "Yasuo", s: 3 }]);
    expect(value!.meta).toEqual({ top: "B" });
    expect(value!.notes).toBe("Point-and-click engage.");
    expect(problems.length).toBeGreaterThan(0);
  });
  it("rejects entries with unusable core fields or unknown ids", () => {
    expect(normalizeCurated({ ...good, damage: "true" }, "lol", ids).value).toBeNull();
    expect(normalizeCurated({ ...good, id: "Nobody" }, "lol", ids).value).toBeNull();
    expect(normalizeCurated({ ...good, roles: ["pos1"] }, "lol", ids).value).toBeNull();
    expect(normalizeCurated(null, "lol", ids).value).toBeNull();
  });
  it("fills missing attributes with 0 and reports them", () => {
    const { value, problems } = normalizeCurated({ ...good, attributes: { engage: 3 } }, "lol", ids);
    expect(value!.attributes.engage).toBe(3);
    expect(value!.attributes.poke).toBe(0);
    expect(problems.some((p) => p.includes("attributes missing"))).toBe(true);
  });
});

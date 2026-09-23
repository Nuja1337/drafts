import { describe, expect, it } from "vitest";
import {
  blendTiers,
  compareVersions,
  deriveArchetypes,
  deriveDotaChampion,
  deriveLolChampion,
  dotaMetaNumbers,
  dotaRolesFromTags,
  lolMeta,
  lolRolesFromTags,
  mergeCurated,
  tiersByPercentile,
  type OpenDotaHeroStat,
} from "./derive";
import { emptyAttributes } from "./games";
import type { CuratedChampion, Tier } from "./types";

const ddragon = (over: Partial<Parameters<typeof deriveLolChampion>[0]> = {}) => ({
  id: "Jinx",
  key: "222",
  name: "Jinx",
  title: "the Loose Cannon",
  tags: ["Marksman"],
  info: { attack: 9, defense: 2, magic: 4, difficulty: 6 },
  partype: "Mana",
  image: { full: "Jinx.png" },
  stats: { attackrange: 525 },
  ...over,
});

describe("deriveLolChampion", () => {
  it("builds a complete uncurated champion from Data Dragon fields", () => {
    const c = deriveLolChampion(ddragon(), "16.18.1");
    expect(c).toMatchObject({ id: "Jinx", key: 222, curated: false, roles: ["bot"], damage: "physical", range: "ranged", difficulty: 2 });
    expect(c.image).toBe("https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Jinx.png");
    expect(c.meta).toEqual({ bot: { tier: "B" } });
    expect(c.attributes.dps).toBe(3);
    expect(c.powerCurve.late).toBeGreaterThanOrEqual(c.powerCurve.early);
    expect(c.archetypes.length).toBeGreaterThan(0);
    for (const v of Object.values(c.attributes)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(3);
  });
  it("reads tanks/supports as magic melee frontliners", () => {
    const leona = deriveLolChampion(
      ddragon({ id: "Leona", key: "89", name: "Leona", tags: ["Tank", "Support"], info: { attack: 4, defense: 8, magic: 3, difficulty: 4 }, stats: { attackrange: 125 } }),
      "16.18.1",
    );
    expect(leona).toMatchObject({ roles: ["support", "top"], damage: "magic", range: "melee" });
    expect(leona.attributes.frontline).toBe(3);
    expect(leona.archetypes).toContain("engage");
  });
  it("falls back sensibly when info ratings are missing", () => {
    const c = deriveLolChampion(ddragon({ id: "NewMage", key: "999", tags: ["Mage"], info: { attack: 0, defense: 0, magic: 0, difficulty: 0 }, stats: undefined }), "16.19.1");
    expect(c).toMatchObject({ roles: ["mid"], damage: "magic", range: "ranged", difficulty: 2 });
  });
  it("maps tags to roles", () => {
    expect(lolRolesFromTags(["Fighter"])).toEqual(["top"]);
    expect(lolRolesFromTags(["Assassin", "Fighter"])).toEqual(["mid", "jungle"]);
    expect(lolRolesFromTags(["Mage", "Support"])).toEqual(["support", "mid"]);
    expect(lolRolesFromTags([])).toEqual(["mid"]);
  });
});

const hero = (over: Partial<OpenDotaHeroStat> = {}): OpenDotaHeroStat => ({
  id: 1,
  name: "npc_dota_hero_antimage",
  localized_name: "Anti-Mage",
  primary_attr: "agi",
  attack_type: "Melee",
  roles: ["Carry", "Escape", "Nuker"],
  img: "/apps/dota2/images/dota_react/heroes/antimage.png?",
  pro_pick: 10,
  pro_win: 6,
  pro_ban: 5,
  "6_pick": 1000,
  "6_win": 520,
  "7_pick": 500,
  "7_win": 250,
  "8_pick": 0,
  "8_win": 0,
  ...over,
});

describe("deriveDotaChampion", () => {
  it("builds ids, images and positions from OpenDota", () => {
    const c = deriveDotaChampion(hero());
    expect(c).toMatchObject({ id: "antimage", key: 1, name: "Anti-Mage", range: "melee", curated: false, damage: "mixed" });
    expect(c.image).toBe("https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/antimage.png");
    expect(c.roles[0]).toBe("pos1");
    expect(c.attributes.mobility).toBe(2);
  });
  it("puts supports in pos4/pos5 and durable initiators in pos3", () => {
    expect(dotaRolesFromTags(["Support", "Disabler", "Nuker"], "int")[0]).toBe("pos5");
    expect(dotaRolesFromTags(["Initiator", "Durable", "Disabler"], "str")[0]).toBe("pos3");
    expect(dotaRolesFromTags(["Carry", "Escape", "Nuker"], "agi")).not.toContain("pos5");
  });
});

describe("meta helpers", () => {
  it("computes pub/pro numbers and ranks stronger heroes higher", () => {
    const rows = [
      hero(),
      hero({ id: 2, name: "npc_dota_hero_axe", "6_win": 450, "7_win": 220, pro_pick: 1, pro_win: 0, pro_ban: 0 }),
      hero({ id: 3, name: "npc_dota_hero_bane", "6_win": 560, "7_win": 280, pro_pick: 30, pro_win: 20, pro_ban: 40 }),
    ];
    const m = dotaMetaNumbers(rows);
    expect(m.get(1)!.winRate).toBeGreaterThan(0.5);
    expect(m.get(1)!.games).toBe(1500);
    expect(m.get(3)!.score).toBeGreaterThan(m.get(1)!.score);
    expect(m.get(1)!.score).toBeGreaterThan(m.get(2)!.score);
    expect(m.get(3)!.banRate).toBeLessThanOrEqual(1);
  });
  it("assigns tiers by percentile with the documented shares", () => {
    const scores = new Map(Array.from({ length: 100 }, (_, i) => [i, 100 - i] as [number, number]));
    const tiers = tiersByPercentile(scores);
    const count = (t: Tier) => [...tiers.values()].filter((x) => x === t).length;
    expect([count("S"), count("A"), count("B"), count("C"), count("D")]).toEqual([5, 20, 40, 25, 10]);
    expect(tiers.get(0)).toBe("S");
    expect(tiers.get(99)).toBe("D");
  });
  it("blends tiers, rounding ties toward the preferred one", () => {
    expect(blendTiers("S", "B")).toBe("A");
    expect(blendTiers("A", "B", "B")).toBe("B");
    expect(blendTiers("A", "B", "A")).toBe("A");
    expect(blendTiers("C", "C")).toBe("C");
  });
  it("compares versions numerically", () => {
    expect(compareVersions("16.10.1", "16.9.1")).toBeGreaterThan(0);
    expect(compareVersions("16.18.1", "16.18.1")).toBe(0);
    expect(compareVersions("15.24.1", "16.1.1")).toBeLessThan(0);
  });
});

describe("mergeCurated", () => {
  const curated: CuratedChampion = {
    id: "Jinx",
    roles: ["bot"],
    damage: "physical",
    range: "ranged",
    attributes: { ...emptyAttributes(), dps: 3, siege: 2, waveclear: 2 },
    powerCurve: { early: 1, mid: 2, late: 3 },
    archetypes: ["protect", "scaling"],
    strongVs: [],
    weakVs: [],
    synergies: [],
    meta: { bot: "A" },
    difficulty: 2,
    notes: "Hyper-carry.",
  };
  it("overrides derived fields and marks the champion curated", () => {
    const base = deriveLolChampion(ddragon(), "16.18.1");
    const merged = mergeCurated(base, curated);
    expect(merged).toMatchObject({ curated: true, archetypes: ["protect", "scaling"], notes: "Hyper-carry.", image: base.image, key: 222 });
    expect(merged.attributes.waveclear).toBe(2);
    expect(lolMeta(merged, curated)).toEqual({ bot: { tier: "A" } });
    expect(lolMeta({ ...merged, roles: ["bot", "mid"] }, curated)).toEqual({ bot: { tier: "A" }, mid: { tier: "B" } });
  });
  it("derives archetypes for any attribute profile", () => {
    expect(deriveArchetypes("lol", emptyAttributes(), { early: 0, mid: 0, late: 0 }).length).toBeGreaterThan(0);
  });
});

// Small hand-written LoL bundle (32 champions) with plausible attributes, tiers, lane matchups and synergies,
// plus a team profile for each side. adv values follow matchupMath.REL_ADV (slight 0.12, clear 0.25, hard 0.4).
import { bundle, team } from "./build";
import type { ChampSpec, MatchupSpec, SynergySpec } from "./build";

const P = "physical" as const;
const M = "magic" as const;
const X = "mixed" as const;

export const LOL_CHAMPS: ChampSpec[] = [
  // Top
  { id: "Darius", roles: ["top"], damage: P, range: "melee", attrs: { frontline: 2, dps: 2, sustain: 2, splitpush: 2, cc: 1 }, curve: [3, 2, 1], arch: ["skirmish", "early"], meta: { top: "A" } },
  { id: "Garen", roles: ["top"], damage: P, range: "melee", attrs: { frontline: 2, dps: 2, splitpush: 2, sustain: 1, burst: 1 }, curve: [2, 2, 1], arch: ["skirmish", "split"], meta: { top: "B" }, difficulty: 1 },
  { id: "Malphite", roles: ["top", "support", "mid"], damage: M, range: "melee", attrs: { engage: 3, frontline: 3, cc: 2, burst: 2, peel: 1 }, curve: [1, 3, 2], arch: ["engage", "dive"], meta: { top: "B", support: "C", mid: "C" }, difficulty: 1 },
  { id: "Fiora", roles: ["top"], damage: P, range: "melee", attrs: { splitpush: 3, dps: 3, mobility: 2, sustain: 2 }, curve: [2, 2, 3], arch: ["split", "skirmish"], meta: { top: "A" }, difficulty: 3 },
  { id: "Jax", roles: ["top", "jungle"], damage: X, range: "melee", attrs: { splitpush: 3, dps: 3, mobility: 2, cc: 1 }, curve: [1, 2, 3], arch: ["split", "skirmish"], meta: { top: "A", jungle: "C" } },
  { id: "Ornn", roles: ["top"], damage: M, range: "melee", attrs: { frontline: 3, engage: 2, cc: 2, peel: 1 }, curve: [2, 2, 3], arch: ["engage", "protect"], meta: { top: "A" } },
  { id: "Kennen", roles: ["top", "mid"], damage: M, range: "ranged", attrs: { engage: 2, cc: 2, burst: 2, poke: 1, mobility: 1 }, curve: [2, 2, 2], arch: ["engage", "dive"], meta: { top: "B", mid: "C" } },
  { id: "KSante", name: "K'Sante", roles: ["top"], damage: P, range: "melee", attrs: { frontline: 3, cc: 2, engage: 1, peel: 1 }, curve: [1, 2, 3], arch: ["engage", "protect"], meta: { top: "B" }, difficulty: 3 },
  { id: "Gragas", roles: ["jungle", "top", "mid", "support"], damage: M, range: "melee", attrs: { engage: 2, disengage: 2, cc: 2, frontline: 2, burst: 1 }, curve: [2, 2, 2], arch: ["engage", "pick"], meta: { jungle: "B", top: "B", mid: "C", support: "C" } },
  // Jungle
  { id: "LeeSin", name: "Lee Sin", roles: ["jungle"], damage: P, range: "melee", attrs: { mobility: 3, pick: 2, burst: 2, engage: 1 }, curve: [3, 2, 1], arch: ["early", "pick", "dive"], meta: { jungle: "A" }, difficulty: 3 },
  { id: "Sejuani", roles: ["jungle"], damage: M, range: "melee", attrs: { engage: 3, cc: 3, frontline: 3 }, curve: [2, 3, 2], arch: ["engage"], meta: { jungle: "A" } },
  { id: "Vi", roles: ["jungle"], damage: P, range: "melee", attrs: { engage: 2, pick: 2, burst: 2, cc: 2 }, curve: [2, 3, 1], arch: ["dive", "pick"], meta: { jungle: "B" } },
  { id: "Graves", roles: ["jungle"], damage: P, range: "ranged", attrs: { dps: 2, burst: 2, mobility: 1, waveclear: 1 }, curve: [2, 3, 2], arch: ["skirmish", "early"], meta: { jungle: "B" } },
  // Mid
  { id: "Ahri", roles: ["mid"], damage: M, range: "ranged", attrs: { mobility: 3, pick: 3, burst: 2, cc: 1, waveclear: 1 }, curve: [2, 2, 2], arch: ["pick", "dive"], meta: { mid: "A" } },
  { id: "Zed", roles: ["mid"], damage: P, range: "melee", attrs: { burst: 3, mobility: 2, splitpush: 2, pick: 2 }, curve: [2, 3, 2], arch: ["pick", "split"], meta: { mid: "B" }, difficulty: 3 },
  { id: "Orianna", roles: ["mid"], damage: M, range: "ranged", attrs: { waveclear: 2, peel: 2, burst: 2, cc: 2, poke: 1, dps: 1 }, curve: [1, 2, 3], arch: ["engage", "protect", "scaling"], meta: { mid: "B" } },
  { id: "Syndra", roles: ["mid"], damage: M, range: "ranged", attrs: { burst: 3, poke: 2, cc: 2, waveclear: 2 }, curve: [2, 2, 2], arch: ["pick", "poke"], meta: { mid: "A" } },
  { id: "Yasuo", roles: ["mid", "top", "bot"], damage: P, range: "melee", attrs: { dps: 2, mobility: 2, splitpush: 2, burst: 1, cc: 1 }, curve: [1, 2, 3], arch: ["skirmish", "engage"], meta: { mid: "B", top: "C", bot: "C" }, difficulty: 3 },
  { id: "Xerath", roles: ["mid", "support"], damage: M, range: "ranged", attrs: { poke: 3, siege: 3, waveclear: 2, burst: 2, cc: 1 }, curve: [2, 2, 2], arch: ["poke"], meta: { mid: "B", support: "B" } },
  { id: "Viktor", roles: ["mid"], damage: M, range: "ranged", attrs: { waveclear: 3, dps: 2, poke: 2, siege: 2, cc: 1 }, curve: [1, 2, 3], arch: ["poke", "scaling"], meta: { mid: ["A", 0.52, 20000] } },
  // Bot
  { id: "Jinx", roles: ["bot"], damage: P, range: "ranged", attrs: { dps: 3, siege: 2, waveclear: 2 }, curve: [1, 2, 3], arch: ["protect", "scaling"], meta: { bot: "A" } },
  { id: "Caitlyn", roles: ["bot"], damage: P, range: "ranged", attrs: { siege: 3, poke: 2, dps: 2, pick: 1 }, curve: [3, 2, 2], arch: ["poke", "early", "push"], meta: { bot: "B" } },
  { id: "Ezreal", roles: ["bot"], damage: P, range: "ranged", attrs: { poke: 3, mobility: 2, dps: 1 }, curve: [1, 2, 2], arch: ["poke"], meta: { bot: "B" }, difficulty: 3 },
  { id: "Kaisa", name: "Kai'Sa", roles: ["bot"], damage: X, range: "ranged", attrs: { dps: 2, burst: 2, mobility: 2 }, curve: [1, 2, 3], arch: ["dive", "skirmish"], meta: { bot: "A" } },
  { id: "Varus", roles: ["bot", "mid"], damage: P, range: "ranged", attrs: { poke: 3, cc: 2, siege: 2, dps: 2 }, curve: [2, 2, 2], arch: ["poke", "pick"], meta: { bot: "B", mid: "C" } },
  // Support
  { id: "Leona", roles: ["support"], damage: M, range: "melee", attrs: { engage: 3, cc: 3, frontline: 2, pick: 1 }, curve: [3, 2, 1], arch: ["engage", "early"], meta: { support: "A" } },
  { id: "Thresh", roles: ["support"], damage: M, range: "ranged", attrs: { pick: 3, cc: 2, peel: 2, engage: 2, disengage: 1 }, curve: [2, 2, 2], arch: ["pick", "engage"], meta: { support: "A" }, difficulty: 3 },
  { id: "Janna", roles: ["support"], damage: M, range: "ranged", attrs: { disengage: 3, peel: 3, sustain: 1 }, curve: [1, 2, 2], arch: ["protect"], meta: { support: "B" } },
  { id: "Lulu", roles: ["support"], damage: M, range: "ranged", attrs: { peel: 3, sustain: 2, disengage: 2, cc: 1 }, curve: [1, 2, 3], arch: ["protect"], meta: { support: "B" } },
  { id: "Nautilus", roles: ["support"], damage: M, range: "melee", attrs: { engage: 3, cc: 3, frontline: 2, pick: 2 }, curve: [2, 2, 1], arch: ["engage", "pick"], meta: { support: "B" } },
  { id: "Pyke", roles: ["support"], damage: P, range: "melee", attrs: { pick: 3, burst: 2, mobility: 2, engage: 1, cc: 1 }, curve: [2, 3, 1], arch: ["pick", "early"], meta: { support: "C" }, difficulty: 3 },
  { id: "Soraka", roles: ["support"], damage: M, range: "ranged", attrs: { sustain: 3, peel: 1, poke: 1 }, curve: [1, 2, 3], arch: ["protect", "scaling"], meta: { support: "C" } },
];

export const LOL_MATCHUPS: MatchupSpec[] = [
  // Top lane
  ["Darius", "Garen", 0.25, true],
  ["Darius", "KSante", 0.12, true],
  ["Darius", "Jax", 0.12, true],
  ["Darius", "Ornn", 0.12, true],
  ["Kennen", "Darius", 0.25, true],
  ["Kennen", "Malphite", 0.25, true],
  ["Kennen", "Ornn", 0.12, true],
  ["Fiora", "Garen", 0.25, true],
  ["Fiora", "Ornn", 0.25, true],
  ["Fiora", "KSante", 0.25, true],
  ["Malphite", "Yasuo", 0.4, true],
  ["Malphite", "Jax", 0.25, true],
  ["Malphite", "Fiora", 0.12, true],
  ["Jax", "Garen", 0.12, true],
  ["Gragas", "Darius", 0.12, true],
  ["Ornn", "Garen", 0.12, true],
  // Jungle
  ["LeeSin", "Sejuani", 0.25, true],
  ["Graves", "Sejuani", 0.25, true],
  ["Vi", "Graves", 0.12, true],
  ["Sejuani", "Vi", 0.12, true],
  ["LeeSin", "Gragas", 0.12, true],
  // Mid lane
  ["Zed", "Xerath", 0.4, true],
  ["Zed", "Viktor", 0.25, true],
  ["Zed", "Orianna", 0.12, true],
  ["Syndra", "Zed", 0.12, true],
  ["Ahri", "Xerath", 0.25, true],
  ["Ahri", "Viktor", 0.12, true],
  ["Yasuo", "Xerath", 0.25, true],
  ["Syndra", "Yasuo", 0.25, true],
  ["Orianna", "Yasuo", 0.12, true],
  ["Viktor", "Orianna", 0.12, true],
  // Bot lane (2v2)
  ["Caitlyn", "Jinx", 0.25, true],
  ["Caitlyn", "Kaisa", 0.12, true],
  ["Varus", "Ezreal", 0.12, true],
  ["Kaisa", "Jinx", 0.12, true],
  ["Leona", "Ezreal", 0.12, true],
  // Support
  ["Janna", "Leona", 0.25, true],
  ["Lulu", "Leona", 0.12, true],
  ["Leona", "Xerath", 0.4, true],
  ["Nautilus", "Xerath", 0.25, true],
  ["Nautilus", "Lulu", 0.12, true],
  ["Thresh", "Janna", 0.12, true],
  ["Leona", "Pyke", 0.12, true],
  // Teamfight / kit interactions
  ["Janna", "Malphite", 0.12],
  ["Lulu", "Zed", 0.12],
  ["Soraka", "Xerath", -0.12],
];

export const LOL_SYNERGIES: SynergySpec[] = [
  ["Yasuo", "Malphite", 1],
  ["Yasuo", "Gragas", 0.66],
  ["Yasuo", "Sejuani", 0.33],
  ["Orianna", "Malphite", 0.66],
  ["Orianna", "Sejuani", 0.66],
  ["Jinx", "Lulu", 1],
  ["Jinx", "Janna", 0.66],
  ["Kaisa", "Nautilus", 0.66],
  ["Kaisa", "Leona", 0.66],
  ["Caitlyn", "Thresh", 0.33],
  ["Xerath", "Caitlyn", 0.33],
  ["Vi", "Ahri", 0.33],
  ["LeeSin", "Orianna", 0.33],
];

export const lolBundle = () => bundle("lol", LOL_CHAMPS, LOL_MATCHUPS, LOL_SYNERGIES);

/** Our team: a protect/engage roster with clear mains and pools. */
export const lolBlueTeam = () =>
  team(
    "lol",
    "t-blue",
    "Aurora",
    [
      {
        id: "p-top",
        name: "Tank",
        roles: [["top", "main"], ["support", "fill"]],
        pool: [["Ornn", 5], ["KSante", 4], ["Malphite", 3], ["Gragas", 3]],
        playstyles: ["tank", "teamfighter"],
        strengths: ["teamfighting"],
        weaknesses: ["vs-ranged"],
        avoid: [["Kennen", 3], ["Fiora", 2]],
      },
      {
        id: "p-jg",
        name: "Hunter",
        roles: [["jungle", "main"], ["top", "secondary"]],
        pool: [["Sejuani", 5], ["Vi", 4], ["Gragas", 4, ["jungle"]], ["LeeSin", 2]],
        playstyles: ["playmaker"],
        strengths: ["early-game"],
      },
      {
        id: "p-mid",
        name: "Mage",
        roles: [["mid", "main"], ["support", "secondary"]],
        pool: [["Ahri", 5], ["Orianna", 4], ["Viktor", 3]],
        playstyles: ["control-mage", "roamer"],
        strengths: ["late-game"],
        weaknesses: ["vs-burst"],
        avoid: [["Zed", 3], ["Yasuo", 2]],
      },
      {
        id: "p-bot",
        name: "Carry",
        roles: [["bot", "main"]],
        pool: [["Jinx", 5], ["Kaisa", 3], ["Caitlyn", 2]],
        playstyles: ["hypercarry"],
        strengths: ["laning"],
        weaknesses: ["vs-poke"],
        avoid: [["Varus", 2]],
      },
      {
        id: "p-sup",
        name: "Shield",
        roles: [["support", "main"], ["mid", "fill"]],
        pool: [["Lulu", 5], ["Janna", 4], ["Thresh", 3]],
        playstyles: ["protector", "enabler"],
        strengths: ["vs-cc"],
        avoid: [["Leona", 2], ["Nautilus", 1]],
      },
    ],
    { preferredArchetypes: ["protect", "engage"], avoidArchetypes: ["split"] },
  );

/** Scouted opponent: aggressive early-game roster. */
export const lolRedTeam = () =>
  team(
    "lol",
    "t-red",
    "Rivals",
    [
      { id: "r-top", name: "Brick", roles: [["top", "main"]], pool: [["Darius", 5], ["Garen", 4], ["Fiora", 3]], playstyles: ["aggressive"] },
      { id: "r-jg", name: "Wolf", roles: [["jungle", "main"]], pool: [["LeeSin", 5], ["Graves", 4], ["Vi", 3]], playstyles: ["aggressive", "playmaker"] },
      { id: "r-mid", name: "Ace", roles: [["mid", "main"]], pool: [["Zed", 5], ["Yasuo", 4], ["Syndra", 3]], playstyles: ["assassin"] },
      { id: "r-bot", name: "Bolt", roles: [["bot", "main"]], pool: [["Caitlyn", 5], ["Ezreal", 4], ["Varus", 3]], playstyles: ["aggressive"] },
      { id: "r-sup", name: "Anchor", roles: [["support", "main"]], pool: [["Leona", 5], ["Nautilus", 4], ["Thresh", 3]], playstyles: ["playmaker"] },
    ],
    { kind: "scout" },
  );

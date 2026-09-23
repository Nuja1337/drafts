// Small hand-written Dota 2 bundle (25 heroes). Matchups carry sample sizes like OpenDota-derived cells.
import { bundle, team } from "./build";
import type { ChampSpec, MatchupSpec, SynergySpec } from "./build";

const P = "physical" as const;
const M = "magic" as const;

export const DOTA_HEROES: ChampSpec[] = [
  // Pos 1
  { id: "antimage", name: "Anti-Mage", roles: ["pos1"], damage: P, range: "melee", attrs: { mobility: 3, splitpush: 3, dps: 3, waveclear: 1 }, curve: [0, 2, 3], arch: ["scaling", "split"], meta: { pos1: ["B", 0.49, 90000] } },
  { id: "juggernaut", name: "Juggernaut", roles: ["pos1"], damage: P, range: "melee", attrs: { dps: 2, sustain: 2, splitpush: 2, burst: 1, siege: 1 }, curve: [2, 2, 2], arch: ["skirmish", "push"], meta: { pos1: ["A", 0.52, 120000] } },
  { id: "medusa", name: "Medusa", roles: ["pos1", "pos2"], damage: P, range: "ranged", attrs: { dps: 3, frontline: 2, waveclear: 3 }, curve: [0, 2, 3], arch: ["scaling", "protect"], meta: { pos1: "A", pos2: "C" } },
  { id: "phantom_lancer", name: "Phantom Lancer", roles: ["pos1"], damage: P, range: "melee", attrs: { dps: 3, splitpush: 2, mobility: 2 }, curve: [1, 2, 3], arch: ["scaling", "split"], meta: { pos1: "B" } },
  { id: "faceless_void", name: "Faceless Void", roles: ["pos1", "pos3"], damage: P, range: "melee", attrs: { engage: 3, cc: 3, dps: 2, mobility: 2 }, curve: [1, 2, 3], arch: ["engage", "scaling"], meta: { pos1: "A", pos3: "C" } },
  // Pos 2
  { id: "nevermore", name: "Shadow Fiend", roles: ["pos2", "pos1"], damage: P, range: "ranged", attrs: { burst: 2, dps: 2, waveclear: 2, siege: 2 }, curve: [2, 3, 2], arch: ["skirmish", "push"], meta: { pos2: "B", pos1: "C" } },
  { id: "storm_spirit", name: "Storm Spirit", roles: ["pos2"], damage: M, range: "ranged", attrs: { mobility: 3, pick: 3, burst: 2, cc: 1 }, curve: [1, 3, 2], arch: ["pick", "dive"], meta: { pos2: "A" }, difficulty: 3 },
  { id: "puck", name: "Puck", roles: ["pos2"], damage: M, range: "ranged", attrs: { mobility: 3, disengage: 2, cc: 2, engage: 2, burst: 1 }, curve: [2, 3, 2], arch: ["pick", "engage"], meta: { pos2: "B" }, difficulty: 3 },
  { id: "invoker", name: "Invoker", roles: ["pos2"], damage: M, range: "ranged", attrs: { burst: 2, cc: 2, poke: 2, waveclear: 2, dps: 1, siege: 1 }, curve: [1, 2, 3], arch: ["pick", "scaling"], meta: { pos2: "A" }, difficulty: 3 },
  { id: "lina", name: "Lina", roles: ["pos2", "pos4", "pos1"], damage: M, range: "ranged", attrs: { burst: 3, poke: 2, waveclear: 2, siege: 1 }, curve: [2, 3, 2], arch: ["pick", "push"], meta: { pos2: "B", pos4: "B", pos1: "C" } },
  // Pos 3
  { id: "axe", name: "Axe", roles: ["pos3"], damage: P, range: "melee", attrs: { engage: 3, frontline: 2, cc: 2, pick: 1 }, curve: [3, 2, 1], arch: ["engage", "early"], meta: { pos3: "A" } },
  { id: "mars", name: "Mars", roles: ["pos3"], damage: P, range: "melee", attrs: { engage: 2, frontline: 2, cc: 2, disengage: 1 }, curve: [2, 2, 2], arch: ["engage"], meta: { pos3: "A" } },
  { id: "tidehunter", name: "Tidehunter", roles: ["pos3"], damage: M, range: "melee", attrs: { engage: 3, cc: 3, frontline: 3 }, curve: [1, 2, 2], arch: ["engage"], meta: { pos3: "B" }, difficulty: 1 },
  { id: "centaur", name: "Centaur Warrunner", roles: ["pos3"], damage: M, range: "melee", attrs: { frontline: 3, engage: 2, cc: 2, mobility: 1 }, curve: [2, 2, 2], arch: ["engage", "push"], meta: { pos3: "B" } },
  { id: "bristleback", name: "Bristleback", roles: ["pos3", "pos1"], damage: P, range: "melee", attrs: { frontline: 3, dps: 2, sustain: 1 }, curve: [2, 3, 2], arch: ["skirmish"], meta: { pos3: "B", pos1: "C" }, difficulty: 1 },
  // Pos 4
  { id: "earthshaker", name: "Earthshaker", roles: ["pos4", "pos5"], damage: M, range: "melee", attrs: { engage: 3, cc: 3, burst: 2 }, curve: [1, 2, 3], arch: ["engage", "pick"], meta: { pos4: "A", pos5: "C" } },
  { id: "rubick", name: "Rubick", roles: ["pos4"], damage: M, range: "ranged", attrs: { disengage: 2, cc: 1, pick: 2 }, curve: [2, 2, 2], arch: ["pick"], meta: { pos4: "B" }, difficulty: 3 },
  { id: "mirana", name: "Mirana", roles: ["pos4", "pos5"], damage: M, range: "ranged", attrs: { pick: 3, cc: 2, mobility: 2, poke: 1 }, curve: [2, 2, 2], arch: ["pick"], meta: { pos4: "B", pos5: "C" } },
  { id: "tusk", name: "Tusk", roles: ["pos4"], damage: M, range: "melee", attrs: { pick: 2, engage: 2, mobility: 2, cc: 1 }, curve: [3, 2, 1], arch: ["early", "pick", "dive"], meta: { pos4: "B" } },
  { id: "pudge", name: "Pudge", roles: ["pos4", "pos5"], damage: M, range: "melee", attrs: { pick: 3, frontline: 2, cc: 2 }, curve: [3, 2, 1], arch: ["pick", "early"], meta: { pos4: "A", pos5: "C" } },
  // Pos 5
  { id: "crystal_maiden", name: "Crystal Maiden", roles: ["pos5"], damage: M, range: "ranged", attrs: { cc: 2, waveclear: 2, burst: 1 }, curve: [2, 2, 1], arch: ["early", "engage"], meta: { pos5: "B" }, difficulty: 1 },
  { id: "lion", name: "Lion", roles: ["pos5", "pos4"], damage: M, range: "ranged", attrs: { burst: 3, cc: 3, pick: 2 }, curve: [2, 3, 1], arch: ["pick", "early"], meta: { pos5: "A", pos4: "B" } },
  { id: "oracle", name: "Oracle", roles: ["pos5"], damage: M, range: "ranged", attrs: { peel: 3, disengage: 3, sustain: 3 }, curve: [1, 2, 2], arch: ["protect"], meta: { pos5: "B" }, difficulty: 3 },
  { id: "dazzle", name: "Dazzle", roles: ["pos5"], damage: M, range: "ranged", attrs: { peel: 3, sustain: 3 }, curve: [2, 2, 2], arch: ["protect", "push"], meta: { pos5: "B" } },
  { id: "witch_doctor", name: "Witch Doctor", roles: ["pos5"], damage: M, range: "ranged", attrs: { cc: 2, dps: 2, burst: 1 }, curve: [2, 2, 2], arch: ["early"], meta: { pos5: "C" } },
];

export const DOTA_MATCHUPS: MatchupSpec[] = [
  // Safe lane (pos1/pos5) vs off lane (pos3/pos4)
  ["axe", "phantom_lancer", 0.4, true, 5200],
  ["axe", "juggernaut", -0.12, true, 6100],
  ["bristleback", "antimage", 0.25, true, 3100],
  ["tusk", "antimage", 0.12, true, 2400],
  ["centaur", "medusa", 0.12, true, 1800],
  ["mars", "phantom_lancer", 0.25, true, 2600],
  ["earthshaker", "phantom_lancer", 0.4, false, 4800],
  ["lion", "antimage", 0.12, false, 7000],
  ["crystal_maiden", "axe", -0.12, true, 3300],
  // Mid
  ["storm_spirit", "invoker", 0.12, true, 2200],
  ["puck", "storm_spirit", 0.12, true, 1500],
  ["nevermore", "invoker", -0.12, true, 2800],
  ["lina", "nevermore", 0.25, true, 1200],
  ["invoker", "medusa", 0.12, false, 900],
  // General interactions
  ["antimage", "storm_spirit", 0.25, false, 2000],
  ["antimage", "medusa", 0.4, false, 1600],
  ["antimage", "invoker", 0.12, false, 3000],
  ["faceless_void", "medusa", -0.12, false, 1100],
  ["oracle", "axe", 0.12, false, 1400],
  ["dazzle", "juggernaut", 0.12, false, 900],
  ["rubick", "tidehunter", 0.25, false, 800],
  // A thin sample: shrunk further by the engine and labeled "low sample".
  ["pudge", "storm_spirit", 0.25, false, 12],
];

export const DOTA_SYNERGIES: SynergySpec[] = [
  ["faceless_void", "invoker", 0.66],
  ["faceless_void", "witch_doctor", 0.66],
  ["medusa", "dazzle", 0.66],
  ["juggernaut", "dazzle", 0.33],
  ["tusk", "storm_spirit", 0.33],
  ["earthshaker", "tidehunter", 0.66],
  ["lion", "tusk", 0.33],
];

export const dotaBundle = () => bundle("dota2", DOTA_HEROES, DOTA_MATCHUPS, DOTA_SYNERGIES);

export const dotaRadiantTeam = () =>
  team("dota2", "d-rad", "Radiant Stack", [
    { id: "d1", name: "Carry", roles: [["pos1", "main"]], pool: [["antimage", 5], ["juggernaut", 4], ["medusa", 3]], playstyles: ["hypercarry"] },
    { id: "d2", name: "Mid", roles: [["pos2", "main"]], pool: [["invoker", 5], ["storm_spirit", 3]], playstyles: ["playmaker"] },
    { id: "d3", name: "Offlane", roles: [["pos3", "main"]], pool: [["axe", 5], ["mars", 4]], playstyles: ["tank"] },
    { id: "d4", name: "Four", roles: [["pos4", "main"], ["pos5", "secondary"]], pool: [["earthshaker", 5], ["tusk", 3]], playstyles: ["roamer"] },
    { id: "d5", name: "Five", roles: [["pos5", "main"], ["pos4", "secondary"]], pool: [["crystal_maiden", 4], ["lion", 4], ["oracle", 3]], playstyles: ["protector"] },
  ]);

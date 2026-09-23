// Deterministic synthetic bundles at production scale for performance tests.
import { roleIds } from "../../games";
import { ARCHETYPES, ATTRIBUTE_KEYS, TIERS } from "../../types";
import type { Archetype, Attributes, GameId, Role, Tier } from "../../types";
import { bundle, team } from "./build";
import type { ChampSpec, MatchupSpec, PlayerSpec, SynergySpec } from "./build";

/** mulberry32 PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` champions; each has `matchupsPer` matchup cells (dense = every pair when matchupsPer >= count)
 * and ~6 synergies. With `samples`, cells carry n like data-derived matchups.
 */
export function syntheticBundle(game: GameId, count: number, matchupsPer: number, seed = 7, samples = false) {
  const r = rng(seed);
  const roles = roleIds(game);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const specs: ChampSpec[] = [];
  for (let i = 0; i < count; i++) {
    const primary = roles[i % roles.length];
    const champRoles: Role[] = [primary];
    if (r() < 0.35) champRoles.push(pick(roles.filter((x) => x !== primary)));
    const attrs: Partial<Attributes> = {};
    for (const k of ATTRIBUTE_KEYS) {
      const x = r();
      attrs[k] = x < 0.45 ? 0 : x < 0.75 ? 1 : x < 0.93 ? 2 : 3;
    }
    const meta: Record<Role, Tier | [Tier, number, number?]> = {};
    for (const role of champRoles) meta[role] = r() < 0.5 ? pick(TIERS) : [pick(TIERS), 0.45 + r() * 0.1, Math.floor(r() * 50000)];
    const arch: Archetype[] = [pick(ARCHETYPES), pick(ARCHETYPES)].filter((a, j, xs) => xs.indexOf(a) === j);
    specs.push({
      id: `C${i}`,
      name: `Champ ${i}`,
      roles: champRoles,
      damage: r() < 0.45 ? "physical" : r() < 0.9 ? "magic" : "mixed",
      range: r() < 0.5 ? "melee" : "ranged",
      attrs,
      curve: [Math.floor(r() * 4), Math.floor(r() * 4), Math.floor(r() * 4)],
      arch,
      meta,
      difficulty: 1 + Math.floor(r() * 3),
    });
  }
  const matchups: MatchupSpec[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < matchupsPer; k++) {
      const j = matchupsPer >= count ? k : Math.floor(r() * count);
      if (j === i) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matchups.push([`C${i}`, `C${j}`, Math.round((r() * 2 - 1) * 0.5 * 1000) / 1000, r() < 0.4, samples ? Math.floor(r() * 5000) : undefined]);
    }
  }
  const synergies: SynergySpec[] = [];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) synergies.push([`C${i}`, `C${Math.floor(r() * count)}`, Math.round(r() * 100) / 100 || 0.1]);
  return bundle(game, specs, matchups, synergies.filter(([a, b]) => a !== b));
}

/** A full 5-player (+2 subs) roster with large pools, for worst-case assignment cost. */
export function syntheticTeam(game: GameId, count: number, seed = 11, id = "syn") {
  const r = rng(seed);
  const roles = roleIds(game);
  const players: PlayerSpec[] = [];
  for (let p = 0; p < 7; p++) {
    const main = roles[p % roles.length];
    const pool: PlayerSpec["pool"] = [];
    for (let k = 0; k < 15; k++) pool.push([`C${Math.floor(r() * count)}`, (1 + Math.floor(r() * 5)) as 1 | 2 | 3 | 4 | 5]);
    players.push({
      id: `${id}-p${p}`,
      name: `Player ${p}`,
      roles: [[main, "main"], [roles[(p + 1) % roles.length], "secondary"], [roles[(p + 2) % roles.length], "fill"]],
      pool: pool.filter(([c], i) => pool.findIndex(([d]) => d === c) === i),
      playstyles: ["aggressive", "teamfighter"],
      strengths: ["laning", "early-game"],
      weaknesses: ["vs-poke", "vs-burst"],
      avoid: [[`C${Math.floor(r() * count)}`, 3], [`C${Math.floor(r() * count)}`, 2]],
    });
  }
  return team(game, id, `Synthetic ${id}`, players, {
    preferredArchetypes: ["engage", "protect"],
    avoidArchetypes: ["split"],
    overrides: [{ a: "C1", b: "C2", adv: 0.3 }, { a: "C3", b: "C4", adv: -0.2 }],
  });
}

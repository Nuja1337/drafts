// Per-call context: validated input, derived turn order, per-side state, and a per-bundle index (cached).
import { GAMES, playstyleDef, roleIds, traitDef } from "../games";
import type { PlaystyleDef, TraitDef } from "../games";
import type { DraftAction, DraftFormat } from "../room";
import { ATTRIBUTE_KEYS, otherSide } from "../types";
import type {
  ActionType,
  AvoidEntry,
  Champion,
  GameDataBundle,
  GameId,
  PlayerProfile,
  PoolEntry,
  Role,
  RolePrefLevel,
  Side,
  TeamProfile,
} from "../types";
import { clamp } from "./explain";
import { poolRoleOk } from "./roles";
import { DEFAULT_TARGETS, MAX_PLAYERS } from "./tuning";
import { DEFAULT_WEIGHTS } from "./types";
import type { EngineInput, EngineWeights } from "./types";

export const N_ATTR = ATTRIBUTE_KEYS.length;
export const ATTR_INDEX: Record<string, number> = Object.fromEntries(ATTRIBUTE_KEYS.map((k, i) => [k, i]));

/** Sanitized numeric view of a champion (attributes as a dense array in ATTRIBUTE_KEYS order). */
export interface ChampInfo {
  c: Champion;
  a: number[];
  /** Physical damage share: physical 1, magic 0, mixed 0.5. */
  phys: number;
  /** [early, mid, late] */
  curve: [number, number, number];
}

export interface AvgProfile {
  a: number[];
  phys: number;
  curve: [number, number, number];
}

export interface BundleIndex {
  list: ChampInfo[];
  info: Map<string, ChampInfo>;
  /** "Typical complete comp" attribute sums, dense. */
  targets: number[];
  roleAvg: Map<Role, AvgProfile>;
  allAvg: AvgProfile;
}

export interface Step {
  side: Side;
  type: ActionType;
  done: boolean;
}

export interface PlayerInfo {
  profile: PlayerProfile;
  name: string;
  pool: Map<string, PoolEntry>;
  avoid: Map<string, AvoidEntry>;
  prefs: Map<Role, RolePrefLevel>;
  hasPrefs: boolean;
  styles: PlaystyleDef[];
  strengths: TraitDef[];
  weaknesses: TraitDef[];
  mechanics: boolean;
  /** Pool entries that cover each role (explicit entry roles, else the champion's data roles). */
  poolInRole: Map<Role, number>;
}

export interface Ctx {
  game: GameId;
  roles: Role[];
  data: GameDataBundle;
  idx: BundleIndex;
  weights: EngineWeights;
  limit: number;
  perspective: Side;
  enemy: Side;
  steps: Step[];
  next: { index: number; type: ActionType; side: Side } | null;
  picks: Record<Side, string[]>;
  bans: string[];
  /** Picked or banned this game. */
  taken: Set<string>;
  /** Not pickable by that side (taken + fearless/extra). */
  unavailable: Record<Side, Set<string>>;
  teams: Record<Side, TeamProfile | null>;
  players: Record<Side, PlayerInfo[]>;
  /** Perspective team's matchup overrides: key `${a}\u0001${b}` → adv of a over b. */
  overrides: Map<string, number>;
  /** Overrides listed per champion from that champion's point of view. */
  overridesBy: Map<string, { id: string; adv: number }[]>;
}

const num = (x: unknown, fallback = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
const PHYS: Record<string, number> = { physical: 1, magic: 0, mixed: 0.5 };

function champInfo(c: Champion): ChampInfo {
  const src = (c.attributes ?? {}) as Partial<Record<string, unknown>>;
  const a = ATTRIBUTE_KEYS.map((k) => clamp(num(src[k]), 0, 3));
  const pc = c.powerCurve ?? { early: 1.5, mid: 1.5, late: 1.5 };
  return {
    c,
    a,
    phys: PHYS[c.damage] ?? 0.5,
    curve: [clamp(num(pc.early, 1.5), 0, 3), clamp(num(pc.mid, 1.5), 0, 3), clamp(num(pc.late, 1.5), 0, 3)],
  };
}

function average(infos: ChampInfo[]): AvgProfile {
  const a = new Array<number>(N_ATTR).fill(0);
  const curve: [number, number, number] = [0, 0, 0];
  let phys = 0;
  for (const i of infos) {
    for (let k = 0; k < N_ATTR; k++) a[k] += i.a[k];
    phys += i.phys;
    curve[0] += i.curve[0];
    curve[1] += i.curve[1];
    curve[2] += i.curve[2];
  }
  if (!infos.length) return { a: a.map(() => 1), phys: 0.5, curve: [1.5, 1.5, 1.5] };
  const n = infos.length;
  return { a: a.map((v) => v / n), phys: phys / n, curve: [curve[0] / n, curve[1] / n, curve[2] / n] };
}

const indexCache = new WeakMap<GameDataBundle, { champions: Champion[]; length: number; index: BundleIndex }>();

/** Builds (or reuses) the per-bundle index. Invalidated if the champions array is replaced or resized. */
export function bundleIndex(data: GameDataBundle): BundleIndex {
  const champions = Array.isArray(data.champions) ? data.champions : [];
  const hit = indexCache.get(data);
  if (hit && hit.champions === champions && hit.length === champions.length) return hit.index;

  const roles = roleIds(data.game);
  const info = new Map<string, ChampInfo>();
  const list: ChampInfo[] = [];
  for (const c of champions) {
    if (!c || typeof c.id !== "string" || !c.id || info.has(c.id)) continue;
    const ci = champInfo({
      ...c,
      name: typeof c.name === "string" && c.name ? c.name : c.id,
      // Keep only this game's roles, deduped, in curated order.
      roles: Array.isArray(c.roles) ? [...new Set(c.roles.filter((r) => roles.includes(r)))] : [],
      archetypes: Array.isArray(c.archetypes) ? c.archetypes : [],
      meta: c.meta && typeof c.meta === "object" ? c.meta : {},
    });
    info.set(c.id, ci);
    list.push(ci);
  }
  const allAvg = average(list);
  const roleAvg = new Map<Role, AvgProfile>();
  for (const r of roles) {
    let members = list.filter((i) => i.c.roles[0] === r);
    if (members.length < 2) members = list.filter((i) => i.c.roles.includes(r));
    roleAvg.set(r, members.length ? average(members) : allAvg);
  }
  const defaults = ATTRIBUTE_KEYS.map((k) => DEFAULT_TARGETS[k]);
  const targets =
    list.length >= 20 ? defaults.map((d, k) => 0.5 * d + 0.5 * clamp(5 * allAvg.a[k], 2.5, 9)) : defaults;
  const index: BundleIndex = { list, info, targets, roleAvg, allAvg };
  indexCache.set(data, { champions, length: champions.length, index });
  return index;
}

/** Resolves every format step to a concrete side and marks completed ones. */
export function deriveSteps(format: DraftFormat, firstSide: Side, actions: DraftAction[]): Step[] {
  const steps = Array.isArray(format?.steps) ? format.steps : [];
  const done = new Array<boolean>(steps.length).fill(false);
  for (const a of actions) if (Number.isInteger(a.index) && a.index >= 0 && a.index < steps.length) done[a.index] = true;
  const second = otherSide(firstSide);
  return steps.map((s, i) => ({ side: s.side === "first" ? firstSide : second, type: s.type === "pick" ? "pick" : "ban", done: done[i] }));
}

function sanitizeWeights(w: Partial<EngineWeights> | undefined): EngineWeights {
  const out: EngineWeights = { ...DEFAULT_WEIGHTS };
  if (w && typeof w === "object") {
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof EngineWeights)[]) {
      const v = w[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp(v, 0, 5);
    }
  }
  return out;
}

function playerInfo(p: PlayerProfile, roles: Role[], idx: BundleIndex): PlayerInfo {
  const prefs = new Map<Role, RolePrefLevel>();
  const rank: Record<RolePrefLevel, number> = { main: 3, secondary: 2, fill: 1 };
  for (const rp of Array.isArray(p.roles) ? p.roles : []) {
    if (!rp || !roles.includes(rp.role) || !(rp.pref in rank)) continue;
    const prev = prefs.get(rp.role);
    if (!prev || rank[rp.pref] > rank[prev]) prefs.set(rp.role, rp.pref);
  }
  const pool = new Map<string, PoolEntry>();
  for (const e of Array.isArray(p.pool) ? p.pool : []) {
    if (!e || typeof e.championId !== "string") continue;
    const comfort = clamp(Math.round(num(e.comfort, 3)), 1, 5) as PoolEntry["comfort"];
    const prev = pool.get(e.championId);
    if (!prev || comfort > prev.comfort) {
      const eroles = Array.isArray(e.roles) ? e.roles.filter((r) => roles.includes(r)) : undefined;
      pool.set(e.championId, { ...e, comfort, roles: eroles && eroles.length ? eroles : undefined });
    }
  }
  const avoid = new Map<string, AvoidEntry>();
  for (const e of Array.isArray(p.avoid) ? p.avoid : []) {
    if (!e || typeof e.championId !== "string") continue;
    const severity = clamp(Math.round(num(e.severity, 1)), 1, 3) as AvoidEntry["severity"];
    const prev = avoid.get(e.championId);
    if (!prev || severity > prev.severity) avoid.set(e.championId, { ...e, severity });
  }
  const ids = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : []);
  const strengths = ids(p.strengths).map(traitDef).filter((t): t is TraitDef => !!t);
  const info: PlayerInfo = {
    profile: p,
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Player",
    pool,
    avoid,
    prefs,
    hasPrefs: prefs.size > 0,
    styles: ids(p.playstyles).map(playstyleDef).filter((s): s is PlaystyleDef => !!s),
    strengths,
    weaknesses: ids(p.weaknesses).map(traitDef).filter((t): t is TraitDef => !!t),
    mechanics: strengths.some((t) => t.id === "mechanics"),
    poolInRole: new Map(),
  };
  for (const [id, e] of pool) {
    const ci = idx.info.get(id);
    if (!ci && !e.roles) continue; // unknown champion without explicit roles: no role information
    for (const r of roles) if (poolRoleOk(info, id, ci, r)) info.poolInRole.set(r, (info.poolInRole.get(r) ?? 0) + 1);
  }
  return info;
}

/** Keeps at most MAX_PLAYERS, preferring players with a main role and bigger pools (stable otherwise). */
function selectPlayers(team: TeamProfile | null, roles: Role[], idx: BundleIndex): PlayerInfo[] {
  if (!team || !Array.isArray(team.players)) return [];
  const infos = team.players.filter((p) => p && typeof p === "object" && typeof p.id === "string").map((p) => playerInfo(p, roles, idx));
  if (infos.length <= MAX_PLAYERS) return infos;
  const hasMain = (i: PlayerInfo) => [...i.prefs.values()].includes("main");
  const keep = new Set(
    infos
      .map((p, i) => ({ p, i }))
      .sort((x, y) => Number(hasMain(y.p)) - Number(hasMain(x.p)) || y.p.pool.size - x.p.pool.size || x.i - y.i)
      .slice(0, MAX_PLAYERS)
      .map((x) => x.p),
  );
  return infos.filter((p) => keep.has(p));
}

function validTeam(t: TeamProfile | null | undefined, game: GameId): TeamProfile | null {
  return t && typeof t === "object" && t.game === game ? t : null;
}

export function buildContext(input: EngineInput): Ctx {
  const data = input?.data;
  if (!data || typeof data !== "object" || !Object.hasOwn(GAMES, data.game)) throw new TypeError("analyzeDraft: input.data must be a GameDataBundle for a known game");
  const game = data.game;
  const roles = roleIds(game);
  const idx = bundleIndex(data);
  const perspective: Side = input.perspective === "red" ? "red" : "blue";
  const firstSide: Side = input.firstSide === "red" ? "red" : "blue";
  const actions = Array.isArray(input.actions) ? input.actions.filter((a) => a && typeof a === "object") : [];
  const steps = deriveSteps(input.format, firstSide, actions);
  const nextIdx = steps.findIndex((s) => !s.done);
  const next = nextIdx < 0 ? null : { index: nextIdx, type: steps[nextIdx].type, side: steps[nextIdx].side };

  const picks: Record<Side, string[]> = { blue: [], red: [] };
  const bans: string[] = [];
  const taken = new Set<string>();
  for (const a of actions) {
    const id = a.championId;
    if (typeof id !== "string" || !id || taken.has(id)) continue;
    taken.add(id);
    if (a.type === "pick") picks[a.side === "red" ? "red" : "blue"].push(id);
    else bans.push(id);
  }
  const extra = (s: Side): string[] => {
    const xs = input.unavailable?.[s];
    return Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : [];
  };
  const unavailable: Record<Side, Set<string>> = { blue: new Set([...taken, ...extra("blue")]), red: new Set([...taken, ...extra("red")]) };

  const teams: Record<Side, TeamProfile | null> = { blue: validTeam(input.teams?.blue, game), red: validTeam(input.teams?.red, game) };
  const players: Record<Side, PlayerInfo[]> = { blue: selectPlayers(teams.blue, roles, idx), red: selectPlayers(teams.red, roles, idx) };

  const overrides = new Map<string, number>();
  const overridesBy = new Map<string, { id: string; adv: number }[]>();
  for (const o of Array.isArray(teams[perspective]?.overrides) ? teams[perspective]!.overrides : []) {
    if (!o || typeof o.a !== "string" || typeof o.b !== "string" || o.a === o.b || !Number.isFinite(o.adv)) continue;
    const adv = clamp(o.adv, -1, 1);
    overrides.set(`${o.a}\u0001${o.b}`, adv);
    overrides.set(`${o.b}\u0001${o.a}`, -adv);
  }
  for (const [key, adv] of overrides) {
    const [a, b] = key.split("\u0001");
    let arr = overridesBy.get(a);
    if (!arr) overridesBy.set(a, (arr = []));
    arr.push({ id: b, adv });
  }

  const limit = Number.isFinite(input.limit) ? clamp(Math.floor(input.limit as number), 1, 200) : 12;
  return {
    game,
    roles,
    data,
    idx,
    weights: sanitizeWeights(input.weights),
    limit,
    perspective,
    enemy: otherSide(perspective),
    steps,
    next,
    picks,
    bans,
    taken,
    unavailable,
    teams,
    players,
    overrides,
    overridesBy,
  };
}

/** Display name for a champion id (falls back to the id for unknown champions). */
export const nameOf = (ctx: Ctx, id: string): string => ctx.idx.info.get(id)?.c.name ?? id;

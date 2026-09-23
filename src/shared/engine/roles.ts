// Role (and player) assignment. Picked champions go to distinct roles maximizing champion role fit plus, when a team
// profile exists, the players' role preferences and pool comfort. Champion placements are brute-forced (≤ 5! = 120);
// for each placement the player lineup is solved exactly with a DP over (role, used-player bitmask).
import type { Role, Side } from "../types";
import type { ChampInfo, Ctx, PlayerInfo } from "./context";
import {
  COMFORT_UNITS,
  FILL_BONUS,
  OFF_ROLE_FIT,
  ROLE_FIT_BY_INDEX,
  ROLE_PREF_UNITS,
  TUNING,
  UNLISTED_PREF_UNITS,
} from "./tuning";

const EPS = 1e-9;

/** Champion fit for a role in units (primary 3 … unlisted -3; unknown champions fit anywhere with 0). */
export function roleFit(ci: ChampInfo | undefined, role: Role): number {
  if (!ci) return 0;
  const i = ci.c.roles.indexOf(role);
  return i < 0 ? OFF_ROLE_FIT : ROLE_FIT_BY_INDEX[Math.min(i, ROLE_FIT_BY_INDEX.length - 1)];
}

/** Player preference for a role in units (players without any prefs are neutral everywhere). */
export function prefUnits(p: PlayerInfo, role: Role): number {
  if (!p.hasPrefs) return 0;
  const pref = p.prefs.get(role);
  return pref ? ROLE_PREF_UNITS[pref] : UNLISTED_PREF_UNITS;
}

/** Whether a player's pool entry covers the role (explicit entry roles, else the champion's data roles). */
export function poolRoleOk(p: PlayerInfo, champId: string, ci: ChampInfo | undefined, role: Role): boolean {
  const e = p.pool.get(champId);
  if (!e) return false;
  if (e.roles) return e.roles.includes(role);
  return !ci || ci.c.roles.length === 0 || ci.c.roles.includes(role);
}

export function comfortUnits(p: PlayerInfo, champId: string, ci: ChampInfo | undefined, role: Role): number {
  const e = p.pool.get(champId);
  if (!e) return 0;
  return e.comfort * COMFORT_UNITS * (poolRoleOk(p, champId, ci, role) ? 1 : TUNING.comfortOffRoleFactor);
}

export interface Lineup {
  total: number;
  /** Player index (into the side's players) per slot, or null. */
  assign: (number | null)[];
}

/**
 * Exact assignment of players to slots. `table[slot * ids.length + j]` is the value of player ids[j] in that slot;
 * leaving a slot empty is worth 0. O(slots × 2^players × players) with players ≤ MAX_PLAYERS.
 */
export function solveLineup(slots: number, ids: number[], table: Float64Array): Lineup {
  const P = ids.length;
  if (slots === 0 || P === 0) return { total: 0, assign: new Array<number | null>(slots).fill(null) };
  const M = 1 << P;
  const f = new Float64Array((slots + 1) * M);
  const choice = new Int8Array(slots * M);
  for (let i = slots - 1; i >= 0; i--) {
    const row = i * M;
    const nextRow = (i + 1) * M;
    for (let mask = 0; mask < M; mask++) {
      let best = f[nextRow + mask];
      let bc = -1;
      for (let j = 0; j < P; j++) {
        if (mask & (1 << j)) continue;
        const v = table[i * P + j] + f[nextRow + (mask | (1 << j))];
        if (v > best + EPS) {
          best = v;
          bc = j;
        }
      }
      f[row + mask] = best;
      choice[row + mask] = bc;
    }
  }
  const assign: (number | null)[] = [];
  let mask = 0;
  for (let i = 0; i < slots; i++) {
    const j = choice[i * M + mask];
    if (j >= 0) {
      assign.push(ids[j]);
      mask |= 1 << j;
    } else assign.push(null);
  }
  return { total: f[0], assign };
}

export interface SideAssign {
  /** Champion id per role index (null = open). */
  champAt: (string | null)[];
  /** Player index per role index for the full lineup (filled and open roles). */
  playerAt: (number | null)[];
  /** Sum of champion role fit of the placement. */
  champFit: number;
}

/** Enumerates injective placements of picks into allowed role indices, calling visit(placement, fitSum). */
function enumeratePlacements(fit: number[][], allowed: boolean[], visit: (roleOfPick: number[], fitSum: number) => void): void {
  const k = fit.length;
  const R = allowed.length;
  const used = new Array<boolean>(R).fill(false);
  const roleOfPick = new Array<number>(k).fill(-1);
  const rec = (i: number, sum: number): void => {
    if (i === k) {
      visit(roleOfPick, sum);
      return;
    }
    for (let r = 0; r < R; r++) {
      if (used[r] || !allowed[r]) continue;
      used[r] = true;
      roleOfPick[i] = r;
      rec(i + 1, sum + fit[i][r]);
      used[r] = false;
    }
    roleOfPick[i] = -1;
  };
  rec(0, 0);
}

/** Joint champion + player assignment for one side. */
export function assignSide(ctx: Ctx, side: Side): SideAssign {
  const roles = ctx.roles;
  const R = roles.length;
  const picks = ctx.picks[side].slice(0, R);
  const infos = picks.map((id) => ctx.idx.info.get(id));
  const fit = picks.map((_, i) => roles.map((r) => roleFit(infos[i], r)));
  const players = ctx.players[side];
  const P = players.length;
  const ids = players.map((_, j) => j);

  // base[r][p] and comfort[i][r][p] tables (units).
  const base = new Float64Array(R * P);
  for (let r = 0; r < R; r++) for (let j = 0; j < P; j++) base[r * P + j] = FILL_BONUS + prefUnits(players[j], roles[r]);
  const comfort = picks.map((id, i) => {
    const t = new Float64Array(R * P);
    for (let r = 0; r < R; r++) for (let j = 0; j < P; j++) t[r * P + j] = comfortUnits(players[j], id, infos[i], roles[r]);
    return t;
  });
  const comfortMatters = comfort.some((t) => t.some((v) => v !== 0));

  let best: { total: number; champFit: number; roleOfPick: number[]; lineup: Lineup | null } | null = null;
  const table = new Float64Array(R * P);
  const allowed = new Array<boolean>(R).fill(true);
  enumeratePlacements(fit, allowed, (roleOfPick, fitSum) => {
    let lineup: Lineup | null = null;
    let value = fitSum;
    if (P > 0 && comfortMatters) {
      table.set(base);
      for (let i = 0; i < roleOfPick.length; i++) {
        const r = roleOfPick[i];
        const c = comfort[i];
        for (let j = 0; j < P; j++) table[r * P + j] += c[r * P + j];
      }
      lineup = solveLineup(R, ids, table);
      value += lineup.total;
    }
    if (!best || value > best.total + EPS) best = { total: value, champFit: fitSum, roleOfPick: [...roleOfPick], lineup };
  });

  const chosen = best as { total: number; champFit: number; roleOfPick: number[]; lineup: Lineup | null } | null;
  const champAt = new Array<string | null>(R).fill(null);
  chosen?.roleOfPick.forEach((r, i) => (champAt[r] = picks[i]));
  // Without pool comfort on the picks, the lineup doesn't depend on the placement: solve it once.
  const lineup = chosen?.lineup ?? (P > 0 ? solveLineup(R, ids, base) : null);
  return {
    champAt,
    playerAt: lineup ? lineup.assign : new Array<number | null>(R).fill(null),
    champFit: chosen?.champFit ?? 0,
  };
}

export interface FlexMove {
  championId: string;
  from: number;
  to: number;
}

export interface FlexOption {
  /** Role-fit units lost by re-shuffling (≥ 0). */
  cost: number;
  moves: FlexMove[];
  /** Role indices still open after a candidate takes this role and the moves happen. */
  openAfter: number[];
}

/**
 * For each filled role, whether our picks could re-shuffle (every champion staying in one of its data roles) so a
 * new champion can take that role — e.g. an early Gragas moving from jungle to top when we add a jungler.
 */
export function flexOptions(ctx: Ctx, a: SideAssign): Map<number, FlexOption> {
  const out = new Map<number, FlexOption>();
  const R = ctx.roles.length;
  const filled = a.champAt.map((c, r) => (c ? r : -1)).filter((r) => r >= 0);
  if (filled.length === 0 || filled.length >= R) return out;
  const picks = a.champAt.filter((c): c is string => !!c);
  const infos = picks.map((id) => ctx.idx.info.get(id));
  const fit = picks.map((_, i) => ctx.roles.map((r) => roleFit(infos[i], r)));
  const currentRole = new Map(a.champAt.map((c, r) => [c, r] as const).filter(([c]) => !!c) as [string, number][]);
  for (const target of filled) {
    const allowed = ctx.roles.map((_, r) => r !== target);
    let best: { sum: number; roleOfPick: number[] } | null = null;
    enumeratePlacements(fit, allowed, (roleOfPick, sum) => {
      // Every champion must stay in a role it's actually played in (unknown champions can go anywhere).
      for (let i = 0; i < roleOfPick.length; i++) if (infos[i] && fit[i][roleOfPick[i]] <= 0) return;
      if (!best || sum > best.sum + EPS) best = { sum, roleOfPick: [...roleOfPick] };
    });
    const found = best as { sum: number; roleOfPick: number[] } | null;
    if (!found) continue;
    const cost = Math.max(0, a.champFit - found.sum);
    if (cost > TUNING.maxFlexCost + EPS) continue;
    const occupied = new Set(found.roleOfPick);
    const moves: FlexMove[] = [];
    found.roleOfPick.forEach((r, i) => {
      const from = currentRole.get(picks[i]);
      if (from !== undefined && from !== r) moves.push({ championId: picks[i], from, to: r });
    });
    const openAfter: number[] = [];
    for (let r = 0; r < R; r++) if (r !== target && !occupied.has(r)) openAfter.push(r);
    out.set(target, { cost, moves, openAfter });
  }
  return out;
}

export interface OpenLineup {
  /** Players not locked to a filled role. */
  free: number[];
  /** Best player per role index for the open roles (null when nobody is left). */
  assign: (number | null)[];
  /** Lineup cost (units) of putting player j at role r instead of the best open lineup; Infinity if unavailable. */
  cost: (j: number, r: number) => number;
}

/** Player options for the still-open roles: who's free and what each (player, role) choice costs the lineup. */
export function openLineup(ctx: Ctx, side: Side, a: SideAssign): OpenLineup {
  const roles = ctx.roles;
  const R = roles.length;
  const players = ctx.players[side];
  const locked = new Set<number>();
  a.champAt.forEach((c, r) => {
    const p = a.playerAt[r];
    if (c && p !== null) locked.add(p);
  });
  const free = players.map((_, j) => j).filter((j) => !locked.has(j));
  const open = a.champAt.map((c, r) => (c ? -1 : r)).filter((r) => r >= 0);
  const assign = new Array<number | null>(R).fill(null);
  const costs = new Map<number, number>();
  if (free.length && open.length) {
    const value = (r: number, j: number) => FILL_BONUS + prefUnits(players[j], roles[r]);
    const tableFor = (slots: number[], ids: number[]) => {
      const t = new Float64Array(slots.length * ids.length);
      slots.forEach((r, s) => ids.forEach((j, k) => (t[s * ids.length + k] = value(r, j))));
      return t;
    };
    const bestAll = solveLineup(open.length, free, tableFor(open, free));
    bestAll.assign.forEach((j, s) => (assign[open[s]] = j));
    for (const j of free) {
      const others = free.filter((x) => x !== j);
      for (const r of open) {
        const rest = open.filter((x) => x !== r);
        const sub = solveLineup(rest.length, others, tableFor(rest, others));
        costs.set(j * R + r, Math.max(0, bestAll.total - (value(r, j) + sub.total)));
      }
    }
  }
  return { free, assign, cost: (j, r) => costs.get(j * R + r) ?? Infinity };
}

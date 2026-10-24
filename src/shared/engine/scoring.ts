// Candidate scoring: our picks, the enemy's likely picks (threats) and our bans. Every contribution is a signed,
// explained part of the score (see explain.ts). A cheap numeric pass ranks everything; only shown suggestions are
// re-scored with reason texts.
import { archetypeDef, GAMES } from "../games";
import type { ArchetypeDef } from "../games";
import type { Role, Side, Tier } from "../types";
import { addComposition, archFit, compState, leadArchetype, restOf } from "./comp";
import type { CompState, Rest } from "./comp";
import { ATTR_INDEX, nameOf } from "./context";
import type { ChampInfo, Ctx, PlayerInfo } from "./context";
import { bySuggestion, clamp, round1, ScoreAcc } from "./explain";
import type { Caps, Component } from "./explain";
import { beatenBy, laneOpponents, laneWeight, matchup, strengthWord } from "./matchups";
import type { Beater } from "./matchups";
import { avoidPhrase, champComfort, comfortWord, mitigation, traitEnemyMatch, traitLabel, traitTeamMatch } from "./players";
import type { ChampComfort } from "./players";
import { assignSide, flexOptions, openLineup } from "./roles";
import type { FlexOption, OpenLineup, SideAssign } from "./roles";
import { TIER_PLAUSIBILITY, TUNING, UNKNOWN_PLAUSIBILITY } from "./tuning";
import type { Suggestion } from "./types";

export interface Slot {
  id: string;
  ri: number;
  ci: ChampInfo | undefined;
}

export interface SideModel {
  side: Side;
  assign: SideAssign;
  lineup: OpenLineup;
  players: PlayerInfo[];
  /** Player per role index: the locked player of a filled role, else the best open-lineup player. */
  playerAt: (PlayerInfo | null)[];
  open: number[];
  openSet: Set<number>;
  slots: Slot[];
  comp: CompState;
  lead: ArchetypeDef | null;
  restCache: Map<string, Rest>;
}

export interface TurnModel {
  /** Step index of our next pick, -1 if none left. */
  ourNextPick: number;
  /** Enemy pick steps after our next pick. */
  enemyPicksAfter: number;
  /** Our ban steps between our next pick and the enemy's last pick (chances to ban a counter). */
  ourBansBetween: number;
  ourPicksLeft: number;
}

interface RoleOption {
  ri: number;
  flex: FlexOption | null;
}

interface PlayerPick {
  j: number;
  c: ChampComfort;
  cost: number;
}

interface EnemyEval {
  score: number;
  ri: number;
  comfort: number;
  player: PlayerInfo | null;
  options: number[];
}

export interface Model {
  ctx: Ctx;
  us: SideModel;
  them: SideModel;
  bySide: Record<Side, SideModel>;
  turn: TurnModel;
  flex: Map<number, FlexOption>;
  roleIndex: Map<Role, number>;
  beaten: Map<string, Beater[]>;
  enemyEval: Map<string, EnemyEval>;
  enemyP75: number;
  enemyMax: number;
  /** Our best numeric pick score per champion (for "don't ban what we want"). */
  ourBest: Map<string, { score: number; comfort: number; player: PlayerInfo | null }>;
  /** Our comp's clearly missing attributes (for ban "exploits" reasoning). */
  ourMissing: Set<string>;
}

const PICK_CAPS: Caps = {
  counter: TUNING.counterCap,
  synergy: TUNING.synergyCap,
  composition: TUNING.compositionCap,
  team: TUNING.teamCap,
  risk: TUNING.riskCap,
  deny: TUNING.denyCap,
};
const BAN_CAPS: Caps = {
  counter: TUNING.counterCap,
  synergy: TUNING.synergyCap,
  composition: TUNING.compositionCap,
  team: 20,
  deny: 20,
  comfort: TUNING.ownWantCap,
};

const roleName = (ctx: Ctx, ri: number): string => GAMES[ctx.game].roles[ri]?.label ?? ctx.roles[ri];

function percentileDesc(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => b - a);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

function sideModel(ctx: Ctx, side: Side): SideModel {
  const assign = assignSide(ctx, side);
  const lineup = openLineup(ctx, side, assign);
  const players = ctx.players[side];
  const open: number[] = [];
  const slots: Slot[] = [];
  assign.champAt.forEach((id, ri) => {
    if (id) slots.push({ id, ri, ci: ctx.idx.info.get(id) });
    else open.push(ri);
  });
  const playerAt = ctx.roles.map((_, r) => {
    const j = assign.champAt[r] ? assign.playerAt[r] : lineup.assign[r];
    return j === null || j === undefined ? null : (players[j] ?? null);
  });
  const comp = compState(ctx, assign.champAt);
  return {
    side,
    assign,
    lineup,
    players,
    playerAt,
    open,
    openSet: new Set(open),
    slots,
    comp,
    lead: leadArchetype(ctx, comp),
    restCache: new Map(),
  };
}

function turnModel(ctx: Ctx): TurnModel {
  const P = ctx.perspective;
  const steps = ctx.steps;
  const from = ctx.next?.index ?? steps.length;
  let ourNextPick = -1;
  for (let i = from; i < steps.length; i++) {
    const s = steps[i];
    if (!s.done && s.side === P && s.type === "pick") {
      ourNextPick = i;
      break;
    }
  }
  let enemyPicksAfter = 0;
  let lastEnemyPick = -1;
  let ourPicksLeft = 0;
  for (let i = from; i < steps.length; i++) {
    const s = steps[i];
    if (s.done || s.type !== "pick") continue;
    if (s.side === P) ourPicksLeft++;
    else if (ourNextPick >= 0 && i > ourNextPick) {
      enemyPicksAfter++;
      lastEnemyPick = i;
    }
  }
  let ourBansBetween = 0;
  for (let i = ourNextPick + 1; ourNextPick >= 0 && i < lastEnemyPick; i++) {
    const s = steps[i];
    if (!s.done && s.side === P && s.type === "ban") ourBansBetween++;
  }
  return { ourNextPick, enemyPicksAfter, ourBansBetween, ourPicksLeft };
}

export function buildModel(ctx: Ctx): Model {
  const blue = sideModel(ctx, "blue");
  const red = sideModel(ctx, "red");
  const bySide: Record<Side, SideModel> = { blue, red };
  const us = bySide[ctx.perspective];
  const them = bySide[ctx.enemy];
  return {
    ctx,
    us,
    them,
    bySide,
    turn: turnModel(ctx),
    flex: us.open.length ? flexOptions(ctx, us.assign) : new Map(),
    roleIndex: new Map(ctx.roles.map((r, i) => [r, i])),
    beaten: new Map(),
    enemyEval: new Map(),
    enemyP75: 0,
    enemyMax: 0,
    ourBest: new Map(),
    ourMissing: new Set(),
  };
}

function restFor(m: Model, side: SideModel, openAfter: number[]): Rest {
  const key = openAfter.join(",");
  let r = side.restCache.get(key);
  if (!r) side.restCache.set(key, (r = restOf(m.ctx, openAfter)));
  return r;
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function addMeta(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number): void {
  const role = m.ctx.roles[ri];
  const stat = ci.c.meta?.[role];
  const tierPts = stat ? TUNING.tierPts[stat.tier as Tier] : undefined;
  if (stat && tierPts !== undefined) {
    let pts = tierPts;
    let wrText = "";
    if (typeof stat.winRate === "number" && Number.isFinite(stat.winRate)) {
      const wr = stat.winRate > 1 ? stat.winRate / 100 : stat.winRate;
      const games = typeof stat.games === "number" && Number.isFinite(stat.games) ? Math.max(0, stat.games) : undefined;
      const conf = games === undefined ? 1 : games / (games + TUNING.metaPriorGames);
      pts += clamp((wr - 0.5) * 100 * TUNING.winRatePtsPerPct, -TUNING.winRateCap, TUNING.winRateCap) * conf;
      wrText = ` (${(wr * 100).toFixed(1)}% WR)`;
    }
    acc.add("meta", "meta", pts, () => `${stat.tier}-tier ${roleName(m.ctx, ri)}${wrText}`);
  } else if (!ci.c.roles.includes(role)) {
    acc.add("meta", "meta", TUNING.offRoleMeta, () => `Off-meta in ${roleName(m.ctx, ri)}`);
  }
}

function lineupText(ctx: Ctx, p: PlayerInfo, ri: number): string {
  const role = ctx.roles[ri];
  const label = roleName(ctx, ri);
  const pref = p.prefs.get(role);
  if (pref === "secondary") return `${label} is ${p.name}'s secondary role`;
  if (pref === "fill") return `${p.name} would fill ${label}`;
  if (pref === "main") return `Shifts the rest of the lineup`;
  return `${label} isn't one of ${p.name}'s roles`;
}

function choosePlayer(side: SideModel, ctx: Ctx, ci: ChampInfo, ri: number, flex: FlexOption | null): PlayerPick | null {
  const role = ctx.roles[ri];
  if (flex) {
    const j = side.assign.playerAt[ri];
    return j === null || j === undefined || !side.players[j] ? null : { j, c: champComfort(side.players[j], ci, role), cost: 0 };
  }
  let best: (PlayerPick & { v: number }) | null = null;
  for (const j of side.lineup.free) {
    const cost = side.lineup.cost(j, ri);
    if (!Number.isFinite(cost)) continue;
    const c = champComfort(side.players[j], ci, role);
    const v = c.pts - TUNING.lineupCostPts * cost;
    if (!best || v > best.v + 1e-9) best = { j, c, cost, v };
  }
  return best;
}

function addComfort(acc: ScoreAcc, ctx: Ctx, side: SideModel, pick: PlayerPick | null, ri: number, comp: Component): void {
  if (!pick) return;
  const p = side.players[pick.j];
  const c = pick.c;
  if (c.comfort > 0) {
    acc.add(comp, comp === "deny" ? "deny" : "comfort", c.pts, () => `${p.name}'s ${comfortWord(c.comfort)} (${c.comfort}/5)${c.roleOk ? "" : `, not usually ${roleName(ctx, ri)}`}`);
  } else {
    const hard = c.hardOffPool ? TUNING.hardOffPool : 0;
    const off = c.offPool ? TUNING.offPoolPts : 0;
    const style = c.style;
    if (style) acc.add(comp, "playstyle", c.pts - hard - off, () => `Suits ${p.name}'s ${style.label.toLowerCase()} playstyle`);
    if (hard) acc.add(comp, "comfort", hard, () => `Demanding pick outside ${p.name}'s pool`);
    if (off) acc.add(comp, "comfort", off, () => `Not in ${p.name}'s pool`);
  }
  if (pick.cost > 0) acc.add(comp, "comfort", -TUNING.lineupCostPts * pick.cost, () => lineupText(ctx, p, ri));
}

/** Counter value of `ci` at role `ri` against the other side's picked champions. */
function addCounters(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number, opponents: Slot[], possessive: string): void {
  const ctx = m.ctx;
  const role = ctx.roles[ri];
  for (const e of opponents) {
    const mu = matchup(ctx, ci.c.id, e.id);
    if (!mu) continue;
    const lw = laneWeight(ctx, role, ctx.roles[e.ri], mu.lane);
    const raw = TUNING.counterScale * lw.w * mu.adv * mu.conf;
    const kind = mu.override ? "override" : raw > 0 ? "counter" : "countered";
    acc.add("counter", kind, raw, () => {
      const name = `${possessive}${nameOf(ctx, e.id)}`;
      const where = lw.lane ? " in lane" : "";
      const tail = mu.override ? " (team note)" : mu.n !== undefined && mu.n < TUNING.lowSample ? " (low sample)" : "";
      const w = strengthWord(mu.adv * mu.conf);
      if (raw > 0) return `${w === "hard" ? "Hard counter to" : w === "clear" ? "Counters" : "Slight edge vs"} ${name}${where}${tail}`;
      return `${w === "hard" ? "Hard-countered by" : w === "clear" ? "Countered by" : "Slightly weak into"} ${name}${where}${tail}`;
    });
  }
}

function synergyOf(m: Model, a: string, b: string): number {
  const syn = m.ctx.data.synergies;
  const v = syn?.[a]?.[b] ?? syn?.[b]?.[a];
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

function addSynergy(acc: ScoreAcc, m: Model, ci: ChampInfo, allies: Slot[], possessive: string): void {
  for (const a of allies) {
    if (a.id === ci.c.id) continue;
    const v = synergyOf(m, ci.c.id, a.id);
    if (v > 0) acc.add("synergy", "synergy", TUNING.synergyScale * v, () => `${v >= 0.8 ? "Strong synergy" : "Synergy"} with ${possessive}${nameOf(m.ctx, a.id)}`);
  }
}

// ---------------------------------------------------------------------------
// Our picks
// ---------------------------------------------------------------------------

function ourOptions(m: Model, ci: ChampInfo): RoleOption[] {
  const out: RoleOption[] = [];
  const seen = new Set<number>();
  const push = (ri: number | undefined, flex: FlexOption | null) => {
    if (ri === undefined || seen.has(ri)) return;
    seen.add(ri);
    out.push({ ri, flex });
  };
  for (const r of ci.c.roles) {
    const ri = m.roleIndex.get(r);
    if (ri === undefined) continue;
    if (m.us.openSet.has(ri)) push(ri, null);
    else if (m.flex.has(ri)) push(ri, m.flex.get(ri)!);
  }
  // Pocket picks: a free player lists explicit roles for this champion.
  for (const j of m.us.lineup.free) {
    const e = m.us.players[j]?.pool.get(ci.c.id);
    if (e?.roles) for (const r of e.roles) if (m.us.openSet.has(m.roleIndex.get(r) ?? -1)) push(m.roleIndex.get(r), null);
  }
  return out;
}

function addTeam(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number, player: PlayerInfo | null): void {
  const ctx = m.ctx;
  const team = ctx.teams[ctx.perspective];
  if (team) {
    let pref: { def: ArchetypeDef; fit: number } | null = null;
    for (const id of Array.isArray(team.preferredArchetypes) ? team.preferredArchetypes : []) {
      const def = archetypeDef(id);
      if (!def) continue;
      const fit = archFit(ci, def);
      if (!pref || fit > pref.fit + 1e-9) pref = { def, fit };
    }
    if (pref && pref.fit > 0.25) {
      const p = pref;
      acc.add("team", "archetype", TUNING.prefArchetype * p.fit, () => `Fits our preferred ${p.def.label} style`);
    }
    let avoid: { def: ArchetypeDef; fit: number } | null = null;
    for (const id of Array.isArray(team.avoidArchetypes) ? team.avoidArchetypes : []) {
      const def = archetypeDef(id);
      if (!def) continue;
      const fit = archFit(ci, def);
      if (!avoid || fit > avoid.fit + 1e-9) avoid = { def, fit };
    }
    if (avoid && avoid.fit >= 0.45) {
      const a = avoid;
      acc.add("team", "archetype", -TUNING.avoidArchetype * a.fit, () => `Leans into ${a.def.label}, a style we avoid`);
    }
  }
  if (!player) return;
  // Traits with a team/game-phase affinity.
  let pos = 0;
  for (const t of player.strengths) {
    const v = traitTeamMatch(t, ci);
    if (v > 0 && pos < TUNING.traitTeamCap) {
      const pts = Math.min(TUNING.traitTeam * v, TUNING.traitTeamCap - pos);
      pos += pts;
      acc.add("team", "strength", pts, () => `Plays to ${player.name}'s ${t.label.toLowerCase()} strength`);
    }
  }
  let neg = 0;
  for (const t of player.weaknesses) {
    const v = traitTeamMatch(t, ci);
    if (v > 0 && neg < TUNING.traitTeamCap) {
      const pts = Math.min(TUNING.traitTeam * v, TUNING.traitTeamCap - neg);
      neg += pts;
      acc.add("team", "weakness", -pts, () => `Leans on ${player.name}'s weaker ${t.label.toLowerCase()}`);
    }
  }
  // Lane opponents that exploit a weakness: reward candidates that mitigate it; hated matchups: reward answers.
  const oppRoles = laneOpponents(ctx, ctx.roles[ri]);
  const opps = m.them.slots.filter((s) => s.ci && oppRoles.includes(ctx.roles[s.ri]));
  for (const t of player.weaknesses) {
    if (!t.enemy) continue;
    const exposer = opps.find((s) => traitEnemyMatch(t, s.ci!) > 0);
    if (!exposer) continue;
    const mit = mitigation(t.id, ci);
    if (mit.value > 0) {
      acc.add("team", "weakness", TUNING.mitigate * mit.value, () =>
        `Helps ${player.name} vs ${nameOf(ctx, exposer.id)}'s ${traitLabel(t.id, t.label)} (${mit.via === "range" ? "ranged" : mit.via})`,
      );
    }
  }
  for (const s of opps) {
    const av = player.avoid.get(s.id);
    if (!av) continue;
    const mu = matchup(ctx, ci.c.id, s.id);
    if (!mu) continue;
    const raw = clamp(TUNING.avoidAnswer * (av.severity / 3) * ((mu.adv * mu.conf) / 0.4), -TUNING.avoidAnswer, TUNING.avoidAnswer);
    acc.add("team", "avoid", raw, () =>
      raw > 0
        ? `Answers ${nameOf(ctx, s.id)}, whom ${player.name} ${avoidPhrase(av.severity)}`
        : `Weak into ${nameOf(ctx, s.id)}, whom ${player.name} ${avoidPhrase(av.severity)}`,
    );
  }
}

/**
 * Scouted enemy players we'd lane against: champions they hate facing or that exploit their weaknesses. Scouting is
 * second-hand, so hated matchups count a little less than our own players' (TUNING.enemyAvoidFactor).
 */
function addEnemyExploits(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number): void {
  if (!m.them.players.length) return;
  const ctx = m.ctx;
  laneOpponents(ctx, ctx.roles[ri]).forEach((er, k) => {
    const eri = m.roleIndex.get(er);
    const p = eri === undefined ? null : m.them.playerAt[eri];
    if (!p) return;
    const f = k === 0 ? 1 : 0.7;
    const av = p.avoid.get(ci.c.id);
    if (av) {
      acc.add("team", "avoid", TUNING.avoidLane * av.severity * f * TUNING.enemyAvoidFactor, () => `Their ${p.name} ${avoidPhrase(av.severity)} ${ci.c.name}`);
    }
    let w = 0;
    for (const t of p.weaknesses) {
      const v = traitEnemyMatch(t, ci);
      if (v > 0 && w < TUNING.weaknessCap) {
        const pts = Math.min(TUNING.weaknessPts * v * f, TUNING.weaknessCap - w);
        w += pts;
        acc.add("team", "weakness", pts, () => `Exploits their ${p.name}'s weakness vs ${traitLabel(t.id, t.label)}`);
      }
    }
  });
}

/** Meta tier of a champion in a role (undefined without tier data). */
function tierOf(ctx: Ctx, id: string, ri: number): Tier | undefined {
  const t = ctx.idx.info.get(id)?.c.meta?.[ctx.roles[ri]]?.tier as Tier | undefined;
  return t && TUNING.tierPts[t] !== undefined ? t : undefined;
}

/** Tier points of a champion in a role; 0 without tier data (moves only happen between a champion's data roles). */
function tierPts(ctx: Ctx, id: string, ri: number): number {
  const t = tierOf(ctx, id, ri);
  return t ? TUNING.tierPts[t] : 0;
}

function plausibility(m: Model, ei: ChampInfo, ri: number): number {
  const stat = ei.c.meta?.[m.ctx.roles[ri]];
  let p = stat ? (TIER_PLAUSIBILITY[stat.tier as Tier] ?? UNKNOWN_PLAUSIBILITY) : UNKNOWN_PLAUSIBILITY;
  // A scouted player who is comfortable on it makes the counter-pick more likely.
  if (m.them.lineup.free.some((j) => (m.them.players[j]?.pool.get(ei.c.id)?.comfort ?? 0) >= 3)) p *= 1.25;
  return p;
}

function addRisk(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number): void {
  const ctx = m.ctx;
  const turn = m.turn;
  if (turn.enemyPicksAfter > 0 && m.them.open.length > 0) {
    let beaters = m.beaten.get(ci.c.id);
    if (!beaters) m.beaten.set(ci.c.id, (beaters = beatenBy(ctx, ci.c.id)));
    const role = ctx.roles[ri];
    const threats: { id: string; t: number }[] = [];
    for (const b of beaters) {
      if (b.id === ci.c.id || ctx.unavailable[ctx.enemy].has(b.id)) continue;
      const ei = ctx.idx.info.get(b.id);
      if (!ei) continue;
      let best = 0;
      for (const r of ei.c.roles) {
        const eri = m.roleIndex.get(r);
        if (eri === undefined || !m.them.openSet.has(eri)) continue;
        best = Math.max(best, laneWeight(ctx, role, r, b.lane).w * plausibility(m, ei, eri));
      }
      if (best > 0) threats.push({ id: b.id, t: b.adv * best });
    }
    if (threats.length) {
      threats.sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : 1));
      const raw = (threats[0]?.t ?? 0) + 0.5 * (threats[1]?.t ?? 0) + 0.25 * (threats[2]?.t ?? 0);
      const pts = (-TUNING.riskScale * raw) / (1 + 0.25 * turn.ourBansBetween);
      acc.add("risk", "blind-risk", pts, () => {
        const names = threats.slice(0, 2).map((t) => nameOf(ctx, t.id));
        const left = turn.enemyPicksAfter === 1 ? "1 enemy pick left" : `${turn.enemyPicksAfter} enemy picks left`;
        return `Counterable by ${names.join(", ")} (${left})`;
      });
    }
  }
  // Hidden information: early flex picks keep our lineup ambiguous.
  if (m.us.slots.length <= 2 && turn.enemyPicksAfter > 0) {
    // Only roles the enemy would take seriously (B-tier or better; roles without tier data still count).
    const flexRoles = ci.c.roles.slice(0, 3).filter((r) => {
      if (!m.us.openSet.has(m.roleIndex.get(r) ?? -1)) return false;
      const tier = ci.c.meta?.[r]?.tier as Tier | undefined;
      return !tier || (TIER_PLAUSIBILITY[tier] ?? 0) >= TIER_PLAUSIBILITY.B;
    });
    if (flexRoles.length >= 2) {
      const pts = flexRoles.length >= 3 ? TUNING.flex3 : TUNING.flex2;
      acc.add("risk", "flex", pts, () => `Flex pick (${flexRoles.map((r) => roleName(ctx, m.roleIndex.get(r)!)).join("/")}) hides our lineup`);
    }
  }
}

function addDeny(acc: ScoreAcc, m: Model, ci: ChampInfo): void {
  const ctx = m.ctx;
  if (m.turn.enemyPicksAfter <= 0 || ctx.unavailable[ctx.enemy].has(ci.c.id)) return;
  const ev = m.enemyEval.get(ci.c.id);
  if (!ev) return;
  const spread = m.enemyMax - m.enemyP75;
  const strength = spread > 1e-9 ? clamp((ev.score - m.enemyP75) / spread, 0, 1) : 0;
  const enemyName = GAMES[ctx.game].sideLabels[ctx.enemy];
  acc.add("deny", "deny", TUNING.denyStrength * strength, () => `Denies a strong pick for ${enemyName}`);
  const player = ev.player;
  if (player && ev.comfort >= 3) {
    acc.add("deny", "deny", TUNING.denyComfortPerLevel * (ev.comfort - 2), () => `Takes away ${player.name}'s ${comfortWord(ev.comfort)} (${ev.comfort}/5)`);
  }
}

function scoreOurPick(m: Model, ci: ChampInfo, opt: RoleOption, explain: boolean): Suggestion & { comfort: number; player: PlayerInfo | null } {
  const ctx = m.ctx;
  const acc = new ScoreAcc(explain);
  const ri = opt.ri;
  addMeta(acc, m, ci, ri);
  const pick = ctx.players[ctx.perspective].length ? choosePlayer(m.us, ctx, ci, ri, opt.flex) : null;
  addComfort(acc, ctx, m.us, pick, ri, "comfort");
  addCounters(acc, m, ci, ri, m.them.slots, "");
  addSynergy(acc, m, ci, m.us.slots, "");
  const openAfter = opt.flex ? opt.flex.openAfter : m.us.open.filter((r) => r !== ri);
  // A re-shuffle really fills the open role a moved champion goes to: compare against that role's average champion.
  const closed = opt.flex ? m.us.open.filter((r) => !opt.flex!.openAfter.includes(r)) : [];
  const baseRole = closed.length === 1 ? ctx.roles[closed[0]] : undefined;
  addComposition(acc, ctx, m.us.comp, restFor(m, m.us, openAfter), ci, ctx.roles[ri], m.us.lead, "our", false, baseRole);
  const player = pick ? m.us.players[pick.j] : null;
  addTeam(acc, m, ci, ri, player);
  addEnemyExploits(acc, m, ci, ri);
  addRisk(acc, m, ci, ri);
  addDeny(acc, m, ci);
  if (opt.flex) {
    const f = opt.flex;
    // Role-fit units lost, plus the meta strength each moved champion loses in its new role (A-tier support → C-tier top).
    let metaLoss = 0;
    for (const mv of f.moves) metaLoss += Math.max(0, tierPts(ctx, mv.championId, mv.from) - tierPts(ctx, mv.championId, mv.to));
    acc.add("structure", "role-filled", -Math.max(0.5, TUNING.roleFilledPts * f.cost + metaLoss), () =>
      f.moves
        .map((mv) => {
          const from = tierOf(ctx, mv.championId, mv.from);
          const to = tierOf(ctx, mv.championId, mv.to);
          return `${nameOf(ctx, mv.championId)} moves to ${roleName(ctx, mv.to)}${from && to && from !== to ? ` (tier ${from} to ${to})` : ""}`;
        })
        .join(", ") || "Re-shuffles our roles",
    );
  }
  const { score, reasons } = acc.finish(TUNING.pickBase, ctx.weights, PICK_CAPS);
  return {
    championId: ci.c.id,
    score,
    role: ctx.roles[ri],
    ...(player ? { playerId: player.profile.id, playerName: player.name } : {}),
    reasons,
    comfort: pick?.c.comfort ?? 0,
    player,
  };
}

// ---------------------------------------------------------------------------
// Enemy picks (threats) and our bans
// ---------------------------------------------------------------------------

function enemyOptions(m: Model, ci: ChampInfo): number[] {
  const out: number[] = [];
  for (const r of ci.c.roles) {
    const ri = m.roleIndex.get(r);
    if (ri !== undefined && m.them.openSet.has(ri) && !out.includes(ri)) out.push(ri);
  }
  for (const j of m.them.lineup.free) {
    const e = m.them.players[j]?.pool.get(ci.c.id);
    if (e?.roles) {
      for (const r of e.roles) {
        const ri = m.roleIndex.get(r);
        if (ri !== undefined && m.them.openSet.has(ri) && !out.includes(ri)) out.push(ri);
      }
    }
  }
  return out;
}

/** The enemy's view of picking `ci` at `ri` (simplified: no blind risk / deny / traits). */
function scoreEnemyPick(acc: ScoreAcc, m: Model, ci: ChampInfo, ri: number, forBan: boolean): PlayerPick | null {
  const ctx = m.ctx;
  addMeta(acc, m, ci, ri);
  const pick = m.them.players.length ? choosePlayer(m.them, ctx, ci, ri, null) : null;
  // In bans, the enemy's comfort is what we deny them.
  addComfort(acc, ctx, m.them, pick, ri, forBan ? "deny" : "comfort");
  addCounters(acc, m, ci, ri, m.us.slots, "our ");
  addSynergy(acc, m, ci, m.them.slots, "their ");
  addComposition(acc, ctx, m.them.comp, restFor(m, m.them, m.them.open.filter((r) => r !== ri)), ci, ctx.roles[ri], m.them.lead, "their", forBan);
  return pick;
}

/** Our-side specifics of a ban: hated matchups, exploited weaknesses, comp holes. */
function addBanSpecific(acc: ScoreAcc, m: Model, ci: ChampInfo, eri: number): void {
  const ctx = m.ctx;
  const erole = ctx.roles[eri];
  const facing = new Set<number>();
  ctx.roles.forEach((r, ro) => {
    const opp = laneOpponents(ctx, r);
    const k = opp.indexOf(erole);
    if (k < 0) return;
    facing.add(ro);
    const p = m.us.playerAt[ro];
    if (!p) return;
    const primary = k === 0;
    const av = p.avoid.get(ci.c.id);
    if (av) {
      acc.add("team", "avoid", TUNING.avoidLane * av.severity * (primary ? 1 : 0.7), () => `${p.name} ${avoidPhrase(av.severity)} ${ci.c.name} (${roleName(ctx, ro)})`);
    }
    let w = 0;
    for (const t of p.weaknesses) {
      const v = traitEnemyMatch(t, ci);
      if (v > 0 && w < TUNING.weaknessCap) {
        const pts = Math.min(TUNING.weaknessPts * v * (primary ? 1 : 0.7), TUNING.weaknessCap - w);
        w += pts;
        acc.add("team", "weakness", pts, () => `Exploits ${p.name}'s weakness vs ${traitLabel(t.id, t.label)}`);
      }
    }
    for (const t of p.strengths) {
      const v = traitEnemyMatch(t, ci);
      if (v > 0) acc.add("team", "strength", TUNING.strengthPts * v, () => `${p.name} handles ${traitLabel(t.id, t.label)} well`);
    }
  });
  // Everyone else who dislikes facing it (teamfights).
  ctx.roles.forEach((_, ro) => {
    if (facing.has(ro)) return;
    const p = m.us.playerAt[ro];
    const av = p?.avoid.get(ci.c.id);
    if (p && av) acc.add("team", "avoid", TUNING.avoidTeam * av.severity, () => `${p.name} ${avoidPhrase(av.severity)} ${ci.c.name}`);
  });
  // Holes in our comp it would exploit.
  if (m.us.comp.n >= 2) {
    const a = (k: string) => ci.a[ATTR_INDEX[k]];
    if ((m.ourMissing.has("peel") || m.ourMissing.has("frontline")) && a("burst") >= 2 && a("mobility") >= 2)
      acc.add("composition", "composition", TUNING.compExploit, () => "Dives our backline (we lack peel)");
    if (m.ourMissing.has("engage") && a("poke") >= 2) acc.add("composition", "composition", TUNING.compExploit, () => "Pokes us freely (we lack engage)");
    if (m.ourMissing.has("disengage") && m.ourMissing.has("peel") && a("engage") >= 3)
      acc.add("composition", "composition", TUNING.compExploit * 0.7, () => "Hard engage we can't disengage");
  }
}

/**
 * Don't ban our own players' comfort picks. (A champion's generic pick value — tier, deny, flex — is not held against
 * the ban: those are the same reasons it's a threat, so subtracting them would push the top meta picks off the list.)
 */
function addOwnWant(acc: ScoreAcc, m: Model, ci: ChampInfo): void {
  if (m.turn.ourPicksLeft <= 0) return;
  const ours = m.ourBest.get(ci.c.id);
  const player = ours?.player;
  if (!ours || !player || ours.comfort < 3) return;
  const raw = -Math.min(TUNING.ownWantCap, TUNING.ownComfortPerLevel * (ours.comfort - 2));
  acc.add("comfort", "comfort", raw, () => `We'd rather pick it (${player.name} ${ours.comfort}/5)`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ScoredLists {
  picks: Suggestion[];
  picksByRole: Record<Role, Suggestion[]>;
  bans: Suggestion[];
  enemyThreats: Suggestion[];
}

const strip = (s: Suggestion & { comfort?: number; player?: PlayerInfo | null }): Suggestion => {
  const out: Suggestion = { championId: s.championId, score: round1(s.score), role: s.role, reasons: s.reasons };
  if (s.playerId) out.playerId = s.playerId;
  if (s.playerName) out.playerName = s.playerName;
  return out;
};

/** Enemy perspective, numeric pass: best role + score per champion they could still pick. */
function evaluateEnemy(m: Model): void {
  const ctx = m.ctx;
  if (!m.them.open.length) return;
  for (const ci of ctx.idx.list) {
    if (ctx.unavailable[ctx.enemy].has(ci.c.id)) continue;
    const options = enemyOptions(m, ci);
    if (!options.length) continue;
    let best: EnemyEval | null = null;
    for (const ri of options) {
      const acc = new ScoreAcc(false);
      const pick = scoreEnemyPick(acc, m, ci, ri, false);
      const { score } = acc.finish(TUNING.pickBase, ctx.weights, PICK_CAPS);
      if (!best || score > best.score + 1e-9) {
        best = { score, ri, comfort: pick?.c.comfort ?? 0, player: pick ? m.them.players[pick.j] : null, options };
      }
    }
    if (best) m.enemyEval.set(ci.c.id, best);
  }
  const scores = [...m.enemyEval.values()].map((e) => e.score);
  m.enemyP75 = percentileDesc(scores, 0.25);
  m.enemyMax = scores.length ? Math.max(...scores) : 0;
}

export function scoreAll(m: Model): ScoredLists {
  const ctx = m.ctx;
  const limit = ctx.limit;
  evaluateEnemy(m);

  // Our picks: numeric pass over every (champion, role option).
  const byRole = new Map<number, { ci: ChampInfo; score: number }[]>();
  for (const ri of m.us.open) byRole.set(ri, []);
  const bestOpt = new Map<string, { ci: ChampInfo; opt: RoleOption; score: number }>();
  if (m.us.open.length) {
    for (const ci of ctx.idx.list) {
      if (ctx.unavailable[ctx.perspective].has(ci.c.id)) continue;
      for (const opt of ourOptions(m, ci)) {
        const s = scoreOurPick(m, ci, opt, false);
        if (!opt.flex) byRole.get(opt.ri)?.push({ ci, score: s.score });
        const prev = bestOpt.get(ci.c.id);
        if (!prev || s.score > prev.score + 1e-9) {
          bestOpt.set(ci.c.id, { ci, opt, score: s.score });
          m.ourBest.set(ci.c.id, { score: s.score, comfort: s.comfort, player: s.player });
        }
      }
    }
  }

  const explained = new Map<string, Suggestion>();
  const explainOur = (ci: ChampInfo, opt: RoleOption): Suggestion => {
    const key = `${ci.c.id}|${opt.ri}`;
    let s = explained.get(key);
    if (!s) explained.set(key, (s = strip(scoreOurPick(m, ci, opt, true))));
    return s;
  };
  const picks = [...bestOpt.values()]
    .map((b) => ({ ...b, championId: b.ci.c.id }))
    .sort(bySuggestion)
    .slice(0, limit)
    .map((b) => explainOur(b.ci, b.opt));
  const picksByRole: Record<Role, Suggestion[]> = {};
  for (const ri of m.us.open) {
    picksByRole[ctx.roles[ri]] = (byRole.get(ri) ?? [])
      .map((x) => ({ ...x, championId: x.ci.c.id }))
      .sort(bySuggestion)
      .slice(0, limit)
      .map((x) => explainOur(x.ci, { ri, flex: null }));
  }

  // Threats: the enemy's best picks, explained from their side.
  const enemyThreats = [...m.enemyEval.entries()]
    .map(([id, e]) => ({ championId: id, score: e.score, e }))
    .sort(bySuggestion)
    .slice(0, limit)
    .map(({ championId, e }) => {
      const ci = ctx.idx.info.get(championId)!;
      const acc = new ScoreAcc(true);
      const pick = scoreEnemyPick(acc, m, ci, e.ri, false);
      const { score, reasons } = acc.finish(TUNING.pickBase, ctx.weights, PICK_CAPS);
      const player = pick ? m.them.players[pick.j] : null;
      return strip({ championId, score, role: ctx.roles[e.ri], reasons, ...(player ? { playerId: player.profile.id, playerName: player.name } : {}) });
    });

  // Bans: threat to us (their view + our specifics) minus what we'd rather pick ourselves.
  const scoreBan = (ci: ChampInfo, ri: number, explain: boolean) => {
    const acc = new ScoreAcc(explain);
    scoreEnemyPick(acc, m, ci, ri, true);
    addBanSpecific(acc, m, ci, ri);
    addOwnWant(acc, m, ci);
    return acc.finish(TUNING.banBase, ctx.weights, BAN_CAPS);
  };
  // Ban candidates are what the enemy can still pick (enemyEval). Fearless locks never apply to bans (same rule as the
  // room reducer), so a champion only WE are locked out of under soft fearless is still a valid — often good — ban.
  const banBest: { championId: string; ci: ChampInfo; ri: number; score: number }[] = [];
  for (const [id, e] of m.enemyEval) {
    if (ctx.taken.has(id)) continue;
    const ci = ctx.idx.info.get(id)!;
    let best: { ri: number; score: number } | null = null;
    for (const ri of e.options) {
      const { score } = scoreBan(ci, ri, false);
      if (!best || score > best.score + 1e-9) best = { ri, score };
    }
    if (best) banBest.push({ championId: id, ci, ...best });
  }
  const bans = banBest
    .sort(bySuggestion)
    .slice(0, limit)
    .map((b) => {
      const { score, reasons } = scoreBan(b.ci, b.ri, true);
      return strip({ championId: b.championId, score, role: ctx.roles[b.ri], reasons });
    });

  return { picks, picksByRole, bans, enemyThreats };
}

// Static game definitions and tag vocabularies shared by UI and engine.
import type { Archetype, AttributeKey, Attributes, GameId, PowerCurve, RangeType, Role, Side } from "./types";

export interface RoleDef {
  id: Role;
  label: string;
  short: string;
}

export interface GameDef {
  id: GameId;
  name: string;
  short: string;
  /** "Champion" / "Hero" */
  unit: string;
  unitPlural: string;
  roles: RoleDef[];
  sideLabels: Record<Side, string>;
  teamSize: 5;
  defaultFormatId: string;
}

export const GAMES: Record<GameId, GameDef> = {
  lol: {
    id: "lol",
    name: "League of Legends",
    short: "LoL",
    unit: "Champion",
    unitPlural: "Champions",
    roles: [
      { id: "top", label: "Top", short: "TOP" },
      { id: "jungle", label: "Jungle", short: "JG" },
      { id: "mid", label: "Mid", short: "MID" },
      { id: "bot", label: "Bot (ADC)", short: "BOT" },
      { id: "support", label: "Support", short: "SUP" },
    ],
    sideLabels: { blue: "Blue", red: "Red" },
    teamSize: 5,
    defaultFormatId: "lol-tournament",
  },
  dota2: {
    id: "dota2",
    name: "Dota 2",
    short: "Dota 2",
    unit: "Hero",
    unitPlural: "Heroes",
    roles: [
      { id: "pos1", label: "Carry (Pos 1)", short: "P1" },
      { id: "pos2", label: "Mid (Pos 2)", short: "P2" },
      { id: "pos3", label: "Offlane (Pos 3)", short: "P3" },
      { id: "pos4", label: "Soft Support (Pos 4)", short: "P4" },
      { id: "pos5", label: "Hard Support (Pos 5)", short: "P5" },
    ],
    sideLabels: { blue: "Radiant", red: "Dire" },
    teamSize: 5,
    defaultFormatId: "dota2-cm",
  },
};

export const roleIds = (game: GameId): Role[] => GAMES[game].roles.map((r) => r.id);
export const roleLabel = (game: GameId, role: Role | null | undefined): string =>
  (role && GAMES[game].roles.find((r) => r.id === role)?.label) || "Flex";

/**
 * Lane opponents: which enemy roles a role mostly interacts with during the laning phase.
 * Used to weight lane-specific matchups.
 */
export const LANE_OPPONENTS: Record<GameId, Record<Role, Role[]>> = {
  lol: {
    top: ["top"],
    jungle: ["jungle"],
    mid: ["mid"],
    bot: ["bot", "support"],
    support: ["support", "bot"],
  },
  dota2: {
    // safe lane (1+5) vs enemy offlane (3+4); mid vs mid
    pos1: ["pos3", "pos4"],
    pos5: ["pos3", "pos4"],
    pos2: ["pos2"],
    pos3: ["pos1", "pos5"],
    pos4: ["pos1", "pos5"],
  },
};

/**
 * The enemy role each role is shown against in lane matchups (a bijection): the same role in LoL; in Dota the safe
 * lane faces the enemy offlane (pos1 vs pos3, pos5 vs pos4) and mid faces mid.
 */
export const LANE_PAIR: Record<GameId, Record<Role, Role>> = {
  lol: { top: "top", jungle: "jungle", mid: "mid", bot: "bot", support: "support" },
  dota2: { pos1: "pos3", pos2: "pos2", pos3: "pos1", pos4: "pos5", pos5: "pos4" },
};

export interface AttributeDef {
  id: AttributeKey;
  label: string;
  description: string;
}

export const ATTRIBUTES: AttributeDef[] = [
  { id: "engage", label: "Engage", description: "Can start fights on its own terms (hard initiation)." },
  { id: "disengage", label: "Disengage", description: "Stops enemy engages and resets bad fights." },
  { id: "peel", label: "Peel", description: "Protects carries from divers and assassins." },
  { id: "poke", label: "Poke", description: "Long-range chip damage before fights start." },
  { id: "burst", label: "Burst", description: "Deletes a target in a short window." },
  { id: "dps", label: "Sustained DPS", description: "Consistent damage over extended fights." },
  { id: "frontline", label: "Frontline", description: "Tanky enough to absorb damage and hold space." },
  { id: "cc", label: "Crowd Control", description: "Stuns, roots, slows, displacements." },
  { id: "mobility", label: "Mobility", description: "Dashes, blinks, movement speed, global presence." },
  { id: "waveclear", label: "Waveclear", description: "Clears minion waves / creep waves quickly and safely." },
  { id: "splitpush", label: "Split Push", description: "Side-lane pressure and 1v1 dueling." },
  { id: "pick", label: "Pick", description: "Catches isolated targets." },
  { id: "sustain", label: "Sustain", description: "Heals and shields for self or team." },
  { id: "siege", label: "Siege", description: "Structure and objective damage, and pushing towers." },
];

export interface ArchetypeDef {
  id: Archetype;
  label: string;
  description: string;
  /** Attribute weights (0..1) describing what the comp needs. */
  wants: Partial<Attributes>;
  /** Optional power-curve preference. */
  curve?: Partial<PowerCurve>;
  /** Games where this archetype is meaningful. */
  games: GameId[];
}

export const ARCHETYPE_DEFS: ArchetypeDef[] = [
  {
    id: "engage",
    label: "Hard Engage",
    description: "Force 5v5 fights with layered initiation and CC.",
    wants: { engage: 1, cc: 0.8, frontline: 0.7, burst: 0.3 },
    games: ["lol", "dota2"],
  },
  {
    id: "poke",
    label: "Poke & Siege",
    description: "Whittle enemies down from range, take objectives without committing.",
    wants: { poke: 1, siege: 0.7, disengage: 0.6, waveclear: 0.5 },
    games: ["lol", "dota2"],
  },
  {
    id: "pick",
    label: "Pick",
    description: "Catch isolated targets with vision control and burst.",
    wants: { pick: 1, burst: 0.7, cc: 0.6, mobility: 0.4 },
    games: ["lol", "dota2"],
  },
  {
    id: "split",
    label: "Split Push",
    description: "Pressure side lanes (1-3-1 / 1-4) and force answers.",
    wants: { splitpush: 1, waveclear: 0.6, disengage: 0.5, mobility: 0.4 },
    games: ["lol", "dota2"],
  },
  {
    id: "protect",
    label: "Protect the Carry",
    description: "Funnel resources into a hyper-carry and peel for them.",
    wants: { peel: 1, dps: 0.9, sustain: 0.6, frontline: 0.5 },
    curve: { late: 1 },
    games: ["lol", "dota2"],
  },
  {
    id: "dive",
    label: "Dive",
    description: "Jump the backline with mobile, bursty threats.",
    wants: { engage: 0.7, mobility: 1, burst: 0.8, frontline: 0.3 },
    games: ["lol", "dota2"],
  },
  {
    id: "skirmish",
    label: "Skirmish",
    description: "Win small fights around the map with strong duelists.",
    wants: { dps: 0.8, mobility: 0.6, sustain: 0.6, burst: 0.4 },
    curve: { early: 0.5, mid: 1 },
    games: ["lol", "dota2"],
  },
  {
    id: "early",
    label: "Early Snowball",
    description: "Win lanes, take early objectives, end before enemies scale.",
    wants: { siege: 0.5, pick: 0.4 },
    curve: { early: 1, mid: 0.6 },
    games: ["lol", "dota2"],
  },
  {
    id: "scaling",
    label: "Late Scaling",
    description: "Survive the early game and outscale.",
    wants: { waveclear: 0.5, disengage: 0.5 },
    curve: { late: 1 },
    games: ["lol", "dota2"],
  },
  {
    id: "push",
    label: "Deathball Push",
    description: "Group early and take towers fast with summons, auras and siege.",
    wants: { siege: 1, waveclear: 0.6, sustain: 0.4 },
    curve: { early: 0.6, mid: 1 },
    games: ["dota2", "lol"],
  },
];

export const archetypeDef = (id: Archetype): ArchetypeDef => ARCHETYPE_DEFS.find((a) => a.id === id)!;

export interface PlaystyleDef {
  id: string;
  label: string;
  description: string;
  /** Attributes this playstyle gravitates to (0..1). Used to score champions outside a player's pool. */
  affinity: Partial<Attributes>;
  curve?: Partial<PowerCurve>;
  archetypes?: Archetype[];
}

export const PLAYSTYLES: PlaystyleDef[] = [
  { id: "aggressive", label: "Aggressive", description: "Looks for early kills and lane pressure.", affinity: { burst: 0.5 }, curve: { early: 1 }, archetypes: ["early", "dive"] },
  { id: "scaling", label: "Scaling / Farm", description: "Prefers to farm up and take over late.", affinity: { dps: 0.6 }, curve: { late: 1 }, archetypes: ["scaling", "protect"] },
  { id: "roamer", label: "Roamer", description: "Leaves lane to impact the map.", affinity: { mobility: 1, pick: 0.6 }, archetypes: ["pick", "skirmish"] },
  { id: "teamfighter", label: "Teamfighter", description: "Shines in 5v5 fights.", affinity: { engage: 0.6, cc: 0.6, dps: 0.4 }, archetypes: ["engage", "protect"] },
  { id: "splitpusher", label: "Split pusher", description: "Happy on an island applying side-lane pressure.", affinity: { splitpush: 1 }, archetypes: ["split"] },
  { id: "playmaker", label: "Playmaker", description: "Starts fights and hunts picks.", affinity: { engage: 0.8, pick: 0.8 }, archetypes: ["engage", "pick"] },
  { id: "protector", label: "Protector / Peeler", description: "Keeps carries alive.", affinity: { peel: 1, disengage: 0.6, sustain: 0.5 }, archetypes: ["protect"] },
  { id: "tank", label: "Tank / Frontline", description: "Comfortable soaking damage in front.", affinity: { frontline: 1, cc: 0.4 }, archetypes: ["engage"] },
  { id: "assassin", label: "Assassin", description: "Burst down key targets.", affinity: { burst: 1, mobility: 0.6 }, archetypes: ["pick", "dive"] },
  { id: "control-mage", label: "Control / Poke mage", description: "Controls space from range.", affinity: { poke: 0.8, waveclear: 0.6, cc: 0.5 }, archetypes: ["poke"] },
  { id: "hypercarry", label: "Hyper carry", description: "Wants resources and a team built around them.", affinity: { dps: 1 }, curve: { late: 1 }, archetypes: ["protect", "scaling"] },
  { id: "enabler", label: "Utility / Enabler", description: "Buffs, heals and sets up allies.", affinity: { sustain: 0.8, cc: 0.5, peel: 0.5 }, archetypes: ["protect"] },
  { id: "weakside", label: "Fine on weak side", description: "Can play low-resource, self-sufficient picks.", affinity: { waveclear: 0.3, frontline: 0.3 } },
  { id: "shotcaller", label: "Shotcaller", description: "Makes the calls; values comps with clear win conditions.", affinity: {} },
];

export interface TraitDef {
  id: string;
  label: string;
  description: string;
  /**
   * When used as a weakness: what about ENEMY champions exploits it.
   * When used as a strength: what about enemy champions the player handles well.
   */
  enemy?: { attr?: AttributeKey; range?: RangeType; curve?: keyof PowerCurve };
  /** Team/game-phase affinity when used as a strength (for comp preferences). */
  team?: { attrs?: Partial<Attributes>; curve?: Partial<PowerCurve>; archetypes?: Archetype[] };
}

export const TRAITS: TraitDef[] = [
  { id: "laning", label: "Laning", description: "Winning or holding lane." },
  { id: "teamfighting", label: "Teamfighting", description: "Positioning and execution in 5v5s.", team: { archetypes: ["engage", "protect"] } },
  { id: "macro", label: "Macro / rotations", description: "Map movements, side lanes, objective setups.", team: { archetypes: ["split", "pick"] } },
  { id: "mechanics", label: "Mechanics", description: "Execution on high-skill champions." },
  { id: "early-game", label: "Early game", description: "Proactive early plays.", team: { curve: { early: 1 }, archetypes: ["early"] } },
  { id: "late-game", label: "Late game", description: "Late-game decision making.", team: { curve: { late: 1 }, archetypes: ["scaling"] } },
  { id: "vs-poke", label: "Vs. poke", description: "Dealing with long-range harass.", enemy: { attr: "poke" } },
  { id: "vs-burst", label: "Vs. burst / assassins", description: "Surviving burst and dive.", enemy: { attr: "burst" } },
  { id: "vs-cc", label: "Vs. heavy CC", description: "Playing around stuns and catches.", enemy: { attr: "cc" } },
  { id: "vs-tanks", label: "Vs. tanks", description: "Dealing with durable frontliners.", enemy: { attr: "frontline" } },
  { id: "vs-mobility", label: "Vs. mobile champions", description: "Tracking and punishing slippery targets.", enemy: { attr: "mobility" } },
  { id: "vs-ranged", label: "Vs. ranged lanes", description: "Laning into ranged opponents.", enemy: { range: "ranged" } },
  { id: "vs-early", label: "Vs. early pressure / ganks", description: "Surviving early aggression and ganks.", enemy: { curve: "early" } },
  { id: "vs-sustain", label: "Vs. sustain", description: "Beating healing and shields.", enemy: { attr: "sustain" } },
  { id: "vs-splitpush", label: "Vs. split push", description: "Answering side-lane pressure.", enemy: { attr: "splitpush" } },
];

export const playstyleDef = (id: string) => PLAYSTYLES.find((p) => p.id === id);
export const traitDef = (id: string) => TRAITS.find((t) => t.id === id);

export const emptyAttributes = (): Attributes => ({
  engage: 0,
  disengage: 0,
  peel: 0,
  poke: 0,
  burst: 0,
  dps: 0,
  frontline: 0,
  cc: 0,
  mobility: 0,
  waveclear: 0,
  splitpush: 0,
  pick: 0,
  sustain: 0,
  siege: 0,
});

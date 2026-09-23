// Core domain types shared by the client, the Worker, the engine and the data scripts.
// This file is the contract between modules — change it deliberately.

export type GameId = "lol" | "dota2";
export const GAME_IDS: readonly GameId[] = ["lol", "dota2"];

/** Draft side. LoL: Blue/Red. Dota 2: Radiant (blue) / Dire (red). */
export type Side = "blue" | "red";
export const SIDES: readonly Side[] = ["blue", "red"];
export const otherSide = (s: Side): Side => (s === "blue" ? "red" : "blue");

/** A team in a room/series. Slots stay fixed across a series while sides can swap between games. */
export type TeamSlot = "A" | "B";
export const TEAM_SLOTS: readonly TeamSlot[] = ["A", "B"];
export const otherSlot = (s: TeamSlot): TeamSlot => (s === "A" ? "B" : "A");

export type ActionType = "pick" | "ban";

/**
 * Game-specific position id.
 * LoL: "top" | "jungle" | "mid" | "bot" | "support"
 * Dota 2: "pos1" | "pos2" | "pos3" | "pos4" | "pos5"
 */
export type Role = string;

export type DamageType = "physical" | "magic" | "mixed";
export type RangeType = "melee" | "ranged";
export type Tier = "S" | "A" | "B" | "C" | "D";
export const TIERS: readonly Tier[] = ["S", "A", "B", "C", "D"];

/** Composition attributes, each rated 0 (none) .. 3 (elite) per champion. */
export const ATTRIBUTE_KEYS = [
  "engage",
  "disengage",
  "peel",
  "poke",
  "burst",
  "dps",
  "frontline",
  "cc",
  "mobility",
  "waveclear",
  "splitpush",
  "pick",
  "sustain",
  "siege",
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

/** Team composition archetypes / win conditions. */
export const ARCHETYPES = [
  "engage",
  "poke",
  "pick",
  "split",
  "protect",
  "dive",
  "skirmish",
  "early",
  "scaling",
  "push",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Relative strength over the game, each 0..3. */
export interface PowerCurve {
  early: number;
  mid: number;
  late: number;
}

/** Reference to another champion with a strength 1 (slight) .. 3 (strong). */
export interface RelationRef {
  id: string;
  s: 1 | 2 | 3;
  /** true when this is specifically a lane matchup (same or opposing lane), not a general teamfight interaction. */
  lane?: boolean;
  note?: string;
}

/**
 * Hand-curated per-champion knowledge. Lives in data/<game>/curated/*.json as `CuratedChampion[]`.
 * Merged with live source data (Data Dragon / OpenDota) by scripts/build-data.ts.
 */
export interface CuratedChampion {
  /** LoL: Data Dragon id (e.g. "MonkeyKing", "KSante"). Dota 2: hero short name without npc_dota_hero_ (e.g. "antimage"). */
  id: string;
  /** Positions this champion is actually played in, most common first. */
  roles: Role[];
  damage: DamageType;
  range: RangeType;
  attributes: Attributes;
  powerCurve: PowerCurve;
  /** 1-4 composition archetypes this champion fits best, best first. */
  archetypes: Archetype[];
  /** Champions this one is favored against. */
  strongVs: RelationRef[];
  /** Champions that are favored against this one. */
  weakVs: RelationRef[];
  /** Champions that combo well with this one on the same team. */
  synergies: RelationRef[];
  /** Curated baseline meta tier per role (current patch knowledge). */
  meta?: Partial<Record<Role, Tier>>;
  /** 1 easy .. 3 hard. */
  difficulty?: 1 | 2 | 3;
  /** 1-2 sentences of draft-relevant summary (identity, win condition, what it needs). */
  notes?: string;
}

export interface MetaStat {
  tier: Tier;
  /** 0..1 */
  winRate?: number;
  /** 0..1 */
  pickRate?: number;
  /** 0..1 */
  banRate?: number;
  games?: number;
}

/** Runtime champion/hero record inside a GameDataBundle. */
export interface Champion {
  id: string;
  /** Numeric id (LoL champion key / Dota hero id). */
  key: number;
  name: string;
  title?: string;
  /** Absolute URL of the square portrait. */
  image: string;
  roles: Role[];
  /** Source class tags (LoL: Fighter/Mage/…, Dota: Carry/Disabler/…). */
  tags: string[];
  damage: DamageType;
  range: RangeType;
  attributes: Attributes;
  powerCurve: PowerCurve;
  archetypes: Archetype[];
  /** Meta per role this champion is played in. */
  meta: Partial<Record<Role, MetaStat>>;
  /** 1..3 */
  difficulty: number;
  notes?: string;
  /** false when attributes were derived heuristically (e.g. a brand-new champion not yet curated). */
  curated: boolean;
}

/** One directed matchup cell. adv in [-1, 1]; positive = row champion favored against column champion. */
export interface MatchupCell {
  adv: number;
  /** Sample size when derived from match data. */
  n?: number;
  /** true when this is a lane-specific matchup. */
  lane?: boolean;
}

/** Everything the client and engine need about one game. Served as static /data/<game>.json. */
export interface GameDataBundle {
  game: GameId;
  /** Data/patch version, e.g. Data Dragon "16.18.1". */
  version: string;
  /** ISO timestamp. */
  generatedAt: string;
  sources: string[];
  champions: Champion[];
  /** Sparse directed matrix: matchups[a][b]. Builders should write both directions (b→a = -adv). */
  matchups: Record<string, Record<string, MatchupCell>>;
  /** Sparse symmetric synergy strength in (0, 1]: synergies[a][b]. */
  synergies: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Team profiles
// ---------------------------------------------------------------------------

/** "team" = your own roster; "scout" = a profile you keep on an opponent. */
export type TeamKind = "team" | "scout";

export type RolePrefLevel = "main" | "secondary" | "fill";
export interface RolePref {
  role: Role;
  pref: RolePrefLevel;
}

export interface PoolEntry {
  championId: string;
  /** 1 = can play it, 3 = comfortable, 5 = signature/one-trick level. */
  comfort: 1 | 2 | 3 | 4 | 5;
  /** Roles the player plays this champion in (defaults to champion roles ∩ player roles). */
  roles?: Role[];
  note?: string;
}

export interface AvoidEntry {
  championId: string;
  /** 1 = dislike, 2 = struggle, 3 = hate / auto-lose. */
  severity: 1 | 2 | 3;
  note?: string;
}

export interface PlayerProfile {
  id: string;
  name: string;
  roles: RolePref[];
  pool: PoolEntry[];
  /** Ids from PLAYSTYLES (games.ts). */
  playstyles: string[];
  /** Ids from TRAITS (games.ts). */
  strengths: string[];
  /** Ids from TRAITS (games.ts). */
  weaknesses: string[];
  /** Champions this player hates playing against. */
  avoid: AvoidEntry[];
  notes: string;
  /** true when a player key has been issued for this slot. */
  claimed: boolean;
  updatedAt: string;
}

/** A team's own belief about a matchup, overriding the dataset. adv in [-1, 1] from a's perspective. */
export interface TeamOverride {
  a: string;
  b: string;
  adv: number;
  note?: string;
}

export interface TeamProfile {
  id: string;
  kind: TeamKind;
  game: GameId;
  name: string;
  tag: string;
  notes: string;
  preferredArchetypes: Archetype[];
  avoidArchetypes: Archetype[];
  overrides: TeamOverride[];
  /** When locked, only the owner can edit anything. */
  locked: boolean;
  players: PlayerProfile[];
  createdAt: string;
  updatedAt: string;
}

/** Who is making a request against a team. Designed so a future account system (Discord OAuth) can resolve to the same principals. */
export type Principal =
  | { kind: "owner" }
  | { kind: "player"; playerId: string }
  | { kind: "viewer" };

export interface AuditEntry {
  id: string;
  teamId: string;
  /** "owner" | "player:<id>" | "system" */
  actor: string;
  actorName?: string;
  action: string;
  /** "team" | "player:<id>" */
  target: string;
  summary: string;
  /** Snapshot before the change (TeamProfile fields or PlayerProfile), null for creations. */
  before: unknown;
  after: unknown;
  revertible: boolean;
  createdAt: string;
}

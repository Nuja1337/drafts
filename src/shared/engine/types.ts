// Draft engine contract. Implementation: src/shared/engine/index.ts exports `analyzeDraft(input): EngineOutput`.
// The engine is pure, synchronous, deterministic and runs in the browser on every draft change — keep it fast (<30ms for 170 champions).
import type { DraftAction, DraftFormat } from "../room";
import type {
  ActionType,
  Archetype,
  AttributeKey,
  Attributes,
  GameDataBundle,
  PowerCurve,
  Role,
  Side,
  TeamProfile,
} from "../types";

/** Multipliers applied to each scoring component. 1 = default; 0 disables. UI exposes these as sliders (0..2). */
export interface EngineWeights {
  /** Meta strength (tier / win rate) of the champion in the role. */
  meta: number;
  /** Player comfort: pool entries, main roles, playstyle fit. */
  comfort: number;
  /** Counter value against already-picked enemies (lane matchups weighted higher). */
  counter: number;
  /** Synergy with already-picked allies. */
  synergy: number;
  /** Fills composition needs (damage split, frontline, engage, …) and fits the comp's archetype. */
  composition: number;
  /** Team preferences: preferred/avoided archetypes, player strengths/weaknesses, hated matchups. */
  team: number;
  /** Blind-pick safety: penalty for picks that are easily countered by enemy picks still to come. */
  risk: number;
  /** Denial: value of taking/banning what the enemy wants (enemy comfort, enemy comp needs). */
  deny: number;
}

export const DEFAULT_WEIGHTS: EngineWeights = {
  meta: 1,
  comfort: 1,
  counter: 1,
  synergy: 1,
  composition: 1,
  team: 1,
  risk: 1,
  deny: 1,
};

export interface EngineInput {
  data: GameDataBundle;
  format: DraftFormat;
  /** Side that acts on the format's "first" steps this game. */
  firstSide: Side;
  /** Completed actions of the current game, in order. */
  actions: DraftAction[];
  /** Extra unavailable champions (fearless locks from earlier games) — per side, since soft fearless differs per team. */
  unavailable: Record<Side, string[]>;
  /** Side we are generating suggestions for. */
  perspective: Side;
  /** Profiles for the teams on each side, when known to this client. */
  teams: Partial<Record<Side, TeamProfile | null>>;
  weights?: Partial<EngineWeights>;
  /** Max suggestions per list (default 12). */
  limit?: number;
}

export type ReasonKind =
  | "meta"
  | "comfort"
  | "playstyle"
  | "counter"
  | "countered"
  | "synergy"
  | "composition"
  | "archetype"
  | "flex"
  | "blind-risk"
  | "deny"
  | "avoid"
  | "weakness"
  | "strength"
  | "override"
  | "role-filled";

export interface Reason {
  kind: ReasonKind;
  /** Signed contribution to the score (score units). */
  delta: number;
  /** Short human sentence, e.g. "Counters Darius (top lane, strong)". */
  text: string;
}

export interface Suggestion {
  championId: string;
  /** Final score; higher is better. Roughly 0..100 but unbounded. */
  score: number;
  /** Best role for this champion in the suggesting team (null if undetermined). */
  role: Role | null;
  /** Player best suited to play it (when a team profile is known). */
  playerId?: string;
  playerName?: string;
  reasons: Reason[];
}

export interface RoleSlot {
  championId: string;
  role: Role;
  playerId?: string;
  playerName?: string;
}

export interface CompAnalysis {
  side: Side;
  championIds: string[];
  /** Sum of champion attributes (each champion 0..3 per attribute). */
  attributes: Attributes;
  /** 0..100 normalized per attribute, relative to what a "complete" 5-champion comp typically has. */
  attributeScores: Attributes;
  /** Share of damage (sums to 1 when any champions picked). */
  damage: { physical: number; magic: number };
  /** Average power curve of the picked champions. */
  curve: PowerCurve;
  /** Archetype fit, best first; score 0..100. */
  archetypes: { id: Archetype; score: number }[];
  strengths: string[];
  warnings: string[];
  /** Attributes the comp is clearly missing (for "fills a need" reasoning). */
  missing: AttributeKey[];
}

export interface LaneMatchup {
  /** Blue's role. */
  role: Role;
  /** Red's role it lanes against (LANE_PAIR): the same role in LoL; e.g. pos3 for pos1 in Dota. */
  vs: Role;
  blue: string | null;
  red: string | null;
  /** adv from blue's perspective in [-1, 1], null when either side missing. */
  adv: number | null;
  text: string;
}

export interface EngineOutput {
  /** The next step in the format, or null when the draft is complete. */
  next: { index: number; type: ActionType; side: Side } | null;
  /** Best picks for `perspective` right now (even when it's not our turn — "what we want next"). */
  picks: Suggestion[];
  /** Best picks per still-open role for `perspective`. */
  picksByRole: Record<Role, Suggestion[]>;
  /** Best bans for `perspective`. */
  bans: Suggestion[];
  /** Champions the enemy most likely wants next (threat list). */
  enemyThreats: Suggestion[];
  /** Inferred role (and player) for every picked champion on each side. */
  roles: Record<Side, RoleSlot[]>;
  comps: Record<Side, CompAnalysis>;
  lanes: LaneMatchup[];
  /** Heuristic draft-advantage estimate for `perspective`, 0..1 (0.5 = even). */
  winEstimate: number;
  /** Champions not selectable right now for `perspective` (picked, banned, fearless). */
  unavailable: string[];
}

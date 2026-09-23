// Scoring constants. Every component is expressed in "score points" at weight 1; EngineWeights multiply them.
// Calibrated so a balanced default roughly spans 0..100 and a comfort-5, main-role, A-tier pick that counters its
// lane opponent tops the list. Matchup adv follows src/shared/matchupMath.ts (curated hard counter = 0.4).
import type { AttributeKey, Attributes, Tier } from "../types";

export const TUNING = {
  /** Starting score for pick suggestions / enemy threats. */
  pickBase: 45,
  /** Starting score for ban suggestions. */
  banBase: 40,

  /** Meta tier value in the role. */
  tierPts: { S: 15, A: 9, B: 3, C: -3, D: -9 } as Record<Tier, number>,
  /** Win rate: points per +1% over 50%, capped, scaled by sample confidence (games / (games + metaPriorGames)). */
  winRatePtsPerPct: 0.8,
  winRateCap: 6,
  metaPriorGames: 300,
  /** Champion played in a role only through a player's pool (not a data role). */
  offRoleMeta: -6,

  /** Pool comfort 0..5 → points. */
  comfortPts: [0, 2, 5, 9, 14, 20] as const,
  /** Pool entry lists roles and this isn't one of them. */
  comfortOffRoleFactor: 0.5,
  /** Max bonus for a champion outside the pool that fits a player's playstyle. */
  playstyleMax: 4,
  /** Off-pool, mechanically demanding champion (difficulty 3) for a player without the "mechanics" strength. */
  hardOffPool: -2,
  /** Champion outside the pool of a player who lists at least two champions for that role. */
  offPoolPts: -4,
  /** Points per unit of lineup cost (role-pref units: main 3, secondary 1.8, fill 0.6, unlisted -1). */
  lineupCostPts: 3.5,

  /** Counter points = scale × lane weight × adv × confidence. */
  counterScale: 18,
  lanePrimaryW: 2,
  laneSecondaryW: 1.6,
  /** Lane-specific matchup applied to champions that won't actually lane together. */
  offLaneLaneCellW: 0.35,
  generalW: 1,
  counterCap: 25,

  synergyScale: 9,
  synergyCap: 18,

  /** Composition: need-utility delta vs an average champion for the role. */
  compScale: 18,
  compNeedsCap: 14,
  /** One-sided damage (e.g. a 5th physical champion) must outweigh a tier step plus deny. */
  damageScale: 24,
  curveScale: 2.5,
  archetypeScale: 7,
  compositionCap: 22,

  /** Team preferences / player traits. */
  prefArchetype: 6,
  avoidArchetype: 6,
  traitTeam: 2,
  traitTeamCap: 4,
  mitigate: 5,
  avoidAnswer: 10,
  teamCap: 16,

  /** Blind risk: points per unit of counter threat (adv × lane weight × plausibility). */
  riskScale: 7,
  riskCap: 12,
  flex2: 3,
  flex3: 4.5,

  denyStrength: 5,
  denyComfortPerLevel: 1.6,
  denyCap: 10,

  /** Candidate for a filled role whose champion can move elsewhere: points per unit of role-fit lost. */
  roleFilledPts: 3,
  /** Max role-fit loss (primary→secondary = 1) for such a re-shuffle to be suggested at all. */
  maxFlexCost: 2,

  /** Bans. */
  avoidLane: 5,
  /** Scouted enemy player's hated matchups, when scoring our picks (× avoidLane × severity). */
  enemyAvoidFactor: 0.6,
  avoidTeam: 1.5,
  weaknessPts: 3.5,
  weaknessCap: 7,
  strengthPts: -2,
  compExploit: 3,
  ownComfortPerLevel: 5,
  ownWantCap: 25,

  /** Minimum |delta| for a reason to be listed. */
  minReason: 0.5,
  /** Extra discount on thin matchup samples: conf = 0.5 + 0.5·n/(n+prior). Builders already shrink adv. */
  sampleConfPrior: 30,
  lowSample: 30,
} as const;

/** How much a balanced comp needs each attribute (utility weights). */
export const NEEDS: Attributes = {
  engage: 0.8,
  disengage: 0.35,
  peel: 0.5,
  poke: 0.25,
  burst: 0.5,
  dps: 0.9,
  frontline: 1,
  cc: 0.9,
  mobility: 0.3,
  waveclear: 0.6,
  splitpush: 0.15,
  pick: 0.25,
  sustain: 0.25,
  siege: 0.35,
};

/** Fallback "complete comp" attribute sums (blended with data-derived norms). */
export const DEFAULT_TARGETS: Attributes = {
  engage: 4,
  disengage: 3,
  peel: 3.5,
  poke: 3.5,
  burst: 5,
  dps: 5,
  frontline: 5,
  cc: 7,
  mobility: 5.5,
  waveclear: 5.5,
  splitpush: 3,
  pick: 3.5,
  sustain: 3.5,
  siege: 4,
};

/** Attributes whose absence is called out as "missing". */
export const CORE_ATTRS: AttributeKey[] = ["frontline", "engage", "cc", "dps", "waveclear", "peel", "burst", "disengage"];

/** Enemy-exploited weakness trait → attributes on OUR candidate that mitigate it. */
export const MITIGATION: Record<string, { attrs: AttributeKey[]; ranged?: boolean; label: string }> = {
  "vs-poke": { attrs: ["sustain", "engage", "mobility"], label: "poke" },
  "vs-burst": { attrs: ["frontline", "sustain", "peel"], label: "burst" },
  "vs-cc": { attrs: ["mobility", "frontline", "disengage"], label: "crowd control" },
  "vs-tanks": { attrs: ["dps"], label: "tanks" },
  "vs-mobility": { attrs: ["cc", "pick"], label: "mobility" },
  "vs-ranged": { attrs: ["poke", "sustain"], ranged: true, label: "ranged laners" },
  "vs-early": { attrs: ["frontline", "disengage", "waveclear"], label: "early pressure" },
  "vs-sustain": { attrs: ["burst", "dps"], label: "sustain" },
  "vs-splitpush": { attrs: ["splitpush", "waveclear"], label: "split push" },
};

/** Likelihood the enemy actually plays a counter, by its meta tier in that role. */
export const TIER_PLAUSIBILITY: Record<Tier, number> = { S: 1, A: 0.9, B: 0.75, C: 0.55, D: 0.4 };
export const UNKNOWN_PLAUSIBILITY = 0.6;

/** Champion role fit (units): index in champion.roles → fit; unlisted = offRoleFit. */
export const ROLE_FIT_BY_INDEX = [3, 2, 1.5, 1] as const;
export const OFF_ROLE_FIT = -3;
/** Player role preference (units). */
export const ROLE_PREF_UNITS = { main: 3, secondary: 1.8, fill: 0.6 } as const;
export const UNLISTED_PREF_UNITS = -1;
/** Bonus per assigned player so the lineup DP fills as many roles as it can. */
export const FILL_BONUS = 10;
/** Pool comfort → assignment units (comfort × this). */
export const COMFORT_UNITS = 0.6;
/** Max players considered per team (DP is O(roles × 2^players × players)). */
export const MAX_PLAYERS = 8;

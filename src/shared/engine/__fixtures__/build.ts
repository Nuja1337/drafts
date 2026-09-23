// Terse builders for hand-written test bundles, team profiles and drafts.
import { getFormat } from "../../formats";
import { emptyAttributes } from "../../games";
import type { DraftAction, DraftFormat } from "../../room";
import { otherSide } from "../../types";
import type {
  Archetype,
  Attributes,
  AvoidEntry,
  Champion,
  DamageType,
  GameDataBundle,
  GameId,
  MatchupCell,
  PlayerProfile,
  PoolEntry,
  RangeType,
  Role,
  RolePref,
  Side,
  TeamProfile,
  Tier,
} from "../../types";

export interface ChampSpec {
  id: string;
  name?: string;
  roles: Role[];
  damage: DamageType;
  range: RangeType;
  attrs: Partial<Attributes>;
  /** [early, mid, late] */
  curve: [number, number, number];
  arch: Archetype[];
  /** Tier, or [tier, winRate, games?]. */
  meta?: Record<Role, Tier | [Tier, number, number?]>;
  difficulty?: number;
  curated?: boolean;
}

/** [a, b, adv of a over b, lane?, n?] — written in both directions. */
export type MatchupSpec = [string, string, number, boolean?, number?];
/** [a, b, synergy] — written in both directions. */
export type SynergySpec = [string, string, number];

export function champ(spec: ChampSpec, key: number): Champion {
  const meta: Champion["meta"] = {};
  for (const [role, m] of Object.entries(spec.meta ?? {})) {
    meta[role] = Array.isArray(m) ? { tier: m[0], winRate: m[1], ...(m[2] !== undefined ? { games: m[2] } : {}) } : { tier: m };
  }
  return {
    id: spec.id,
    key,
    name: spec.name ?? spec.id,
    image: `https://example.invalid/${spec.id}.png`,
    roles: spec.roles,
    tags: [],
    damage: spec.damage,
    range: spec.range,
    attributes: { ...emptyAttributes(), ...spec.attrs },
    powerCurve: { early: spec.curve[0], mid: spec.curve[1], late: spec.curve[2] },
    archetypes: spec.arch,
    meta,
    difficulty: spec.difficulty ?? 2,
    curated: spec.curated ?? true,
  };
}

export function bundle(game: GameId, specs: ChampSpec[], matchups: MatchupSpec[], synergies: SynergySpec[]): GameDataBundle {
  const m: Record<string, Record<string, MatchupCell>> = {};
  const put = (a: string, b: string, cell: MatchupCell) => ((m[a] ??= {})[b] = cell);
  for (const [a, b, adv, lane, n] of matchups) {
    const extra = { ...(lane ? { lane: true } : {}), ...(n !== undefined ? { n } : {}) };
    put(a, b, { adv, ...extra });
    put(b, a, { adv: -adv, ...extra });
  }
  const s: Record<string, Record<string, number>> = {};
  for (const [a, b, v] of synergies) {
    (s[a] ??= {})[b] = v;
    (s[b] ??= {})[a] = v;
  }
  return {
    game,
    version: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources: ["fixture"],
    champions: specs.map((c, i) => champ(c, i + 1)),
    matchups: m,
    synergies: s,
  };
}

export interface PlayerSpec {
  id: string;
  name: string;
  roles: [Role, RolePref["pref"]][];
  pool?: [string, PoolEntry["comfort"], Role[]?][];
  playstyles?: string[];
  strengths?: string[];
  weaknesses?: string[];
  avoid?: [string, AvoidEntry["severity"]][];
}

export function player(p: PlayerSpec): PlayerProfile {
  return {
    id: p.id,
    name: p.name,
    roles: p.roles.map(([role, pref]) => ({ role, pref })),
    pool: (p.pool ?? []).map(([championId, comfort, roles]) => ({ championId, comfort, ...(roles ? { roles } : {}) })),
    playstyles: p.playstyles ?? [],
    strengths: p.strengths ?? [],
    weaknesses: p.weaknesses ?? [],
    avoid: (p.avoid ?? []).map(([championId, severity]) => ({ championId, severity })),
    notes: "",
    claimed: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function team(game: GameId, id: string, name: string, players: PlayerSpec[], extra: Partial<TeamProfile> = {}): TeamProfile {
  return {
    id,
    kind: "team",
    game,
    name,
    tag: name.slice(0, 3).toUpperCase(),
    notes: "",
    preferredArchetypes: [],
    avoidArchetypes: [],
    overrides: [],
    locked: false,
    players: players.map(player),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

export function format(id: string): DraftFormat {
  const f = getFormat(id);
  if (!f) throw new Error(`unknown format ${id}`);
  return f;
}

/** Actions for the first `ids.length` steps of a format (null = skipped ban). */
export function actions(fmt: DraftFormat, firstSide: Side, ids: (string | null)[]): DraftAction[] {
  return ids.map((championId, index) => {
    const step = fmt.steps[index];
    const side = step.side === "first" ? firstSide : otherSide(firstSide);
    return { index, side, slot: side === firstSide ? "A" : "B", type: step.type, championId, at: 1_700_000_000_000 + index };
  });
}

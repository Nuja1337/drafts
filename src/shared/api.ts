// HTTP API contract. All endpoints are under /api. Errors are JSON `ApiErrorBody` with a non-2xx status.
// Team auth: `Authorization: Bearer <key>` where key is an owner key (own_…), player key (ply_…) or view key (view_…).
import type {
  Archetype,
  AttributeKey,
  AuditEntry,
  AvoidEntry,
  GameId,
  PlayerProfile,
  PoolEntry,
  Principal,
  Role,
  RolePref,
  Side,
  TeamKind,
  TeamOverride,
  TeamProfile,
} from "./types";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---- Teams --------------------------------------------------------------
// POST /api/teams                                   (public, rate limited)
export interface CreateTeamReq {
  name: string;
  game: GameId;
  kind?: TeamKind;
  tag?: string;
}
export interface CreateTeamRes {
  team: TeamProfile;
  ownerKey: string;
  inviteCode: string;
  viewKey: string;
}

// GET /api/teams/:teamId                            (owner | player | viewer)
export interface GetTeamRes {
  team: TeamProfile;
  you: Principal;
  /** Owner only. */
  inviteCode?: string;
  /** Owner only. */
  viewKey?: string;
}

// PATCH /api/teams/:teamId                          (owner)
export interface UpdateTeamReq {
  name?: string;
  tag?: string;
  notes?: string;
  preferredArchetypes?: Archetype[];
  avoidArchetypes?: Archetype[];
  overrides?: TeamOverride[];
  locked?: boolean;
}
export interface TeamRes {
  team: TeamProfile;
}

// DELETE /api/teams/:teamId                         (owner) → { ok: true }

// POST /api/teams/:teamId/players                   (owner) → TeamRes & { playerId }
export interface AddPlayerReq {
  name: string;
}

// PUT /api/teams/:teamId/players/:playerId          (owner, or that player when team not locked) → TeamRes
export interface UpdatePlayerReq {
  name?: string;
  roles?: RolePref[];
  pool?: PoolEntry[];
  playstyles?: string[];
  strengths?: string[];
  weaknesses?: string[];
  avoid?: AvoidEntry[];
  notes?: string;
}

// DELETE /api/teams/:teamId/players/:playerId       (owner) → TeamRes
// POST   /api/teams/:teamId/players/:playerId/release (owner: revoke that player's key; slot becomes unclaimed) → TeamRes

// POST /api/teams/:teamId/keys/rotate               (owner)
export interface RotateKeyReq {
  which: "invite" | "view" | "owner";
}
export interface RotateKeyRes {
  inviteCode?: string;
  viewKey?: string;
  ownerKey?: string;
}

// GET /api/teams/:teamId/audit?before=<iso>&limit=50 (owner | player)
export interface AuditRes {
  entries: AuditEntry[];
  /** Pass as ?before= to page back. */
  nextBefore?: string;
}
// POST /api/teams/:teamId/audit/:entryId/revert     (owner) → TeamRes

// ---- Invites ------------------------------------------------------------
// GET /api/invites/:teamId/:code                    (public)
export interface InviteInfoRes {
  teamId: string;
  teamName: string;
  game: GameId;
  kind: TeamKind;
  locked: boolean;
  openSlots: { id: string; name: string }[];
  /** false when the roster is full (12 players), so joining can only claim an open slot. */
  canCreate: boolean;
}
// POST /api/invites/:teamId/:code/join              (public, rate limited)
export interface JoinReq {
  /** Claim an existing unclaimed slot… */
  playerId?: string;
  /** …or create a new player with this name. */
  name?: string;
}
export interface JoinRes {
  team: TeamProfile;
  playerId: string;
  playerKey: string;
}

// ---- Rooms (see room.ts for CreateRoomReq/Res and the WS protocol) -----
// POST /api/rooms                                   (public, rate limited) body CreateRoomReq → CreateRoomRes
// GET  /api/rooms/:roomId                           (public) → RoomState
// GET  /api/rooms/:roomId/ws[?auth=1]              WebSocket upgrade; keys never go in the URL — with ?auth=1 the
//                                                   first frame is {t:"auth", key}; without it = spectator (room.ts)

// ---- AI coach -----------------------------------------------------------
// POST /api/coach                                   (public, AI rate limited) → CoachRes
export interface CoachChampionInfo {
  name: string;
  role: Role | null;
  player?: string;
}
export interface CoachReq {
  game: GameId;
  perspective: Side;
  /** Human-readable facts computed client-side by the engine; the model must ground on these. */
  context: {
    ourTeamName: string;
    enemyTeamName: string;
    phase: string;
    nextAction: string | null;
    ourPicks: CoachChampionInfo[];
    enemyPicks: CoachChampionInfo[];
    bans: string[];
    ourComp: { archetypes: string[]; strengths: string[]; warnings: string[]; damage: string; curve: string };
    enemyComp: { archetypes: string[]; strengths: string[]; warnings: string[]; damage: string; curve: string };
    topPickSuggestions: { name: string; role: string | null; player?: string; reasons: string[] }[];
    topBanSuggestions: { name: string; reasons: string[] }[];
    laneMatchups?: { role: string; ours: string; theirs: string; verdict: string }[];
    playerNotes?: string[];
  };
  /** Optional user question, max 300 chars. */
  question?: string;
}
export interface CoachRes {
  text: string;
  model: string;
}

// ---- Live data ----------------------------------------------------------
// GET /api/live/:game → LiveDataRes (cached; refreshed by the cron trigger)
export interface LiveDataRes {
  game: GameId;
  updatedAt: string | null;
  /** Dota 2: compact matchup overrides refreshed from OpenDota. Format documented in src/worker/live.ts. */
  matchups?: string;
  /** Optional meta overrides keyed by champion id. */
  meta?: Record<string, { winRate?: number; pickRate?: number; banRate?: number; games?: number }>;
}

// GET /api/health → { ok: true, time: string }

export type { AttributeKey, PlayerProfile };

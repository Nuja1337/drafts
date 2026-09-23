// Draft room model + WebSocket protocol. Pure types; logic lives in draft.ts (state machine) and the DraftRoom Durable Object.
import type { ActionType, GameId, Side, TeamSlot } from "./types";

/** One step of a draft format. "first" = the side that has first pick this game. */
export interface FormatStep {
  side: "first" | "second";
  type: ActionType;
}

export interface DraftFormat {
  id: string;
  game: GameId;
  name: string;
  description: string;
  steps: FormatStep[];
  /** Short labels for phases, keyed by the index of the first step in the phase. */
  phases?: { start: number; label: string }[];
}

/**
 * captains: each team gets its own captain link; host can act for either side (admin override).
 * host: a single host enters both sides (e.g. mirroring a real in-client champ select); everyone else spectates.
 */
export type RoomMode = "captains" | "host";

/** off = normal; soft = a team can't re-pick champions IT picked earlier in the series; hard = nobody can pick any champion picked earlier in the series. */
export type FearlessMode = "off" | "soft" | "hard";

export interface RoomTeam {
  name: string;
  /** Attached TeamProfile id. Clients only load it if they hold a key for that team. */
  profileId?: string | null;
}

export interface TimerConfig {
  enabled: boolean;
  pickSeconds: number;
  banSeconds: number;
}

export interface RoomConfig {
  game: GameId;
  formatId: string;
  mode: RoomMode;
  bestOf: 1 | 2 | 3 | 5;
  fearless: FearlessMode;
  timer: TimerConfig;
  teams: Record<TeamSlot, RoomTeam>;
  /**
   * Side with first pick in game 1 (default "blue"). Team A starts on blue. LoL: blue always picks first;
   * Dota 2 CM: the coin-toss winner may give first pick to either side. Later games choose it in `nextGame`.
   */
  firstSide?: Side;
}

export interface DraftAction {
  /** Index into format.steps. */
  index: number;
  side: Side;
  slot: TeamSlot;
  type: ActionType;
  /** null = skipped ban (timeout / "no ban"). */
  championId: string | null;
  at: number;
  /** true when the server auto-locked on timeout. */
  auto?: boolean;
}

/**
 * One game of the series. `RoomState.history` holds every earlier game, plus the current game as soon as the host
 * records its winner (so every client sees the result); undo/reset or clearing the winner removes that entry again.
 */
export interface GameRecord {
  number: number;
  sides: Record<Side, TeamSlot>;
  firstSide: Side;
  actions: DraftAction[];
  winner: TeamSlot | null;
}

export type RoomStatus = "lobby" | "drafting" | "paused" | "finished";

export interface RoomState {
  id: string;
  config: RoomConfig;
  status: RoomStatus;
  /** 1-based game number within the series. */
  gameNumber: number;
  /** Which team is on which side for the current game. */
  sides: Record<Side, TeamSlot>;
  /** Side that acts on "first" steps this game. */
  firstSide: Side;
  actions: DraftAction[];
  /** Earlier games (for series + fearless), plus the current game once its winner is recorded (see GameRecord). */
  history: GameRecord[];
  hovers: Record<Side, string | null>;
  ready: Record<TeamSlot, boolean>;
  /** Epoch ms when the current turn times out (null when no timer / not drafting). */
  turnDeadline: number | null;
  /** When paused with a timer running: ms left on the turn. */
  pausedRemainingMs: number | null;
  presence: { host: number; A: number; B: number; spectators: number };
  createdAt: number;
  updatedAt: number;
}

export type RoomRole = { kind: "host" } | { kind: "captain"; slot: TeamSlot } | { kind: "spectator" };

/**
 * WebSocket protocol (GET /api/rooms/:roomId/ws): JSON frames — ClientMsg and RoomControlMsg up, ServerMsg down — plus:
 * - Auth: room keys never go in the URL (URLs end up in request logs). A client holding a host/captain key connects
 *   with `?auth=1` and sends {t:"auth", key} as its first frame; the server holds the welcome until then and welcomes
 *   it in the key's role (a bad key: welcome as spectator, then a "bad_key" error). Without `?auth=1` a socket is
 *   welcomed as a spectator at once; it may still send "auth" later and gets a fresh welcome.
 * - Capacity: host and captain sockets never compete with spectators for room. Each keyed role keeps at most ~10
 *   sockets; past that its oldest socket is closed with 4409.
 * - Keepalive: the client may send the plain text frame "ka" (not JSON); the runtime answers "ka" without waking the
 *   Durable Object (cheap on the free tier). Clients send it every ~30 s.
 * - Close codes: 4404 room not found, 4410 room expired and 4409 replaced by a newer connection with the same key are
 *   final (don't reconnect); 4429 room full (retry with backoff); anything else — e.g. 4001 captain link revoked — is a
 *   normal drop (reconnect).
 */
export type ClientMsg =
  /**
   * `index` (optional) is the step the client meant to act on; the server rejects it with a "stale" error when the draft
   * has moved on (e.g. a timeout auto-lock landed first). Clients should always send it.
   */
  | { t: "hover"; championId: string | null; index?: number }
  /** Lock the given champion for the current step. Captains may only act on their own side's steps; host may act on any. */
  | { t: "lock"; championId: string | null; index?: number }
  | { t: "ready"; ready: boolean }
  /** Host only (captains mode also auto-starts when both teams are ready). */
  | { t: "start" }
  | { t: "pause" }
  | { t: "resume" }
  /** Host only: remove the last action. */
  | { t: "undo" }
  /** Host only: restart the current game's draft. */
  | { t: "reset" }
  /** Host, or the captain of that slot: rename team / attach a team profile. */
  | { t: "setTeam"; slot: TeamSlot; name?: string; profileId?: string | null }
  /**
   * Host only: record (or clear, with null) the winner of the finished current game — or, with `game`, correct an
   * earlier game's result ("bad_game" / "series_decided" when that isn't possible).
   */
  | { t: "setWinner"; winner: TeamSlot | null; game?: number }
  /** Host only, after the current game finished: begin the next game of the series. */
  | { t: "nextGame"; sides: Record<Side, TeamSlot>; firstSide: Side }
  | { t: "ping" };

/**
 * Connection-level frames, handled by the Durable Object itself (they never reach the draft reducer in draft.ts).
 */
export type RoomControlMsg =
  /** Sign in with a host or captain key (see the protocol notes above). */
  | { t: "auth"; key: string }
  /**
   * Host only, captains mode: issue a new captain link for `slot` (e.g. after the old one leaked). The old key stops
   * working at once — sockets using it are closed with 4001 and rejoin as spectators — and only the calling socket
   * receives the new key, in a "keyRotated" message.
   */
  | { t: "rotateKey"; slot: TeamSlot };

export type ServerMsg =
  | { t: "welcome"; you: RoomRole; state: RoomState; serverTime: number }
  | { t: "state"; state: RoomState; serverTime: number }
  | { t: "error"; code: string; message: string }
  | { t: "pong"; serverTime: number }
  /** Reply to rotateKey (host only): the new captain key for `slot`. */
  | { t: "keyRotated"; slot: TeamSlot; key: string };

export interface CreateRoomReq {
  config: RoomConfig;
}

export interface CreateRoomRes {
  roomId: string;
  hostKey: string;
  /** Present in captains mode. */
  captainKeys?: Record<TeamSlot, string>;
}

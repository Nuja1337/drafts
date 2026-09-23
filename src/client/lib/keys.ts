// Local key store: team keys (owner/player/view) and room keys live only in this browser's localStorage.
// Every access is wrapped — storage can be unavailable (private mode, blocked site data).
import type { GameId, TeamKind } from "../../shared/types";
import { shouldStoreRoomKey } from "./roomKeys";

export { roomKeyRank } from "./roomKeys";

export type TeamKeyRole = "owner" | "player" | "view";
export interface StoredTeamKey {
  teamId: string;
  key: string;
  role: TeamKeyRole;
  playerId?: string;
  /** Cached for listing without a network round-trip. */
  teamName: string;
  game: GameId;
  kind: TeamKind;
  savedAt: number;
}

export interface StoredRoom {
  roomId: string;
  key?: string;
  label: string;
  game: GameId;
  savedAt: number;
}

const TEAM_KEYS = "drafts.teamKeys.v1";
const ROOMS = "drafts.rooms.v1";

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("drafts:keys"));
}

const rank: Record<TeamKeyRole, number> = { owner: 3, player: 2, view: 1 };

export function listTeamKeys(): StoredTeamKey[] {
  return Object.values(read<Record<string, StoredTeamKey>>(TEAM_KEYS, {})).sort((a, b) => b.savedAt - a.savedAt);
}
export function getTeamKey(teamId: string): StoredTeamKey | undefined {
  return read<Record<string, StoredTeamKey>>(TEAM_KEYS, {})[teamId];
}
/** Saves a key; never downgrades an existing stronger key (owner > player > view) unless `force`. */
export function saveTeamKey(entry: Omit<StoredTeamKey, "savedAt">, force = false) {
  const all = read<Record<string, StoredTeamKey>>(TEAM_KEYS, {});
  const prev = all[entry.teamId];
  if (prev && !force && rank[prev.role] > rank[entry.role]) {
    all[entry.teamId] = { ...prev, teamName: entry.teamName, savedAt: Date.now() };
  } else {
    all[entry.teamId] = { ...entry, savedAt: Date.now() };
  }
  write(TEAM_KEYS, all);
}
export function updateTeamMeta(teamId: string, patch: Partial<Pick<StoredTeamKey, "teamName" | "game" | "kind">>) {
  const all = read<Record<string, StoredTeamKey>>(TEAM_KEYS, {});
  if (!all[teamId]) return;
  all[teamId] = { ...all[teamId], ...patch };
  write(TEAM_KEYS, all);
}
export function forgetTeam(teamId: string) {
  const all = read<Record<string, StoredTeamKey>>(TEAM_KEYS, {});
  delete all[teamId];
  write(TEAM_KEYS, all);
}

export function listRooms(): StoredRoom[] {
  return Object.values(read<Record<string, StoredRoom>>(ROOMS, {})).sort((a, b) => b.savedAt - a.savedAt);
}
export function getRoom(roomId: string): StoredRoom | undefined {
  return read<Record<string, StoredRoom>>(ROOMS, {})[roomId];
}
export function saveRoom(entry: Omit<StoredRoom, "savedAt">) {
  const all = read<Record<string, StoredRoom>>(ROOMS, {});
  const prev = all[entry.roomId];
  all[entry.roomId] = { ...prev, ...entry, key: entry.key ?? prev?.key, savedAt: Date.now() };
  // keep the 30 most recent
  const sorted = Object.values(all).sort((a, b) => b.savedAt - a.savedAt).slice(0, 30);
  write(ROOMS, Object.fromEntries(sorted.map((r) => [r.roomId, r])));
}
/**
 * Stores a room key the server has confirmed (it welcomed us as host or captain). Never replaces a stronger stored key,
 * so opening a captain link in the host's browser doesn't demote it. Returns whether the stored key changed.
 */
export function saveRoomKey(roomId: string, key: string): boolean {
  const prev = getRoom(roomId);
  if (!shouldStoreRoomKey(prev?.key, key)) return false;
  saveRoom({ roomId, key, label: prev?.label ?? "Draft room", game: prev?.game ?? "lol" });
  return true;
}

export function forgetRoom(roomId: string) {
  const all = read<Record<string, StoredRoom>>(ROOMS, {});
  delete all[roomId];
  write(ROOMS, all);
}

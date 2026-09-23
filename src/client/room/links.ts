// Room link helpers + a small local store of the keys the room creator received, so the host can re-share
// captain links from inside the room later. Keys stay in this browser only; every storage access is wrapped.
import type { TeamSlot } from "../../shared/types";

export interface RoomLinks {
  hostKey?: string;
  captainKeys?: Partial<Record<TeamSlot, string>>;
  savedAt: number;
}

const STORE = "drafts.roomLinks.v1";
const MAX_ROOMS = 30;
/** Fired on window after saveRoomLinks, so an open share dialog picks up a rotated captain link. */
export const ROOM_LINKS_EVENT = "drafts:roomlinks";
/** This tab's saves, for when localStorage is unavailable (a rotated link must still be shown to the host). */
const memory: Record<string, RoomLinks> = {};

function readAll(): Record<string, RoomLinks> {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RoomLinks>) : {};
  } catch {
    return {};
  }
}

export function getRoomLinks(roomId: string): RoomLinks | undefined {
  const stored = readAll()[roomId];
  const mine = memory[roomId];
  return !mine || (stored && stored.savedAt >= mine.savedAt) ? stored : mine;
}

export function saveRoomLinks(roomId: string, links: Omit<RoomLinks, "savedAt">) {
  const all = readAll();
  all[roomId] = { ...(all[roomId] ?? memory[roomId]), ...links, savedAt: Date.now() };
  memory[roomId] = all[roomId];
  const kept = Object.entries(all)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_ROOMS);
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: links are still shown once on the create page, and kept in memory for this tab */
  }
  try {
    window.dispatchEvent(new CustomEvent(ROOM_LINKS_EVENT, { detail: { roomId } }));
  } catch {
    /* no window (tests) */
  }
}

/** Absolute room URL; with a key it becomes a host/captain link. */
export function roomUrl(roomId: string, key?: string | null): string {
  const base = `${window.location.origin}/r/${encodeURIComponent(roomId)}`;
  return key ? `${base}?k=${encodeURIComponent(key)}` : base;
}

// Loads the team profiles attached to a room's slots — only those this browser holds a key for.
import { useEffect, useRef, useState } from "react";
import type { GetTeamRes } from "../../shared/api";
import type { GameId, TeamProfile, TeamSlot } from "../../shared/types";
import { api } from "../lib/api";
import { getTeamKey } from "../lib/keys";

export type ProfileStatus = "none" | "nokey" | "loading" | "ok" | "error";
export interface ProfileState {
  status: ProfileStatus;
  profile: TeamProfile | null;
  error?: string;
}

/** `key` is the credential the entry was fetched with, so a changed key triggers a refetch. */
type Entry = { key: string } & ({ status: "loading" } | { status: "ok"; profile: TeamProfile } | { status: "error"; error: string });

/** Re-renders when stored team keys change (this tab or another). */
function useKeysVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("drafts.teamKeys")) bump();
    };
    window.addEventListener("drafts:keys", bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("drafts:keys", bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return v;
}

export function useTeamProfiles(game: GameId | undefined, ids: Record<TeamSlot, string | null | undefined>): Record<TeamSlot, ProfileState> {
  const keysVersion = useKeysVersion();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const idA = ids.A ?? null;
  const idB = ids.B ?? null;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const id of new Set([idA, idB])) {
      if (!id) continue;
      const stored = getTeamKey(id);
      if (!stored) continue;
      const prev = entriesRef.current[id];
      // Already loaded (or in flight) with this exact key: nothing to do.
      if (prev && prev.key === stored.key && prev.status !== "error") continue;
      const key = stored.key;
      entriesRef.current = { ...entriesRef.current, [id]: { key, status: "loading" } };
      setEntries((p) => ({ ...p, [id]: { key, status: "loading" } }));
      // Results apply only while mounted and only if the entry wasn't superseded by a newer key.
      const settle = (entry: Entry) => {
        if (!mounted.current) return;
        setEntries((p) => (p[id]?.key === key ? { ...p, [id]: entry } : p));
      };
      api<GetTeamRes>("GET", `/teams/${encodeURIComponent(id)}`, undefined, key).then(
        (res) => settle({ key, status: "ok", profile: res.team }),
        (err: unknown) => settle({ key, status: "error", error: err instanceof Error ? err.message : "Could not load team profile." }),
      );
    }
  }, [idA, idB, keysVersion]);

  const resolve = (id: string | null): ProfileState => {
    if (!id) return { status: "none", profile: null };
    const stored = getTeamKey(id);
    if (!stored) return { status: "nokey", profile: null };
    const e = entries[id];
    if (!e || e.status === "loading" || e.key !== stored.key) return { status: "loading", profile: null };
    if (e.status === "error") return { status: "error", profile: null, error: e.error };
    // A profile for another game can't inform this draft.
    if (game && e.profile.game !== game) return { status: "error", profile: null, error: "This profile is for a different game." };
    return { status: "ok", profile: e.profile };
  };

  return { A: resolve(idA), B: resolve(idB) };
}

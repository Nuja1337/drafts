// Team API hooks and mutation helpers. Keys live in lib/keys.ts; every team call sends the stored key as a Bearer token.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AddPlayerReq,
  AuditRes,
  CreateTeamReq,
  CreateTeamRes,
  GetTeamRes,
  InviteInfoRes,
  JoinReq,
  JoinRes,
  RotateKeyReq,
  RotateKeyRes,
  TeamRes,
  UpdatePlayerReq,
  UpdateTeamReq,
} from "../../shared/api";
import type { PlayerProfile, Principal, TeamProfile } from "../../shared/types";
import { api, ApiRequestError } from "./api";
import {
  getTeamKey,
  listRooms,
  listTeamKeys,
  saveTeamKey,
  updateTeamMeta,
  type StoredRoom,
  type StoredTeamKey,
  type TeamKeyRole,
} from "./keys";

/** Mirrors the server's validation limits (src/worker/teams/schema.ts) so forms can stop bad input early. */
export const TEAM_LIMITS = {
  teamName: 40,
  tag: 8,
  notes: 4000,
  playerName: 32,
  note: 200,
  pool: 80,
  avoid: 50,
  overrides: 300,
  players: 12,
} as const;

const seg = encodeURIComponent;
const teamPath = (teamId: string) => `/teams/${seg(teamId)}`;

/** Raw endpoint wrappers. Each takes the key explicitly so callers decide which credential to use. */
export const teamApi = {
  create: (req: CreateTeamReq) => api<CreateTeamRes>("POST", "/teams", req),
  get: (teamId: string, key: string) => api<GetTeamRes>("GET", teamPath(teamId), undefined, key),
  update: (teamId: string, key: string, req: UpdateTeamReq) => api<TeamRes>("PATCH", teamPath(teamId), req, key),
  remove: (teamId: string, key: string) => api<{ ok: true }>("DELETE", teamPath(teamId), undefined, key),
  addPlayer: (teamId: string, key: string, req: AddPlayerReq) =>
    api<TeamRes & { playerId: string }>("POST", `${teamPath(teamId)}/players`, req, key),
  updatePlayer: (teamId: string, key: string, playerId: string, req: UpdatePlayerReq) =>
    api<TeamRes>("PUT", `${teamPath(teamId)}/players/${seg(playerId)}`, req, key),
  removePlayer: (teamId: string, key: string, playerId: string) =>
    api<TeamRes>("DELETE", `${teamPath(teamId)}/players/${seg(playerId)}`, undefined, key),
  releasePlayer: (teamId: string, key: string, playerId: string) =>
    api<TeamRes>("POST", `${teamPath(teamId)}/players/${seg(playerId)}/release`, undefined, key),
  rotateKey: (teamId: string, key: string, which: RotateKeyReq["which"]) =>
    api<RotateKeyRes>("POST", `${teamPath(teamId)}/keys/rotate`, { which } satisfies RotateKeyReq, key),
  audit: (teamId: string, key: string, opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return api<AuditRes>("GET", `${teamPath(teamId)}/audit${qs ? `?${qs}` : ""}`, undefined, key);
  },
  revert: (teamId: string, key: string, entryId: string) =>
    api<TeamRes>("POST", `${teamPath(teamId)}/audit/${seg(entryId)}/revert`, undefined, key),
  invite: (teamId: string, code: string) => api<InviteInfoRes>("GET", `/invites/${seg(teamId)}/${seg(code)}`),
  join: (teamId: string, code: string, req: JoinReq) => api<JoinRes>("POST", `/invites/${seg(teamId)}/${seg(code)}/join`, req),
};

// ---- Links -----------------------------------------------------------------

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
export const teamUrl = (teamId: string, key?: string) => `${origin()}/t/${seg(teamId)}${key ? `?key=${seg(key)}` : ""}`;
export const inviteUrl = (teamId: string, code: string) => `${origin()}/join/${seg(teamId)}/${seg(code)}`;
export const playerPath = (teamId: string, playerId: string) => `/t/${seg(teamId)}/p/${seg(playerId)}`;

// ---- Principals & permissions ----------------------------------------------

export const principalRole = (p: Principal): TeamKeyRole => (p.kind === "owner" ? "owner" : p.kind === "player" ? "player" : "view");

const ROLE_RANK: Record<TeamKeyRole, number> = { owner: 3, player: 2, view: 1 };

export const KEY_ROLE_LABEL: Record<TeamKeyRole, string> = { owner: "Owner", player: "Player", view: "Viewer" };

export function youLabel(team: TeamProfile, you: Principal): string {
  if (you.kind === "owner") return "Owner";
  if (you.kind === "viewer") return "Viewer";
  return team.players.find((p) => p.id === you.playerId)?.name ?? "Player";
}

export function canEditPlayer(team: TeamProfile, you: Principal, playerId: string): boolean {
  if (you.kind === "owner") return true;
  return you.kind === "player" && you.playerId === playerId && !team.locked;
}

/** Why a principal can't edit a player (null when they can). */
export function editBlockReason(team: TeamProfile, you: Principal, playerId: string): string | null {
  if (canEditPlayer(team, you, playerId)) return null;
  if (you.kind === "viewer") return "You have a view-only link. Ask the team owner for an invite link to claim and edit your own profile.";
  if (you.kind === "player" && you.playerId === playerId && team.locked)
    return "The owner has locked this team, so profile edits are paused until it is unlocked.";
  return "You can only edit your own profile. The team owner can edit every player.";
}

/** 401: the key is missing or no longer valid for this team (rotated, released, wrong team) — drop it. 403 means valid but not allowed. */
export const isKeyRejected = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError && e.status === 401;
export const isNotFound = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError && e.status === 404;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Stores `key` for a team after the server confirms what it is. */
function storeFromResponse(teamId: string, key: string, res: GetTeamRes, force: boolean) {
  saveTeamKey(
    {
      teamId,
      key,
      role: principalRole(res.you),
      playerId: res.you.kind === "player" ? res.you.playerId : undefined,
      teamName: res.team.name,
      game: res.team.game,
      kind: res.team.kind,
    },
    force,
  );
}

/**
 * Imports a key from a shared link: asks the server what it grants, then stores it.
 * A weaker link never replaces a stronger stored key — unless that stored key no longer works (rotated/released).
 */
export async function importTeamKey(teamId: string, key: string): Promise<GetTeamRes> {
  const res = await teamApi.get(teamId, key);
  const prev = getTeamKey(teamId);
  let force = false;
  if (prev && prev.key !== key && ROLE_RANK[prev.role] > ROLE_RANK[principalRole(res.you)]) {
    try {
      await teamApi.get(teamId, prev.key);
    } catch (e) {
      if (isKeyRejected(e) || isNotFound(e)) force = true;
    }
  }
  storeFromResponse(teamId, key, res, force);
  return res;
}

/** Saves the key returned by a successful join. A working owner key is kept (the owner already edits every player). */
export async function storeJoinKey(res: JoinRes): Promise<void> {
  const prev = getTeamKey(res.team.id);
  let force = false;
  if (prev?.role === "owner" && prev.key !== res.playerKey) {
    try {
      await teamApi.get(res.team.id, prev.key);
    } catch (e) {
      if (isKeyRejected(e) || isNotFound(e)) force = true;
    }
  }
  saveTeamKey(
    {
      teamId: res.team.id,
      key: res.playerKey,
      role: "player",
      playerId: res.playerId,
      teamName: res.team.name,
      game: res.team.game,
      kind: res.team.kind,
    },
    force,
  );
}

// ---- Local key store subscriptions ---------------------------------------------

function subscribeKeys(cb: () => void): () => void {
  window.addEventListener("drafts:keys", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("drafts:keys", cb);
    window.removeEventListener("storage", cb);
  };
}

/** Team keys saved in this browser, newest first; updates when keys change (also across tabs). */
export function useStoredTeams(): StoredTeamKey[] {
  const [list, setList] = useState(listTeamKeys);
  useEffect(() => subscribeKeys(() => setList(listTeamKeys())), []);
  return list;
}

export function useStoredRooms(): StoredRoom[] {
  const [list, setList] = useState(listRooms);
  useEffect(() => subscribeKeys(() => setList(listRooms())), []);
  return list;
}

export function useStoredTeamKey(teamId: string | undefined): StoredTeamKey | undefined {
  const [entry, setEntry] = useState(() => (teamId ? getTeamKey(teamId) : undefined));
  useEffect(() => {
    const sync = () => setEntry(teamId ? getTeamKey(teamId) : undefined);
    sync();
    return subscribeKeys(sync);
  }, [teamId]);
  return entry;
}

// ---- useTeam ------------------------------------------------------------------

export interface UseTeam {
  /** The key entry stored for this team in this browser (undefined = no access). */
  stored: StoredTeamKey | undefined;
  key: string | null;
  team: TeamProfile | null;
  you: Principal | null;
  /** Owner only. */
  inviteCode: string | null;
  /** Owner only. */
  viewKey: string | null;
  /** First load in flight (no data yet). */
  loading: boolean;
  /** Background refresh in flight (data still shown). */
  refreshing: boolean;
  error: Error | null;
  refresh: () => void;
  /** Applies a TeamProfile returned by a mutation without refetching. */
  setTeam: (team: TeamProfile) => void;
  /** Applies rotated owner-only secrets. */
  setSecrets: (patch: { inviteCode?: string; viewKey?: string }) => void;
}

interface LoadedTeam {
  teamId: string;
  key: string;
  res: GetTeamRes;
}

/** Loads a team with the key stored for it. Refetches when the stored key changes. */
export function useTeam(teamId: string | undefined): UseTeam {
  const stored = useStoredTeamKey(teamId);
  const key = stored?.key ?? null;
  const [loaded, setLoaded] = useState<LoadedTeam | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!teamId || !key) {
      setPending(false);
      setError(null);
      return;
    }
    const req = ++reqRef.current;
    setPending(true);
    setError(null);
    teamApi.get(teamId, key).then(
      (res) => {
        if (req !== reqRef.current) return;
        setLoaded({ teamId, key, res });
        setPending(false);
        // Keep the cached listing metadata and role in sync with what the server says.
        const s = getTeamKey(teamId);
        if (s && s.key === key) {
          const role = principalRole(res.you);
          const playerId = res.you.kind === "player" ? res.you.playerId : undefined;
          if (s.role !== role || s.playerId !== playerId || s.teamName !== res.team.name || s.game !== res.team.game || s.kind !== res.team.kind) {
            storeFromResponse(teamId, key, res, true);
          }
        }
      },
      (e: unknown) => {
        if (req !== reqRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setPending(false);
      },
    );
  }, [teamId, key, nonce]);

  // Keep showing this team's data while a new key (e.g. a rotated owner key) loads; drop it once a key is rejected
  // or the team is gone, so stale permissions are never shown.
  const current =
    loaded && key && loaded.teamId === teamId && !(error && (loaded.key !== key || isKeyRejected(error) || isNotFound(error))) ? loaded.res : null;

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const setTeam = useCallback((team: TeamProfile) => {
    setLoaded((l) => (l && l.teamId === team.id ? { ...l, res: { ...l.res, team } } : l));
    const s = getTeamKey(team.id);
    if (s && s.teamName !== team.name) updateTeamMeta(team.id, { teamName: team.name });
  }, []);
  const setSecrets = useCallback((patch: { inviteCode?: string; viewKey?: string }) => {
    setLoaded((l) => (l ? { ...l, res: { ...l.res, ...patch } } : l));
  }, []);

  return {
    stored,
    key,
    team: current?.team ?? null,
    you: current?.you ?? null,
    inviteCode: current?.inviteCode ?? null,
    viewKey: current?.viewKey ?? null,
    loading: !!key && !current && !error,
    refreshing: pending && !!current,
    // A failed background refresh (e.g. network) keeps showing the last good data; the error is still surfaced.
    error,
    refresh,
    setTeam,
    setSecrets,
  };
}

export const findPlayer = (team: TeamProfile | null, playerId: string | undefined): PlayerProfile | undefined =>
  team && playerId ? team.players.find((p) => p.id === playerId) : undefined;

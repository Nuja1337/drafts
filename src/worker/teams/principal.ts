// Who is calling, relative to one team. Route code only ever sees a `Principal` (owner | player | viewer),
// never a raw credential, so new credential types can be added here without touching the routes.
//
// Today the only credential is a bearer key. A future Discord OAuth login plugs in as another resolver:
// read the session cookie, load the account's membership for `team.id` (e.g. a `memberships` table mapping
// account → owner / playerId), and return the matching Principal. `hasCredentials` must then also report
// the session so a stale login gets 401 (re-authenticate) rather than 403.
import type { Principal } from "../../shared/types";
import { ApiError, bearer, safeEqual, sha256, type AppContext } from "../lib/http";
import type { TeamRecord } from "./store";

export type PrincipalKind = Principal["kind"];
export type PrincipalResolver = (c: AppContext, team: TeamRecord) => Promise<Principal | null>;

// Real keys are ~36-37 chars; refuse to hash arbitrarily long header values.
const MAX_KEY_LENGTH = 128;

/** Bearer keys: own_… (owner), ply_… (player slot), view_… (read-only). */
export const keyResolver: PrincipalResolver = async (c, team) => {
  const key = bearer(c);
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  if (key.startsWith("own_")) {
    return safeEqual(await sha256(key), team.ownerKeyHash) ? { kind: "owner" } : null;
  }
  if (key.startsWith("ply_")) {
    const hash = await sha256(key);
    // Scan every slot (≤ 12) without early exit so timing doesn't reveal which slot matched.
    let match: string | null = null;
    for (const p of team.players) if (p.keyHash && safeEqual(hash, p.keyHash)) match = p.id;
    return match ? { kind: "player", playerId: match } : null;
  }
  if (key.startsWith("view_")) {
    const [given, stored] = await Promise.all([sha256(key), sha256(team.viewKey)]);
    return safeEqual(given, stored) ? { kind: "viewer" } : null;
  }
  return null;
};

const resolvers: PrincipalResolver[] = [keyResolver];

/** First resolver that recognises the caller wins; null = no valid credential for this team. */
export async function resolvePrincipal(c: AppContext, team: TeamRecord): Promise<Principal | null> {
  for (const resolve of resolvers) {
    const p = await resolve(c, team);
    if (p) return p;
  }
  return null;
}

/** Whether the request carries any credential at all (decides 401 "sign in" vs 403 "not allowed"). */
export const hasCredentials = (c: AppContext): boolean => bearer(c) !== null;

/**
 * Resolves the caller and enforces the allowed principal kinds.
 * 401 = no credential, or one that doesn't belong to this team (rotated/released/wrong team) — the client should drop it.
 * 403 = a valid credential without the needed rights.
 */
export async function requirePrincipal(c: AppContext, team: TeamRecord, allowed: PrincipalKind[]): Promise<Principal> {
  const p = await resolvePrincipal(c, team);
  if (!p) {
    if (!hasCredentials(c)) throw new ApiError(401, "unauthorized", "This team is private. A team key is required.");
    throw new ApiError(401, "invalid_key", "That key isn't valid for this team (it may have been rotated or released).");
  }
  if (!allowed.includes(p.kind)) {
    const msg =
      allowed.length === 1 && allowed[0] === "owner"
        ? "Only the team owner can do that."
        : p.kind === "viewer"
          ? "A view key can only see the team profile. That needs a player or owner key."
          : "You don't have permission to do that.";
    throw new ApiError(403, "forbidden", msg);
  }
  return p;
}

/** Audit attribution for a principal. */
export function actorOf(p: Principal, team: TeamRecord): { actor: string; actorName: string } {
  switch (p.kind) {
    case "owner":
      return { actor: "owner", actorName: "Owner" };
    case "player":
      return { actor: `player:${p.playerId}`, actorName: team.players.find((x) => x.id === p.playerId)?.name ?? "Player" };
    case "viewer":
      return { actor: "viewer", actorName: "Viewer" };
  }
}

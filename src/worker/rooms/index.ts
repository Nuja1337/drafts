// Room routes (mounted under /api): create a room, read its state, upgrade to its WebSocket.
import { Hono } from "hono";
import { ROOM_ID_RE } from "../../shared/draft";
import type { CreateRoomRes, RoomConfig, RoomState } from "../../shared/room";
import type { TeamSlot } from "../../shared/types";
import { ApiError, errorBody, randomId, randomKey, rateLimit, readJsonBounded, sha256, type AppEnv } from "../lib/http";
import type { DraftRoom, RoomKeyHashes } from "./DraftRoom";
import { createRoomSchema } from "./schema";

const MAX_BODY_BYTES = 8_192;
const ID_ATTEMPTS = 3;

const roomStub = (env: Env, roomId: string) =>
  (env.ROOMS as DurableObjectNamespace<DraftRoom>).get(env.ROOMS.idFromName(roomId));

const notFound = () => new ApiError(404, "not_found", "Room not found.");

export const roomsApp = new Hono<AppEnv>();

roomsApp.post("/rooms", async (c) => {
  await rateLimit(c, "WRITE_LIMITER", "rooms");
  const parsed = createRoomSchema.safeParse(await readJsonBounded(c, MAX_BODY_BYTES));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new ApiError(400, "invalid", `${where}${issue?.message ?? "Invalid room settings."}`);
  }
  const config: RoomConfig = parsed.data.config;

  const hostKey = randomKey("host");
  const captainKeys: Record<TeamSlot, string> | undefined =
    config.mode === "captains" ? { A: randomKey("cap"), B: randomKey("cap") } : undefined;
  const hashes: RoomKeyHashes = { host: await sha256(hostKey) };
  if (captainKeys) {
    hashes.A = await sha256(captainKeys.A);
    hashes.B = await sha256(captainKeys.B);
  }

  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
    const roomId = randomId(8);
    if (await roomStub(c.env, roomId).init(roomId, config, hashes, Date.now())) {
      const res: CreateRoomRes = captainKeys ? { roomId, hostKey, captainKeys } : { roomId, hostKey };
      return c.json(res, 201);
    }
  }
  throw new ApiError(503, "busy", "Couldn't allocate a room — please try again.");
});

roomsApp.get("/rooms/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  if (!ROOM_ID_RE.test(roomId)) throw notFound();
  const state = (await roomStub(c.env, roomId).getState()) as RoomState | null;
  if (!state) throw notFound();
  c.header("cache-control", "no-store");
  return c.json(state);
});

roomsApp.get("/rooms/:roomId/ws", async (c) => {
  const roomId = c.req.param("roomId");
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.json(errorBody("upgrade_required", "Expected a WebSocket upgrade."), 426);
  }
  if (!ROOM_ID_RE.test(roomId)) throw notFound();
  // The DO welcomes spectators at once and waits for an {t:"auth", key} frame on ?auth=1 sockets (keys never travel
  // in the URL); it also explains a missing room over the socket before closing it. It reads cf-connecting-ip for
  // its per-network spectator cap.
  return roomStub(c.env, roomId).fetch(c.req.raw);
});

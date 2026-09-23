// Zod schemas for room creation and the WebSocket client protocol (src/shared/room.ts is the type contract).
import { z } from "zod";
import { PROFILE_ID_RE, TEAM_NAME_MAX, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS, cleanTeamName } from "../../shared/draft";
import { getFormat } from "../../shared/formats";
import type { ClientMsg, CreateRoomReq, RoomControlMsg } from "../../shared/room";

const slot = z.enum(["A", "B"]);
const side = z.enum(["blue", "red"]);
// shape only; the reducer reports specific errors (bad_champion / unavailable / fearless_locked)
const championId = z.string().max(64);
const profileId = z.string().regex(PROFILE_ID_RE);
const seconds = z
  .number()
  .int()
  .min(TIMER_MIN_SECONDS, `Turn timers must be ${TIMER_MIN_SECONDS}-${TIMER_MAX_SECONDS} seconds.`)
  .max(TIMER_MAX_SECONDS, `Turn timers must be ${TIMER_MIN_SECONDS}-${TIMER_MAX_SECONDS} seconds.`);

const team = (fallback: string) =>
  z.object({
    // empty names fall back to "Team A"/"Team B"; control characters and runs of whitespace are cleaned
    name: z
      .string()
      .max(TEAM_NAME_MAX * 2)
      .transform((n) => (n.trim() === "" ? fallback : cleanTeamName(n)))
      .refine((n): n is string => n !== null, `Team names must be at most ${TEAM_NAME_MAX} characters.`),
    profileId: profileId.nullable().optional().transform((p) => p ?? null),
  });

export const createRoomSchema = z.object({
  config: z
    .object({
      game: z.enum(["lol", "dota2"]),
      formatId: z.string().max(40),
      mode: z.enum(["captains", "host"]),
      bestOf: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)], { error: "Series length must be 1, 2, 3 or 5." }),
      fearless: z.enum(["off", "soft", "hard"]),
      timer: z.object({ enabled: z.boolean(), pickSeconds: seconds, banSeconds: seconds }),
      teams: z.object({ A: team("Team A"), B: team("Team B") }),
      firstSide: side.optional(),
    })
    .refine((c) => getFormat(c.formatId)?.game === c.game, {
      message: "Unknown draft format for this game.",
      path: ["formatId"],
    })
    // Same rule as setTeam in draft.ts: one team profile can't describe both sides.
    .refine((c) => c.teams.A.profileId === null || c.teams.A.profileId !== c.teams.B.profileId, {
      message: "Both teams can't use the same team profile.",
      path: ["teams", "B", "profileId"],
    }),
}) satisfies z.ZodType<CreateRoomReq, unknown>;

const lockOrHover = { championId: championId.nullable(), index: z.number().int().min(0).max(99).optional() };

export const clientMsgSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hover"), ...lockOrHover }),
  z.object({ t: z.literal("lock"), ...lockOrHover }),
  z.object({ t: z.literal("ready"), ready: z.boolean() }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("pause") }),
  z.object({ t: z.literal("resume") }),
  z.object({ t: z.literal("undo") }),
  z.object({ t: z.literal("reset") }),
  z.object({
    t: z.literal("setTeam"),
    slot,
    name: z.string().max(TEAM_NAME_MAX * 2).optional(),
    profileId: profileId.nullable().optional(),
  }),
  z.object({ t: z.literal("setWinner"), winner: slot.nullable(), game: z.number().int().min(1).max(5).optional() }),
  z.object({ t: z.literal("nextGame"), sides: z.object({ blue: slot, red: slot }), firstSide: side }),
  z.object({ t: z.literal("ping") }),
]) satisfies z.ZodType<ClientMsg, unknown>;

export const controlMsgSchema = z.discriminatedUnion("t", [
  // shape only; DraftRoom treats anything that doesn't match a key hash (including over-long keys) as a bad key
  z.object({ t: z.literal("auth"), key: z.string().max(256) }),
  z.object({ t: z.literal("rotateKey"), slot }),
]) satisfies z.ZodType<RoomControlMsg, unknown>;

/** Every frame a room socket accepts: draft messages for the reducer plus connection-level control messages. */
export const socketMsgSchema = z.discriminatedUnion("t", [...clientMsgSchema.options, ...controlMsgSchema.options]);

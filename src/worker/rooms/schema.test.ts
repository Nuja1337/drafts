import { describe, expect, it } from "vitest";
import { clientMsgSchema, createRoomSchema, socketMsgSchema } from "./schema";

const config = (A: string | null, B: string | null) => ({
  config: {
    game: "lol",
    formatId: "lol-tournament",
    mode: "captains",
    bestOf: 3,
    fearless: "off",
    timer: { enabled: true, pickSeconds: 30, banSeconds: 30 },
    teams: { A: { name: "Alpha", profileId: A }, B: { name: "Beta", profileId: B } },
  },
});

describe("createRoomSchema", () => {
  it("accepts different or missing profiles", () => {
    expect(createRoomSchema.safeParse(config("aaaaaaaa", "bbbbbbbb")).success).toBe(true);
    expect(createRoomSchema.safeParse(config(null, null)).success).toBe(true);
    expect(createRoomSchema.safeParse(config("aaaaaaaa", null)).success).toBe(true);
  });

  it("refuses one profile on both teams", () => {
    const r = createRoomSchema.safeParse(config("aaaaaaaa", "aaaaaaaa"));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["config", "teams", "B", "profileId"]);
  });
});

describe("clientMsgSchema setWinner", () => {
  it("accepts an optional game number (correcting an earlier result)", () => {
    expect(clientMsgSchema.parse({ t: "setWinner", winner: "A", game: 1 })).toEqual({ t: "setWinner", winner: "A", game: 1 });
    expect(clientMsgSchema.parse({ t: "setWinner", winner: null })).toEqual({ t: "setWinner", winner: null });
  });

  it("rejects out-of-range or fractional game numbers", () => {
    for (const game of [0, 6, 1.5, "1"]) expect(clientMsgSchema.safeParse({ t: "setWinner", winner: "B", game }).success).toBe(false);
  });

  it("socket frames include control messages", () => {
    expect(socketMsgSchema.safeParse({ t: "auth", key: "host_x" }).success).toBe(true);
    expect(socketMsgSchema.safeParse({ t: "rotateKey", slot: "A" }).success).toBe(true);
    expect(socketMsgSchema.safeParse({ t: "rotateKey", slot: "C" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { roomKeyRank, shouldStoreRoomKey } from "./roomKeys";

describe("room key strength", () => {
  it("ranks keys by their server prefix", () => {
    expect(roomKeyRank("host_abc")).toBe(3);
    expect(roomKeyRank("cap_abc")).toBe(2);
    expect(roomKeyRank("AAAAAAAAAAAAAAAA")).toBe(0);
    expect(roomKeyRank(undefined)).toBe(0);
  });

  it("stores a confirmed key unless a stronger one is already stored", () => {
    expect(shouldStoreRoomKey(undefined, "cap_a")).toBe(true);
    expect(shouldStoreRoomKey("host_x", "cap_b")).toBe(false); // opening a captain link doesn't demote the host
    expect(shouldStoreRoomKey("cap_a", "cap_b")).toBe(true); // switching captain seats is allowed
    expect(shouldStoreRoomKey("cap_a", "host_x")).toBe(true);
    expect(shouldStoreRoomKey("host_x", "host_x")).toBe(false);
    expect(shouldStoreRoomKey("junk_key_value", "cap_a")).toBe(true);
  });
});

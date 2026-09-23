// Unit tests for the pure parts of the Teams API (validation, diffs, audit paging). Routes are covered end to end
// by scripts/smoke-teams.mjs against a local Worker.
import { describe, expect, it } from "vitest";
import {
  FULL_AFTER_MAX_CHARS,
  coalesceEdit,
  describePlayerChange,
  describeTeamChange,
  diff,
  encodeSnapshots,
  rowToEntry,
  toAuditPage,
  type LastTargetRow,
} from "./auditFormat";
import { createTeamSchema, formatIssue, isReservedName, joinSchema, nameKey, playerName, playerSchema, updateTeamSchema } from "./schema";

const row = (id: string, createdAt: string) => ({
  id,
  team_id: "t",
  actor: "owner",
  actor_name: "Owner",
  action: "team.update",
  target: "team",
  summary: id,
  revertible: 1,
  created_at: createdAt,
});

describe("toAuditPage", () => {
  it("returns everything without a cursor when rows fit", () => {
    const page = toAuditPage([row("a", "2026-01-01T00:00:03.000Z"), row("b", "2026-01-01T00:00:02.000Z")], 2);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(page.nextBefore).toBeUndefined();
    expect(page.entries[0].revertible).toBe(true);
    expect(page.entries[0].actorName).toBe("Owner");
  });

  it("leaves snapshots out of list entries (revert reads the full row)", () => {
    const page = toAuditPage([{ ...row("a", "2026-01-01T00:00:03.000Z"), before_json: '{"name":"w"}', after_json: '{"name":"x"}' }], 5);
    expect(JSON.parse(JSON.stringify(page.entries[0]))).not.toHaveProperty("after");
    expect(JSON.parse(JSON.stringify(page.entries[0]))).not.toHaveProperty("before");
    const full = rowToEntry({ ...row("a", "2026-01-01T00:00:03.000Z"), before_json: '{"name":"w"}', after_json: '{"name":"x"}' });
    expect(full.before).toEqual({ name: "w" });
    expect(full.after).toEqual({ name: "x" });
  });

  it("holds back rows that share the boundary timestamp", () => {
    const rows = [
      row("a", "2026-01-01T00:00:03.000Z"),
      row("b", "2026-01-01T00:00:02.000Z"),
      row("c", "2026-01-01T00:00:02.000Z"),
    ];
    // limit 2: row c (same ms as b) is beyond the page, so b must wait for the next page too.
    const page = toAuditPage(rows, 2);
    expect(page.entries.map((e) => e.id)).toEqual(["a"]);
    expect(page.nextBefore).toBe("2026-01-01T00:00:03.000Z");
  });

  it("falls back to the untrimmed page when every row shares one timestamp", () => {
    const t = "2026-01-01T00:00:01.000Z";
    const page = toAuditPage([row("a", t), row("b", t)], 1);
    expect(page.entries.map((e) => e.id)).toEqual(["a"]);
    expect(page.nextBefore).toBe(t);
  });
});

describe("diff", () => {
  it("keeps only changed keys", () => {
    const d = diff({ name: "A", tag: "X", notes: "" }, { name: "A", tag: "Y" });
    expect(d.keys).toEqual(["tag"]);
    expect(d.before).toEqual({ tag: "X" });
    expect(d.after).toEqual({ tag: "Y" });
  });

  it("compares arrays structurally", () => {
    expect(diff({ pool: [{ championId: "Ahri", comfort: 5 }] }, { pool: [{ championId: "Ahri", comfort: 5 }] }).keys).toEqual([]);
  });
});

describe("summaries", () => {
  it("describes team and player changes", () => {
    expect(describeTeamChange({ locked: false }, { locked: true })).toBe("Locked the team (owner-only edits)");
    expect(
      describePlayerChange(
        "Bob",
        { pool: [{ championId: "Ahri" }, { championId: "Zed" }] },
        { pool: [{ championId: "Ahri" }, { championId: "Lux" }, { championId: "Syndra" }] },
      ),
    ).toBe("Updated Bob: champion pool (+2/-1)");
  });

  it("tolerates summarised snapshots", () => {
    expect(describePlayerChange("Bob", { pool: [{ championId: "Ahri" }] }, { pool: { count: 3 } })).toBe("Updated Bob: champion pool");
  });
});

describe("audit snapshot size", () => {
  const overrides = (n: number) => Array.from({ length: n }, (_, i) => ({ a: `Champ${i}`, b: "Zed", adv: 0.1, note: "x".repeat(60) }));

  it("keeps small snapshots whole", () => {
    const s = encodeSnapshots({ name: "A" }, { name: "B" });
    expect(s).toEqual({ before: '{"name":"A"}', after: '{"name":"B"}' });
  });

  it("summarises a large `after` but keeps `before` (revert needs it)", () => {
    const before = { overrides: overrides(200), notes: "n".repeat(300) };
    const after = { overrides: overrides(210), notes: "m".repeat(300) };
    const s = encodeSnapshots(before, after);
    expect(JSON.parse(s.before!)).toEqual(before);
    expect(JSON.parse(s.after!)).toEqual({ overrides: { count: 210 }, notes: { chars: 300 } });
    expect(s.before!.length + s.after!.length).toBeLessThan(JSON.stringify(before).length + FULL_AFTER_MAX_CHARS);
  });

  it("keeps creation/removal snapshots (one side null) whole", () => {
    const profile = { name: "Bob", pool: overrides(200) };
    expect(encodeSnapshots(null, profile).after).toBe(JSON.stringify(profile));
    expect(encodeSnapshots(profile, null)).toEqual({ before: JSON.stringify(profile), after: null });
  });
});

describe("coalesceEdit", () => {
  const prev = (over: Partial<LastTargetRow> = {}): LastTargetRow => ({
    seq: 7,
    actor: "player:p1",
    action: "player.update",
    before_json: JSON.stringify({ pool: [{ championId: "Ahri" }], notes: "owner notes" }),
    after_json: JSON.stringify({ pool: [], notes: "" }),
    revertible: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("folds a recent self-edit into the previous entry, keeping the earliest `before`", () => {
    const m = coalesceEdit(prev(), "player:p1", "2026-01-01T00:05:00.000Z", { notes: "" }, { notes: "spam" });
    expect(m).toEqual({
      seq: 7,
      before: { pool: [{ championId: "Ahri" }], notes: "owner notes" },
      after: { pool: [], notes: "spam" },
    });
  });

  it("merges fields the earlier entry didn't touch", () => {
    const m = coalesceEdit(prev(), "player:p1", "2026-01-01T00:05:00.000Z", { roles: [] }, { roles: [{ role: "mid" }] });
    expect(m?.before).toEqual({ pool: [{ championId: "Ahri" }], notes: "owner notes", roles: [] });
  });

  it("starts a new entry for another actor, another action, an old entry or a snapshot-less entry", () => {
    const at = "2026-01-01T00:05:00.000Z";
    expect(coalesceEdit(undefined, "player:p1", at, {}, {})).toBeNull();
    expect(coalesceEdit(prev({ actor: "owner" }), "player:p1", at, {}, {})).toBeNull();
    expect(coalesceEdit(prev({ action: "player.claim" }), "player:p1", at, {}, {})).toBeNull();
    expect(coalesceEdit(prev(), "player:p1", "2026-01-01T00:15:00.000Z", {}, {})).toBeNull();
    expect(coalesceEdit(prev({ revertible: 0, before_json: null, after_json: null }), "player:p1", at, {}, {})).toBeNull();
  });
});

describe("player name identity", () => {
  it("rejects invisible and filler characters in names", () => {
    for (const bad of ["Alice​", "Al‍ice", "Ali­ce", "Alice⁠", "Aliceㅤ", "Alice͏", "Al﻿ice", "Al‮ice"]) {
      expect(playerName.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(playerName.parse("﻿Alice")).toBe("Alice"); // leading BOM is trimmed
    expect(playerName.safeParse("Zoë Ω 😀").success).toBe(true);
  });

  it("collides look-alike names", () => {
    const alice = nameKey("Alice");
    for (const twin of ["alice", "ＡＬＩＣＥ", "Al ice", "Аlice", "Alicе", "ALICΕ", "Aliсe", "Alice️"]) {
      expect(nameKey(twin), JSON.stringify(twin)).toBe(alice);
    }
    expect(nameKey("Alicia")).not.toBe(alice);
    expect(nameKey("Sub 5")).not.toBe(nameKey("Sub 6"));
  });

  it("reserves system actor names", () => {
    expect(isReservedName("Owner")).toBe(true);
    expect(isReservedName(" 0wner ".replace("0", "O"))).toBe(true);
    expect(isReservedName("Оwner")).toBe(true); // Cyrillic О
    expect(isReservedName("Former Player")).toBe(true);
    expect(isReservedName("Owen")).toBe(false);
  });
});

describe("schemas", () => {
  it("trims names and rejects unknown fields", () => {
    expect(createTeamSchema.parse({ name: "  Team  ", game: "lol" }).name).toBe("Team");
    const extra = createTeamSchema.safeParse({ name: "T", game: "lol", extra: 1 });
    expect(formatIssue(extra.error?.issues[0])).toMatch(/Unrecognized key/);
    const missing = createTeamSchema.safeParse({ game: "lol" });
    expect(formatIssue(missing.error?.issues[0])).toBe("name: Required.");
  });

  it("validates roles per game", () => {
    expect(playerSchema("lol").safeParse({ roles: [{ role: "mid", pref: "main" }] }).success).toBe(true);
    expect(playerSchema("lol").safeParse({ roles: [{ role: "pos2", pref: "main" }] }).success).toBe(false);
    expect(playerSchema("dota2").safeParse({ pool: [{ championId: "invoker", comfort: 4, roles: ["pos2"] }] }).success).toBe(true);
  });

  it("bounds lists before parsing items", () => {
    const pool = Array.from({ length: 81 }, () => "not even an object");
    const res = playerSchema("lol").safeParse({ pool });
    expect(res.success).toBe(false);
    expect(res.error?.issues).toHaveLength(1);
    expect(res.error?.issues[0].message).toMatch(/At most 80/);
  });

  it("drops blank notes and rejects duplicate overrides", () => {
    const out = playerSchema("lol").parse({ avoid: [{ championId: "Zed", severity: 2, note: "   " }] });
    expect(JSON.stringify(out.avoid)).toBe('[{"championId":"Zed","severity":2}]');
    const dup = { a: "Ahri", b: "Zed", adv: 0.2 };
    expect(updateTeamSchema.safeParse({ overrides: [dup, dup] }).success).toBe(false);
    expect(updateTeamSchema.safeParse({ overrides: [dup, { ...dup, a: "Zed", b: "Ahri" }] }).success).toBe(true);
  });

  it("requires a slot or a name to join", () => {
    expect(joinSchema.safeParse({}).success).toBe(false);
    expect(joinSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(joinSchema.safeParse({ playerId: "abcdefghij", name: "Rename" }).success).toBe(true);
  });
});

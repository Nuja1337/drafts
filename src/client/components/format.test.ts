import { describe, expect, it } from "vitest";
import { compact, pct, searchKey, signed, timeAgo } from "./format";

describe("format helpers", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");

  it("timeAgo uses friendly relative units", () => {
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3 hours ago");
    expect(timeAgo(now - 24 * 3600_000, now)).toBe("yesterday");
    expect(timeAgo("not a date", now)).toBe("");
  });

  it("formats percentages, signed values and counts", () => {
    expect(pct(0.534)).toBe("53.4%");
    expect(pct(undefined)).toBe("—");
    expect(signed(0.42)).toBe("+0.42");
    expect(signed(-0.1, 1)).toBe("−0.1");
    expect(signed(0)).toBe("±0.00");
    expect(compact(999)).toBe("999");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(31303)).toBe("31k");
    expect(compact(2_500_000)).toBe("2.5M");
  });

  it("searchKey ignores case, accents and punctuation", () => {
    expect(searchKey("Kai'Sa")).toBe("kaisa");
    expect(searchKey("Nature's Prophet")).toBe("naturesprophet");
    expect(searchKey("Kha'Zix")).toBe(searchKey("khazix"));
    expect(searchKey("Éclair")).toBe("eclair");
  });
});

import { describe, expect, it } from "vitest";
import { autoTab, scoreWith } from "./view";

describe("analysis tab follows the draft", () => {
  it("picks the tab that fits the next action for the viewed side", () => {
    expect(autoTab({ index: 0, side: "blue", type: "ban" }, false, "blue")).toBe("bans");
    expect(autoTab({ index: 6, side: "blue", type: "pick" }, false, "blue")).toBe("picks");
    expect(autoTab({ index: 7, side: "red", type: "pick" }, false, "blue")).toBe("threats");
    expect(autoTab({ index: 1, side: "red", type: "ban" }, false, "blue")).toBeNull();
    expect(autoTab(null, true, "red")).toBe("comps");
    expect(autoTab(null, false, "red")).toBeNull();
  });
});

describe("next-game result entry", () => {
  it("recomputes the series score when the current result changes", () => {
    expect(scoreWith({ A: 1, B: 0 }, null, "A")).toEqual({ A: 2, B: 0 });
    expect(scoreWith({ A: 1, B: 1 }, "B", "A")).toEqual({ A: 2, B: 0 });
    expect(scoreWith({ A: 1, B: 1 }, "B", null)).toEqual({ A: 1, B: 0 });
    expect(scoreWith({ A: 0, B: 0 }, null, null)).toEqual({ A: 0, B: 0 });
  });
});

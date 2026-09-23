import { describe, expect, it } from "vitest";
import { initialRoomState, stepSide } from "../../shared/draft";
import { getFormat } from "../../shared/formats";
import type { DraftAction, RoomConfig, RoomState } from "../../shared/room";
import type { TeamSlot } from "../../shared/types";
import { buildDraftView } from "./view";

const format = getFormat("dota2-cm")!;
const config = (bestOf: RoomConfig["bestOf"]): RoomConfig => ({
  game: "dota2",
  formatId: format.id,
  mode: "captains",
  bestOf,
  fearless: "off",
  timer: { enabled: false, pickSeconds: 30, banSeconds: 30 },
  teams: { A: { name: "Alpha" }, B: { name: "Bravo" } },
});

/** Game `gameNumber` fully drafted; `results` are the recorded winners of games 1..n (null = no result). */
function drafted(bestOf: RoomConfig["bestOf"], gameNumber: number, results: (TeamSlot | null)[]): RoomState {
  const s = initialRoomState("abcdefgh", config(bestOf), 0);
  const actions: DraftAction[] = format.steps.map((step, index) => {
    const side = stepSide(step, s.firstSide);
    return { index, side, slot: s.sides[side], type: step.type, championId: step.type === "pick" ? `h${gameNumber}_${index}` : null, at: index };
  });
  const history = results.map((winner, i) => ({ number: i + 1, sides: s.sides, firstSide: s.firstSide, actions: i + 1 === gameNumber ? actions : [], winner }));
  return { ...s, status: "drafting", gameNumber, actions, history: history.filter((g) => g.number < gameNumber || g.winner) };
}

describe("buildDraftView series state", () => {
  it("a drafted last game without a result is not 'Series complete' yet", () => {
    const v = buildDraftView(drafted(2, 2, [null]), format, null);
    expect(v.complete).toBe(true);
    expect(v.seriesOver).toBe(false);
    expect(v.phase).toBe("Draft complete");
    expect(v.canNextGame).toBe(false);
  });

  it("recording the last result completes the series; 1–1 in a Bo2 is a draw", () => {
    const v = buildDraftView(drafted(2, 2, ["A", "B"]), format, null);
    expect(v.seriesOver).toBe(true);
    expect(v.phase).toBe("Series complete");
    expect(v.seriesWinner).toBeNull();
    expect(v.seriesDrawn).toBe(true);
  });

  it("a decided series has a winner and no draw", () => {
    const v = buildDraftView(drafted(3, 2, ["A", "A"]), format, null);
    expect(v.seriesOver).toBe(true);
    expect(v.seriesWinner).toBe("A");
    expect(v.seriesDrawn).toBe(false);
    expect(v.canNextGame).toBe(false);
  });

  it("a finished game that isn't the last can go on to the next one, result or not", () => {
    const v = buildDraftView(drafted(3, 1, []), format, null);
    expect(v.seriesOver).toBe(false);
    expect(v.canNextGame).toBe(true);
    expect(v.phase).toBe("Draft complete");
  });

  it("a Bo1 reads 'Draft complete' even once its result is in", () => {
    const v = buildDraftView(drafted(1, 1, ["B"]), format, null);
    expect(v.seriesOver).toBe(true);
    expect(v.phase).toBe("Draft complete");
  });
});

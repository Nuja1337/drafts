import { describe, expect, it } from "vitest";
import {
  MIN_RESUME_MS,
  actingSide,
  applyTimeout,
  bansOf,
  cleanTeamName,
  currentResult,
  currentStep,
  fearlessLocked,
  initialRoomState,
  isDraftComplete,
  isSeriesOver,
  nextStep,
  phaseLabel,
  picksOf,
  reduce,
  seriesScore,
  stepSide,
  unavailableFor,
  winsNeeded,
  type DraftResult,
} from "./draft";
import { FORMATS, formatsFor, getFormat } from "./formats";
import lolIds from "./rosters/lol.json";
import type { ClientMsg, DraftFormat, RoomConfig, RoomRole, RoomState } from "./room";
import type { Side, TeamSlot } from "./types";

const HOST: RoomRole = { kind: "host" };
const CAP_A: RoomRole = { kind: "captain", slot: "A" };
const CAP_B: RoomRole = { kind: "captain", slot: "B" };
const SPEC: RoomRole = { kind: "spectator" };
const T0 = 1_700_000_000_000;

function config(over: Partial<RoomConfig> = {}): RoomConfig {
  return {
    game: "lol",
    formatId: "lol-tournament",
    mode: "captains",
    bestOf: 3,
    fearless: "off",
    timer: { enabled: true, pickSeconds: 30, banSeconds: 20 },
    teams: { A: { name: "Alpha", profileId: null }, B: { name: "Bravo", profileId: null } },
    ...over,
  };
}

function okState(r: DraftResult): RoomState {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.state;
}
function errCode(r: DraftResult): string {
  if (r.ok) throw new Error("expected an error");
  return r.error.code;
}
const apply = (s: RoomState, role: RoomRole, msg: ClientMsg, now = T0) => okState(reduce(s, role, msg, now));

/** Order of a format as B/R letters for a given first side. */
const order = (f: DraftFormat, first: Side = "blue") =>
  f.steps.map((st) => `${stepSide(st, first) === "blue" ? "B" : "R"}${st.type === "ban" ? "b" : "p"}`).join(" ");

/** A distinct real LoL champion id per key (the room only accepts roster ids); never one the tests name directly. */
const NAMED = new Set(["Ahri", "Zed", "Jinx", "Lux"]);
const POOL = lolIds.filter((id) => !NAMED.has(id));
const assigned = new Map<string, string>();
function C(key: string): string {
  let id = assigned.get(key);
  if (!id) {
    id = POOL[assigned.size];
    if (!id) throw new Error("test champion pool exhausted");
    assigned.set(key, id);
  }
  return id;
}

/** Host locks every remaining step with fresh champions keyed by `prefix`. */
function hostDraftAll(s: RoomState, prefix: string, now = T0): RoomState {
  let st = s;
  let i = 0;
  while (currentStep(st)) st = apply(st, HOST, { t: "lock", championId: C(`${prefix}${i++}`) }, now);
  return st;
}

function started(over: Partial<RoomConfig> = {}): RoomState {
  return apply(initialRoomState("room0001", config(over), T0), HOST, { t: "start" });
}

describe("formats", () => {
  it("has stable ids and valid phases", () => {
    expect(FORMATS.map((f) => f.id)).toEqual(["lol-tournament", "lol-ranked", "dota2-cm", "dota2-allpick"]);
    for (const f of FORMATS) {
      const starts = (f.phases ?? []).map((p) => p.start);
      expect(starts[0]).toBe(0);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
      for (const s of starts) expect(s).toBeLessThan(f.steps.length);
      // every team ends with exactly five picks
      expect(f.steps.filter((s) => s.type === "pick" && s.side === "first")).toHaveLength(5);
      expect(f.steps.filter((s) => s.type === "pick" && s.side === "second")).toHaveLength(5);
    }
    expect(formatsFor("lol").map((f) => f.id)).toEqual(["lol-tournament", "lol-ranked"]);
    expect(formatsFor("dota2").map((f) => f.id)).toEqual(["dota2-cm", "dota2-allpick"]);
    expect(getFormat("nope")).toBeUndefined();
  });

  it("LoL tournament draft order", () => {
    expect(order(getFormat("lol-tournament")!)).toBe(
      ["Bb Rb Bb Rb Bb Rb", "Bp Rp Rp Bp Bp Rp", "Rb Bb Rb Bb", "Rp Bp Bp Rp"].join(" "),
    );
  });

  it("Dota 2 Captains Mode order (7.40)", () => {
    const f = getFormat("dota2-cm")!;
    expect(f.steps).toHaveLength(24);
    expect(order(f)).toBe(
      ["Bb Bb Rb Rb Bb Rb Rb", "Bp Rp", "Bb Bb Rb", "Rp Bp Bp Rp Rp Bp", "Bb Rb Bb Rb", "Bp Rp"].join(" "),
    );
    // first pick team bans 3-2-2, second pick team 4-1-2
    const bans = (side: "first" | "second", from: number, to: number) =>
      f.steps.slice(from, to).filter((s) => s.type === "ban" && s.side === side).length;
    expect([bans("first", 0, 7), bans("first", 9, 12), bans("first", 18, 22)]).toEqual([3, 2, 2]);
    expect([bans("second", 0, 7), bans("second", 9, 12), bans("second", 18, 22)]).toEqual([4, 1, 2]);
    expect(phaseLabel(f, 7)).toBe("Pick phase 1");
    expect(phaseLabel(f, 21)).toBe("Ban phase 3");
  });

  it("ranked / all pick orders", () => {
    const pickOrder = "Bp Rp Rp Bp Bp Rp Rp Bp Bp Rp";
    const banOrder = "Bb Rb Bb Rb Bb Rb Bb Rb Bb Rb";
    expect(order(getFormat("lol-ranked")!)).toBe(`${banOrder} ${pickOrder}`);
    expect(order(getFormat("dota2-allpick")!)).toBe(`${banOrder} ${pickOrder}`);
  });
});

describe("basic helpers", () => {
  const f = getFormat("lol-tournament")!;

  it("stepSide / nextStep follow the first side", () => {
    expect(stepSide({ side: "first", type: "ban" }, "red")).toBe("red");
    expect(stepSide({ side: "second", type: "ban" }, "red")).toBe("blue");
    expect(nextStep(f, "red", [])).toEqual({ index: 0, side: "red", type: "ban" });
    const s = hostDraftAll(started(), "c");
    expect(nextStep(f, "blue", s.actions)).toBeNull();
    expect(order(f, "red").startsWith("Rb Bb")).toBe(true);
  });

  it("picksOf / bansOf", () => {
    let s = started();
    s = apply(s, HOST, { t: "lock", championId: "Ahri" }); // blue ban
    s = apply(s, HOST, { t: "lock", championId: null }); // red skips
    expect(bansOf(s.actions)).toEqual(["Ahri", null]);
    expect(bansOf(s.actions, "red")).toEqual([null]);
    s = hostDraftAll(s, "x");
    expect(picksOf(s.actions, "blue")).toHaveLength(5);
    expect(picksOf(s.actions, "red")).toHaveLength(5);
    expect(picksOf(s.actions, "blue")[0]).toBe(s.actions[6].championId);
  });

  it("phaseLabel", () => {
    expect(phaseLabel(f, 0)).toBe("Ban phase 1");
    expect(phaseLabel(f, 5)).toBe("Ban phase 1");
    expect(phaseLabel(f, 6)).toBe("Pick phase 1");
    expect(phaseLabel(f, 19)).toBe("Pick phase 2");
    expect(phaseLabel(f, 20)).toBe("Draft complete");
    expect(phaseLabel({ ...f, phases: undefined }, 7)).toBe("Picks");
  });

  it("initialRoomState", () => {
    const s = initialRoomState("abc", config(), T0);
    expect(s).toMatchObject({ id: "abc", status: "lobby", gameNumber: 1, sides: { blue: "A", red: "B" }, firstSide: "blue" });
    expect(s.actions).toEqual([]);
    expect(isDraftComplete(s)).toBe(false);
    expect(s.createdAt).toBe(T0);
    // Dota CM coin toss: first pick can go to the red (Dire) side in game 1.
    const dire = initialRoomState("abc", config({ game: "dota2", formatId: "dota2-cm", firstSide: "red" }), T0);
    expect(dire.firstSide).toBe("red");
    expect(currentStep({ ...dire, status: "drafting" })).toMatchObject({ index: 0, side: "red", type: "ban" });
  });

  it("cleanTeamName", () => {
    expect(cleanTeamName("  Team\u0007  Liquid ")).toBe("Team Liquid");
    expect(cleanTeamName("   ")).toBeNull();
    expect(cleanTeamName("x".repeat(33))).toBeNull();
  });
});

describe("lobby and start", () => {
  it("captains mode auto-starts when both teams are ready", () => {
    let s = initialRoomState("r", config(), T0);
    s = apply(s, CAP_A, { t: "ready", ready: true });
    expect(s.status).toBe("lobby");
    s = apply(s, CAP_A, { t: "ready", ready: false });
    s = apply(s, CAP_A, { t: "ready", ready: true });
    s = apply(s, CAP_B, { t: "ready", ready: true }, T0 + 5);
    expect(s.status).toBe("drafting");
    expect(s.turnDeadline).toBe(T0 + 5 + 20_000); // first step is a ban
    expect(errCode(reduce(s, CAP_A, { t: "ready", ready: false }, T0))).toBe("not_in_lobby");
  });

  it("only the host starts; host mode has no ready checks", () => {
    const s = initialRoomState("r", config(), T0);
    expect(errCode(reduce(s, CAP_A, { t: "start" }, T0))).toBe("forbidden");
    expect(errCode(reduce(s, SPEC, { t: "start" }, T0))).toBe("forbidden");
    expect(errCode(reduce(s, HOST, { t: "ready", ready: true }, T0))).toBe("forbidden");
    const h = initialRoomState("r", config({ mode: "host" }), T0);
    expect(errCode(reduce(h, CAP_A, { t: "ready", ready: true }, T0))).toBe("forbidden");
    const d = apply(h, HOST, { t: "start" });
    expect(d.status).toBe("drafting");
    expect(errCode(reduce(d, HOST, { t: "start" }, T0))).toBe("already_started");
  });

  it("no timer means no deadlines", () => {
    const s = started({ timer: { enabled: false, pickSeconds: 30, banSeconds: 30 } });
    expect(s.turnDeadline).toBeNull();
    expect(apply(s, HOST, { t: "lock", championId: "Ahri" }).turnDeadline).toBeNull();
  });
});

describe("locking and permissions", () => {
  it("captains act only for their side on their turn", () => {
    let s = started();
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: "Ahri" }, T0))).toBe("not_your_turn");
    expect(errCode(reduce(s, SPEC, { t: "lock", championId: "Ahri" }, T0))).toBe("forbidden");
    expect(actingSide(s, CAP_A)).toBe("blue");
    expect(actingSide(s, CAP_B)).toBeNull();
    expect(actingSide(s, HOST)).toBe("blue");
    expect(actingSide(s, SPEC)).toBeNull();
    s = apply(s, CAP_A, { t: "lock", championId: "Ahri" }, T0 + 1000);
    expect(s.actions[0]).toMatchObject({ index: 0, side: "blue", slot: "A", type: "ban", championId: "Ahri", at: T0 + 1000 });
    expect(s.turnDeadline).toBe(T0 + 1000 + 20_000);
    // host can act for red
    s = apply(s, HOST, { t: "lock", championId: "Zed" });
    expect(s.actions[1]).toMatchObject({ side: "red", slot: "B" });
  });

  it("validates champion ids and availability", () => {
    let s = started();
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "bad id!" }, T0))).toBe("bad_champion");
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "x".repeat(41) }, T0))).toBe("bad_champion");
    s = apply(s, CAP_A, { t: "lock", championId: "Ahri" });
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: "Ahri" }, T0))).toBe("unavailable");
    s = apply(s, CAP_B, { t: "lock", championId: null }); // ban skip is fine
    // advance to the first pick
    while (currentStep(s)!.type === "ban") s = apply(s, HOST, { t: "lock", championId: null });
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: null }, T0))).toBe("pick_required");
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "Ahri" }, T0))).toBe("unavailable");
    s = apply(s, CAP_A, { t: "lock", championId: "Jinx" });
    expect(unavailableFor(s, "red")).toEqual(new Set(["Ahri", "Jinx"]));
  });

  it("only accepts the room's roster ids: no case variants, other-game or made-up ids", () => {
    let s = started();
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "antimage" }, T0))).toBe("bad_champion"); // a Dota hero
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "TotallyFake_123" }, T0))).toBe("bad_champion");
    expect(errCode(reduce(s, CAP_A, { t: "hover", championId: "ahri" }, T0))).toBe("bad_champion");
    s = apply(s, CAP_A, { t: "lock", championId: "Ahri" });
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: "AHRI" }, T0))).toBe("bad_champion");
    // a champion newer than this build (LoL clients add those from Data Dragon) is accepted, case-insensitively once
    s = apply(s, CAP_B, { t: "lock", championId: "Newchampion" });
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "NewChampion" }, T0))).toBe("unavailable");
    // Dota rooms take known heroes only
    let d = apply(initialRoomState("r", config({ game: "dota2", formatId: "dota2-cm" }), T0), HOST, { t: "start" });
    expect(errCode(reduce(d, HOST, { t: "lock", championId: "Ahri" }, T0))).toBe("bad_champion");
    expect(errCode(reduce(d, HOST, { t: "lock", championId: "Antimage" }, T0))).toBe("bad_champion");
    d = apply(d, HOST, { t: "lock", championId: "antimage" });
    expect(d.actions).toHaveLength(1);
  });

  it("captain slots follow side swaps", () => {
    let s = initialRoomState("r", config(), T0);
    s = { ...s, sides: { blue: "B", red: "A" } };
    s = apply(s, HOST, { t: "start" });
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "Ahri" }, T0))).toBe("not_your_turn");
    s = apply(s, CAP_B, { t: "lock", championId: "Ahri" });
    expect(s.actions[0]).toMatchObject({ side: "blue", slot: "B" });
  });

  it("host mode: only the host acts", () => {
    const s = started({ mode: "host" });
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: "Ahri" }, T0))).toBe("forbidden");
    expect(apply(s, HOST, { t: "lock", championId: "Ahri" }).actions).toHaveLength(1);
  });

  it("no locks when not drafting or complete", () => {
    const lobby = initialRoomState("r", config(), T0);
    expect(errCode(reduce(lobby, HOST, { t: "lock", championId: "Ahri" }, T0))).toBe("not_drafting");
    const paused = apply(started(), HOST, { t: "pause" });
    expect(errCode(reduce(paused, HOST, { t: "lock", championId: "Ahri" }, T0))).toBe("not_drafting");
    const done = hostDraftAll(started(), "c");
    expect(isDraftComplete(done)).toBe(true);
    expect(done.turnDeadline).toBeNull();
    expect(errCode(reduce(done, HOST, { t: "lock", championId: "Ahri" }, T0))).toBe("draft_complete");
  });

  it("stale index guard", () => {
    const s = started();
    const msg = { t: "lock", championId: "Ahri", index: 3 } as ClientMsg;
    expect(errCode(reduce(s, HOST, msg, T0))).toBe("stale");
    expect(apply(s, HOST, { t: "lock", championId: "Ahri", index: 0 } as ClientMsg).actions).toHaveLength(1);
  });

  it("hovers", () => {
    let s = started();
    expect(errCode(reduce(s, CAP_B, { t: "hover", championId: "Ahri" }, T0))).toBe("not_your_turn");
    expect(errCode(reduce(s, CAP_A, { t: "hover", championId: "no way" }, T0))).toBe("bad_champion");
    s = apply(s, CAP_A, { t: "hover", championId: "Ahri" });
    expect(s.hovers.blue).toBe("Ahri");
    expect(reduce(s, CAP_A, { t: "hover", championId: "Ahri" }, T0 + 9)).toEqual({ ok: true, state: s }); // no-op
    s = apply(s, CAP_A, { t: "lock", championId: "Ahri" });
    expect(s.hovers.blue).toBeNull();
    // a hover on a champion that gets taken is cleared
    s = { ...s, hovers: { blue: "Zed", red: null } };
    s = apply(s, CAP_B, { t: "lock", championId: "Zed" });
    expect(s.hovers).toEqual({ blue: null, red: null });
    // hovering is allowed while paused
    s = apply(s, HOST, { t: "pause" });
    s = apply(s, CAP_A, { t: "hover", championId: "Lux" });
    expect(s.hovers.blue).toBe("Lux");
  });
});

describe("pause, resume, timeout", () => {
  it("pause/resume preserve remaining time (with a floor)", () => {
    let s = started(); // deadline T0 + 20s
    s = apply(s, HOST, { t: "pause" }, T0 + 8_000);
    expect(s).toMatchObject({ status: "paused", turnDeadline: null, pausedRemainingMs: 12_000 });
    expect(errCode(reduce(s, HOST, { t: "pause" }, T0))).toBe("not_drafting");
    expect(errCode(reduce(s, CAP_A, { t: "resume" }, T0))).toBe("forbidden");
    s = apply(s, HOST, { t: "resume" }, T0 + 60_000);
    expect(s).toMatchObject({ status: "drafting", turnDeadline: T0 + 72_000, pausedRemainingMs: null });
    expect(errCode(reduce(s, HOST, { t: "resume" }, T0))).toBe("not_paused");
    s = apply(s, HOST, { t: "pause" }, T0 + 71_900);
    s = apply(s, HOST, { t: "resume" }, T0 + 80_000);
    expect(s.turnDeadline).toBe(T0 + 80_000 + MIN_RESUME_MS);
  });

  it("timeout locks a valid hover", () => {
    let s = started();
    s = apply(s, CAP_A, { t: "hover", championId: "Ahri" });
    expect(applyTimeout(s, T0 + 19_999)).toBeNull();
    const out = applyTimeout(s, T0 + 20_000)!;
    expect(out.expired).toBeNull();
    expect(out.state.actions[0]).toMatchObject({ championId: "Ahri", auto: true, side: "blue" });
    expect(out.state.turnDeadline).toBe(T0 + 40_000);
  });

  it("timeout skips a ban without hover", () => {
    const out = applyTimeout(started(), T0 + 20_000)!;
    expect(out.state.actions[0]).toMatchObject({ championId: null, auto: true, type: "ban" });
  });

  it("timeout on a pick without a valid hover pauses the draft", () => {
    let s = started();
    while (currentStep(s)!.type === "ban") s = apply(s, HOST, { t: "lock", championId: null }, T0);
    s = { ...s, hovers: { blue: null, red: null } };
    const out = applyTimeout(s, s.turnDeadline!)!;
    expect(out.expired?.code).toBe("timer_expired");
    expect(out.state).toMatchObject({ status: "paused", turnDeadline: null, pausedRemainingMs: null });
    expect(out.state.actions).toHaveLength(s.actions.length);
    // resuming gives a full turn
    const r = apply(out.state, HOST, { t: "resume" }, T0 + 100_000);
    expect(r.turnDeadline).toBe(T0 + 100_000 + 30_000);
  });

  it("no timeout while paused or without timer", () => {
    const paused = apply(started(), HOST, { t: "pause" });
    expect(applyTimeout(paused, T0 + 1e9)).toBeNull();
    expect(applyTimeout(initialRoomState("r", config(), T0), T0 + 1e9)).toBeNull();
  });
});

describe("undo and reset", () => {
  it("undo removes the last action and restarts the turn", () => {
    let s = started();
    expect(errCode(reduce(s, HOST, { t: "undo" }, T0))).toBe("nothing_to_undo");
    s = apply(s, HOST, { t: "lock", championId: "Ahri" });
    s = apply(s, HOST, { t: "lock", championId: "Zed" });
    expect(errCode(reduce(s, CAP_A, { t: "undo" }, T0))).toBe("forbidden");
    s = apply(s, HOST, { t: "undo" }, T0 + 3_000);
    expect(s.actions.map((a) => a.championId)).toEqual(["Ahri"]);
    expect(s.turnDeadline).toBe(T0 + 3_000 + 20_000);
    // undo while paused keeps it paused with a full turn banked
    s = apply(s, HOST, { t: "pause" }, T0 + 4_000);
    s = apply(s, HOST, { t: "undo" }, T0 + 5_000);
    expect(s).toMatchObject({ status: "paused", pausedRemainingMs: 20_000, turnDeadline: null });
  });

  it("undo after a recorded result clears it and un-finishes the series", () => {
    let s = hostDraftAll(started({ bestOf: 1 }), "c");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    expect(s.status).toBe("finished");
    s = apply(s, HOST, { t: "undo" });
    expect(s.status).toBe("drafting");
    expect(s.history).toEqual([]);
    expect(currentResult(s)).toBeNull();
  });

  it("reset returns to the lobby", () => {
    let s = started();
    s = apply(s, CAP_A, { t: "lock", championId: "Ahri" });
    s = apply(s, HOST, { t: "reset" });
    expect(s).toMatchObject({ status: "lobby", actions: [], turnDeadline: null, ready: { A: false, B: false } });
    expect(errCode(reduce(s, CAP_A, { t: "reset" }, T0))).toBe("forbidden");
  });
});

describe("series", () => {
  it("winsNeeded", () => {
    expect([1, 2, 3, 5].map((n) => winsNeeded(n as RoomConfig["bestOf"]))).toEqual([1, 2, 2, 3]);
  });

  it("setWinner and nextGame require a complete draft", () => {
    const s = started();
    expect(errCode(reduce(s, HOST, { t: "setWinner", winner: "A" }, T0))).toBe("draft_incomplete");
    expect(errCode(reduce(s, HOST, { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" }, T0))).toBe(
      "draft_incomplete",
    );
  });

  it("best of 3 decided 2-0", () => {
    let s = hostDraftAll(started(), "g1_");
    expect(errCode(reduce(s, CAP_A, { t: "setWinner", winner: "A" }, T0))).toBe("forbidden");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    expect(s.status).toBe("drafting");
    expect(currentResult(s)).toBe("A");
    expect(s.history).toHaveLength(1);
    expect(errCode(reduce(s, HOST, { t: "nextGame", sides: { blue: "A", red: "A" }, firstSide: "blue" }, T0))).toBe("bad_sides");
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" });
    expect(s).toMatchObject({ status: "lobby", gameNumber: 2, sides: { blue: "B", red: "A" }, actions: [] });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ number: 1, winner: "A", sides: { blue: "A", red: "B" } });
    s = hostDraftAll(apply(s, HOST, { t: "start" }), "g2_");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    expect(seriesScore(s)).toEqual({ A: 2, B: 0 });
    expect(isSeriesOver(s)).toBe(true);
    expect(s.status).toBe("finished");
    expect(errCode(reduce(s, HOST, { t: "nextGame", sides: { blue: "A", red: "B" }, firstSide: "blue" }, T0))).toBe("series_over");
    // correcting the result reopens the series
    s = apply(s, HOST, { t: "setWinner", winner: "B" });
    expect(s.status).toBe("drafting");
    expect(seriesScore(s)).toEqual({ A: 1, B: 1 });
    // clearing the result removes the record
    s = apply(s, HOST, { t: "setWinner", winner: null });
    expect(s.history).toHaveLength(1);
  });

  it("nextGame without a result archives the game with winner null", () => {
    let s = hostDraftAll(started(), "g1_");
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "A", red: "B" }, firstSide: "red" });
    expect(s.history[0].winner).toBeNull();
    expect(s.firstSide).toBe("red");
    s = apply(s, HOST, { t: "start" });
    expect(currentStep(s)).toEqual({ index: 0, side: "red", type: "ban" });
  });

  it("the host can correct an earlier game's result", () => {
    let s = hostDraftAll(started(), "r1_");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" });
    // from the next game's lobby: clear it, then record it again
    s = apply(s, HOST, { t: "setWinner", winner: null, game: 1 } as ClientMsg);
    expect(s.status).toBe("lobby");
    expect(s.history[0]).toMatchObject({ number: 1, winner: null });
    s = apply(s, HOST, { t: "setWinner", winner: "A", game: 1 } as ClientMsg);
    const same = reduce(s, HOST, { t: "setWinner", winner: "A", game: 1 } as ClientMsg, T0 + 50);
    expect(same.ok && same.state).toBe(s);
    s = hostDraftAll(apply(s, HOST, { t: "start" }), "r2_");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    expect(s.status).toBe("finished");
    // game 1 was a misclick (B won): the correction reopens the series for a decider
    expect(errCode(reduce(s, CAP_A, { t: "setWinner", winner: "B", game: 1 } as ClientMsg, T0))).toBe("forbidden");
    s = apply(s, HOST, { t: "setWinner", winner: "B", game: 1 } as ClientMsg, T0 + 7);
    expect(s).toMatchObject({ status: "drafting", updatedAt: T0 + 7 });
    expect(seriesScore(s)).toEqual({ A: 1, B: 1 });
    expect(currentResult(s)).toBe("A");
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "A", red: "B" }, firstSide: "blue" });
    expect(s.gameNumber).toBe(3);
    // B winning game 2 as well would have ended the series before game 3
    expect(errCode(reduce(s, HOST, { t: "setWinner", winner: "B", game: 2 } as ClientMsg, T0))).toBe("series_decided");
    for (const game of [0, 4, 1.5]) expect(errCode(reduce(s, HOST, { t: "setWinner", winner: "A", game } as ClientMsg, T0))).toBe("bad_game");
    // game 3 is the current game: its draft must be complete first
    expect(errCode(reduce(s, HOST, { t: "setWinner", winner: "A", game: 3 } as ClientMsg, T0))).toBe("draft_incomplete");
  });

  it("best of 2 ends 1-1 and best of 1 ends after one game", () => {
    let s = hostDraftAll(started({ bestOf: 2 }), "a");
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" });
    s = hostDraftAll(apply(s, HOST, { t: "start" }), "b");
    s = apply(s, HOST, { t: "setWinner", winner: "B" });
    expect(s.status).toBe("finished");
    let one = hostDraftAll(started({ bestOf: 1 }), "a");
    expect(errCode(reduce(one, HOST, { t: "nextGame", sides: { blue: "B", red: "A" }, firstSide: "blue" }, T0))).toBe("series_over");
    one = apply(one, HOST, { t: "setWinner", winner: "B" });
    expect(one.status).toBe("finished");
  });
});

describe("fearless", () => {
  /** Plays game 1 where A (blue) picks a0..a4 and B (red) picks b0..b4, then swaps sides for game 2. */
  function afterGame1(fearless: RoomConfig["fearless"], sides: Record<Side, TeamSlot> = { blue: "B", red: "A" }) {
    let s = started({ fearless, bestOf: 5 });
    const picks: Record<Side, number> = { blue: 0, red: 0 };
    while (currentStep(s)) {
      const step = currentStep(s)!;
      const id = step.type === "ban" ? null : C(`${step.side === "blue" ? "a" : "b"}${picks[step.side]++}`);
      s = apply(s, HOST, { t: "lock", championId: id });
    }
    s = apply(s, HOST, { t: "setWinner", winner: "A" });
    // the current game's own record never locks anything
    expect(fearlessLocked(s)).toEqual({ blue: [], red: [] });
    return apply(apply(s, HOST, { t: "nextGame", sides, firstSide: "blue" }), HOST, { t: "start" });
  }

  it("off", () => {
    const s = afterGame1("off");
    expect(fearlessLocked(s)).toEqual({ blue: [], red: [] });
    expect(apply(s, HOST, { t: "lock", championId: C("a0") }).actions).toHaveLength(1);
  });

  it("soft: a team can't re-pick its own champions, tracked through side swaps", () => {
    let s = afterGame1("soft");
    const locked = fearlessLocked(s);
    // A is now red, B is now blue
    expect(new Set(locked.red)).toEqual(new Set([C("a0"), C("a1"), C("a2"), C("a3"), C("a4")]));
    expect(new Set(locked.blue)).toEqual(new Set([C("b0"), C("b1"), C("b2"), C("b3"), C("b4")]));
    expect(unavailableFor(s, "red").has(C("a0"))).toBe(true);
    expect(unavailableFor(s, "blue").has(C("a0"))).toBe(false);
    // bans are never fearless-locked
    s = apply(s, CAP_B, { t: "lock", championId: C("b0") });
    expect(s.actions[0]).toMatchObject({ slot: "B", championId: C("b0"), type: "ban" });
    while (currentStep(s)!.type === "ban") s = apply(s, HOST, { t: "lock", championId: null });
    // blue (B) picks first: its own b1 is locked, A's a0 is fine
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: C("b1") }, T0))).toBe("fearless_locked");
    expect(errCode(reduce(s, CAP_B, { t: "hover", championId: C("b1") }, T0))).toBe("fearless_locked");
    s = apply(s, CAP_B, { t: "lock", championId: C("a0") });
    // red (A) may take B's old champion
    s = apply(s, CAP_A, { t: "lock", championId: C("b2") });
    expect(errCode(reduce(s, CAP_A, { t: "lock", championId: C("a1") }, T0))).toBe("fearless_locked");
  });

  it("soft without a side swap", () => {
    const s = afterGame1("soft", { blue: "A", red: "B" });
    expect(new Set(fearlessLocked(s).blue)).toEqual(new Set([C("a0"), C("a1"), C("a2"), C("a3"), C("a4")]));
  });

  it("hard: nobody can pick anything picked earlier", () => {
    let s = afterGame1("hard");
    const all = [C("a0"), C("a1"), C("a2"), C("a3"), C("a4"), C("b0"), C("b1"), C("b2"), C("b3"), C("b4")];
    expect(new Set(fearlessLocked(s).blue)).toEqual(new Set(all));
    expect(new Set(fearlessLocked(s).red)).toEqual(new Set(all));
    s = apply(s, HOST, { t: "lock", championId: C("a3") }); // banning is still allowed
    while (currentStep(s)!.type === "ban") s = apply(s, HOST, { t: "lock", championId: null });
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: C("a1") }, T0))).toBe("fearless_locked");
    expect(errCode(reduce(s, CAP_B, { t: "lock", championId: C("b1") }, T0))).toBe("fearless_locked");
    // timeout with a fearless-locked hover pauses instead of locking it
    s = { ...s, hovers: { ...s.hovers, blue: C("a1") } };
    expect(applyTimeout(s, s.turnDeadline!)!.expired?.code).toBe("timer_expired");
  });

  it("hard fearless accumulates over three games", () => {
    let s = afterGame1("hard");
    s = hostDraftAll(s, "g2_");
    s = apply(s, HOST, { t: "nextGame", sides: { blue: "A", red: "B" }, firstSide: "blue" });
    expect(fearlessLocked(s).blue).toHaveLength(20);
  });
});

describe("setTeam", () => {
  it("host or own captain, validated", () => {
    let s = initialRoomState("r", config(), T0);
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "B", name: "Nope" }, T0))).toBe("forbidden");
    expect(errCode(reduce(s, SPEC, { t: "setTeam", slot: "A", name: "Nope" }, T0))).toBe("forbidden");
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "A" }, T0))).toBe("bad_message");
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "A", name: "  " }, T0))).toBe("bad_name");
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "A", profileId: "BAD!" }, T0))).toBe("bad_profile");
    s = apply(s, CAP_A, { t: "setTeam", slot: "A", name: " Team  Liquid ", profileId: "abc123" }, T0 + 1);
    expect(s.config.teams.A).toEqual({ name: "Team Liquid", profileId: "abc123" });
    expect(s.updatedAt).toBe(T0 + 1);
    s = apply(s, HOST, { t: "setTeam", slot: "B", profileId: null });
    expect(s.config.teams.B.profileId).toBeNull();
    const same = reduce(s, HOST, { t: "setTeam", slot: "A", name: "Team Liquid" }, T0 + 50);
    expect(same.ok && same.state).toBe(s);
  });

  it("one profile can't be attached to both teams; captains change teams only in the lobby", () => {
    let s = initialRoomState("r", config(), T0);
    s = apply(s, CAP_B, { t: "setTeam", slot: "B", profileId: "bteam00profile" });
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "A", profileId: "bteam00profile" }, T0))).toBe("bad_profile");
    expect(errCode(reduce(s, HOST, { t: "setTeam", slot: "A", profileId: "bteam00profile" }, T0))).toBe("bad_profile");
    s = apply(s, CAP_A, { t: "setTeam", slot: "A", profileId: "ateam00profile" });
    s = apply(s, HOST, { t: "start" });
    expect(errCode(reduce(s, CAP_A, { t: "setTeam", slot: "A", profileId: null }, T0))).toBe("not_in_lobby");
    expect(errCode(reduce(s, CAP_B, { t: "setTeam", slot: "B", name: "Renamed" }, T0))).toBe("not_in_lobby");
    expect(apply(s, HOST, { t: "setTeam", slot: "B", name: "Renamed" }).config.teams.B.name).toBe("Renamed");
  });
});

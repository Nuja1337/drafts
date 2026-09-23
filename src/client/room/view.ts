// Pure derivations from RoomState for rendering: turn, board cells, availability, series score.
import {
  actingSide,
  currentResult,
  fearlessLocked,
  isSeriesOver,
  nextStep,
  phaseLabel,
  seriesScore,
  stepSide,
  takenIn,
  unavailableFor,
  winsNeeded,
} from "../../shared/draft";
import type { DraftAction, DraftFormat, GameRecord, RoomRole, RoomState } from "../../shared/room";
import type { ActionType, Side, TeamSlot } from "../../shared/types";

export interface Turn {
  index: number;
  side: Side;
  type: ActionType;
}

export interface BoardCell {
  stepIndex: number;
  /** 0-based phase group (used to space ban groups like a broadcast overlay). */
  phase: number;
  action: DraftAction | null;
}

export interface FearlessOrigin {
  game: number;
  slot: TeamSlot;
}

export interface DraftView {
  format: DraftFormat;
  next: Turn | null;
  phase: string;
  sideOf: Record<TeamSlot, Side>;
  yourSlot: TeamSlot | null;
  yourSide: Side | null;
  isHost: boolean;
  /** True when this viewer may hover/lock the current step right now. */
  canAct: boolean;
  /** Every step of this game has been locked. */
  complete: boolean;
  picks: Record<Side, BoardCell[]>;
  bans: Record<Side, BoardCell[]>;
  /** Fearless pick locks per side (from draft.ts; bans are never fearless-locked). */
  locked: Record<Side, string[]>;
  /** Picked or banned this game. */
  taken: Set<string>;
  /** What each side can't pick right now (taken + fearless). */
  unavailable: Record<Side, Set<string>>;
  pickedBy: Map<string, Side>;
  banned: Set<string>;
  /** Earlier-game picks, for "picked in game N" tooltips. */
  fearlessOrigins: Map<string, FearlessOrigin[]>;
  previousGames: GameRecord[];
  wins: Record<TeamSlot, number>;
  currentWinner: TeamSlot | null;
  winsNeeded: number;
  /** The series is decided, or its last game's result is recorded. */
  seriesOver: boolean;
  seriesWinner: TeamSlot | null;
  /** Series over without a winner (a Bo2 that ended 1–1). */
  seriesDrawn: boolean;
  /** Host may start the next game of the series now. */
  canNextGame: boolean;
}

const phaseIndexOf = (format: DraftFormat, stepIndex: number): number => {
  let p = 0;
  (format.phases ?? []).forEach((ph, i) => {
    if (stepIndex >= ph.start) p = i;
  });
  return p;
};

export function buildDraftView(state: RoomState, format: DraftFormat, you: RoomRole | null): DraftView {
  const { actions, firstSide } = state;
  const rawNext = nextStep(format, firstSide, actions);
  const next: Turn | null = rawNext ? { index: rawNext.index, side: rawNext.side, type: rawNext.type } : null;
  const complete = next === null;

  const byIndex = new Map<number, DraftAction>();
  for (const a of actions) byIndex.set(a.index, a);

  const picks: Record<Side, BoardCell[]> = { blue: [], red: [] };
  const bans: Record<Side, BoardCell[]> = { blue: [], red: [] };
  format.steps.forEach((step, i) => {
    const side = stepSide(step, firstSide);
    const cell: BoardCell = { stepIndex: i, phase: phaseIndexOf(format, i), action: byIndex.get(i) ?? null };
    (step.type === "pick" ? picks : bans)[side].push(cell);
  });

  const pickedBy = new Map<string, Side>();
  const banned = new Set<string>();
  for (const a of actions) {
    if (!a.championId) continue;
    if (a.type === "pick") pickedBy.set(a.championId, a.side);
    else banned.add(a.championId);
  }

  const sideOf: Record<TeamSlot, Side> = state.sides.blue === "A" ? { A: "blue", B: "red" } : { A: "red", B: "blue" };
  const isHost = you?.kind === "host";
  const yourSlot = you?.kind === "captain" ? you.slot : null;
  const yourSide = yourSlot ? sideOf[yourSlot] : null;
  const canAct = state.status === "drafting" && !!next && actingSide(state, you) !== null;

  const previousGames = state.history.filter((g) => g.number < state.gameNumber).sort((a, b) => a.number - b.number);
  const fearlessOrigins = new Map<string, FearlessOrigin[]>();
  for (const g of previousGames) {
    for (const a of g.actions) {
      if (a.type !== "pick" || !a.championId) continue;
      const list = fearlessOrigins.get(a.championId) ?? [];
      list.push({ game: g.number, slot: a.slot });
      fearlessOrigins.set(a.championId, list);
    }
  }

  const wins = seriesScore(state);
  const need = winsNeeded(state.config.bestOf);
  const seriesWinner: TeamSlot | null = wins.A >= need ? "A" : wins.B >= need ? "B" : null;
  // Over only once decided or the last game's result is recorded (a drafted but unrecorded last game is not over yet).
  const seriesOver = isSeriesOver(state);
  const canNextGame = complete && !seriesOver && state.gameNumber < state.config.bestOf;

  let phase: string;
  if (state.status === "lobby") phase = state.gameNumber > 1 ? `Game ${state.gameNumber} lobby` : "Lobby";
  else if (complete) phase = seriesOver && state.config.bestOf > 1 ? "Series complete" : "Draft complete";
  else phase = phaseLabel(format, next!.index);

  return {
    format,
    next,
    phase,
    sideOf,
    yourSlot,
    yourSide,
    isHost,
    canAct,
    complete,
    picks,
    bans,
    locked: fearlessLocked(state),
    taken: takenIn(actions),
    unavailable: { blue: unavailableFor(state, "blue"), red: unavailableFor(state, "red") },
    pickedBy,
    banned,
    fearlessOrigins,
    previousGames,
    wins,
    currentWinner: currentResult(state),
    winsNeeded: need,
    seriesOver,
    seriesWinner,
    seriesDrawn: seriesOver && !seriesWinner && state.config.bestOf > 1 && wins.A === wins.B && wins.A > 0,
    canNextGame,
  };
}

/** Whether `side` may select `id` for a step of `type` (bans ignore fearless locks, like the server). */
export const isSelectable = (view: DraftView, side: Side, type: ActionType, id: string): boolean =>
  type === "ban" ? !view.taken.has(id) : !view.unavailable[side].has(id);

/** Stable string key for a list of actions (to memoize engine runs across hover-only updates). */
export const actionsKey = (actions: DraftAction[]): string =>
  actions.map((a) => `${a.index}${a.side[0]}${a.type[0]}:${a.championId ?? "-"}`).join("|");

export const lockedKey = (locked: Record<Side, string[]>): string => `${[...locked.blue].sort().join(",")}/${[...locked.red].sort().join(",")}`;

/** Series score after replacing the current game's recorded result with `result`. */
export function scoreWith(wins: Record<TeamSlot, number>, current: TeamSlot | null, result: TeamSlot | null): Record<TeamSlot, number> {
  const next = { ...wins };
  if (current) next[current]--;
  if (result) next[result]++;
  return next;
}

export type AnalysisTab = "picks" | "bans" | "threats" | "comps" | "lanes" | "coach";

/** The analysis tab that fits the next action: our ban → bans, our pick → picks, their pick → threats, done → comps. */
export function autoTab(next: Turn | null, complete: boolean, perspective: Side): AnalysisTab | null {
  if (complete) return "comps";
  if (!next) return null;
  if (next.side === perspective) return next.type === "ban" ? "bans" : "picks";
  return next.type === "pick" ? "threats" : null;
}

export const roleName = (you: RoomRole | null): string =>
  !you ? "Connecting" : you.kind === "host" ? "Host" : you.kind === "captain" ? `Captain ${you.slot}` : "Spectator";

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return String(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

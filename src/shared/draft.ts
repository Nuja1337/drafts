// Pure draft state machine shared by the DraftRoom Durable Object (authoritative) and the client (UI gating, previews).
// Every transition is a pure function (state, …, now) → new state | error; nothing here touches I/O or clocks.
import { getFormat } from "./formats";
import { GAMES } from "./games";
import type { ClientMsg, DraftAction, DraftFormat, FormatStep, GameRecord, RoomConfig, RoomRole, RoomState } from "./room";
import { isDraftableChampion } from "./rosters";
import { SIDES, TEAM_SLOTS, otherSide, type ActionType, type Side, type TeamSlot } from "./types";

// ---- Limits shared by the API validation, the DO and the client -------------------------------

/** Champion / hero ids (Data Dragon ids, Dota short names). */
export const CHAMPION_ID_RE = /^[A-Za-z0-9_]{1,40}$/;
/** Team profile ids (randomId alphabet). */
export const PROFILE_ID_RE = /^[a-z0-9]{6,24}$/;
/** Room ids are randomId(8). */
export const ROOM_ID_RE = /^[a-z0-9]{8}$/;
export const TEAM_NAME_MAX = 32;
export const TIMER_MIN_SECONDS = 10;
export const TIMER_MAX_SECONDS = 300;
/** A resumed turn always gets at least this much time (never more than a full turn). */
export const MIN_RESUME_MS = 5_000;

// ---- Basic helpers (documented contract) -------------------------------------------------------

export function stepSide(step: FormatStep, firstSide: Side): Side {
  return step.side === "first" ? firstSide : otherSide(firstSide);
}

export interface NextStep {
  index: number;
  side: Side;
  type: ActionType;
}

/** The step to act on after `actions`, or null when the draft is complete. */
export function nextStep(format: DraftFormat, firstSide: Side, actions: DraftAction[]): NextStep | null {
  const index = actions.length;
  const step = format.steps[index];
  if (!step) return null;
  return { index, side: stepSide(step, firstSide), type: step.type };
}

/** Champion ids `side` picked, in pick order. */
export function picksOf(actions: DraftAction[], side: Side): string[] {
  const out: string[] = [];
  for (const a of actions) if (a.type === "pick" && a.side === side && a.championId) out.push(a.championId);
  return out;
}

/** Bans in order (null = skipped ban), optionally for one side. */
export function bansOf(actions: DraftAction[], side?: Side): (string | null)[] {
  const out: (string | null)[] = [];
  for (const a of actions) if (a.type === "ban" && (!side || a.side === side)) out.push(a.championId);
  return out;
}

/** Every champion picked or banned in these actions. */
export function takenIn(actions: DraftAction[]): Set<string> {
  const out = new Set<string>();
  for (const a of actions) if (a.championId) out.add(a.championId);
  return out;
}

/** The room's format. Throws for an unknown id (ids are stable and validated on room creation). */
export function formatOf(state: RoomState): DraftFormat {
  const f = getFormat(state.config.formatId);
  if (!f) throw new Error(`Unknown draft format "${state.config.formatId}"`);
  return f;
}

/** Current step of the room's draft, or null when complete. */
export function currentStep(state: RoomState): NextStep | null {
  return nextStep(formatOf(state), state.firstSide, state.actions);
}

/**
 * Champions each side may not pick because of fearless rules. Only games numbered before the current one count.
 * soft: a team (slot) can't re-pick what IT picked earlier, followed through side swaps. hard: nobody can pick anything
 * picked earlier. Bans are never fearless-locked.
 */
export function fearlessLocked(state: RoomState): Record<Side, string[]> {
  const mode = state.config.fearless;
  const locked: Record<Side, Set<string>> = { blue: new Set(), red: new Set() };
  if (mode !== "off") {
    for (const game of state.history) {
      if (game.number >= state.gameNumber) continue;
      for (const a of game.actions) {
        if (a.type !== "pick" || !a.championId) continue;
        if (mode === "hard") {
          locked.blue.add(a.championId);
          locked.red.add(a.championId);
        } else {
          const slot = game.sides[a.side];
          for (const side of SIDES) if (state.sides[side] === slot) locked[side].add(a.championId);
        }
      }
    }
  }
  return { blue: [...locked.blue], red: [...locked.red] };
}

/** Everything `side` can't pick right now: picked/banned this game + fearless locks. */
export function unavailableFor(state: RoomState, side: Side): Set<string> {
  const out = takenIn(state.actions);
  for (const id of fearlessLocked(state)[side]) out.add(id);
  return out;
}

export function isDraftComplete(state: RoomState): boolean {
  return state.actions.length >= formatOf(state).steps.length;
}

export function phaseLabel(format: DraftFormat, index: number): string {
  if (index >= format.steps.length) return "Draft complete";
  const i = Math.max(0, index);
  let best: { start: number; label: string } | null = null;
  for (const p of format.phases ?? []) if (p.start <= i && (!best || p.start >= best.start)) best = p;
  if (best) return best.label;
  return format.steps[i].type === "ban" ? "Bans" : "Picks";
}

export function initialRoomState(id: string, config: RoomConfig, now: number): RoomState {
  return {
    id,
    config,
    status: "lobby",
    gameNumber: 1,
    sides: { blue: "A", red: "B" },
    firstSide: config.firstSide === "red" ? "red" : "blue",
    actions: [],
    history: [],
    hovers: { blue: null, red: null },
    ready: { A: false, B: false },
    turnDeadline: null,
    pausedRemainingMs: null,
    presence: { host: 0, A: 0, B: 0, spectators: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

// ---- Series helpers -----------------------------------------------------------------------------

export const winsNeeded = (bestOf: RoomConfig["bestOf"]): number => Math.floor(bestOf / 2) + 1;

/** Game wins per team from recorded results (history). */
export function seriesScore(state: RoomState): Record<TeamSlot, number> {
  const score: Record<TeamSlot, number> = { A: 0, B: 0 };
  for (const g of state.history) if (g.winner) score[g.winner]++;
  return score;
}

/**
 * The current game's recorded result. History holds every earlier game; the current game is appended as soon as the
 * host records its winner (so everyone sees it) and is removed again by undo/reset or clearing the result.
 */
export function currentResult(state: RoomState): TeamSlot | null {
  return state.history.find((g) => g.number === state.gameNumber)?.winner ?? null;
}

/** Series decided (a team reached the needed wins) or the last game of the series has a result. */
export function isSeriesOver(state: RoomState): boolean {
  const score = seriesScore(state);
  const need = winsNeeded(state.config.bestOf);
  if (score.A >= need || score.B >= need) return true;
  return state.gameNumber >= state.config.bestOf && currentResult(state) !== null;
}

export function sideOfSlot(state: RoomState, slot: TeamSlot): Side {
  return state.sides.blue === slot ? "blue" : "red";
}

/** Side `role` may lock/hover for on the current step, or null (not their turn / not allowed / draft over). */
export function actingSide(state: RoomState, role: RoomRole | null): Side | null {
  if (!role || (state.status !== "drafting" && state.status !== "paused")) return null;
  const step = currentStep(state);
  if (!step) return null;
  if (role.kind === "host") return step.side;
  if (role.kind === "captain" && state.config.mode === "captains" && sideOfSlot(state, role.slot) === step.side) return step.side;
  return null;
}

// ---- Transitions --------------------------------------------------------------------------------

export interface DraftError {
  code: string;
  message: string;
}
export type DraftResult = { ok: true; state: RoomState } | { ok: false; error: DraftError };

const ok = (state: RoomState): DraftResult => ({ ok: true, state });
const fail = (code: string, message: string): DraftResult => ({ ok: false, error: { code, message } });
const unit = (state: RoomState) => GAMES[state.config.game].unit.toLowerCase();
const sideName = (state: RoomState, side: Side) => GAMES[state.config.game].sideLabels[side];

const turnMs = (config: RoomConfig, type: ActionType): number =>
  (type === "pick" ? config.timer.pickSeconds : config.timer.banSeconds) * 1000;

/** Deadline for the current step if it started at `now` (null without a timer or when the draft is complete). */
function deadlineFor(state: RoomState, now: number): number | null {
  if (!state.config.timer.enabled) return null;
  const step = currentStep(state);
  return step ? now + turnMs(state.config, step.type) : null;
}

const withoutCurrentRecord = (state: RoomState): GameRecord[] => state.history.filter((g) => g.number < state.gameNumber);

/** Why `championId` can't be used for a `type` step by `side` (null = fine). null championId = skipped ban. */
export function championError(state: RoomState, side: Side, type: ActionType, championId: string | null): DraftError | null {
  if (championId === null) {
    return type === "ban" ? null : { code: "pick_required", message: `Choose a ${unit(state)} to pick.` };
  }
  if (!CHAMPION_ID_RE.test(championId)) return { code: "bad_champion", message: `Invalid ${unit(state)} id.` };
  if (!isDraftableChampion(state.config.game, championId)) return { code: "bad_champion", message: `Unknown ${unit(state)}.` };
  // Case-insensitive, so a case variant can't slip past a ban or a fearless lock.
  const folded = championId.toLowerCase();
  const same = (id: string) => id.toLowerCase() === folded;
  if ([...takenIn(state.actions)].some(same)) {
    return { code: "unavailable", message: `That ${unit(state)} was already picked or banned this game.` };
  }
  if (type === "pick" && fearlessLocked(state)[side].some(same)) {
    return { code: "fearless_locked", message: `That ${unit(state)} is locked by fearless rules for ${sideName(state, side)}.` };
  }
  return null;
}

/** Why the current step can't be locked by `side` with `championId` (null = valid). */
export function validateLock(state: RoomState, side: Side, championId: string | null): DraftError | null {
  if (state.status !== "drafting") {
    return { code: "not_drafting", message: state.status === "paused" ? "The draft is paused." : "The draft is not running." };
  }
  const step = currentStep(state);
  if (!step) return { code: "draft_complete", message: "The draft is already complete." };
  if (step.side !== side) return { code: "not_your_turn", message: `It's ${sideName(state, step.side)}'s turn.` };
  return championError(state, side, step.type, championId);
}

function lockStep(state: RoomState, step: NextStep, championId: string | null, now: number, auto: boolean): RoomState {
  const action: DraftAction = {
    index: step.index,
    side: step.side,
    slot: state.sides[step.side],
    type: step.type,
    championId,
    at: now,
    ...(auto ? { auto: true } : {}),
  };
  const hovers: Record<Side, string | null> = { ...state.hovers, [step.side]: null };
  // a hover on the champion just taken is now meaningless
  for (const s of SIDES) if (championId && hovers[s] === championId) hovers[s] = null;
  const next: RoomState = { ...state, actions: [...state.actions, action], hovers, updatedAt: now };
  next.turnDeadline = deadlineFor(next, now);
  return next;
}

/** Locks `championId` for the current step on behalf of `side`. */
export function applyLock(state: RoomState, side: Side, championId: string | null, now: number): DraftResult {
  const err = validateLock(state, side, championId);
  if (err) return { ok: false, error: err };
  return ok(lockStep(state, currentStep(state)!, championId, now, false));
}

/** Sets the acting side's hover (the champion auto-locked when the timer runs out). */
export function applyHover(state: RoomState, side: Side, championId: string | null, now: number): DraftResult {
  if (state.status !== "drafting" && state.status !== "paused") return fail("not_drafting", "The draft is not running.");
  const step = currentStep(state);
  if (!step) return fail("draft_complete", "The draft is already complete.");
  if (step.side !== side) return fail("not_your_turn", `It's ${sideName(state, step.side)}'s turn.`);
  if (championId !== null) {
    const err = championError(state, side, step.type, championId);
    if (err) return { ok: false, error: err };
  }
  if (state.hovers[side] === championId) return ok(state);
  return ok({ ...state, hovers: { ...state.hovers, [side]: championId }, updatedAt: now });
}

export function startDraft(state: RoomState, now: number): DraftResult {
  if (state.status !== "lobby") return fail("already_started", "The draft has already started.");
  const next: RoomState = { ...state, status: "drafting", hovers: { blue: null, red: null }, pausedRemainingMs: null, updatedAt: now };
  next.turnDeadline = deadlineFor(next, now);
  return ok(next);
}

export function setReady(state: RoomState, slot: TeamSlot, ready: boolean, now: number): DraftResult {
  if (state.status !== "lobby") return fail("not_in_lobby", "Ready checks only happen before the draft starts.");
  if (state.ready[slot] === ready) return ok(state);
  const next: RoomState = { ...state, ready: { ...state.ready, [slot]: ready }, updatedAt: now };
  // captains mode starts itself once both teams are ready
  if (state.config.mode === "captains" && TEAM_SLOTS.every((s) => next.ready[s])) return startDraft(next, now);
  return ok(next);
}

export function pauseDraft(state: RoomState, now: number): DraftResult {
  if (state.status !== "drafting") return fail("not_drafting", "Only a running draft can be paused.");
  if (isDraftComplete(state)) return fail("draft_complete", "The draft is already complete.");
  const remaining = state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now);
  return ok({ ...state, status: "paused", turnDeadline: null, pausedRemainingMs: remaining, updatedAt: now });
}

export function resumeDraft(state: RoomState, now: number): DraftResult {
  if (state.status !== "paused") return fail("not_paused", "The draft is not paused.");
  const next: RoomState = { ...state, status: "drafting", pausedRemainingMs: null, updatedAt: now };
  const step = currentStep(state);
  if (state.config.timer.enabled && step) {
    const full = turnMs(state.config, step.type);
    const remaining = state.pausedRemainingMs ?? full;
    next.turnDeadline = now + Math.min(full, Math.max(remaining, MIN_RESUME_MS));
  } else {
    next.turnDeadline = null;
  }
  return ok(next);
}

/** Removes the last action. The turn restarts with a full timer; a recorded result for this game is cleared. */
export function undoAction(state: RoomState, now: number): DraftResult {
  if (state.actions.length === 0) return fail("nothing_to_undo", "Nothing to undo.");
  const status = state.status === "finished" || state.status === "lobby" ? "drafting" : state.status;
  const next: RoomState = {
    ...state,
    status,
    actions: state.actions.slice(0, -1),
    history: withoutCurrentRecord(state),
    hovers: { blue: null, red: null },
    turnDeadline: null,
    pausedRemainingMs: null,
    updatedAt: now,
  };
  if (status === "drafting") {
    next.turnDeadline = deadlineFor(next, now);
  } else if (state.config.timer.enabled) {
    const step = currentStep(next);
    next.pausedRemainingMs = step ? turnMs(state.config, step.type) : null;
  }
  return ok(next);
}

/** Restarts the current game's draft: back to the lobby with nothing locked. */
export function resetGame(state: RoomState, now: number): DraftResult {
  return ok({
    ...state,
    status: "lobby",
    actions: [],
    history: withoutCurrentRecord(state),
    hovers: { blue: null, red: null },
    ready: { A: false, B: false },
    turnDeadline: null,
    pausedRemainingMs: null,
    updatedAt: now,
  });
}

/**
 * Records (or clears, with null) the winner of a game: by default the current, fully drafted one; `game` corrects an
 * earlier game of the series (a misclick or a forgotten result), as long as the earlier games alone wouldn't already
 * have decided the series.
 */
export function setWinner(state: RoomState, winner: TeamSlot | null, now: number, game = state.gameNumber): DraftResult {
  if (game !== state.gameNumber) return setEarlierWinner(state, winner, now, game);
  if (!isDraftComplete(state)) return fail("draft_incomplete", "Finish the draft before recording a result.");
  const history = withoutCurrentRecord(state);
  if (winner) {
    history.push({
      number: state.gameNumber,
      sides: { ...state.sides },
      firstSide: state.firstSide,
      actions: state.actions,
      winner,
    });
  }
  const next: RoomState = { ...state, history, updatedAt: now };
  next.status = isSeriesOver(next) ? "finished" : "drafting";
  return ok(next);
}

function setEarlierWinner(state: RoomState, winner: TeamSlot | null, now: number, game: number): DraftResult {
  const i = Number.isInteger(game) && game >= 1 && game < state.gameNumber ? state.history.findIndex((g) => g.number === game) : -1;
  if (i < 0) return fail("bad_game", "There's no such earlier game in this series.");
  if (state.history[i].winner === winner) return ok(state);
  const history = state.history.map((g, k) => (k === i ? { ...g, winner } : g));
  const earlier = seriesScore({ ...state, history: history.filter((g) => g.number < state.gameNumber) });
  const need = winsNeeded(state.config.bestOf);
  if (earlier.A >= need || earlier.B >= need) {
    return fail("series_decided", `That result would have ended the series before game ${state.gameNumber}.`);
  }
  const next: RoomState = { ...state, history, updatedAt: now };
  if (isDraftComplete(next)) next.status = isSeriesOver(next) ? "finished" : "drafting";
  return ok(next);
}

/** Archives the current game and opens the next one in the lobby (teams ready up again). */
export function nextGame(state: RoomState, sides: Record<Side, TeamSlot>, firstSide: Side, now: number): DraftResult {
  if (!TEAM_SLOTS.includes(sides.blue) || !TEAM_SLOTS.includes(sides.red) || sides.blue === sides.red) {
    return fail("bad_sides", "Each side needs a different team.");
  }
  if (!SIDES.includes(firstSide)) return fail("bad_sides", "Invalid first side.");
  if (!isDraftComplete(state)) return fail("draft_incomplete", "Finish the current draft first.");
  if (isSeriesOver(state) || state.gameNumber >= state.config.bestOf) return fail("series_over", "The series is over.");
  const history = [...state.history];
  if (!history.some((g) => g.number === state.gameNumber)) {
    history.push({ number: state.gameNumber, sides: { ...state.sides }, firstSide: state.firstSide, actions: state.actions, winner: null });
  }
  return ok({
    ...state,
    status: "lobby",
    gameNumber: state.gameNumber + 1,
    sides: { blue: sides.blue, red: sides.red },
    firstSide,
    actions: [],
    history,
    hovers: { blue: null, red: null },
    ready: { A: false, B: false },
    turnDeadline: null,
    pausedRemainingMs: null,
    updatedAt: now,
  });
}

/** Trims and collapses whitespace, strips control characters. Returns null when empty or too long. */
export function cleanTeamName(name: string): string | null {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 1 && cleaned.length <= TEAM_NAME_MAX ? cleaned : null;
}

export function setTeam(state: RoomState, slot: TeamSlot, name: string | undefined, profileId: string | null | undefined, now: number): DraftResult {
  if (name === undefined && profileId === undefined) return fail("bad_message", "Nothing to change.");
  const team = { ...state.config.teams[slot] };
  if (name !== undefined) {
    const cleaned = cleanTeamName(name);
    if (!cleaned) return fail("bad_name", `Team names must be 1-${TEAM_NAME_MAX} characters.`);
    team.name = cleaned;
  }
  if (profileId !== undefined) {
    if (profileId !== null && !PROFILE_ID_RE.test(profileId)) return fail("bad_profile", "Invalid team profile id.");
    // One profile can't be both teams: the other side would get advice built from its own players' pools.
    const other: TeamSlot = slot === "A" ? "B" : "A";
    if (profileId !== null && state.config.teams[other].profileId === profileId) {
      return fail("bad_profile", "That profile is already attached to the other team.");
    }
    team.profileId = profileId;
  }
  const prev = state.config.teams[slot];
  if (prev.name === team.name && (prev.profileId ?? null) === (team.profileId ?? null)) return ok(state);
  return ok({ ...state, config: { ...state.config, teams: { ...state.config.teams, [slot]: team } }, updatedAt: now });
}

export interface TimeoutOutcome {
  state: RoomState;
  /** Set when the draft was paused because a pick timed out with no valid hover. */
  expired: DraftError | null;
}

/**
 * What happens when the current turn's deadline has passed: lock the valid hover, else skip a ban, else pause the
 * draft (the server has no roster to random a pick from). null = nothing due.
 */
export function applyTimeout(state: RoomState, now: number): TimeoutOutcome | null {
  if (state.status !== "drafting" || state.turnDeadline === null || now < state.turnDeadline) return null;
  const step = currentStep(state);
  if (!step) return { state: { ...state, turnDeadline: null, updatedAt: now }, expired: null };
  const hover = state.hovers[step.side];
  if (hover && !championError(state, step.side, step.type, hover)) {
    return { state: lockStep(state, step, hover, now, true), expired: null };
  }
  if (step.type === "ban") return { state: lockStep(state, step, null, now, true), expired: null };
  return {
    state: { ...state, status: "paused", turnDeadline: null, pausedRemainingMs: null, updatedAt: now },
    expired: {
      code: "timer_expired",
      message: `Timer expired on ${sideName(state, step.side)}'s pick with no ${unit(state)} hovered. The draft is paused until the host resumes.`,
    },
  };
}

// ---- Permission-aware reducer ----------------------------------------------------------------------

const HOST_ONLY = new Set<ClientMsg["t"]>(["start", "pause", "resume", "undo", "reset", "setWinner", "nextGame"]);

/**
 * Applies one client message from `role`. Returns the same state object when nothing changed.
 * Permissions: spectators can't act; in host mode only the host acts; captains act only for their own side on its turn;
 * the host may act for any side and alone controls start/pause/resume/undo/reset/setWinner/nextGame.
 */
export function reduce(state: RoomState, role: RoomRole, msg: ClientMsg, now: number): DraftResult {
  if (msg.t === "ping") return ok(state);
  if (role.kind === "spectator") return fail("forbidden", "Spectators can't act in this room.");
  const isHost = role.kind === "host";
  if (!isHost && state.config.mode === "host") return fail("forbidden", "In host mode only the host makes changes.");
  if (HOST_ONLY.has(msg.t) && !isHost) return fail("forbidden", "Only the host can do that.");
  const captainSlot = role.kind === "captain" ? role.slot : null;

  switch (msg.t) {
    case "hover":
    case "lock": {
      const step = currentStep(state);
      if (!step) return fail("draft_complete", "The draft is already complete.");
      // optional stale-turn guard: a client may send the step index it meant to act on
      if (typeof msg.index === "number" && msg.index !== step.index) return fail("stale", "The draft moved on. Try again.");
      const side = captainSlot ? sideOfSlot(state, captainSlot) : step.side;
      return msg.t === "hover" ? applyHover(state, side, msg.championId, now) : applyLock(state, side, msg.championId, now);
    }
    case "ready":
      if (!captainSlot) return fail("forbidden", "Only team captains ready up. The host can start the draft instead.");
      return setReady(state, captainSlot, msg.ready, now);
    case "setTeam":
      if (captainSlot && captainSlot !== msg.slot) return fail("forbidden", "Captains can only edit their own team.");
      // Mid-draft changes (e.g. swapping the attached profile) are the host's call, matching the lobby-only UI.
      if (captainSlot && state.status !== "lobby") return fail("not_in_lobby", "Teams can only be changed in the lobby.");
      return setTeam(state, msg.slot, msg.name, msg.profileId, now);
    case "start":
      return startDraft(state, now);
    case "pause":
      return pauseDraft(state, now);
    case "resume":
      return resumeDraft(state, now);
    case "undo":
      return undoAction(state, now);
    case "reset":
      return resetGame(state, now);
    case "setWinner":
      // `game` (optional) corrects an earlier game's result.
      return setWinner(state, msg.winner, now, msg.game);
    case "nextGame":
      return nextGame(state, msg.sides, msg.firstSide, now);
  }
}

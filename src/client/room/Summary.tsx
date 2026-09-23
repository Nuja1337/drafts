// Draft-complete panel: both comps at a glance, result entry and the next-game dialog (host).
import { useState } from "react";
import type { EngineOutput } from "../../shared/engine/types";
import { archetypeDef, GAMES } from "../../shared/games";
import type { ClientMsg, RoomState } from "../../shared/room";
import type { Champion, Side, TeamSlot } from "../../shared/types";
import { Button, cn, Modal } from "../ui";
import { IconCheck, IconCrown, IconReset, IconUndo, IconWarn } from "./icons";
import { Portrait } from "./Portrait";
import { scoreWith, type DraftView } from "./view";

type Lookup = (id: string | null | undefined) => Champion | undefined;

function SideSummary({ state, side, output, lookup, view }: { state: RoomState; side: Side; output: EngineOutput | null; lookup: Lookup; view: DraftView }) {
  const game = GAMES[state.config.game];
  const slot = state.sides[side];
  const team = state.config.teams[slot];
  const comp = output?.comps[side];
  const roles = output?.roles[side] ?? [];
  const ids = view.picks[side].map((c) => c.action?.championId).filter((x): x is string => !!x);
  const top = comp?.archetypes[0];
  return (
    <div className={cn("min-w-0 rounded-xl border bg-panel p-3", side === "blue" ? "border-blue/40" : "border-red/40")}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", side === "blue" ? "bg-blue" : "bg-red")} />
        <span className="truncate font-display font-bold">{team.name}</span>
        {view.currentWinner === slot && <IconCrown className="size-4 shrink-0 text-accent" title="Winner" />}
        <span className="flex-1" />
        {top && <span className="shrink-0 text-xs text-muted">{archetypeDef(top.id)?.label ?? top.id}</span>}
      </div>
      <ul className="space-y-1">
        {ids.map((id) => {
          const c = lookup(id);
          const r = roles.find((x) => x.championId === id);
          const roleShort = r ? (game.roles.find((g) => g.id === r.role)?.short ?? r.role) : null;
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              <Portrait champ={c} fallbackId={id} className="size-7" />
              <span className="min-w-0 flex-1 truncate">{c?.name ?? id}</span>
              <span className="shrink-0 text-[11px] text-muted">{[roleShort, r?.playerName].filter(Boolean).join(" · ")}</span>
            </li>
          );
        })}
      </ul>
      {comp && (comp.strengths.length > 0 || comp.warnings.length > 0) && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs">
          {comp.strengths.slice(0, 2).map((s) => (
            <li key={s} className="flex gap-1.5 text-muted">
              <IconCheck className="mt-0.5 size-3 shrink-0 text-good" />
              {s}
            </li>
          ))}
          {comp.warnings.slice(0, 2).map((s) => (
            <li key={s} className="flex gap-1.5 text-muted">
              <IconWarn className="mt-0.5 size-3 shrink-0 text-warn" />
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ResultChoice = TeamSlot | "none";

function NextGameDialog({ state, view, open, onClose, send }: { state: RoomState; view: DraftView; open: boolean; onClose: () => void; send: (msg: ClientMsg) => void }) {
  const game = GAMES[state.config.game];
  const teams = state.config.teams;
  // Default: swap sides (common series convention); first pick stays with the blue/radiant side.
  const [blueSlot, setBlueSlot] = useState<TeamSlot>(state.sides.red);
  const [firstSide, setFirstSide] = useState<Side>("blue");
  // A result can't be entered once the next game has started, so it's asked for here (no default).
  const [result, setResult] = useState<ResultChoice | null>(view.currentWinner);
  const redSlot: TeamSlot = blueSlot === "A" ? "B" : "A";
  const winner: TeamSlot | null = result === "none" ? null : result;
  const after = scoreWith(view.wins, view.currentWinner, winner);
  const decided = after.A >= view.winsNeeded || after.B >= view.winsNeeded;

  const confirm = () => {
    if (result === null) return;
    // The room applies messages in order: record the result first, then open the next game.
    if (winner !== view.currentWinner) send({ t: "setWinner", winner });
    if (!decided) send({ t: "nextGame", sides: { blue: blueSlot, red: redSlot }, firstSide });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={decided ? `Result of game ${state.gameNumber}` : `Start game ${state.gameNumber + 1}`}>
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">Who won game {state.gameNumber}?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["A", "B", "none"] as const).map((r) => (
              <label key={r} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm", result === r ? "border-accent bg-accent/5" : "border-line")}>
                <input type="radio" name="result" checked={result === r} onChange={() => setResult(r)} className="accent-[var(--color-accent)]" />
                <span className="min-w-0 truncate">{r === "none" ? "Not played" : `${teams[r].name} won`}</span>
              </label>
            ))}
          </div>
          {result === null && <p className="text-xs text-warn">Record the result now — it can't be entered after the next game starts.</p>}
          {decided && winner && (
            <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              That makes it {after.A}–{after.B}: {teams[winner].name} win the series, so no further game is needed.
            </p>
          )}
        </fieldset>
        {!decided && (
          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">Sides</legend>
              {(["A", "B"] as const).map((slot) => {
                const other: TeamSlot = slot === "A" ? "B" : "A";
                const swapped = slot !== state.sides.blue;
                return (
                  <label key={slot} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3", blueSlot === slot ? "border-accent bg-accent/5" : "border-line")}>
                    <input type="radio" name="blueSlot" checked={blueSlot === slot} onChange={() => setBlueSlot(slot)} className="accent-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="text-blue">{game.sideLabels.blue}:</span> {teams[slot].name} · <span className="text-red">{game.sideLabels.red}:</span> {teams[other].name}
                    </span>
                    <span className="text-xs text-faint">{swapped ? "swap" : "same"}</span>
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">First pick</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["blue", "red"] as const).map((s) => (
                  <label key={s} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm", firstSide === s ? "border-accent bg-accent/5" : "border-line")}>
                    <input type="radio" name="firstSide" checked={firstSide === s} onChange={() => setFirstSide(s)} className="accent-[var(--color-accent)]" />
                    <span className="min-w-0 truncate">
                      <span className={s === "blue" ? "text-blue" : "text-red"}>{game.sideLabels[s]}</span> ({teams[s === "blue" ? blueSlot : redSlot].name})
                    </span>
                  </label>
                ))}
              </div>
              {state.config.game === "lol" && <p className="text-xs text-faint">In League the blue side normally has first pick.</p>}
            </fieldset>
            {state.config.fearless !== "off" && (
              <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                Fearless ({state.config.fearless}): champions picked so far stay locked for the rest of the series.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={result === null} onClick={confirm}>
            {decided ? "Record result" : `Start game ${state.gameNumber + 1}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Summary({
  state,
  view,
  output,
  perspective,
  lookup,
  send,
  onReset,
}: {
  state: RoomState;
  view: DraftView;
  output: EngineOutput | null;
  perspective: Side;
  lookup: Lookup;
  send: (msg: ClientMsg) => void;
  onReset: () => void;
}) {
  const [nextOpen, setNextOpen] = useState(false);
  const teams = state.config.teams;
  // The server appends the current game to history as soon as a result is recorded.
  const winner = view.currentWinner;
  const est = output ? Math.round(output.winEstimate * 100) : null;
  const perspName = teams[state.sides[perspective]].name;
  const setWinner = (w: TeamSlot | null) => send({ t: "setWinner", winner: w });
  const moreGames = state.gameNumber < state.config.bestOf;
  const waiting = view.seriesOver
    ? null
    : !winner
      ? `Waiting for the host to record the result${moreGames ? " and start the next game" : ""}…`
      : moreGames
        ? "Waiting for the host to start the next game…"
        : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="text-center">
          <div className="text-[11px] font-semibold tracking-[0.25em] text-accent uppercase">Game {state.gameNumber}</div>
          <h2 className="font-display text-2xl font-bold">Draft complete</h2>
          {est !== null && (
            <p className="mt-1 text-sm text-muted">
              Draft edge for {perspName}: <span className={cn("font-semibold", est >= 50 ? "text-good" : "text-bad")}>{est}%</span>
              <span className="text-faint"> (heuristic, not a prediction)</span>
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SideSummary state={state} side="blue" output={output} lookup={lookup} view={view} />
          <SideSummary state={state} side="red" output={output} lookup={lookup} view={view} />
        </div>

        {view.seriesWinner ? (
          <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-center">
            <IconCrown className="mx-auto mb-1 size-6 text-accent" />
            <div className="font-display text-lg font-bold">{teams[view.seriesWinner].name} win the series</div>
            <div className="text-sm text-muted">
              {view.wins.A} – {view.wins.B}
            </div>
          </div>
        ) : view.seriesDrawn ? (
          <div className="rounded-xl border border-line-strong bg-panel-2 p-4 text-center">
            <div className="font-display text-lg font-bold">
              Series drawn {view.wins.A}–{view.wins.B}
            </div>
            <div className="text-sm text-muted">Neither team reached {view.winsNeeded} wins.</div>
          </div>
        ) : null}

        {view.isHost ? (
          <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <div className="text-xs font-semibold tracking-wider text-muted uppercase">Result of game {state.gameNumber}</div>
            <div className="flex flex-wrap gap-2">
              {(["A", "B"] as const).map((slot) => (
                <Button key={slot} variant={winner === slot ? "primary" : "secondary"} onClick={() => setWinner(slot)} aria-pressed={winner === slot}>
                  {winner === slot && <IconCrown className="size-4" />}
                  {teams[slot].name} won
                </Button>
              ))}
              {winner && (
                <Button variant="ghost" onClick={() => setWinner(null)}>
                  Clear
                </Button>
              )}
            </div>
            {view.canNextGame ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <Button variant="primary" onClick={() => setNextOpen(true)}>
                  Next game ({state.gameNumber + 1} of {state.config.bestOf})
                </Button>
                {!winner && <span className="text-xs text-warn">No result recorded yet — you'll be asked for it before the next game starts.</span>}
              </div>
            ) : (
              state.config.bestOf > 1 &&
              !view.seriesWinner &&
              !view.seriesDrawn && (
                <p className="border-t border-line pt-3 text-sm text-muted">
                  That was the last game of the series{winner ? "." : " — record its result to finish the series."}
                </p>
              )
            )}
            <div className="flex flex-wrap gap-1 border-t border-line pt-3">
              <Button size="sm" variant="ghost" onClick={() => send({ t: "undo" })} title="Reopen the draft by removing the last pick">
                <IconUndo className="size-3.5" /> Undo last pick
              </Button>
              <Button size="sm" variant="ghost" onClick={onReset} title="Clear this game's draft and return to the lobby">
                <IconReset className="size-3.5" /> Reset game
              </Button>
            </div>
          </div>
        ) : (
          waiting && <p className="text-center text-sm text-muted">{waiting}</p>
        )}
      </div>
      {nextOpen && <NextGameDialog state={state} view={view} open={nextOpen} onClose={() => setNextOpen(false)} send={send} />}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} autoFocus>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

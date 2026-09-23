// Bottom bar of the center column: whose turn, the selected champion, Lock in / No ban, and host draft controls.
import { GAMES } from "../../shared/games";
import type { ClientMsg, RoomState } from "../../shared/room";
import type { Champion } from "../../shared/types";
import { Button, cn } from "../ui";
import { IconBan, IconPause, IconPlay, IconReset, IconUndo } from "./icons";
import { Portrait } from "./Portrait";
import type { DraftView } from "./view";

export function ActionBar({
  state,
  view,
  selectedChamp,
  selectedId,
  selectedAvailable,
  lockPending,
  onLock,
  onNoBan,
  send,
  onReset,
}: {
  state: RoomState;
  view: DraftView;
  selectedChamp: Champion | undefined;
  selectedId: string | null;
  selectedAvailable: boolean;
  lockPending: boolean;
  onLock: () => void;
  onNoBan: () => void;
  send: (msg: ClientMsg) => void;
  onReset: () => void;
}) {
  const game = GAMES[state.config.game];
  const next = view.next;
  const paused = state.status === "paused";
  const teamOnNext = next ? state.config.teams[state.sides[next.side]].name : "";
  const ordinal = next ? (next.type === "pick" ? view.picks : view.bans)[next.side].findIndex((c) => c.stepIndex === next.index) + 1 : 0;
  const stepText = next ? `${game.sideLabels[next.side]} ${next.type} ${ordinal}` : "";

  let turnLine: string;
  if (paused) turnLine = "Draft paused by the host";
  else if (!next) turnLine = "Draft complete";
  else if (view.canAct && view.isHost && view.yourSlot === null) turnLine = `Entering for ${teamOnNext}`;
  else if (view.canAct) turnLine = "Your turn";
  else turnLine = `Waiting for ${teamOnNext}`;

  const canLock = view.canAct && !paused && !lockPending && !!selectedId && selectedAvailable;
  const isBan = next?.type === "ban";

  return (
    <div className="border-t border-line bg-panel/95 px-2 py-2 sm:px-3">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 basis-48 items-center gap-2.5 rounded-lg border px-2 py-1.5",
            view.canAct && !paused ? (next?.side === "red" ? "border-red/50 bg-red/10" : "border-blue/50 bg-blue/10") : "border-line bg-panel-2",
          )}
        >
          <Portrait champ={selectedChamp} fallbackId={selectedId} className="size-9" />
          <div className="min-w-0">
            <div className={cn("truncate text-[10px] font-bold tracking-[0.18em] uppercase", next?.side === "red" ? "text-red" : "text-blue")}>
              {stepText}
              {stepText && " · "}
              <span className={cn(view.canAct && !paused ? "text-accent" : "text-muted")}>{turnLine}</span>
            </div>
            <div className="truncate text-sm font-semibold">
              {selectedId ? (selectedChamp?.name ?? selectedId) : view.canAct ? `Select a ${game.unit.toLowerCase()}` : <span className="text-muted">—</span>}
              {selectedId && !selectedAvailable && <span className="ml-2 text-xs font-normal text-bad">unavailable</span>}
            </div>
          </div>
        </div>

        {view.canAct && isBan && (
          <Button variant="secondary" onClick={onNoBan} disabled={paused || lockPending} title="Skip this ban">
            <IconBan className="size-4" />
            No ban
          </Button>
        )}
        {view.canAct && (
          <Button
            variant={next?.side === "red" ? "red" : "blue"}
            size="lg"
            onClick={onLock}
            disabled={!canLock}
            loading={lockPending}
            className="min-w-32 font-display tracking-wider uppercase"
            aria-keyshortcuts="Enter"
            title="Lock in (Enter)"
          >
            {isBan ? "Ban" : "Lock in"}
            <kbd className="hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">⏎</kbd>
          </Button>
        )}

        {view.isHost && (
          <div className="flex items-center gap-1 border-line sm:border-l sm:pl-2">
            {paused ? (
              <Button size="sm" variant="primary" onClick={() => send({ t: "resume" })} title="Resume the draft">
                <IconPlay className="size-3.5" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => send({ t: "pause" })} disabled={state.status !== "drafting"} title="Pause the draft">
                <IconPause className="size-3.5" /> <span className="hidden md:inline">Pause</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => send({ t: "undo" })} disabled={state.actions.length === 0} title="Undo the last pick/ban">
              <IconUndo className="size-3.5" /> <span className="hidden md:inline">Undo</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={onReset} title="Restart this game's draft">
              <IconReset className="size-3.5" /> <span className="hidden md:inline">Reset</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

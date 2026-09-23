// Broadcast-style room header: teams + series score, phase, countdown, connection, role and share.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { GAMES } from "../../shared/games";
import type { RoomRole, RoomState } from "../../shared/room";
import type { Side, TeamSlot } from "../../shared/types";
import { cn } from "../ui";
import { IconBack, IconEye, IconShare } from "./icons";
import { formatClock, roleName, type DraftView, type Turn } from "./view";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Re-render every `ms` while `active`. */
function useTick(active: boolean, ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}

export function Countdown({ state, next, serverNow, className }: { state: RoomState; next: Turn | null; serverNow: () => number; className?: string }) {
  const running = state.status === "drafting" && state.turnDeadline !== null && !!next;
  useTick(running, 200);
  const timer = state.config.timer;
  const paused = state.status === "paused";

  let ms: number | null = null;
  if (paused && state.pausedRemainingMs !== null) ms = state.pausedRemainingMs;
  else if (running) ms = Math.max(0, state.turnDeadline! - serverNow());
  const total = next ? (next.type === "pick" ? timer.pickSeconds : timer.banSeconds) * 1000 : 0;
  const frac = ms !== null && total > 0 ? Math.min(1, ms / total) : 0;
  const urgent = running && ms !== null && ms <= 10_000;
  const sideTone = next?.side === "red" ? "bg-red" : "bg-blue";

  return (
    <div className={cn("flex flex-col items-center", className)} aria-live="off">
      {ms !== null ? (
        <span
          className={cn(
            "font-display text-3xl leading-none font-bold tabular-nums sm:text-4xl",
            paused ? "text-muted" : urgent ? "animate-pulse text-bad" : "text-text",
          )}
          title={paused ? "Timer paused" : "Time left for this turn"}
        >
          {formatClock(ms)}
        </span>
      ) : (
        <span className="font-display text-2xl leading-none font-bold text-faint sm:text-3xl" title={timer.enabled ? "Timer idle" : "No turn timer"}>
          {timer.enabled ? "--" : "∞"}
        </span>
      )}
      {timer.enabled && next && state.status !== "lobby" && (
        <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-panel-3 sm:w-32">
          <span className={cn("block h-full rounded-full transition-[width] duration-200 ease-linear", sideTone)} style={{ width: `${frac * 100}%` }} />
        </span>
      )}
    </div>
  );
}

function TeamPlate({ side, name, gameLabel, wins, bestOf, align }: { side: Side; name: string; gameLabel: string; wins: number; bestOf: number; align: "left" | "right" }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 sm:gap-3", align === "right" && "flex-row-reverse text-right")}>
      <span className={cn("h-9 w-1.5 shrink-0 rounded-full sm:h-10", side === "blue" ? "bg-blue" : "bg-red")} aria-hidden />
      <div className="min-w-0">
        <div className={cn("text-[10px] font-semibold tracking-[0.2em] uppercase", side === "blue" ? "text-blue" : "text-red")}>{gameLabel}</div>
        <div className="truncate font-display text-base leading-tight font-bold sm:text-xl" title={name}>
          {name}
        </div>
      </div>
      {bestOf > 1 && (
        <span className="shrink-0 rounded-md border border-line-strong bg-panel-2 px-2 py-0.5 font-display text-lg font-bold tabular-nums" title="Games won">
          {wins}
        </span>
      )}
    </div>
  );
}

const STATUS_UI: Record<ConnStatus, { label: string; dot: string }> = {
  open: { label: "Live", dot: "bg-good" },
  connecting: { label: "Connecting", dot: "bg-warn animate-pulse" },
  reconnecting: { label: "Reconnecting", dot: "bg-warn animate-pulse" },
  closed: { label: "Offline", dot: "bg-bad" },
};

export function RoomHeader({
  state,
  view,
  you,
  status,
  serverNow,
  onShare,
  onSwitchToHost,
}: {
  state: RoomState;
  view: DraftView;
  you: RoomRole | null;
  status: ConnStatus;
  serverNow: () => number;
  onShare: () => void;
  /** Set when this browser holds the host key but this visit uses another one (e.g. a captain link). */
  onSwitchToHost?: () => void;
}) {
  const game = GAMES[state.config.game];
  const teamOn = (side: Side) => state.config.teams[state.sides[side]];
  const slotOn = (side: Side): TeamSlot => state.sides[side];
  const bestOf = state.config.bestOf;
  const statusUi = STATUS_UI[status];
  const phaseText = state.status === "paused" ? "Paused" : view.phase;
  const turnText =
    view.next && (state.status === "drafting" || state.status === "paused")
      ? `${game.sideLabels[view.next.side]} ${view.next.type}`
      : null;
  const roleTone =
    you?.kind === "host"
      ? "border-accent/50 bg-accent/15 text-accent"
      : you?.kind === "captain"
        ? view.yourSide === "red"
          ? "border-red/50 bg-red/15 text-red"
          : "border-blue/50 bg-blue/15 text-blue"
        : "border-line-strong bg-panel-3 text-muted";
  const spectators = state.presence.spectators;

  return (
    <header className="relative z-20 border-b border-line bg-panel/90 backdrop-blur">
      {/* utility row */}
      <div className="flex h-9 items-center gap-2 border-b border-line/60 px-3 text-xs sm:px-4">
        <Link to="/" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted hover:bg-panel-2 hover:text-text" title="Back to home">
          <IconBack className="size-4" />
          <span className="font-display font-bold tracking-wide text-text">
            drafts
          </span>
        </Link>
        <span className="hidden truncate text-faint sm:inline">
          {game.short} · {view.format.name} · {state.config.mode === "host" ? "single host" : "two captains"}
          {bestOf > 1 && ` · Game ${state.gameNumber} of Bo${bestOf}`}
          {state.config.fearless !== "off" && ` · Fearless (${state.config.fearless})`}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-muted" title={`Connection: ${statusUi.label}`}>
          <span className={cn("size-2 rounded-full", statusUi.dot)} />
          <span className="hidden sm:inline">{statusUi.label}</span>
        </span>
        <span className="hidden items-center gap-1 text-muted sm:flex" title={`${spectators} spectator${spectators === 1 ? "" : "s"} watching`}>
          <IconEye className="size-3.5" />
          {spectators}
        </span>
        <span className={cn("rounded-md border px-1.5 py-0.5 font-semibold whitespace-nowrap", roleTone)} title="Your role in this room">
          {roleName(you)}
        </span>
        {onSwitchToHost && (
          <button
            onClick={onSwitchToHost}
            className="rounded-md px-1.5 py-1 font-semibold whitespace-nowrap text-accent hover:bg-panel-2"
            title="This browser also has the host link for this room — reconnect as host"
          >
            Switch to host
          </button>
        )}
        <button onClick={onShare} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-text" title="Share links">
          <IconShare className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </button>
      </div>
      {/* broadcast row */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 sm:gap-4 sm:px-4">
        <TeamPlate side="blue" name={teamOn("blue").name} gameLabel={game.sideLabels.blue} wins={view.wins[slotOn("blue")]} bestOf={bestOf} align="left" />
        <div className="flex min-w-[6.5rem] flex-col items-center gap-1 sm:min-w-[12rem]">
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[10px] font-semibold tracking-[0.16em] text-muted uppercase sm:text-[11px]">
            {bestOf > 1 && <span className="text-faint sm:hidden">G{state.gameNumber}</span>}
            <span className={cn(state.status === "paused" && "text-warn")}>{phaseText}</span>
            {turnText && (
              <span className={cn("font-bold", view.next!.side === "blue" ? "text-blue" : "text-red")}>
                <span className="text-faint">· </span>
                {turnText}
              </span>
            )}
          </div>
          <Countdown state={state} next={view.next} serverNow={serverNow} />
        </div>
        <TeamPlate side="red" name={teamOn("red").name} gameLabel={game.sideLabels.red} wins={view.wins[slotOn("red")]} bestOf={bestOf} align="right" />
      </div>
    </header>
  );
}

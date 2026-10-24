// Draft board pieces: pick columns, ban rows and the series history strip.
import type { RoleSlot } from "../../shared/engine/types";
import { GAMES } from "../../shared/games";
import type { GameRecord, RoomState } from "../../shared/room";
import type { Champion, GameId, Side, TeamSlot } from "../../shared/types";
import { cn } from "../ui";
import { IconBan, IconCrown } from "./icons";
import { Portrait } from "./Portrait";
import type { BoardCell, DraftView } from "./view";

/** Lock-in animations only play for actions this recent (not on page load). */
const FRESH_MS = 2500;

type Lookup = (id: string | null | undefined) => Champion | undefined;

function shortRole(game: GameId, role: string | null | undefined): string | null {
  if (!role) return null;
  return GAMES[game].roles.find((r) => r.id === role)?.short ?? role;
}

function PickSlot({
  game,
  side,
  cell,
  ordinal,
  champ,
  roleSlot,
  hoverChamp,
  hoverId,
  active,
  fresh,
}: {
  game: GameId;
  side: Side;
  cell: BoardCell;
  ordinal: number;
  champ: Champion | undefined;
  roleSlot: RoleSlot | undefined;
  hoverChamp: Champion | undefined;
  hoverId: string | null;
  active: boolean;
  fresh: boolean;
}) {
  const id = cell.action?.championId ?? null;
  const shown = champ ?? hoverChamp;
  const isHover = !id && !!hoverId;
  const role = shortRole(game, roleSlot?.role);
  const right = side === "red";
  return (
    <div
      role="group"
      className={cn(
        "relative flex min-h-12 flex-1 overflow-hidden rounded-lg border bg-panel transition-colors lg:min-h-16",
        active ? "animate-pulse-ring border-accent" : id ? (right ? "border-red/40" : "border-blue/40") : "border-line",
      )}
      aria-label={`${GAMES[game].sideLabels[side]} pick ${ordinal}${id ? `: ${champ?.name ?? id}` : active ? " (picking now)" : ""}`}
    >
      {/* splash-like backdrop */}
      {shown && (
        <img
          key={shown.image}
          src={shown.image}
          alt=""
          aria-hidden
          draggable={false}
          className={cn("pointer-events-none absolute inset-0 size-full scale-125 object-cover blur-[2px]", isHover ? "opacity-10" : "opacity-25")}
        />
      )}
      <div
        className={cn(
          "absolute inset-0",
          right ? "bg-linear-to-l from-red/25 via-transparent to-transparent" : "bg-linear-to-r from-blue/25 via-transparent to-transparent",
        )}
        aria-hidden
      />
      <span className={cn("absolute inset-y-0 w-1", right ? "right-0 bg-red" : "left-0 bg-blue", !id && "opacity-40")} aria-hidden />
      {fresh && <span className={cn("dl-flash absolute inset-0", right ? "bg-red" : "bg-blue")} aria-hidden />}

      <div key={id ?? "empty"} className={cn("relative flex w-full items-center gap-2 px-2.5 py-1.5 lg:gap-3 lg:px-3", right && "flex-row-reverse text-right", fresh && "dl-lockin")}>
        {shown ? (
          <Portrait champ={shown} fallbackId={id ?? hoverId} className={cn("size-10 lg:size-12 xl:size-14 2xl:size-16", isHover && "opacity-50")} />
        ) : id ? (
          <Portrait champ={null} fallbackId={id} className="size-10 lg:size-12 xl:size-14 2xl:size-16" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-faint lg:size-12 xl:size-14 2xl:size-16">
            {ordinal}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold tracking-wider text-muted uppercase">
            {id ? [role, roleSlot?.playerName].filter(Boolean).join(" · ") || `Pick ${ordinal}` : active ? (isHover ? "Hovering" : "Picking…") : `Pick ${ordinal}`}
          </div>
          <div className={cn("truncate font-display text-sm font-semibold lg:text-base 2xl:text-lg", isHover ? "text-muted italic" : "text-text")}>
            {id ? (champ?.name ?? id) : isHover ? (hoverChamp?.name ?? hoverId) : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PickColumn({
  state,
  view,
  side,
  lookup,
  roles,
  serverNow,
  className,
}: {
  state: RoomState;
  view: DraftView;
  side: Side;
  lookup: Lookup;
  roles: RoleSlot[] | undefined;
  serverNow: () => number;
  className?: string;
}) {
  const game = state.config.game;
  const team = state.config.teams[state.sides[side]];
  const now = serverNow();
  const hoverId = state.hovers[side];
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col gap-1.5 lg:gap-2", className)}>
      <div className={cn("flex items-center gap-2 px-0.5 lg:hidden", side === "red" && "flex-row-reverse text-right")}>
        <span className={cn("size-2 shrink-0 rounded-full", side === "blue" ? "bg-blue" : "bg-red")} />
        <span className="truncate text-xs font-semibold">{team.name}</span>
      </div>
      {view.picks[side].map((cell, i) => {
        const id = cell.action?.championId ?? null;
        const active = !!view.next && view.next.index === cell.stepIndex && state.status !== "lobby" && !view.complete;
        return (
          <PickSlot
            key={cell.stepIndex}
            game={game}
            side={side}
            cell={cell}
            ordinal={i + 1}
            champ={lookup(id)}
            roleSlot={id ? roles?.find((r) => r.championId === id) : undefined}
            hoverChamp={active ? lookup(hoverId) : undefined}
            hoverId={active ? hoverId : null}
            active={active}
            fresh={!!cell.action && !!id && now - cell.action.at < FRESH_MS}
          />
        );
      })}
    </div>
  );
}

function BanSlot({ cell, lookup, active, hoverId, fresh, sideLabel, ordinal }: { cell: BoardCell; lookup: Lookup; active: boolean; hoverId: string | null; fresh: boolean; sideLabel: string; ordinal: number }) {
  const id = cell.action?.championId ?? null;
  const skipped = !!cell.action && id === null;
  const champ = lookup(id);
  const hover = active && hoverId ? lookup(hoverId) : undefined;
  const size = "size-8 sm:size-9 xl:size-10 2xl:size-11";
  const label = `${sideLabel} ban ${ordinal}${id ? `: ${champ?.name ?? id}` : skipped ? ": no ban" : ""}`;
  return (
    <span className={cn("relative rounded-md", active && "animate-pulse-ring ring-2 ring-accent")} title={label} aria-label={label}>
      {id ? (
        <span key={id} className={cn("block", fresh && "dl-lockin")}>
          <Portrait champ={champ} fallbackId={id} banned className={size} />
        </span>
      ) : skipped ? (
        <span className={cn("flex items-center justify-center rounded-md border border-line bg-panel-2 text-faint", size)}>
          <IconBan className="size-4" />
        </span>
      ) : hover ? (
        <Portrait champ={hover} fallbackId={hoverId} className={cn("opacity-50", size)} />
      ) : (
        <span className={cn("block rounded-md border border-dashed border-line-strong bg-panel/60", size)} />
      )}
    </span>
  );
}

export function BanRow({ state, view, side, lookup, serverNow, className }: { state: RoomState; view: DraftView; side: Side; lookup: Lookup; serverNow: () => number; className?: string }) {
  const cells = view.bans[side];
  const now = serverNow();
  const sideLabel = GAMES[state.config.game].sideLabels[side];
  const hoverId = state.hovers[side];
  // Group by phase so ban phases read as separate clusters.
  const groups: { phase: number; cells: { cell: BoardCell; ordinal: number }[] }[] = [];
  cells.forEach((cell, i) => {
    const last = groups[groups.length - 1];
    if (last && last.phase === cell.phase) last.cells.push({ cell, ordinal: i + 1 });
    else groups.push({ phase: cell.phase, cells: [{ cell, ordinal: i + 1 }] });
  });
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5", side === "red" && "flex-row-reverse", className)}>
      {groups.map((g) => (
        <div key={g.phase} className={cn("flex gap-1", side === "red" && "flex-row-reverse")}>
          {g.cells.map(({ cell, ordinal }) => {
            const active = !!view.next && view.next.index === cell.stepIndex && state.status !== "lobby" && !view.complete;
            return (
              <BanSlot
                key={cell.stepIndex}
                cell={cell}
                lookup={lookup}
                active={active}
                hoverId={hoverId}
                fresh={!!cell.action?.championId && now - cell.action.at < FRESH_MS}
                sideLabel={sideLabel}
                ordinal={ordinal}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function BansBar({ state, view, lookup, serverNow }: { state: RoomState; view: DraftView; lookup: Lookup; serverNow: () => number }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line bg-panel/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-8 shrink-0 text-[10px] font-semibold tracking-widest text-blue uppercase">Bans</span>
        <BanRow state={state} view={view} side="blue" lookup={lookup} serverNow={serverNow} />
      </div>
      <div className="flex min-w-0 flex-row-reverse items-center gap-2 sm:flex-row">
        <BanRow state={state} view={view} side="red" lookup={lookup} serverNow={serverNow} />
        <span className="w-8 shrink-0 text-right text-[10px] font-semibold tracking-widest text-red uppercase sm:text-left">Bans</span>
      </div>
    </div>
  );
}

function GamePicks({ game, slot, lookup }: { game: GameRecord; slot: TeamSlot; lookup: Lookup }) {
  const side: Side = game.sides.blue === slot ? "blue" : "red";
  const ids = game.actions.filter((a) => a.type === "pick" && a.slot === slot && a.championId).map((a) => a.championId!);
  return (
    <span className={cn("flex gap-0.5 rounded-md border-b-2 pb-0.5", side === "blue" ? "border-blue" : "border-red")}>
      {ids.map((id) => {
        const c = lookup(id);
        return (
          <span key={id} title={`${c?.name ?? id} (game ${game.number})`}>
            <Portrait champ={c} fallbackId={id} className="size-6 sm:size-7" rounded="rounded" />
          </span>
        );
      })}
      {ids.length === 0 && <span className="px-1 text-[10px] text-faint">no picks</span>}
    </span>
  );
}

export function SeriesStrip({
  state,
  view,
  lookup,
  open,
  onToggle,
  onSetResult,
}: {
  state: RoomState;
  view: DraftView;
  lookup: Lookup;
  open: boolean;
  onToggle: () => void;
  /** Host only: correct an earlier game's result (the server refuses one that would have ended the series already). */
  onSetResult?: (game: number, winner: TeamSlot | null) => void;
}) {
  if (view.previousGames.length === 0) return null;
  const teams = state.config.teams;
  const fearless = state.config.fearless;
  return (
    <div className="border-b border-line bg-panel/30 px-3 py-1.5 lg:px-4">
      <button onClick={onToggle} className="flex w-full items-center gap-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-text" aria-expanded={open}>
        <span>Series</span>
        <span className="text-faint normal-case tracking-normal">
          {teams.A.name} {view.wins.A} – {view.wins.B} {teams.B.name}
          {fearless !== "off" && ` · fearless ${fearless}: ${fearless === "hard" ? "earlier picks are locked for everyone" : "teams can't repeat their own picks"}`}
        </span>
        <span className="flex-1" />
        <span className="text-faint">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {view.previousGames.map((g) => (
            <div key={g.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="w-7 font-display font-bold text-muted">G{g.number}</span>
              {(["A", "B"] as const).map((slot) => (
                <span key={slot} className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("max-w-28 truncate", g.winner === slot ? "font-semibold text-text" : "text-muted")}>
                    {g.winner === slot && <IconCrown className="mr-0.5 inline size-3 text-accent" />}
                    {teams[slot].name}
                  </span>
                  <GamePicks game={g} slot={slot} lookup={lookup} />
                </span>
              ))}
              {onSetResult && (
                <select
                  value={g.winner ?? ""}
                  onChange={(e) => onSetResult(g.number, e.target.value === "A" || e.target.value === "B" ? e.target.value : null)}
                  aria-label={`Game ${g.number} result`}
                  title="Correct this game's result"
                  className="ml-auto h-6 max-w-40 rounded border border-line bg-panel-2 px-1 text-[11px] text-muted hover:border-line-strong"
                >
                  {(["A", "B"] as const).map((slot) => (
                    <option key={slot} value={slot}>
                      {teams[slot].name} won
                    </option>
                  ))}
                  <option value="">No result</option>
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

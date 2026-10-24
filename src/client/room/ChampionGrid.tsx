// Champion/hero picker grid: ranked search, role chips, sort, availability states and suggestion highlights.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Suggestion } from "../../shared/engine/types";
import { GAMES } from "../../shared/games";
import type { RoomState } from "../../shared/room";
import type { ActionType, Champion, Side } from "../../shared/types";
import { indexChampions, searchChampions } from "../lib/champSearch";
import type { GameData } from "../lib/gameData";
import { cn } from "../ui";
import { IconLock, IconSearch } from "./icons";
import { Portrait } from "./Portrait";
import { isSelectable, type DraftView } from "./view";

export type GridSort = "name" | "suggested";

interface ChampStatus {
  unavailable: boolean;
  pickedSide?: Side;
  banned: boolean;
  fearless: boolean;
  reason: string | null;
}

export function ChampionGrid({
  data,
  state,
  view,
  gridSide,
  stepType,
  selected,
  onSelect,
  onLock,
  suggestions,
  suggestionLabel,
  searchRef,
  selectable,
  stepIndex,
}: {
  data: GameData;
  state: RoomState;
  view: DraftView;
  /** Availability is judged for this side (the side acting now, or the viewer's side). */
  gridSide: Side;
  /** Type of the current step: fearless locks only block picks. */
  stepType: ActionType;
  selected: string | null;
  onSelect: (id: string) => void;
  onLock: () => void;
  suggestions: Suggestion[];
  suggestionLabel: string;
  searchRef: RefObject<HTMLInputElement | null>;
  /** When false, clicking still highlights locally but the UI explains you can't act. */
  selectable: boolean;
  /** Index of the current step (-1 when none): the search clears after a step this viewer could act on. */
  stepIndex: number;
}) {
  const game = GAMES[state.config.game];
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [sort, setSort] = useState<GridSort>("name");

  // After a step this viewer could act on is locked, start the next one with a clean search (typing "am" + Enter twice
  // for one ban must not leave "am" in front of the next name). Text typed while waiting for the enemy is kept.
  const prevStep = useRef({ step: stepIndex, game: state.gameNumber, canAct: selectable });
  useEffect(() => {
    const p = prevStep.current;
    if ((p.step !== stepIndex || p.game !== state.gameNumber) && p.canAct) {
      setQuery("");
      setRole(null);
    }
    prevStep.current = { step: stepIndex, game: state.gameNumber, canAct: selectable };
  }, [stepIndex, state.gameNumber, selectable]);

  const scoreOf = useMemo(() => {
    const m = new Map<string, { score: number; rank: number }>();
    suggestions.forEach((s, i) => m.set(s.championId, { score: s.score, rank: i }));
    return m;
  }, [suggestions]);

  const lockedSet = useMemo(() => new Set(view.locked[gridSide]), [view.locked, gridSide]);
  const teams = state.config.teams;
  const gridSlot = state.sides[gridSide];

  const statusOf = (c: Champion): ChampStatus => {
    const pickedSide = view.pickedBy.get(c.id);
    const banned = view.banned.has(c.id);
    const fearless = !pickedSide && !banned && lockedSet.has(c.id);
    let reason: string | null = null;
    if (pickedSide) reason = `Picked by ${teams[state.sides[pickedSide]].name}`;
    else if (banned) reason = "Banned";
    else if (fearless) {
      const origins = view.fearlessOrigins.get(c.id) ?? [];
      const o = (state.config.fearless === "soft" ? origins.find((x) => x.slot === gridSlot) : undefined) ?? origins[origins.length - 1];
      reason = o ? `Picked in game ${o.game} by ${teams[o.slot].name} (fearless)` : "Locked by fearless rules";
      if (stepType === "ban") reason += ", but can still be banned";
    }
    const blocked = !isSelectable(view, gridSide, stepType, c.id);
    if (blocked && !reason) reason = "Unavailable";
    return { unavailable: blocked, pickedSide, banned, fearless, reason };
  };

  const index = useMemo(() => indexChampions(data.champions, state.config.game), [data.champions, state.config.game]);
  // Best search match first (so Enter hovers what was meant); the chosen sort orders champions within a match tier.
  const list = useMemo(() => {
    const scoreFor = (c: Champion) => scoreOf.get(c.id)?.score ?? Number.NEGATIVE_INFINITY;
    const bySuggested = (a: Champion, b: Champion) => {
      const sa = scoreFor(a);
      const sb = scoreFor(b);
      return sa === sb ? 0 : sb > sa ? 1 : -1;
    };
    return searchChampions(index, query, role ?? "all", sort === "suggested" ? bySuggested : undefined);
  }, [index, query, role, sort, scoreOf]);

  const firstAvailable = () => list.find((c) => !statusOf(c).unavailable);
  const topPicks: { champ: Champion; score: number }[] = [];
  for (const s of suggestions) {
    if (topPicks.length >= 3) break;
    const champ = data.byId.get(s.championId);
    if (champ && isSelectable(view, gridSide, stepType, champ.id)) topPicks.push({ champ, score: s.score });
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = firstAvailable();
      if (!first) return;
      if (selected === first.id) onLock();
      else onSelect(first.id);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else e.currentTarget.blur();
    }
  };

  const onItemKey = (e: KeyboardEvent<HTMLButtonElement>, id: string, blocked: boolean) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (blocked) return;
    if (selected === id) onLock();
    else onSelect(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-2 sm:px-3">
        <label className="relative min-w-0 flex-1 basis-40">
          <span className="sr-only">Search {game.unitPlural.toLowerCase()}</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={`Search ${game.unitPlural.toLowerCase()}`}
            className="h-9 w-full rounded-lg border border-line bg-panel-2 pr-8 pl-8 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
            aria-keyshortcuts="/"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line-strong px-1 text-[10px] text-faint sm:block">/</kbd>
        </label>
        <div className="flex rounded-lg bg-panel-2 p-0.5 text-xs" role="group" aria-label="Sort">
          {(["name", "suggested"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              disabled={s === "suggested" && suggestions.length === 0}
              className={cn("rounded-md px-2.5 py-1.5 font-medium capitalize disabled:opacity-40", sort === s ? "bg-panel-3 text-text" : "text-muted hover:text-text")}
            >
              {s === "name" ? "A–Z" : "Suggested"}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-1" role="group" aria-label="Filter by role">
          <RoleChip active={role === null} onClick={() => setRole(null)}>
            All
          </RoleChip>
          {game.roles.map((r) => (
            <RoleChip key={r.id} active={role === r.id} onClick={() => setRole(role === r.id ? null : r.id)} title={r.label}>
              {r.short}
            </RoleChip>
          ))}
          {suggestions.length > 0 && (
            <span className="ml-auto hidden items-center gap-1 self-center text-[11px] text-faint md:flex">
              <span className="size-2.5 rounded-sm ring-2 ring-accent" /> {suggestionLabel}
            </span>
          )}
        </div>
      </div>

      {/* Phones: the analysis panel sits below the grid, so surface the top suggestions right here. */}
      {selectable && topPicks.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5 lg:hidden" role="group" aria-label={suggestionLabel}>
          <span className="shrink-0 text-[10px] font-semibold tracking-wider text-muted uppercase">Top</span>
          {topPicks.map(({ champ, score }) => (
            <button
              key={champ.id}
              type="button"
              onClick={() => onSelect(champ.id)}
              aria-pressed={selected === champ.id}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border p-1 text-left",
                selected === champ.id ? "border-text bg-panel-3" : "border-accent/40 bg-panel-2",
              )}
            >
              <Portrait champ={champ} className="size-7" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{champ.name}</span>
              <span className="shrink-0 text-[10px] font-bold text-accent tabular-nums">{Math.round(score)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3">
        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No {game.unitPlural.toLowerCase()} match “{query}”.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-x-1.5 gap-y-2 sm:grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] 2xl:grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))]">
            {list.map((c) => {
              const st = statusOf(c);
              const sug = scoreOf.get(c.id);
              const highlighted = !st.unavailable && sug !== undefined && sug.rank < 10;
              const isSel = selected === c.id;
              const hoveredBy = (["blue", "red"] as const).find((s) => state.hovers[s] === c.id);
              const title = [c.name, st.reason, highlighted ? `Suggested #${sug!.rank + 1} (score ${Math.round(sug!.score)})` : null].filter(Boolean).join(" · ");
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-champ={c.id}
                    title={title}
                    aria-label={title}
                    aria-disabled={st.unavailable || undefined}
                    aria-pressed={isSel}
                    onClick={() => !st.unavailable && onSelect(c.id)}
                    onKeyDown={(e) => onItemKey(e, c.id, st.unavailable)}
                    className={cn(
                      "group flex w-full flex-col items-center gap-1 rounded-lg p-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-text",
                      st.unavailable ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    <span
                      className={cn(
                        "relative block aspect-square w-full rounded-md transition-transform",
                        !st.unavailable && "group-hover:-translate-y-0.5",
                        isSel
                          ? "ring-2 ring-text ring-offset-2 ring-offset-bg"
                          : hoveredBy
                            ? hoveredBy === "blue"
                              ? "ring-2 ring-blue"
                              : "ring-2 ring-red"
                            : highlighted
                              ? "ring-2 ring-accent/80"
                              : "",
                      )}
                    >
                      <Portrait champ={c} className="size-full" dim={st.unavailable && !st.banned && !st.fearless} banned={st.banned} locked={st.fearless && st.unavailable} />
                      {st.pickedSide && (
                        <span className={cn("absolute inset-x-0 bottom-0 rounded-b-md py-px text-[9px] font-bold tracking-wider text-white uppercase", st.pickedSide === "blue" ? "bg-blue/85" : "bg-red/85")}>
                          Picked
                        </span>
                      )}
                      {st.fearless && (
                        <span className="absolute top-0.5 right-0.5 rounded bg-bg/80 p-0.5 text-warn">
                          <IconLock className="size-3" />
                        </span>
                      )}
                      {highlighted && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-accent px-1 text-[10px] leading-4 font-bold text-bg tabular-nums shadow">
                          {Math.round(sug!.score)}
                        </span>
                      )}
                    </span>
                    <span className={cn("w-full truncate text-[11px] leading-tight", st.unavailable ? "text-faint" : isSel ? "font-semibold text-text" : "text-muted group-hover:text-text")}>
                      {c.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!selectable && <p className="mt-3 text-center text-xs text-muted">You can browse, but you can't lock in this turn.</p>}
      </div>
    </div>
  );
}

function RoleChip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] font-semibold tracking-wider uppercase transition-colors",
        active ? "border-accent/60 bg-accent/15 text-accent" : "border-line bg-panel-2 text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

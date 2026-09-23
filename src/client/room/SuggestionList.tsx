// Ranked suggestion list with score bars and signed, expandable reasons.
import { useState } from "react";
import type { Reason, Suggestion } from "../../shared/engine/types";
import { GAMES } from "../../shared/games";
import type { Champion, GameId, Side } from "../../shared/types";
import { cn } from "../ui";
import { IconChevron } from "./icons";
import { Portrait } from "./Portrait";

type Lookup = (id: string | null | undefined) => Champion | undefined;

const fmtDelta = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d) >= 10 ? Math.abs(d).toFixed(0) : Math.abs(d).toFixed(1)}`;

function ReasonRow({ r }: { r: Reason }) {
  const positive = r.delta >= 0;
  return (
    <li className="flex items-start gap-1.5 text-[11px] leading-snug">
      <span className={cn("w-9 shrink-0 text-right font-semibold tabular-nums", positive ? "text-good" : "text-bad")}>{fmtDelta(r.delta)}</span>
      <span className="min-w-0 text-muted">{r.text}</span>
    </li>
  );
}

function SuggestionItem({
  s,
  rank,
  frac,
  game,
  side,
  lookup,
  onSelect,
  disabled,
}: {
  s: Suggestion;
  rank: number;
  /** Bar fill 0..1 relative to the list. */
  frac: number;
  game: GameId;
  side: Side;
  lookup: Lookup;
  onSelect?: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const c = lookup(s.championId);
  const reasons = [...s.reasons].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const shown = open ? reasons : reasons.slice(0, 3);
  const role = s.role ? (GAMES[game].roles.find((r) => r.id === s.role)?.short ?? s.role) : null;
  const fill = Math.min(1, Math.max(0.04, Number.isFinite(frac) ? frac : 0));
  return (
    <li className="rounded-lg border border-line bg-panel-2/60 p-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSelect?.(s.championId)}
          disabled={!onSelect || disabled}
          className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none enabled:hover:ring-2 enabled:hover:ring-accent/60"
          title={onSelect && !disabled ? `Select ${c?.name ?? s.championId}` : (c?.name ?? s.championId)}
        >
          <Portrait champ={c} fallbackId={s.championId} className="size-10" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-faint tabular-nums">{rank}</span>
            <span className="truncate text-sm font-semibold">{c?.name ?? s.championId}</span>
            {role && <span className="shrink-0 rounded bg-panel-3 px-1 text-[10px] font-semibold text-muted">{role}</span>}
            {s.playerName && <span className="min-w-0 truncate text-[11px] text-accent">{s.playerName}</span>}
            <span className="ml-auto shrink-0 font-display text-sm font-bold tabular-nums">{Math.round(s.score)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3">
            <div className={cn("h-full rounded-full", side === "blue" ? "bg-blue" : "bg-red")} style={{ width: `${fill * 100}%` }} />
          </div>
        </div>
      </div>
      {shown.length > 0 && <ul className="mt-1.5 space-y-0.5">{shown.map((r, i) => <ReasonRow key={`${r.kind}-${i}`} r={r} />)}</ul>}
      {reasons.length > 3 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-0.5 text-[11px] text-faint hover:text-text" aria-expanded={open}>
          <IconChevron className={cn("size-3 transition-transform", open && "rotate-180")} />
          {open ? "Fewer reasons" : `All ${reasons.length} reasons`}
        </button>
      )}
    </li>
  );
}

export function SuggestionList({
  items,
  game,
  side,
  lookup,
  onSelect,
  isAvailable,
  empty,
  limit = 12,
}: {
  items: Suggestion[];
  game: GameId;
  side: Side;
  lookup: Lookup;
  onSelect?: (id: string) => void;
  isAvailable?: (id: string) => boolean;
  empty: string;
  limit?: number;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const list = items.slice(0, limit);
  // Scores cluster tightly, so bars span the list's range (with headroom below the lowest) rather than 0..max.
  const scores = list.map((s) => (Number.isFinite(s.score) ? s.score : 0));
  const hi = Math.max(...scores);
  const lo = Math.min(...scores) - Math.max(1, (hi - Math.min(...scores)) * 0.5);
  return (
    <ol className="space-y-1.5">
      {list.map((s, i) => (
        <SuggestionItem
          key={s.championId}
          s={s}
          rank={i + 1}
          frac={hi > lo ? (scores[i] - lo) / (hi - lo) : 1}
          game={game}
          side={side}
          lookup={lookup}
          onSelect={onSelect}
          disabled={isAvailable ? !isAvailable(s.championId) : false}
        />
      ))}
    </ol>
  );
}

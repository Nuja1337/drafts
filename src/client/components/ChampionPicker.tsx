// Champion/hero picker: ranked search (name, id, initials and shorthand like "mf"/"am"/"j4"), role filter, portrait grid.
// Used inline, in a modal (multi-select pools / hate lists) and as a single-value select button (matchup overrides).
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { GAMES } from "../../shared/games";
import type { GameId, Role } from "../../shared/types";
import { indexChampions, searchChampions } from "../lib/champSearch";
import type { GameData } from "../lib/gameData";
import { Button, ChampIcon, cn, ErrorNote, Input, Modal } from "../ui";
import { LoadingBlock } from "./common";
import { RoleIcon } from "./RoleIcon";

export interface ChampionPickerProps {
  game: GameId;
  data: GameData | null;
  error?: Error | null;
  /** Shown with a check mark (click toggles via onPick). */
  selected?: ReadonlySet<string>;
  /** Shown greyed out and not clickable. */
  disabled?: ReadonlySet<string>;
  /** Tooltip suffix for disabled champions. */
  disabledReason?: string;
  onPick: (id: string) => void;
  autoFocus?: boolean;
  className?: string;
  /** Max height of the scrolling grid. */
  gridClassName?: string;
}

export function ChampionPicker({
  game,
  data,
  error,
  selected,
  disabled,
  disabledReason,
  onPick,
  autoFocus,
  className,
  gridClassName,
}: ChampionPickerProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const deferredQuery = useDeferredValue(query);
  const index = useMemo(() => (data ? indexChampions(data.champions, game) : []), [data, game]);
  const results = useMemo(() => searchChampions(index, deferredQuery, role), [index, deferredQuery, role]);
  const unit = GAMES[game].unitPlural.toLowerCase();

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingBlock label={`Loading ${unit}…`} className="py-10" />;

  const pickFirst = () => {
    const first = results.find((c) => !disabled?.has(c.id));
    if (first) onPick(first.id);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Input
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder={`Search ${unit}…`}
        aria-label={`Search ${unit}`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            pickFirst();
          }
        }}
      />
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter by role">
        <RoleFilterButton active={role === "all"} onClick={() => setRole("all")}>
          All
        </RoleFilterButton>
        {GAMES[game].roles.map((r) => (
          <RoleFilterButton key={r.id} active={role === r.id} onClick={() => setRole(r.id)} title={r.label}>
            <RoleIcon game={game} role={r.id} className="size-3.5" />
            {r.short}
          </RoleFilterButton>
        ))}
      </div>
      <div className={cn("overflow-y-auto rounded-lg border border-line bg-panel-2/50 p-2", gridClassName ?? "max-h-[50vh]")}>
        {results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No {unit} match “{query}”.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5">
            {results.map((c) => {
              const isSel = selected?.has(c.id) ?? false;
              const isDis = disabled?.has(c.id) ?? false;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={isDis}
                    aria-pressed={selected ? isSel : undefined}
                    title={isDis && disabledReason ? `${c.name} — ${disabledReason}` : c.name}
                    onClick={() => onPick(c.id)}
                    className={cn(
                      "group flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center transition-colors",
                      isSel ? "bg-accent/15 ring-1 ring-accent/70" : "hover:bg-panel-3",
                      isDis && "cursor-not-allowed opacity-35",
                    )}
                  >
                    <span className="relative">
                      <ChampIcon champ={c} size={44} title="" />
                      {isSel && (
                        <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-bg">
                          ✓
                        </span>
                      )}
                    </span>
                    <span className={cn("w-full truncate text-[11px] leading-tight", isSel ? "text-accent" : "text-muted group-hover:text-text")}>{c.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RoleFilterButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors",
        active ? "border-accent/60 bg-accent/15 text-accent" : "border-line bg-panel-2 text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/** Picker in a modal. With `multi`, clicks toggle and the modal stays open until Done. */
export function ChampionPickerModal({
  open,
  onClose,
  title,
  multi,
  footer,
  ...picker
}: ChampionPickerProps & { open: boolean; onClose: () => void; title: ReactNode; multi?: boolean; footer?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <ChampionPicker
        {...picker}
        autoFocus
        gridClassName="max-h-[55vh]"
        onPick={(id) => {
          picker.onPick(id);
          if (!multi) onClose();
        }}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-faint">{footer}</div>
        <Button variant={multi ? "primary" : "ghost"} onClick={onClose}>
          {multi ? "Done" : "Cancel"}
        </Button>
      </div>
    </Modal>
  );
}

/** Button showing one chosen champion; opens a picker to change it. */
export function ChampionSelect({
  game,
  data,
  value,
  onChange,
  placeholder = "Choose…",
  disabled,
  exclude,
  label,
}: {
  game: GameId;
  data: GameData | null;
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  exclude?: ReadonlySet<string>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const champ = value ? data?.byId.get(value) : undefined;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={label ? `${label}: ${champ?.name ?? value ?? "none"}` : undefined}
        className={cn(
          "flex h-10 min-w-0 items-center gap-2 rounded-lg border border-line bg-panel-2 pr-3 pl-1 text-left text-sm transition-colors",
          disabled ? "cursor-default" : "hover:border-line-strong",
          !value && "border-dashed pl-3 text-faint",
        )}
      >
        {value && <ChampIcon champ={champ} size={32} />}
        <span className="truncate">{value ? (champ?.name ?? value) : placeholder}</span>
      </button>
      {!disabled && (
        <ChampionPickerModal
          open={open}
          onClose={() => setOpen(false)}
          title={label ?? `Choose a ${GAMES[game].unit.toLowerCase()}`}
          game={game}
          data={data}
          disabled={exclude}
          selected={value ? new Set([value]) : undefined}
          onPick={onChange}
        />
      )}
    </>
  );
}

// Champion/hero data browser: search + role/archetype/curated filters, grid or table view, detail modal (?c=<id>).
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ARCHETYPE_DEFS, GAMES } from "../../shared/games";
import { GAME_IDS, type Archetype, type Champion, type GameId, type Role, type Tier } from "../../shared/types";
import { TIER_RANK, TierBadge } from "../components/badges";
import { ChampionDetail } from "../components/ChampionDetail";
import { LoadingBlock, PageHeader } from "../components/common";
import { fullDate, pct, searchKey, timeAgo } from "../components/format";
import { useTitle } from "../components/useTitle";
import { RoleIcon } from "../components/RoleIcon";
import { indexChampions, matchRank } from "../lib/champSearch";
import { hasWinRates, useGameData } from "../lib/gameData";
import { Badge, Button, ChampIcon, cn, EmptyState, ErrorNote, Input, Modal, Select, Toggle } from "../ui";

type SortKey = "name" | "tier" | "winrate";
type View = "grid" | "table";

const bestTier = (c: Champion): Tier | undefined => {
  let best: Tier | undefined;
  for (const m of Object.values(c.meta)) if (m && (!best || TIER_RANK[m.tier] > TIER_RANK[best])) best = m.tier;
  return best;
};
const tierIn = (c: Champion, role: Role | "all") => (role === "all" ? bestTier(c) : c.meta[role]?.tier);
const winRateIn = (c: Champion, role: Role | "all"): number | undefined => {
  if (role !== "all") return c.meta[role]?.winRate;
  let best: number | undefined;
  for (const m of Object.values(c.meta)) if (m?.winRate !== undefined && (best === undefined || m.winRate > best)) best = m.winRate;
  return best;
};

export function DataBrowser() {
  const { game: param } = useParams();
  const game = GAME_IDS.find((g) => g === param);
  useTitle(game ? `${GAMES[game].name} data` : "Data");
  if (!game) {
    return (
      <EmptyState
        title="Unknown game"
        action={
          <div className="flex justify-center gap-2">
            {GAME_IDS.map((g) => (
              <Link key={g} to={`/data/${g}`} className="rounded-lg border border-line-strong bg-panel-3 px-4 py-2 text-sm hover:bg-line-strong">
                {GAMES[g].name}
              </Link>
            ))}
          </div>
        }
      >
        Pick one of the supported games.
      </EmptyState>
    );
  }
  // Keyed so filters reset when switching games (roles differ).
  return <Browser key={game} game={game} />;
}

function Browser({ game }: { game: GameId }) {
  const { data, error, loading } = useGameData(game);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [archetype, setArchetype] = useState<Archetype | "all">("all");
  const [curatedOnly, setCuratedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [view, setView] = useState<View>("grid");
  const deferredQuery = useDeferredValue(query);
  const def = GAMES[game];
  const withWinRates = useMemo(() => !!data && hasWinRates(data.champions), [data]);
  // No win-rate data (LoL): sorting by it would silently fall back to names, so it isn't offered.
  const sortBy: SortKey = sort === "winrate" && !withWinRates ? "tier" : sort;
  const index = useMemo(() => (data ? indexChampions(data.champions, game) : []), [data, game]);

  const results = useMemo(() => {
    if (!data) return [];
    const q = searchKey(deferredQuery);
    // Same ranked matcher as the draft grid (names, ids, initials, shorthand), plus exact tag matches last.
    const rankOf = new Map<string, number>();
    for (const i of index) {
      const c = i.champ;
      if (role !== "all" && !c.roles.includes(role) && !c.meta[role]) continue;
      if ((archetype !== "all" && !c.archetypes.includes(archetype)) || (curatedOnly && !c.curated)) continue;
      const r = matchRank(i, q) ?? (c.tags.some((t) => searchKey(t) === q) ? 99 : null);
      if (r !== null) rankOf.set(c.id, r);
    }
    const list = data.champions.filter((c) => rankOf.has(c.id));
    const tierRank = (c: Champion) => {
      const t = tierIn(c, role);
      return t ? TIER_RANK[t] : 0;
    };
    // Best search match first; the chosen sort orders champions within a match tier.
    const bySort = (a: Champion, b: Champion): number =>
      sortBy === "tier" ? tierRank(b) - tierRank(a) : sortBy === "winrate" ? (winRateIn(b, role) ?? -1) - (winRateIn(a, role) ?? -1) : 0;
    return list.sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)! || bySort(a, b) || a.name.localeCompare(b.name));
  }, [data, index, deferredQuery, role, archetype, curatedOnly, sortBy]);

  const selectedId = params.get("c");
  const selected = selectedId ? data?.byId.get(selectedId) : undefined;
  const open = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("c", id);
        else next.delete("c");
        return next;
      },
      { replace: true },
    );

  const archetypes = ARCHETYPE_DEFS.filter((a) => a.games.includes(game));
  const derivedCount = data ? data.champions.filter((c) => !c.curated).length : 0;

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex gap-1">
            {GAME_IDS.map((g) => (
              <Link
                key={g}
                to={`/data/${g}`}
                className={cn("rounded-md px-2 py-0.5 transition-colors", g === game ? "bg-panel-3 text-text" : "text-faint hover:text-muted")}
              >
                {GAMES[g].short}
              </Link>
            ))}
          </span>
        }
        title={`${def.unitPlural}`}
        subtitle={
          data ? (
            <span>
              {data.champions.length} {def.unitPlural.toLowerCase()} · data {data.version} ·{" "}
              <span title={fullDate(data.generatedAt)}>built {timeAgo(data.generatedAt)}</span>
              {derivedCount > 0 && <span className="text-faint"> · {derivedCount} not yet curated</span>}
            </span>
          ) : (
            `Everything the draft engine knows about each ${def.unit.toLowerCase()}.`
          )
        }
      />

      {error ? (
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      ) : loading || !data ? (
        <LoadingBlock label={`Loading ${def.unitPlural.toLowerCase()}…`} />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-4 space-y-3 rounded-xl border border-line bg-panel p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${def.unitPlural.toLowerCase()} or tags…`}
                aria-label="Search"
                className="md:max-w-xs"
              />
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Role">
                <FilterButton active={role === "all"} onClick={() => setRole("all")}>
                  All roles
                </FilterButton>
                {def.roles.map((r) => (
                  <FilterButton key={r.id} active={role === r.id} onClick={() => setRole(r.id)} title={r.label}>
                    <RoleIcon game={game} role={r.id} className="size-3.5" />
                    {r.short}
                  </FilterButton>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={archetype} onChange={(e) => setArchetype(e.target.value as Archetype | "all")} aria-label="Archetype" className="h-9 w-auto min-w-0">
                <option value="all">Any archetype</option>
                {archetypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
              <Select value={sortBy} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" className="h-9 w-auto min-w-0">
                <option value="name">Sort: Name</option>
                <option value="tier">Sort: Tier{role !== "all" ? ` (${def.roles.find((r) => r.id === role)?.short})` : ""}</option>
                {withWinRates && <option value="winrate">Sort: Win rate</option>}
              </Select>
              <Toggle checked={curatedOnly} onChange={setCuratedOnly} label={<span className="text-muted">Curated only</span>} />
              <div className="ml-auto flex rounded-lg border border-line bg-panel-2 p-0.5" role="radiogroup" aria-label="View">
                {(["grid", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn("rounded-md px-3 py-1 text-xs font-semibold capitalize", view === v ? "bg-panel-3 text-text" : "text-muted hover:text-text")}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-3 text-xs text-faint">
            {results.length === data.champions.length ? `${results.length} ${def.unitPlural.toLowerCase()}` : `${results.length} of ${data.champions.length}`}
          </div>

          {results.length === 0 ? (
            <EmptyState title={`No ${def.unitPlural.toLowerCase()} match`}>Try clearing a filter.</EmptyState>
          ) : view === "grid" ? (
            <ChampionGrid game={game} list={results} role={role} onOpen={open} />
          ) : (
            <ChampionTable game={game} list={results} onOpen={open} showWinRate={withWinRates} />
          )}

          <Modal open={!!selected} onClose={() => open(null)} title={selected ? `${selected.name}` : ""} wide>
            {selected && <ChampionDetail game={game} data={data} champ={selected} onSelect={open} />}
          </Modal>
        </>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors",
        active ? "border-accent/60 bg-accent/15 text-accent" : "border-line bg-panel-2 text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function ChampionGrid({ game, list, role, onOpen }: { game: GameId; list: Champion[]; role: Role | "all"; onOpen: (id: string) => void }) {
  const roles = GAMES[game].roles;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
      {list.map((c) => {
        const shown = role === "all" ? roles.filter((r) => c.roles.includes(r.id) || c.meta[r.id]) : roles.filter((r) => r.id === role);
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex h-full w-full items-center gap-2.5 rounded-xl border border-line bg-panel p-2 text-left transition-colors hover:border-line-strong hover:bg-panel-2"
            >
              <ChampIcon champ={c} size={48} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-sm font-semibold">{c.name}</span>
                  {!c.curated && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Derived (not curated)" />}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {shown.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-0.5" title={`${r.label}: ${c.meta[r.id]?.tier ?? "no"} tier`}>
                      <RoleIcon game={game} role={r.id} className="size-3 text-faint" title={r.label} />
                      <TierBadge tier={c.meta[r.id]?.tier} className="h-4 min-w-4 text-[10px]" />
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ChampionTable({ game, list, onOpen, showWinRate }: { game: GameId; list: Champion[]; onOpen: (id: string) => void; showWinRate: boolean }) {
  const roles = GAMES[game].roles;
  const archetypeLabel = (id: Archetype) => ARCHETYPE_DEFS.find((a) => a.id === id)?.label ?? id;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="bg-panel-2 text-left text-[11px] tracking-wider text-muted uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">{GAMES[game].unit}</th>
            {roles.map((r) => (
              <th key={r.id} className="px-1 py-2 text-center font-semibold" title={r.label}>
                <span className="inline-flex items-center gap-1">
                  <RoleIcon game={game} role={r.id} className="size-3.5" />
                  {r.short}
                </span>
              </th>
            ))}
            {showWinRate && <th className="px-2 py-2 text-right font-semibold">Best WR</th>}
            <th className="px-2 py-2 font-semibold">Dmg</th>
            <th className="px-2 py-2 font-semibold">Range</th>
            <th className="px-2 py-2 font-semibold">Archetypes</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer border-t border-line bg-panel transition-colors hover:bg-panel-2">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(c.id);
                  }}
                  className="flex items-center gap-2 text-left"
                >
                  <ChampIcon champ={c} size={28} />
                  <span className="font-medium whitespace-nowrap">{c.name}</span>
                  {!c.curated && (
                    <Badge tone="warn" className="px-1 py-0 text-[9px]">
                      Derived
                    </Badge>
                  )}
                </button>
              </td>
              {roles.map((r) => (
                <td key={r.id} className="px-1 text-center">
                  {c.meta[r.id] || c.roles.includes(r.id) ? <TierBadge tier={c.meta[r.id]?.tier} /> : <span className="text-line-strong">·</span>}
                </td>
              ))}
              {showWinRate && <td className="px-2 text-right text-muted tabular-nums">{pct(winRateIn(c, "all"))}</td>}
              <td className="px-2 text-xs text-muted capitalize">{c.damage}</td>
              <td className="px-2 text-xs text-muted capitalize">{c.range}</td>
              <td className="px-2 text-xs text-faint">{c.archetypes.slice(0, 3).map(archetypeLabel).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

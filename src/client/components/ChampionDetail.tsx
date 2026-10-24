// Champion/hero detail: meta per role, attribute bars, power curve, archetypes, notes, and relations
// (strong vs / weak vs / synergies) taken from the bundle's matchup and synergy matrices.
import { useMemo, type ReactNode } from "react";
import { ARCHETYPE_DEFS, ATTRIBUTES, GAMES } from "../../shared/games";
import type { Champion, GameId, Role } from "../../shared/types";
import { hasWinRates, type GameData } from "../lib/gameData";
import { Badge, ChampIcon, cn } from "../ui";
import { TierBadge } from "./badges";
import { Pill } from "./common";
import { compact, pct, signed } from "./format";
import { RoleChip } from "./RoleIcon";

const TOP_N = 8;

interface Relation {
  champ: Champion;
  value: number;
  lane?: boolean;
  n?: number;
}

function relationsFor(data: GameData, id: string): { strong: Relation[]; weak: Relation[]; synergy: Relation[] } {
  const strong: Relation[] = [];
  const weak: Relation[] = [];
  for (const [other, cell] of Object.entries(data.matchups[id] ?? {})) {
    const champ = data.byId.get(other);
    if (!champ || other === id || !Number.isFinite(cell.adv) || cell.adv === 0) continue;
    (cell.adv > 0 ? strong : weak).push({ champ, value: cell.adv, lane: cell.lane, n: cell.n });
  }
  strong.sort((a, b) => b.value - a.value);
  weak.sort((a, b) => a.value - b.value);
  const synergy: Relation[] = [];
  for (const [other, v] of Object.entries(data.synergies[id] ?? {})) {
    const champ = data.byId.get(other);
    if (champ && other !== id && Number.isFinite(v) && v > 0) synergy.push({ champ, value: v });
  }
  synergy.sort((a, b) => b.value - a.value);
  return { strong: strong.slice(0, TOP_N), weak: weak.slice(0, TOP_N), synergy: synergy.slice(0, TOP_N) };
}

/** 0..3 rating as three segments. */
function Segments({ value, max = 3, className }: { value: number; max?: number; className?: string }) {
  const v = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span className={cn("flex gap-0.5", className)} aria-label={`${v} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < v ? "bg-accent" : "bg-line")} />
      ))}
    </span>
  );
}

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function RelationList({ items, kind, onSelect, empty }: { items: Relation[]; kind: "strong" | "weak" | "synergy"; onSelect: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="text-xs text-faint">{empty}</p>;
  const color = kind === "strong" ? "bg-good" : kind === "weak" ? "bg-bad" : "bg-blue";
  const text = kind === "strong" ? "text-good" : kind === "weak" ? "text-bad" : "text-blue";
  return (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.champ.id}>
          <button type="button" onClick={() => onSelect(r.champ.id)} className="flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-panel-2">
            <ChampIcon champ={r.champ} size={28} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm">{r.champ.name}</span>
                {r.lane && (
                  <Badge className="px-1 py-0 text-[9px]" title="Lane matchup">
                    Lane
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block h-1 rounded-full bg-line">
                <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.abs(r.value) * 100)}%` }} />
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("block text-xs font-semibold tabular-nums", text)}>{kind === "synergy" ? r.value.toFixed(2) : signed(r.value)}</span>
              {r.n !== undefined && <span className="block text-[10px] text-faint tabular-nums">n={compact(r.n)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ChampionDetail({ game, data, champ, onSelect }: { game: GameId; data: GameData; champ: Champion; onSelect: (id: string) => void }) {
  const rel = useMemo(() => relationsFor(data, champ.id), [data, champ.id]);
  // The LoL bundle has tiers only: don't show four columns of dashes.
  const stats = useMemo(() => hasWinRates(data.champions), [data]);
  const metaRoles = useMemo(() => {
    const order = GAMES[game].roles.map((r) => r.id);
    const roles = new Set<Role>([...champ.roles, ...Object.keys(champ.meta)]);
    return order.filter((r) => roles.has(r));
  }, [game, champ]);
  const archetypeLabel = (id: string) => ARCHETYPE_DEFS.find((a) => a.id === id);
  const unit = GAMES[game].unit.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <ChampIcon champ={champ} size={80} className="rounded-xl" />
        <div className="min-w-0 space-y-1.5">
          <div>
            <div className="font-display text-2xl font-bold">{champ.name}</div>
            {champ.title && <div className="text-sm text-muted capitalize">{champ.title}</div>}
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge tone={champ.damage === "magic" ? "blue" : champ.damage === "physical" ? "red" : "accent"}>{champ.damage} dmg</Badge>
            <Badge>{champ.range}</Badge>
            <Badge title="Difficulty 1 (easy) to 3 (hard)">Difficulty {"◆".repeat(Math.max(1, Math.min(3, Math.round(champ.difficulty))))}</Badge>
            {!champ.curated && (
              <Badge tone="warn" title={`Not hand-curated yet. Attributes for this ${unit} are derived heuristically from source data.`}>
                Derived
              </Badge>
            )}
            {champ.tags.map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>
        </div>
      </div>

      {champ.notes && <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-muted">{champ.notes}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Meta by role">
          {metaRoles.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-faint">
                    <th className="pb-1 font-medium">Role</th>
                    <th className="pb-1 font-medium">Tier</th>
                    {stats && (
                      <>
                        <th className="pb-1 text-right font-medium">Win</th>
                        <th className="pb-1 text-right font-medium">Pick</th>
                        <th className="pb-1 text-right font-medium">Ban</th>
                        <th className="pb-1 text-right font-medium">Games</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {metaRoles.map((r) => {
                    const m = champ.meta[r];
                    return (
                      <tr key={r} className="border-t border-line/60">
                        <td className="py-1.5">
                          <RoleChip game={game} role={r} />
                        </td>
                        <td>
                          <TierBadge tier={m?.tier} />
                        </td>
                        {stats && (
                          <>
                            <td className="text-right tabular-nums">{pct(m?.winRate)}</td>
                            <td className="text-right text-muted tabular-nums">{pct(m?.pickRate)}</td>
                            <td className="text-right text-muted tabular-nums">{pct(m?.banRate)}</td>
                            <td className="text-right text-faint tabular-nums">{compact(m?.games)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!stats && <p className="mt-1 text-[11px] text-muted">Tier data only. This data set has no win, pick or ban rates.</p>}
            </div>
          ) : (
            <p className="text-xs text-faint">No role data.</p>
          )}
        </Section>

        <Section title="Power curve">
          <div className="flex h-24 items-end gap-3">
            {(["early", "mid", "late"] as const).map((k) => {
              const v = Math.max(0, Math.min(3, champ.powerCurve[k]));
              return (
                <div key={k} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div className="flex w-full flex-1 items-end rounded-md bg-panel-2">
                    <div className="w-full rounded-md bg-linear-to-t from-accent/40 to-accent" style={{ height: `${(v / 3) * 100}%` }} title={`${k}: ${v}/3`} />
                  </div>
                  <span className="text-[11px] text-muted capitalize">{k}</span>
                </div>
              );
            })}
          </div>
          {champ.archetypes.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Fits comps</h4>
              <div className="flex flex-wrap gap-1">
                {champ.archetypes.map((a) => (
                  <Pill key={a} tone="accent" title={archetypeLabel(a)?.description}>
                    {archetypeLabel(a)?.label ?? a}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      <Section title="Attributes">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {ATTRIBUTES.map((a) => (
            <div key={a.id} className="grid grid-cols-[7.5rem_1fr_1rem] items-center gap-2" title={a.description}>
              <dt className="truncate text-xs text-muted">{a.label}</dt>
              <dd>
                <Segments value={champ.attributes[a.id] ?? 0} />
              </dd>
              <dd className="text-right text-[11px] text-faint tabular-nums">{champ.attributes[a.id] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="Strong against">
          <RelationList items={rel.strong} kind="strong" onSelect={onSelect} empty="No favorable matchups recorded." />
        </Section>
        <Section title="Weak against">
          <RelationList items={rel.weak} kind="weak" onSelect={onSelect} empty="No unfavorable matchups recorded." />
        </Section>
        <Section title="Synergies">
          <RelationList items={rel.synergy} kind="synergy" onSelect={onSelect} empty="No synergies recorded." />
        </Section>
      </div>
    </div>
  );
}

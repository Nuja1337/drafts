// Roster card: a player's roles, top pool champions with comfort, playstyles, traits and hated matchups.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { playstyleDef, traitDef } from "../../shared/games";
import type { GameId, PlayerProfile, RolePrefLevel } from "../../shared/types";
import type { GameData } from "../lib/gameData";
import { Badge, ChampIcon, cn } from "../ui";
import { Pill } from "./common";
import { RoleChip } from "./RoleIcon";

const LEVEL_ORDER: Record<RolePrefLevel, number> = { main: 0, secondary: 1, fill: 2 };
const POOL_PREVIEW = 6;
const AVOID_PREVIEW = 5;

/** Five tiny segments under a portrait showing comfort 1..5. */
export function ComfortMeter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("flex gap-px", className)} aria-label={`Comfort ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn("h-1 flex-1 rounded-full", n <= value ? (value >= 5 ? "bg-accent" : "bg-accent/70") : "bg-line")} />
      ))}
    </span>
  );
}

export function PlayerCard({
  game,
  data,
  player,
  isYou,
  href,
  canEdit,
  actions,
  unitLabel = "Pool",
}: {
  game: GameId;
  data: GameData | null;
  player: PlayerProfile;
  isYou?: boolean;
  href: string;
  canEdit: boolean;
  actions?: ReactNode;
  unitLabel?: string;
}) {
  const roles = [...player.roles].sort((a, b) => LEVEL_ORDER[a.pref] - LEVEL_ORDER[b.pref]);
  const pool = [...player.pool].sort((a, b) => b.comfort - a.comfort);
  const avoid = [...player.avoid].sort((a, b) => b.severity - a.severity);
  const name = (id: string) => data?.byId.get(id)?.name ?? id;
  const empty = !roles.length && !pool.length && !player.playstyles.length && !player.strengths.length && !player.weaknesses.length && !avoid.length;

  return (
    <article className={cn("flex min-w-0 flex-col rounded-xl border bg-panel", isYou ? "border-accent/50" : "border-line")}>
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold" title={player.name}>
            {player.name}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {roles.length ? roles.map((r) => <RoleChip key={r.role} game={game} role={r.role} level={r.pref} />) : <span className="text-xs text-faint">No roles set</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isYou && <Badge tone="accent">You</Badge>}
          {player.claimed ? (
            <Badge tone="good" title="A player link has been issued for this slot">
              Linked
            </Badge>
          ) : (
            <Badge title="No one has claimed this slot yet. Share the invite link.">Open slot</Badge>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        {empty && <p className="text-sm text-faint">Profile not filled in yet.</p>}

        {pool.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {unitLabel} <span className="text-faint/70">· {pool.length}</span>
            </h4>
            <ul className="flex flex-wrap gap-1.5">
              {pool.slice(0, POOL_PREVIEW).map((e) => (
                <li key={e.championId} className="w-9" title={`${name(e.championId)} · comfort ${e.comfort}/5${e.note ? ` · ${e.note}` : ""}`}>
                  <ChampIcon champ={data?.byId.get(e.championId)} size={36} title="" />
                  <ComfortMeter value={e.comfort} className="mt-0.5" />
                </li>
              ))}
              {pool.length > POOL_PREVIEW && (
                <li className="flex size-9 items-center justify-center rounded-md border border-line bg-panel-2 text-xs text-muted">+{pool.length - POOL_PREVIEW}</li>
              )}
            </ul>
          </section>
        )}

        {player.playstyles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.playstyles.map((id) => {
              const d = playstyleDef(id);
              return (
                <Pill key={id} tone="blue" title={d?.description}>
                  {d?.label ?? id}
                </Pill>
              );
            })}
          </div>
        )}

        {(player.strengths.length > 0 || player.weaknesses.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {player.strengths.map((id) => (
              <Pill key={`s-${id}`} tone="good" title={`Strength: ${traitDef(id)?.description ?? ""}`}>
                + {traitDef(id)?.label ?? id}
              </Pill>
            ))}
            {player.weaknesses.map((id) => (
              <Pill key={`w-${id}`} tone="bad" title={`Weakness: ${traitDef(id)?.description ?? ""}`}>
                − {traitDef(id)?.label ?? id}
              </Pill>
            ))}
          </div>
        )}

        {avoid.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Hates facing</h4>
            <ul className="flex flex-wrap gap-1.5">
              {avoid.slice(0, AVOID_PREVIEW).map((a) => (
                <li
                  key={a.championId}
                  className="relative"
                  title={`${name(a.championId)} · ${["", "dislikes", "struggles", "hates"][a.severity]}${a.note ? ` · ${a.note}` : ""}`}
                >
                  <ChampIcon champ={data?.byId.get(a.championId)} size={28} className="ring-1 ring-bad/60" title="" />
                  <span className="absolute -right-1 -bottom-1 rounded bg-bad px-0.5 text-[9px] leading-tight font-bold text-bg">{"!".repeat(a.severity)}</span>
                </li>
              ))}
              {avoid.length > AVOID_PREVIEW && <li className="self-center text-xs text-muted">+{avoid.length - AVOID_PREVIEW}</li>}
            </ul>
          </section>
        )}

        {player.notes && <p className="line-clamp-2 text-xs text-muted" title={player.notes}>{player.notes}</p>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <Link to={href} className={cn("text-sm font-semibold", canEdit ? "text-accent hover:text-accent-strong" : "text-muted hover:text-text")}>
          {canEdit ? (isYou ? "Edit my profile →" : "Edit profile →") : "View profile →"}
        </Link>
        {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
      </footer>
    </article>
  );
}

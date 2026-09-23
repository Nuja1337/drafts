// Small domain badges: game, key role, team kind, meta tier.
import { GAMES } from "../../shared/games";
import type { GameId, TeamKind, Tier } from "../../shared/types";
import type { TeamKeyRole } from "../lib/keys";
import { KEY_ROLE_LABEL } from "../lib/teams";
import { Badge, cn } from "../ui";

export function GameBadge({ game, className }: { game: GameId; className?: string }) {
  const def = GAMES[game] as (typeof GAMES)[GameId] | undefined; // guards stale/corrupt local storage entries
  if (!def) return null;
  return (
    <Badge tone={game === "lol" ? "accent" : "red"} className={className} title={def.name}>
      {def.short}
    </Badge>
  );
}

const ROLE_TONE = { owner: "accent", player: "blue", view: "neutral" } as const;

export function KeyRoleBadge({ role, className }: { role: TeamKeyRole; className?: string }) {
  return (
    <Badge tone={ROLE_TONE[role]} className={className}>
      {KEY_ROLE_LABEL[role]}
    </Badge>
  );
}

export function KindBadge({ kind, className }: { kind: TeamKind; className?: string }) {
  return kind === "scout" ? (
    <Badge tone="warn" className={className} title="A profile you keep on an opponent">
      Opponent
    </Badge>
  ) : (
    <Badge tone="good" className={className} title="Your own roster">
      Team
    </Badge>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  S: "bg-accent/20 text-accent border-accent/50",
  A: "bg-good/15 text-good border-good/40",
  B: "bg-blue/15 text-blue border-blue/40",
  C: "bg-panel-3 text-muted border-line-strong",
  D: "bg-bad/10 text-bad/80 border-bad/30",
};

export function TierBadge({ tier, className, title }: { tier: Tier | undefined; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-display text-[11px] font-bold leading-none",
        tier ? TIER_STYLE[tier] : "border-line bg-panel-2 text-faint",
        className,
      )}
    >
      {tier ?? "–"}
    </span>
  );
}

export const TIER_RANK: Record<Tier, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

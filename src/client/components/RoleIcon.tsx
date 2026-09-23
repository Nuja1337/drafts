// Role glyphs (LoL lanes / Dota positions) and compact role chips.
import { GAMES, roleLabel } from "../../shared/games";
import type { GameId, Role, RolePrefLevel } from "../../shared/types";
import { cn } from "../ui";

const FAINT = 0.35;

function LolGlyph({ role }: { role: Role }) {
  switch (role) {
    case "top":
      return (
        <>
          <path d="M2 2h10v3H5v7H2z" />
          <rect x="8" y="8" width="6" height="6" rx="1" opacity={FAINT} />
        </>
      );
    case "bot":
      return (
        <>
          <path d="M14 14H4v-3h7V4h3z" />
          <rect x="2" y="2" width="6" height="6" rx="1" opacity={FAINT} />
        </>
      );
    case "mid":
      return (
        <>
          <path d="M2 11 11 2h3v3l-9 9H2z" />
          <path d="M2 2h5L2 7zM14 14H9l5-5z" opacity={FAINT} />
        </>
      );
    case "jungle":
      return <path d="M8 1.5 3 9h2.6L4 14.5h8L10.4 9H13z" />;
    case "support":
      return <path d="M8 1.5 13.5 4v4.2c0 3.1-2.3 5.3-5.5 6.3-3.2-1-5.5-3.2-5.5-6.3V4z" />;
    default:
      return <circle cx="8" cy="8" r="5" />;
  }
}

function DotaGlyph({ role }: { role: Role }) {
  const n = /^pos([1-5])$/.exec(role)?.[1];
  return (
    <>
      <path d="M8 .8 15.2 8 8 15.2.8 8z" opacity={FAINT} />
      <text x="8" y="11.3" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="currentColor" style={{ fontFamily: "var(--font-display)" }}>
        {n ?? "?"}
      </text>
    </>
  );
}

/** 16×16 role glyph that inherits the current text color. Decorative unless `title` is given (use it when no text label is next to it). */
export function RoleIcon({ game, role, className, title }: { game: GameId; role: Role; className?: string; title?: string }) {
  const glyph = game === "lol" ? <LolGlyph role={role} /> : <DotaGlyph role={role} />;
  if (!title) {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className={cn("size-4 shrink-0", className)} aria-hidden>
        {glyph}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={cn("size-4 shrink-0", className)} role="img" aria-label={title}>
      <title>{title}</title>
      {glyph}
    </svg>
  );
}

const LEVEL_STYLE: Record<RolePrefLevel, string> = {
  main: "border-accent/50 bg-accent/15 text-accent",
  secondary: "border-blue/40 bg-blue/10 text-blue",
  fill: "border-line-strong bg-panel-3 text-muted",
};
const LEVEL_LABEL: Record<RolePrefLevel, string> = { main: "Main", secondary: "Secondary", fill: "Can fill" };

/** Icon + short label chip; `level` colors it by preference strength. */
export function RoleChip({ game, role, level, className }: { game: GameId; role: Role; level?: RolePrefLevel; className?: string }) {
  const short = GAMES[game].roles.find((r) => r.id === role)?.short ?? role.toUpperCase();
  const label = roleLabel(game, role);
  return (
    <span
      title={level ? `${label} — ${LEVEL_LABEL[level]}` : label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap",
        level ? LEVEL_STYLE[level] : "border-line-strong bg-panel-3 text-muted",
        className,
      )}
    >
      <RoleIcon game={game} role={role} className="size-3.5" />
      {short}
    </span>
  );
}


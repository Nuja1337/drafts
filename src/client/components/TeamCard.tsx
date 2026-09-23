// Cards for things remembered in this browser: team keys and recent draft rooms.
import { Link } from "react-router";
import type { StoredRoom, StoredTeamKey } from "../lib/keys";
import { Badge, cn } from "../ui";
import { GameBadge, KeyRoleBadge, KindBadge } from "./badges";
import { fullDate, timeAgo } from "./format";

/** Two-letter monogram tile coloured by game. */
export function TeamMonogram({ name, game, className }: { name: string; game: StoredTeamKey["game"]; className?: string }) {
  const letters =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0] ?? "")
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg border font-display text-base font-bold",
        game === "lol" ? "border-accent/40 bg-accent/10 text-accent" : "border-red/40 bg-red/10 text-red",
        className,
      )}
    >
      {letters}
    </span>
  );
}

export function TeamCard({ entry, onForget }: { entry: StoredTeamKey; onForget?: () => void }) {
  return (
    <div className="group relative flex items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-line-strong hover:bg-panel-2 sm:p-4">
      <TeamMonogram name={entry.teamName} game={entry.game} />
      <div className="min-w-0 flex-1">
        <Link to={`/t/${encodeURIComponent(entry.teamId)}`} className="block truncate font-display font-semibold after:absolute after:inset-0 after:content-['']">
          {entry.teamName || "Untitled team"}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <GameBadge game={entry.game} />
          <KeyRoleBadge role={entry.role} />
          {entry.kind === "scout" && <KindBadge kind="scout" />}
        </div>
      </div>
      {onForget && (
        <button
          type="button"
          onClick={onForget}
          className="relative z-10 shrink-0 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-panel-3 hover:text-bad"
          title="Remove this team's key from this browser"
        >
          Forget
        </button>
      )}
    </div>
  );
}

const roomRole = (key: string | undefined): { label: string; tone: "accent" | "blue" | "neutral" } =>
  !key ? { label: "Spectator", tone: "neutral" } : key.startsWith("host_") ? { label: "Host", tone: "accent" } : { label: "Captain", tone: "blue" };

export function RoomCard({ room, onForget }: { room: StoredRoom; onForget?: () => void }) {
  const role = roomRole(room.key);
  return (
    <div className="group relative flex items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-line-strong hover:bg-panel-2">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-panel-3 font-display text-xs font-bold text-muted"
      >
        {room.game === "dota2" ? "D2" : "LoL"}
      </span>
      <div className="min-w-0 flex-1">
        <Link to={`/r/${encodeURIComponent(room.roomId)}`} className="block truncate text-sm font-semibold after:absolute after:inset-0 after:content-['']">
          {room.label || `Room ${room.roomId}`}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
          <Badge tone={role.tone}>{role.label}</Badge>
          <span title={fullDate(room.savedAt)}>{timeAgo(room.savedAt)}</span>
        </div>
      </div>
      {onForget && (
        <button
          type="button"
          onClick={onForget}
          className="relative z-10 shrink-0 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-panel-3 hover:text-bad"
          title="Remove this room from the list"
        >
          ✕
        </button>
      )}
    </div>
  );
}

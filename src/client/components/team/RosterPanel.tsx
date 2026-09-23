// Roster tab: player cards, owner add-slot form and per-player admin actions.
import { useMemo, useState, type FormEvent } from "react";
import { roleIds } from "../../../shared/games";
import type { PlayerProfile, Principal, TeamProfile } from "../../../shared/types";
import type { GameData } from "../../lib/gameData";
import { canEditPlayer, errorMessage, playerPath, TEAM_LIMITS, teamApi } from "../../lib/teams";
import { Button, EmptyState, ErrorNote, Input } from "../../ui";
import { PlayerCard } from "../PlayerCard";
import { PlayerAdminActions } from "./PlayerAdminActions";

/** Orders players by the position of their main role (Top→Support / Pos 1→5); players without a main role go last. */
function sortRoster(team: TeamProfile): PlayerProfile[] {
  const order = roleIds(team.game);
  const rank = (p: PlayerProfile) => {
    const main = p.roles.find((r) => r.pref === "main");
    const i = main ? order.indexOf(main.role) : -1;
    return i < 0 ? order.length : i;
  };
  return team.players.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

function AddPlayerForm({ team, ownerKey, onTeam }: { team: TeamProfile; ownerKey: string; onTeam: (t: TeamProfile) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = team.players.length >= TEAM_LIMITS.players;
  const trimmed = name.trim();
  const duplicate = team.players.some((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || busy || full || duplicate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await teamApi.addPlayer(team.id, ownerKey, { name: trimmed });
      onTeam(res.team);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={TEAM_LIMITS.playerName}
          placeholder={full ? `Roster full (${TEAM_LIMITS.players} max)` : team.kind === "scout" ? "Opponent player name" : "Player name"}
          disabled={full}
          aria-label="New player name"
          className="min-w-0"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={!trimmed || full || duplicate} className="shrink-0">
          Add player
        </Button>
      </div>
      {duplicate && trimmed && <p className="text-xs text-warn">There's already a player called “{trimmed}”.</p>}
      {error && <ErrorNote error={error} />}
    </form>
  );
}

export function RosterPanel({
  team,
  you,
  ownerKey,
  data,
  onTeam,
}: {
  team: TeamProfile;
  you: Principal;
  /** Present only when the viewer is the owner. */
  ownerKey: string | null;
  data: GameData | null;
  onTeam: (t: TeamProfile) => void;
}) {
  const roster = useMemo(() => sortRoster(team), [team]);
  const scout = team.kind === "scout";
  const isOwner = you.kind === "owner" && !!ownerKey;
  const unit = team.game === "lol" ? "Champion pool" : "Hero pool";

  return (
    <div className="space-y-5">
      {isOwner && (
        <div className="grid gap-3 rounded-xl border border-line bg-panel p-4 md:grid-cols-[1fr_minmax(0,24rem)] md:items-center">
          <div>
            <h2 className="font-display font-semibold">{scout ? "Add their players" : "Add player slots"}</h2>
            <p className="text-xs text-muted">
              {scout
                ? "Add each opponent you want to track, then fill in their pools and habits."
                : "Create a slot per player (subs too). Players claim their slot with the invite link and fill in their own profile — or you fill it in for them."}
            </p>
          </div>
          <AddPlayerForm team={team} ownerKey={ownerKey} onTeam={onTeam} />
        </div>
      )}

      {roster.length === 0 ? (
        <EmptyState title={scout ? "No opponent players yet" : "No players yet"}>
          {isOwner
            ? scout
              ? "Add the players you want to scout above."
              : "Add a slot for each player above, then share the invite link from the Access tab."
            : "The owner hasn't added any players yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roster.map((p) => (
            <PlayerCard
              key={p.id}
              game={team.game}
              data={data}
              player={p}
              isYou={you.kind === "player" && you.playerId === p.id}
              href={playerPath(team.id, p.id)}
              canEdit={canEditPlayer(team, you, p.id)}
              unitLabel={unit}
              actions={isOwner ? <PlayerAdminActions team={team} player={p} ownerKey={ownerKey} onTeam={onTeam} /> : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

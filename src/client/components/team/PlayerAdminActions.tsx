// Owner-only per-player actions: release the player's link (slot becomes claimable again) and remove the player.
import { useState } from "react";
import type { PlayerProfile, TeamProfile } from "../../../shared/types";
import { teamApi } from "../../lib/teams";
import { Button, cn } from "../../ui";
import { ConfirmModal } from "../ConfirmModal";

export function PlayerAdminActions({
  team,
  player,
  ownerKey,
  onTeam,
  className,
}: {
  team: TeamProfile;
  player: PlayerProfile;
  ownerKey: string;
  onTeam: (team: TeamProfile) => void;
  className?: string;
}) {
  const [confirm, setConfirm] = useState<"release" | "remove" | null>(null);
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {player.claimed && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirm("release")} title="Revoke this player's link">
          Release link
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs hover:text-bad" onClick={() => setConfirm("remove")}>
        Remove
      </Button>

      <ConfirmModal
        open={confirm === "release"}
        onClose={() => setConfirm(null)}
        title={`Release ${player.name}'s link?`}
        confirmLabel="Release link"
        onConfirm={async () => {
          const res = await teamApi.releasePlayer(team.id, ownerKey, player.id);
          onTeam(res.team);
        }}
      >
        <p>
          The player link held by <b className="text-text">{player.name}</b> stops working immediately. Their profile stays; the slot becomes open so anyone with the
          invite link can claim it again.
        </p>
        <p>Use this when a player lost their link, left the team, or the link leaked.</p>
      </ConfirmModal>

      <ConfirmModal
        open={confirm === "remove"}
        onClose={() => setConfirm(null)}
        title={`Remove ${player.name}?`}
        confirmLabel="Remove player"
        onConfirm={async () => {
          const res = await teamApi.removePlayer(team.id, ownerKey, player.id);
          onTeam(res.team);
        }}
      >
        <p>
          Deletes <b className="text-text">{player.name}</b>'s profile — pool, preferences and notes — and revokes their link. You can undo this from the Activity tab.
        </p>
      </ConfirmModal>
    </div>
  );
}

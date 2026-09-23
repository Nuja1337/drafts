// Access tab (owner only): lock, invite/view/owner links, key rotation and per-player link management.
import { useState, type ReactNode } from "react";
import type { RotateKeyReq } from "../../../shared/api";
import type { TeamProfile } from "../../../shared/types";
import { errorMessage, inviteUrl, teamApi, teamUrl } from "../../lib/teams";
import { Badge, Button, Card, CopyField, ErrorNote, Toggle } from "../../ui";
import { ConfirmModal } from "../ConfirmModal";
import { PlayerAdminActions } from "./PlayerAdminActions";

type Which = RotateKeyReq["which"];

const ROTATE_COPY: Record<Which, { title: string; body: ReactNode; label: string }> = {
  invite: {
    title: "Rotate the invite link?",
    label: "Rotate invite",
    body: <p>The current invite link stops working. Players who already joined keep their access — only new joins need the new link.</p>,
  },
  view: {
    title: "Rotate the view link?",
    label: "Rotate view link",
    body: <p>Everyone using the current view link loses access immediately. Share the new link with the people who should keep it.</p>,
  },
  owner: {
    title: "Rotate the owner key?",
    label: "Rotate owner key",
    body: (
      <>
        <p>
          Your current owner link stops working everywhere — including other devices and anyone it may have leaked to. This browser switches to the new key
          automatically.
        </p>
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-warn">The new owner link is shown once. Save it right away.</p>
      </>
    ),
  },
};

function LinkBlock({ title, description, children }: { title: ReactNode; description: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div>
        <h3 className="font-display font-semibold">{title}</h3>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function AccessPanel({
  team,
  ownerKey,
  inviteCode,
  viewKey,
  onTeam,
  onSecrets,
  onOwnerRotated,
}: {
  team: TeamProfile;
  ownerKey: string;
  inviteCode: string | null;
  viewKey: string | null;
  onTeam: (t: TeamProfile) => void;
  onSecrets: (patch: { inviteCode?: string; viewKey?: string }) => void;
  /** Called with the new owner key; the parent stores it and shows it once. */
  onOwnerRotated: (newKey: string) => void;
}) {
  const [rotating, setRotating] = useState<Which | null>(null);
  const [showOwner, setShowOwner] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const scout = team.kind === "scout";

  const setLocked = async (locked: boolean) => {
    setLockBusy(true);
    setLockError(null);
    try {
      const res = await teamApi.update(team.id, ownerKey, { locked });
      onTeam(res.team);
    } catch (e) {
      setLockError(errorMessage(e));
    } finally {
      setLockBusy(false);
    }
  };

  const rotate = async (which: Which) => {
    const res = await teamApi.rotateKey(team.id, ownerKey, which);
    if (which === "invite") {
      if (!res.inviteCode) throw new Error("The server didn't return a new invite code — reload and try again.");
      onSecrets({ inviteCode: res.inviteCode });
    } else if (which === "view") {
      if (!res.viewKey) throw new Error("The server didn't return a new view key — reload and try again.");
      onSecrets({ viewKey: res.viewKey });
    } else {
      if (!res.ownerKey) throw new Error("The server didn't return a new owner key — reload before doing anything else.");
      setShowOwner(false);
      onOwnerRotated(res.ownerKey);
    }
  };

  const claimed = team.players.filter((p) => p.claimed);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card title="Share links">
        <div className="divide-y divide-line">
          <LinkBlock
            title="Invite link"
            description={
              scout
                ? "Lets a teammate claim a slot and keep that opponent's notes up to date. They can only edit the slot they claim."
                : "Players open this to claim their slot (or create one) and edit their own profile. Safe to share in your team chat."
            }
          >
            {inviteCode ? <CopyField value={inviteUrl(team.id, inviteCode)} /> : <p className="text-sm text-faint">Invite link unavailable — rotate it to create a new one.</p>}
            <Button size="sm" variant="ghost" onClick={() => setRotating("invite")}>
              ↻ Rotate invite
            </Button>
          </LinkBlock>

          <LinkBlock title="View link" description="Read-only access to the whole profile — for coaches, analysts or subs. Holders can't edit anything.">
            {viewKey ? <CopyField value={teamUrl(team.id, viewKey)} /> : <p className="text-sm text-faint">View link unavailable — rotate it to create a new one.</p>}
            <Button size="sm" variant="ghost" onClick={() => setRotating("view")}>
              ↻ Rotate view link
            </Button>
          </LinkBlock>

          <LinkBlock
            title={
              <span className="flex items-center gap-2">
                Owner link <Badge tone="warn">Master key</Badge>
              </span>
            }
            description="Full control: edit everything, manage links, delete the team. Keep it private — use it to sign in on another device."
          >
            {showOwner ? (
              <div className="space-y-2">
                <CopyField value={teamUrl(team.id, ownerKey)} />
                <Button size="sm" variant="ghost" onClick={() => setShowOwner(false)}>
                  Hide
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setShowOwner(true)}>
                  Reveal owner link
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-bad" onClick={() => setRotating("owner")}>
                  ↻ Rotate owner key
                </Button>
              </div>
            )}
          </LinkBlock>
        </div>
      </Card>

      <div className="space-y-5">
        <Card title="Lock">
          <div className="space-y-3">
            <Toggle checked={team.locked} onChange={setLocked} disabled={lockBusy} label={<span className="font-semibold">{team.locked ? "Locked" : "Unlocked"}</span>} />
            <p className="text-xs text-muted">
              While locked, only you can edit anything: players can't change their profiles and nobody can join with the invite link. Lock before a match to freeze the
              roster; unlock when players should update their pools.
            </p>
            <ErrorNote error={lockError} />
          </div>
        </Card>

        <Card title={`Player links · ${claimed.length}/${team.players.length}`}>
          {team.players.length === 0 ? (
            <p className="text-sm text-faint">No players yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {team.players.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {p.claimed ? <Badge tone="good">Linked</Badge> : <Badge>Open</Badge>}
                  </div>
                  <PlayerAdminActions team={team} player={p} ownerKey={ownerKey} onTeam={onTeam} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">Releasing a link revokes it; the slot can then be claimed again via the invite link.</p>
        </Card>
      </div>

      <ConfirmModal
        open={!!rotating}
        onClose={() => setRotating(null)}
        title={rotating ? ROTATE_COPY[rotating].title : ""}
        confirmLabel={rotating ? ROTATE_COPY[rotating].label : "Rotate"}
        onConfirm={() => (rotating ? rotate(rotating) : undefined)}
      >
        {rotating && ROTATE_COPY[rotating].body}
      </ConfirmModal>
    </div>
  );
}

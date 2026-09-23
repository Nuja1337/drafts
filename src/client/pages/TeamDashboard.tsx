// Team dashboard: imports ?key= links, then shows roster, settings, access (owner) and activity (owner + players).
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Principal, TeamProfile } from "../../shared/types";
import { Banner, ButtonLink, LoadingBlock, PageHeader } from "../components/common";
import { GameBadge, KindBadge } from "../components/badges";
import { useTitle } from "../components/useTitle";
import { AccessPanel } from "../components/team/AccessPanel";
import { AuditLog } from "../components/team/AuditLog";
import { RosterPanel } from "../components/team/RosterPanel";
import { SettingsPanel } from "../components/team/SettingsPanel";
import { TeamGate } from "../components/TeamGate";
import { useGameData } from "../lib/gameData";
import { getTeamKey, saveTeamKey } from "../lib/keys";
import {
  errorMessage,
  importTeamKey,
  isKeyRejected,
  isNotFound,
  KEY_ROLE_LABEL,
  playerPath,
  principalRole,
  teamUrl,
  useTeam,
  youLabel,
  type UseTeam,
} from "../lib/teams";
import { Badge, Button, CopyField, Modal, Spinner, Tabs } from "../ui";

type TabId = "roster" | "settings" | "access" | "activity";

type ImportState = { status: "idle" } | { status: "pending" } | { status: "done"; notice: string | null } | { status: "error"; message: string };

function tabsFor(you: Principal): { id: TabId; label: string }[] {
  const tabs: { id: TabId; label: string }[] = [
    { id: "roster", label: "Roster" },
    { id: "settings", label: "Settings" },
  ];
  if (you.kind === "owner") tabs.push({ id: "access", label: "Access" });
  if (you.kind !== "viewer") tabs.push({ id: "activity", label: "Activity" });
  return tabs;
}

export function TeamDashboard() {
  const { teamId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const urlKey = params.get("key");
  const [imp, setImp] = useState<ImportState>({ status: "idle" });
  const importedRef = useRef<string | null>(null);
  const state = useTeam(teamId || undefined);

  // Move ?key= into local storage (after the server confirms what it grants) and strip it from the URL.
  useEffect(() => {
    if (!teamId || !urlKey) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("key");
        return next;
      },
      { replace: true },
    );
    if (importedRef.current === urlKey) return;
    importedRef.current = urlKey;
    setImp({ status: "pending" });
    const before = getTeamKey(teamId);
    importTeamKey(teamId, urlKey.trim()).then(
      (res) => {
        const now = getTeamKey(teamId);
        const kept = before && now && now.key !== urlKey.trim() && now.role !== principalRole(res.you);
        setImp({
          status: "done",
          notice: kept ? `You opened a ${KEY_ROLE_LABEL[principalRole(res.you)].toLowerCase()} link, but this browser already has ${KEY_ROLE_LABEL[now.role].toLowerCase()} access — keeping that.` : null,
        });
      },
      (e: unknown) =>
        setImp({
          status: "error",
          message: isKeyRejected(e)
            ? "The link you opened has an outdated key — it was probably rotated or released. Ask the owner for a fresh link."
            : isNotFound(e)
              ? "The team in that link doesn't exist anymore."
              : `Couldn't check the link: ${errorMessage(e)}`,
        }),
    );
  }, [teamId, urlKey, setParams]);

  // Also covers the first render with ?key= (before the effect starts), so "no access" never flashes.
  if (imp.status === "pending" || (urlKey && imp.status === "idle")) return <LoadingBlock label="Checking your link…" />;

  return (
    <div className="space-y-4">
      {imp.status === "error" && <Banner tone="bad">{imp.message}</Banner>}
      {imp.status === "done" && imp.notice && <Banner tone="neutral">{imp.notice}</Banner>}
      <TeamGate state={state}>{({ team, you }) => <Dashboard state={state} team={team} you={you} />}</TeamGate>
    </div>
  );
}

function Dashboard({ state, team, you }: { state: UseTeam; team: TeamProfile; you: Principal }) {
  const [params, setParams] = useSearchParams();
  const { data } = useGameData(team.game);
  const [newOwnerKey, setNewOwnerKey] = useState<string | null>(null);
  const tabs = tabsFor(you);
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : "roster";
  const scout = team.kind === "scout";
  const ownerKey = you.kind === "owner" ? state.key : null;
  const me = you.kind === "player" ? team.players.find((p) => p.id === you.playerId) : undefined;
  useTitle(team.name);

  const setTab = (id: TabId) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "roster") next.delete("tab");
        else next.set("tab", id);
        return next;
      },
      { replace: true },
    );

  const onOwnerRotated = (key: string) => {
    // Persist before anything else: the old key is already dead on the server.
    saveTeamKey({ teamId: team.id, key, role: "owner", teamName: team.name, game: team.game, kind: team.kind }, true);
    setNewOwnerKey(key);
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <KindBadge kind={team.kind} />
            <GameBadge game={team.game} />
            {team.tag && <span className="font-display tracking-widest text-muted">[{team.tag}]</span>}
            {team.locked && (
              <Badge tone="warn" title="Only the owner can edit while locked">
                Locked
              </Badge>
            )}
            {state.refreshing && <Spinner className="size-3.5 text-faint" />}
          </>
        }
        title={team.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              You are:{" "}
              <b className="text-text">
                {you.kind === "player" && me ? (
                  <Link to={playerPath(team.id, me.id)} className="text-accent hover:underline">
                    {youLabel(team, you)}
                  </Link>
                ) : (
                  youLabel(team, you)
                )}
              </b>
              {you.kind === "viewer" && <span className="text-faint"> (read-only)</span>}
              {you.kind === "player" && <span className="text-faint"> (player)</span>}
            </span>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <span>
              {team.players.length} player{team.players.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <>
            {me && (
              <ButtonLink to={playerPath(team.id, me.id)} variant={team.locked ? "secondary" : "primary"}>
                {team.locked ? "View my profile" : "Edit my profile"}
              </ButtonLink>
            )}
            <ButtonLink to={`/rooms/new?game=${team.game}&${scout ? "b" : "a"}=${encodeURIComponent(team.id)}`} variant={me ? "secondary" : "primary"}>
              {scout ? "Draft against them" : "Start a draft"}
            </ButtonLink>
            <Button variant="ghost" onClick={state.refresh} disabled={state.refreshing} aria-label="Reload team" title="Reload">
              ↻
            </Button>
          </>
        }
      />

      {state.error && <div className="mb-4"><Banner tone="bad">Couldn't refresh: {errorMessage(state.error)}</Banner></div>}
      {team.locked && you.kind === "player" && (
        <div className="mb-4">
          <Banner tone="warn">The owner has locked this team. You can look around, but profile edits are paused until it's unlocked.</Banner>
        </div>
      )}
      {scout && you.kind === "owner" && team.players.length === 0 && tab === "roster" && (
        <div className="mb-4">
          <Banner tone="accent">
            This is an opponent profile. Add their players and what they're comfortable on — when you attach it to a draft room, suggestions will target their pools and
            weaknesses.
          </Banner>
        </div>
      )}

      <div className="mb-5 overflow-x-auto">
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="min-w-max sm:max-w-md" />
      </div>

      {tab === "roster" && <RosterPanel team={team} you={you} ownerKey={ownerKey} data={data} onTeam={state.setTeam} />}
      {tab === "settings" && <SettingsPanel team={team} ownerKey={ownerKey} data={data} onTeam={state.setTeam} />}
      {tab === "access" && ownerKey && (
        <AccessPanel
          team={team}
          ownerKey={ownerKey}
          inviteCode={state.inviteCode}
          viewKey={state.viewKey}
          onTeam={state.setTeam}
          onSecrets={state.setSecrets}
          onOwnerRotated={onOwnerRotated}
        />
      )}
      {tab === "activity" && state.key && <AuditLog team={team} teamKey={state.key} canRevert={you.kind === "owner"} onTeam={state.setTeam} />}

      <Modal open={!!newOwnerKey} onClose={() => setNewOwnerKey(null)} title="Your new owner link">
        <div className="space-y-4">
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            The old owner link no longer works. This browser now uses the new key — save this link somewhere safe (password manager). It's the only way to regain
            owner access on another device.
          </p>
          {newOwnerKey && <CopyField label="Owner backup link" value={teamUrl(team.id, newOwnerKey)} />}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setNewOwnerKey(null)}>
              I've saved it
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Loaded-state view (exported for render smoke tests). */
export { Dashboard as TeamDashboardView };

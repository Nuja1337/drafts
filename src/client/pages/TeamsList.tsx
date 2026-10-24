// Teams and opponent profiles this browser holds keys for.
import { useState } from "react";
import { ButtonLink, PageHeader } from "../components/common";
import { ConfirmModal } from "../components/ConfirmModal";
import { useTitle } from "../components/useTitle";
import { TeamCard } from "../components/TeamCard";
import { forgetTeam, type StoredTeamKey } from "../lib/keys";
import { useStoredTeams } from "../lib/teams";
import { EmptyState } from "../ui";

function Group({ title, hint, entries, onForget }: { title: string; hint: string; entries: StoredTeamKey[]; onForget: (e: StoredTeamKey) => void }) {
  if (!entries.length) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="font-display text-lg font-semibold">
          {title} <span className="text-faint">· {entries.length}</span>
        </h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <TeamCard key={e.teamId} entry={e} onForget={() => onForget(e)} />
        ))}
      </div>
    </section>
  );
}

export function TeamsList() {
  useTitle("Teams");
  const teams = useStoredTeams();
  const [forgetting, setForgetting] = useState<StoredTeamKey | null>(null);
  const own = teams.filter((t) => t.kind === "team");
  const scouts = teams.filter((t) => t.kind === "scout");

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Teams and opponent profiles you have links for on this device. Keys are stored only in this browser."
        actions={
          <>
            <ButtonLink to="/teams/new?kind=scout">Scout an opponent</ButtonLink>
            <ButtonLink to="/teams/new" variant="primary">
              Create team
            </ButtonLink>
          </>
        }
      />

      {teams.length === 0 ? (
        <EmptyState
          title="No teams on this device yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink to="/teams/new" variant="primary">
                Create your team
              </ButtonLink>
              <ButtonLink to="/teams/new?kind=scout">Scout an opponent</ButtonLink>
            </div>
          }
        >
          Create a team to store your players' pools and preferences, or open an invite or view link someone shared with you. It will show up here.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          <Group title="Your teams" hint="Rosters you own, play on or can view." entries={own} onForget={setForgetting} />
          <Group title="Opponent profiles" hint="Scouting notes on teams you draft against." entries={scouts} onForget={setForgetting} />
          <p className="text-xs text-faint">
            To switch devices, open your owner backup link (from the team's <span className="text-muted">Access</span> tab) or ask the owner for a fresh invite.
            There are no accounts yet, so lost links can't be recovered.
          </p>
        </div>
      )}

      <ConfirmModal
        open={!!forgetting}
        onClose={() => setForgetting(null)}
        title={`Forget “${forgetting?.teamName ?? ""}”?`}
        confirmLabel="Forget on this device"
        onConfirm={() => {
          if (forgetting) forgetTeam(forgetting.teamId);
        }}
      >
        <p>This removes the team's key from this browser only. The team itself is not deleted.</p>
        {forgetting?.role === "owner" ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-bad">
            This is your <b>owner key</b>. Unless you saved the owner backup link somewhere else, you will permanently lose control of this team.
          </p>
        ) : (
          <p>You'll need the invite or view link again to get back in.</p>
        )}
      </ConfirmModal>
    </div>
  );
}

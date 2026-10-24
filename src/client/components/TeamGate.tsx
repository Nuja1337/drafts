// Renders the non-ready states of useTeam (no key, loading, rejected key, deleted team, errors) and the page once ready.
import type { ReactNode } from "react";
import type { Principal, TeamProfile } from "../../shared/types";
import { forgetTeam } from "../lib/keys";
import { errorMessage, isKeyRejected, isNotFound, type UseTeam } from "../lib/teams";
import { Button, EmptyState } from "../ui";
import { ButtonLink, LoadingBlock } from "./common";

export function NoTeamAccess({ scoutHint }: { scoutHint?: boolean }) {
  return (
    <EmptyState
      title="You need an invite link"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink to="/teams">Your teams</ButtonLink>
          <ButtonLink to="/teams/new" variant="primary">
            Create a team
          </ButtonLink>
        </div>
      }
    >
      <p>
        {scoutHint ? "Profiles" : "Team profiles"} are private. Ask the owner for an <b className="text-text">invite link</b> to join as a player, or a{" "}
        <b className="text-text">view link</b> for read-only access. If you own this team, open your owner backup link on this device.
      </p>
    </EmptyState>
  );
}

export function TeamGate({ state, children }: { state: UseTeam; children: (ready: { team: TeamProfile; you: Principal }) => ReactNode }) {
  const { stored, team, you, error } = state;
  if (!state.key) return <NoTeamAccess />;
  if (team && you) return <>{children({ team, you })}</>;
  if (state.loading) return <LoadingBlock label="Loading team…" />;

  const forget = stored ? (
    <Button variant="danger" onClick={() => forgetTeam(stored.teamId)}>
      Forget on this device
    </Button>
  ) : null;

  if (isKeyRejected(error)) {
    return (
      <EmptyState
        title="Your link for this team no longer works"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/teams">Your teams</ButtonLink>
            {forget}
          </div>
        }
      >
        {stored?.role === "owner"
          ? "The owner key saved here was rotated, probably from another device. Open the newest owner link to regain access."
          : stored?.role === "player"
            ? "Your player key was released or replaced by the team owner. Ask them for a fresh invite link."
            : "The view link was rotated by the team owner. Ask them for the new one."}
        {stored?.teamName && <span className="mt-2 block text-faint">Saved as “{stored.teamName}”.</span>}
      </EmptyState>
    );
  }
  if (isNotFound(error)) {
    return (
      <EmptyState
        title="Team not found"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/teams">Your teams</ButtonLink>
            {forget}
          </div>
        }
      >
        This team doesn't exist anymore. Its owner may have deleted it.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      title="Couldn't load the team"
      action={
        <Button variant="primary" onClick={state.refresh}>
          Try again
        </Button>
      }
    >
      {error ? errorMessage(error) : "Something went wrong."}
    </EmptyState>
  );
}

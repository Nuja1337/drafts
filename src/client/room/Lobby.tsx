// Pre-draft lobby: team cards (name, attached profile, ready), room settings and the host Start button.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cleanTeamName, PROFILE_ID_RE, TEAM_NAME_MAX } from "../../shared/draft";
import { GAMES } from "../../shared/games";
import type { ClientMsg, RoomState } from "../../shared/room";
import type { Side, TeamSlot } from "../../shared/types";
import { listTeamKeys } from "../lib/keys";
import { Badge, Button, cn, Select } from "../ui";
import { IconCheck } from "./icons";
import type { ProfileState } from "./useTeamProfiles";
import type { DraftView } from "./view";


const FEARLESS_TEXT: Record<RoomState["config"]["fearless"], string> = {
  off: "Off",
  soft: "Soft — a team can't re-pick its own earlier picks",
  hard: "Hard — nobody can pick anything picked earlier in the series",
};

/** Inline team-name editor that commits on blur / Enter. */
function TeamNameInput({ value, onCommit, disabled }: { value: string; onCommit: (name: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const name = cleanTeamName(draft);
    if (!name) setDraft(value);
    else if (name !== value) onCommit(name);
  };
  return (
    <input
      value={draft}
      disabled={disabled}
      maxLength={TEAM_NAME_MAX}
      aria-label="Team name"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "w-full min-w-0 rounded-md border bg-transparent px-2 py-1 font-display text-lg font-bold text-text focus:outline-none",
        disabled ? "border-transparent" : "border-line hover:border-line-strong focus:border-accent",
      )}
    />
  );
}

export function ProfileSelect({
  state,
  slot,
  profile,
  send,
  disabled,
  isYou = false,
}: {
  state: RoomState;
  slot: TeamSlot;
  profile: ProfileState;
  send: (msg: ClientMsg) => void;
  disabled: boolean;
  /** The viewer captains this slot (warn when the opponent holds their team's profile). */
  isYou?: boolean;
}) {
  const game = state.config.game;
  const current = state.config.teams[slot].profileId ?? "";
  // One profile can't describe both teams (the server refuses it), so the other slot's profile isn't selectable here.
  const otherProfile = state.config.teams[slot === "A" ? "B" : "A"].profileId ?? "";
  const options = listTeamKeys().filter((k) => k.game === game && PROFILE_ID_RE.test(k.teamId));
  const own = options.filter((k) => k.kind === "team");
  const scouts = options.filter((k) => k.kind === "scout");
  const attached = current ? options.find((k) => k.teamId === current) : undefined;
  const known = !current || !!attached;
  const ownOnOpponent = isYou && !!otherProfile && own.some((k) => k.teamId === otherProfile);
  return (
    <div className="space-y-1">
      {disabled ? (
        // Read-only viewers get plain text, not a disabled (and truncated) select.
        <div className="flex h-9 items-center rounded-lg border border-line bg-panel-2/50 px-3 text-sm">
          <span className={cn("truncate", !current && "text-muted")}>{current ? (attached?.teamName ?? "Team profile attached") : "No team profile"}</span>
        </div>
      ) : (
        <Select
          value={current}
          aria-label="Attached team profile"
          onChange={(e) => send({ t: "setTeam", slot, profileId: e.target.value || null })}
          className="h-9"
        >
          <option value="">No team profile</option>
          {!known && <option value={current}>Attached (no access)</option>}
          {own.length > 0 && (
            <optgroup label="Your teams">
              {own.map((k) => (
                <option key={k.teamId} value={k.teamId} disabled={k.teamId === otherProfile}>
                  {k.teamName}
                </option>
              ))}
            </optgroup>
          )}
          {scouts.length > 0 && (
            <optgroup label="Scout profiles">
              {scouts.map((k) => (
                <option key={k.teamId} value={k.teamId} disabled={k.teamId === otherProfile}>
                  {k.teamName}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      )}
      {ownOnOpponent && (
        <p className="text-xs text-warn">Your team's profile is attached to the opponent — ask the host to remove it there.</p>
      )}
      <div className="text-xs">
        {profile.status === "loading" && <span className="text-muted">Loading profile…</span>}
        {profile.status === "ok" && profile.profile && (
          <span className="text-good">
            {profile.profile.players.length} player{profile.profile.players.length === 1 ? "" : "s"} loaded — suggestions use their pools
          </span>
        )}
        {profile.status === "nokey" && <span className="text-muted">Only holders of this team's key see player-aware suggestions.</span>}
        {profile.status === "error" && <span className="text-bad">{profile.error}</span>}
        {profile.status === "none" && !disabled && options.length === 0 && (
          <span className="text-faint">
            No saved {GAMES[game].short} profiles.{" "}
            <Link to="/teams/new" className="text-accent hover:underline">
              Create one
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}

function TeamCard({
  state,
  view,
  slot,
  side,
  profile,
  send,
}: {
  state: RoomState;
  view: DraftView;
  slot: TeamSlot;
  side: Side;
  profile: ProfileState;
  send: (msg: ClientMsg) => void;
}) {
  const team = state.config.teams[slot];
  const captains = state.config.mode === "captains";
  const canEdit = view.isHost || view.yourSlot === slot;
  const isYou = view.yourSlot === slot;
  const ready = state.ready[slot];
  const online = state.presence[slot] > 0;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-panel p-4", side === "blue" ? "border-blue/40" : "border-red/40")}>
      <span className={cn("absolute inset-x-0 top-0 h-1", side === "blue" ? "bg-blue" : "bg-red")} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn("text-[11px] font-bold tracking-[0.2em] uppercase", side === "blue" ? "text-blue" : "text-red")}>
          {GAMES[state.config.game].sideLabels[side]} side
        </span>
        <span className="text-[11px] text-faint">Team {slot}</span>
        {state.firstSide === side && <Badge title="This side acts on the format's first steps">First pick</Badge>}
        {isYou && <Badge tone="accent">You</Badge>}
        <span className="flex-1" />
        {captains && (
          <span className={cn("flex items-center gap-1.5 text-xs", online ? "text-good" : "text-faint")}>
            <span className={cn("size-2 rounded-full", online ? "bg-good" : "bg-line-strong")} />
            {online ? "Captain here" : "Captain not connected"}
          </span>
        )}
      </div>
      <TeamNameInput value={team.name} disabled={!canEdit} onCommit={(name) => send({ t: "setTeam", slot, name })} />
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Team profile</div>
        <ProfileSelect state={state} slot={slot} profile={profile} send={send} disabled={!canEdit} isYou={isYou && !view.isHost} />
      </div>
      {captains && (
        <div className="mt-4 flex items-center gap-3">
          {isYou ? (
            <Button variant={ready ? "secondary" : side === "blue" ? "blue" : "red"} onClick={() => send({ t: "ready", ready: !ready })} className="flex-1">
              {ready ? "Not ready" : "Ready up"}
            </Button>
          ) : null}
          <span className={cn("flex items-center gap-1.5 text-sm font-semibold", ready ? "text-good" : "text-muted")}>
            {ready ? <IconCheck className="size-4" /> : <span className="size-2 rounded-full bg-line-strong" />}
            {ready ? "Ready" : "Not ready"}
          </span>
        </div>
      )}
    </div>
  );
}

export function Lobby({
  state,
  view,
  profiles,
  send,
}: {
  state: RoomState;
  view: DraftView;
  profiles: Record<TeamSlot, ProfileState>;
  send: (msg: ClientMsg) => void;
}) {
  const cfg = state.config;
  const captains = cfg.mode === "captains";
  const slotOn = (side: Side) => state.sides[side];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold">{state.gameNumber > 1 ? `Game ${state.gameNumber} lobby` : "Lobby"}</h2>
          <p className="mt-1 text-sm text-muted">
            {captains
              ? "Each captain readies up from their own link. The draft starts automatically when both are ready, or when the host starts it."
              : "The host enters picks and bans for both sides. Everyone else watches the board and suggestions live."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["blue", "red"] as const).map((side) => (
            <TeamCard key={side} state={state} view={view} slot={slotOn(side)} side={side} profile={profiles[slotOn(side)]} send={send} />
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line bg-panel p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] tracking-wider text-faint uppercase">Format</dt>
            <dd className="font-medium" title={view.format.description}>
              {view.format.name}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-faint uppercase">Series</dt>
            <dd className="font-medium">{cfg.bestOf === 1 ? "Single game" : `Best of ${cfg.bestOf}`}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-faint uppercase">Fearless</dt>
            <dd className="font-medium" title={FEARLESS_TEXT[cfg.fearless]}>
              {cfg.fearless === "off" ? "Off" : cfg.fearless === "soft" ? "Soft" : "Hard"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-faint uppercase">Timer</dt>
            <dd className="font-medium">{cfg.timer.enabled ? `${cfg.timer.pickSeconds}s pick · ${cfg.timer.banSeconds}s ban` : "Off"}</dd>
          </div>
          <p className="col-span-full text-xs text-faint">{view.format.description}</p>
        </dl>

        <div className="flex flex-col items-center gap-2">
          {view.isHost ? (
            <>
              <Button variant="primary" size="lg" onClick={() => send({ t: "start" })} className="min-w-48 font-display tracking-wider uppercase">
                Start draft
              </Button>
              {captains && !(state.ready.A && state.ready.B) && <p className="text-xs text-faint">You can start before both captains are ready (admin override).</p>}
            </>
          ) : view.yourSlot ? (
            <p className="text-sm text-muted">{state.ready[view.yourSlot] ? "You're ready — waiting for the other captain or the host." : "Ready up when your team is set."}</p>
          ) : (
            <p className="text-sm text-muted">Waiting for the host to start the draft…</p>
          )}
          <p className="text-xs text-faint">
            {state.presence.host > 0 ? "Host is online" : "Host is offline"} · {state.presence.spectators} spectator{state.presence.spectators === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

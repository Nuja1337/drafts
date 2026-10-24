// Invite landing: claim an open slot or join as a new player, then continue to the player editor.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import type { InviteInfoRes } from "../../shared/api";
import { GameBadge, KindBadge } from "../components/badges";
import { Banner, ButtonLink, LoadingBlock } from "../components/common";
import { useTitle } from "../components/useTitle";
import { ApiRequestError } from "../lib/api";
import { errorMessage, isNotFound, KEY_ROLE_LABEL, playerPath, storeJoinKey, TEAM_LIMITS, teamApi, useStoredTeamKey } from "../lib/teams";
import { Button, Card, cn, EmptyState, ErrorNote, Input } from "../ui";

const NEW = "__new__";

export function JoinTeam() {
  const { teamId = "", code = "" } = useParams();
  const navigate = useNavigate();
  const existing = useStoredTeamKey(teamId || undefined);
  const [info, setInfo] = useState<InviteInfoRes | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Nothing is preselected while open slots exist: claiming one means "I am this player", so it must be a deliberate choice.
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(info ? `Join ${info.teamName}` : "Join team");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await teamApi.invite(teamId, code);
      setInfo(res);
      // Keep a still-valid choice; "add me" is the default only when there is no open slot to claim.
      setChoice((c) => (c === NEW || (c !== null && res.openSlots.some((s) => s.id === c)) ? c : res.openSlots.length ? null : NEW));
    } catch (e) {
      setLoadError(e);
    }
  }, [teamId, code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return isNotFound(loadError) ? (
      <EmptyState title="This invite link doesn't work" action={<ButtonLink to="/">Go home</ButtonLink>}>
        The owner may have rotated the invite, or the team was deleted. Ask them for a fresh link.
      </EmptyState>
    ) : (
      <EmptyState
        title="Couldn't open the invite"
        action={
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        }
      >
        {errorMessage(loadError)}
      </EmptyState>
    );
  }
  if (!info) return <LoadingBlock label="Opening invite…" />;

  const scout = info.kind === "scout";
  const trimmed = name.trim();
  // A full roster can only be joined by claiming an open slot (older servers omit canCreate and answer 409 team_full).
  const canCreate = info.canCreate !== false;
  const full = !canCreate && info.openSlots.length === 0;
  const isNew = choice === NEW;
  const slot = !isNew && choice ? info.openSlots.find((s) => s.id === choice) : undefined;
  const canSubmit =
    !info.locked && !busy && !full && (isNew ? canCreate && trimmed.length > 0 && trimmed.length <= TEAM_LIMITS.playerName : !!slot);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = isNew ? { name: trimmed } : slot ? { playerId: slot.id } : null;
    if (!canSubmit || !body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await teamApi.join(teamId, code, body);
      await storeJoinKey(res);
      navigate(playerPath(res.team.id, res.playerId), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      // Slot taken / team locked / invite changed: refresh what's available.
      if (err instanceof ApiRequestError && [403, 404, 409].includes(err.status)) void load();
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <GameBadge game={info.game} />
          {scout && <KindBadge kind="scout" />}
        </div>
        <h1 className="font-display text-3xl font-bold break-words">Join {info.teamName}</h1>
        <p className="mt-1 text-sm text-muted">
          {scout
            ? "You've been invited to help maintain this opponent profile. Claim a player slot to keep their notes up to date."
            : "Claim your player slot to fill in your champion pool, roles and playstyle. Your drafter uses it to suggest picks you're comfortable on."}
        </p>
      </header>

      {existing && (
        <Banner tone="neutral" action={<ButtonLink to={`/t/${encodeURIComponent(teamId)}`} size="sm">Open team</ButtonLink>}>
          This device already has <b className="text-text">{KEY_ROLE_LABEL[existing.role].toLowerCase()}</b> access to this team.
          {existing.role === "owner"
            ? " As owner you can already edit every player, so only join here if you also play on the team."
            : existing.role === "player"
              ? " Joining again switches this device to the new slot."
              : ""}
        </Banner>
      )}
      {info.locked && <Banner tone="warn">This team is locked. Ask the owner to unlock it before joining.</Banner>}
      {full && !info.locked && (
        <Banner tone="warn">This roster is full ({TEAM_LIMITS.players} players) and every slot is claimed. Ask the owner to free a slot.</Banner>
      )}

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={info.locked || busy} className="space-y-2">
            <legend className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Who are you?</legend>
            {info.openSlots.map((s) => (
              <SlotOption
                key={s.id}
                checked={choice === s.id}
                onSelect={() => setChoice(s.id)}
                label={s.name}
                hint={choice === s.id ? `You'll edit ${s.name}'s profile. Only pick this if it's you.` : "Claim this open slot if it's you"}
              />
            ))}
            {canCreate && (
              <SlotOption
                checked={isNew}
                onSelect={() => setChoice(NEW)}
                label={info.openSlots.length ? "I'm not listed" : "Add me to the roster"}
                hint="Creates a new player slot with your name"
              />
            )}
            {isNew && canCreate && (
              <div className="pt-1 pl-7">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={TEAM_LIMITS.playerName}
                  placeholder="Your name or in-game name"
                  aria-label="Your name"
                  autoFocus
                />
              </div>
            )}
          </fieldset>
          {error && <ErrorNote error={error} />}
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-faint">You'll get a personal link that's saved in this browser. You don't need an account.</p>
            <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit} className="sm:shrink-0 sm:whitespace-nowrap">
              {isNew ? "Join team" : slot ? `Claim ${slot.name}'s slot` : "Choose who you are"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function SlotOption({ checked, onSelect, label, hint }: { checked: boolean; onSelect: () => void; label: string; hint: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-accent/60 bg-accent/10" : "border-line bg-panel-2 hover:border-line-strong",
      )}
    >
      <input type="radio" name="slot" checked={checked} onChange={onSelect} className="size-4 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

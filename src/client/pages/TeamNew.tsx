// Create a team or an opponent (scout) profile, then show the one-time owner backup link.
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { CreateTeamRes } from "../../shared/api";
import { GAMES } from "../../shared/games";
import { GAME_IDS, type GameId, type TeamKind } from "../../shared/types";
import { PageHeader } from "../components/common";
import { useTitle } from "../components/useTitle";
import { saveTeamKey } from "../lib/keys";
import { errorMessage, inviteUrl, TEAM_LIMITS, teamApi, teamUrl } from "../lib/teams";
import { Button, Card, CopyField, cn, ErrorNote, Field, Input } from "../ui";

const parseGame = (v: string | null): GameId => (GAME_IDS.includes(v as GameId) ? (v as GameId) : "lol");
const parseKind = (v: string | null): TeamKind => (v === "scout" ? "scout" : "team");

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; hint: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            value === o.id ? "border-accent/70 bg-accent/10" : "border-line bg-panel-2 hover:border-line-strong",
          )}
        >
          <div className={cn("font-display font-semibold", value === o.id ? "text-accent" : "text-text")}>{o.label}</div>
          <div className="mt-0.5 text-xs text-muted">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

function OwnerLinkPanel({ created, onContinue }: { created: CreateTeamRes; onContinue: () => void }) {
  const [ack, setAck] = useState(false);
  const scout = created.team.kind === "scout";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow={<span className="text-good">{scout ? "Opponent profile created" : "Team created"}</span>}
        title={created.team.name}
        subtitle="One last thing before you continue — save your owner link."
      />
      <Card>
        <div className="space-y-4">
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            <p className="font-semibold">This link is the master key for {scout ? "this profile" : "your team"}.</p>
            <p className="mt-1 text-warn/90">
              Anyone who has it can edit or delete everything. It's saved in this browser, but there are no accounts yet — if you clear your browser data or switch
              devices, this link is the only way back in. Keep it in a password manager and never paste it in public channels.
            </p>
          </div>
          <CopyField label="Owner backup link" value={teamUrl(created.team.id, created.ownerKey)} />
          {!scout && (
            <div className="border-t border-line pt-4">
              <CopyField label="Invite link for your players (safe to share with the team)" value={inviteUrl(created.team.id, created.inviteCode)} />
              <p className="mt-1.5 text-xs text-faint">Players open it, claim their slot and fill in their own pool. You can find both links later in the team's Access tab.</p>
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm text-muted">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
            I've saved the owner link somewhere safe.
          </label>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!ack} onClick={onContinue}>
              Continue to {scout ? "profile" : "dashboard"} →
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function TeamNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [kind, setKind] = useState<TeamKind>(() => parseKind(params.get("kind")));
  const [game, setGame] = useState<GameId>(() => parseGame(params.get("game")));
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateTeamRes | null>(null);
  const scout = kind === "scout";
  useTitle(scout ? "Scout an opponent" : "Create a team");

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && trimmedName.length <= TEAM_LIMITS.teamName && tag.trim().length <= TEAM_LIMITS.tag;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await teamApi.create({ name: trimmedName, game, kind, tag: tag.trim() || undefined });
      saveTeamKey({ teamId: res.team.id, key: res.ownerKey, role: "owner", teamName: res.team.name, game: res.team.game, kind: res.team.kind }, true);
      setCreated(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) return <OwnerLinkPanel created={created} onContinue={() => navigate(`/t/${encodeURIComponent(created.team.id)}`)} />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={scout ? "Scout an opponent" : "Create your team"}
        subtitle={
          scout
            ? "Keep notes on a team you'll draft against — their players' pools, comfort picks and weaknesses — so suggestions can target them."
            : "Set up your roster once. Players fill in their own pools and preferences through an invite link."
        }
      />
      <Card>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold tracking-wider text-muted uppercase">Profile type</div>
            <Segmented
              label="Profile type"
              value={kind}
              onChange={setKind}
              options={[
                { id: "team", label: "My team", hint: "Your own roster and players." },
                { id: "scout", label: "Opponent profile", hint: "Scouting notes on another team." },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold tracking-wider text-muted uppercase">Game</div>
            <Segmented
              label="Game"
              value={game}
              onChange={setGame}
              options={GAME_IDS.map((g) => ({
                id: g,
                label: GAMES[g].name,
                hint: GAMES[g].roles.map((r) => r.short).join(" · "),
              }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field label={scout ? "Opponent name" : "Team name"} hint={`${trimmedName.length}/${TEAM_LIMITS.teamName}`}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={TEAM_LIMITS.teamName}
                placeholder={scout ? "e.g. Rival Esports" : "e.g. Midnight Wolves"}
                autoFocus
                required
              />
            </Field>
            <Field label="Tag" hint="Optional">
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value.toUpperCase())}
                maxLength={TEAM_LIMITS.tag}
                placeholder="WOLF"
                className="font-display tracking-wider uppercase"
              />
            </Field>
          </div>
          {error && <ErrorNote error={error} />}
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-faint">You'll get an owner link that controls this {scout ? "profile" : "team"}. No account needed.</p>
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
              {scout ? "Create profile" : "Create team"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// Player profile editor: roles, champion pool with comfort, playstyles, strengths/weaknesses, hated matchups, notes.
// Dirty tracking with Save/Discard and an unsaved-changes guard; read-only when the viewer can't edit this player.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { UpdatePlayerReq } from "../../shared/api";
import { GAMES, PLAYSTYLES, roleIds, TRAITS } from "../../shared/games";
import type { AvoidEntry, GameId, PlayerProfile, PoolEntry, Principal, Role, RolePrefLevel, TeamProfile } from "../../shared/types";
import { GameBadge } from "../components/badges";
import { ChampionPickerModal } from "../components/ChampionPicker";
import { Banner, ButtonLink, Chip } from "../components/common";
import { fullDate, timeAgo } from "../components/format";
import { useTitle } from "../components/useTitle";
import { RoleIcon } from "../components/RoleIcon";
import { TeamGate } from "../components/TeamGate";
import { useUnsavedChangesGuard } from "../components/UnsavedGuard";
import { useGameData, type GameData } from "../lib/gameData";
import { canEditPlayer, editBlockReason, errorMessage, TEAM_LIMITS, teamApi, useTeam, type UseTeam } from "../lib/teams";
import { Badge, Button, Card, ChampIcon, cn, EmptyState, Input, Stars, Textarea } from "../ui";

// ---- Form model ------------------------------------------------------------------

interface PoolRow {
  championId: string;
  comfort: PoolEntry["comfort"];
  roles: Role[];
  note: string;
}
interface AvoidRow {
  championId: string;
  severity: AvoidEntry["severity"];
  note: string;
}
interface PlayerForm {
  name: string;
  roles: Partial<Record<Role, RolePrefLevel>>;
  pool: PoolRow[];
  playstyles: string[];
  strengths: string[];
  weaknesses: string[];
  avoid: AvoidRow[];
  notes: string;
}

const PLAYSTYLE_ORDER = new Map(PLAYSTYLES.map((p, i) => [p.id, i]));
const TRAIT_ORDER = new Map(TRAITS.map((t, i) => [t.id, i]));
/** Canonical order (definition order; unknown ids last) so toggling on/off never reads as a change. */
const ordered = (ids: string[], order: Map<string, number>) => [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));

function fromPlayer(p: PlayerProfile, game: GameId): PlayerForm {
  const valid = new Set(roleIds(game));
  const roles: Partial<Record<Role, RolePrefLevel>> = {};
  for (const r of p.roles) if (valid.has(r.role)) roles[r.role] = r.pref;
  return {
    name: p.name,
    roles,
    pool: p.pool.map((e) => ({ championId: e.championId, comfort: e.comfort, roles: (e.roles ?? []).filter((r) => valid.has(r)), note: e.note ?? "" })),
    playstyles: ordered(p.playstyles, PLAYSTYLE_ORDER),
    strengths: ordered(p.strengths, TRAIT_ORDER),
    weaknesses: ordered(p.weaknesses, TRAIT_ORDER),
    avoid: p.avoid.map((a) => ({ championId: a.championId, severity: a.severity, note: a.note ?? "" })),
    notes: p.notes,
  };
}

/** Builds the PUT body. The server schema is strict, so only contract fields are sent. */
function toRequest(f: PlayerForm, game: GameId): Required<UpdatePlayerReq> {
  const order = roleIds(game);
  return {
    name: f.name.trim(),
    roles: order.filter((r) => f.roles[r]).map((r) => ({ role: r, pref: f.roles[r] as RolePrefLevel })),
    pool: f.pool.map((e) => {
      const entry: PoolEntry = { championId: e.championId, comfort: e.comfort };
      const roles = order.filter((r) => e.roles.includes(r));
      if (roles.length) entry.roles = roles;
      const note = e.note.trim();
      if (note) entry.note = note;
      return entry;
    }),
    playstyles: ordered(f.playstyles, PLAYSTYLE_ORDER),
    strengths: ordered(f.strengths, TRAIT_ORDER),
    weaknesses: ordered(f.weaknesses, TRAIT_ORDER),
    avoid: f.avoid.map((a) => {
      const entry: AvoidEntry = { championId: a.championId, severity: a.severity };
      const note = a.note.trim();
      if (note) entry.note = note;
      return entry;
    }),
    notes: f.notes.trimEnd(),
  };
}

function validate(f: PlayerForm, team: TeamProfile, playerId: string): string | null {
  const name = f.name.trim();
  if (!name) return "Name is required.";
  if (name.length > TEAM_LIMITS.playerName) return `Name must be ${TEAM_LIMITS.playerName} characters or fewer.`;
  const key = name.toLowerCase();
  if (team.players.some((p) => p.id !== playerId && p.name.trim().toLowerCase() === key)) return `Another player is already called “${name}”.`;
  if (f.pool.length > TEAM_LIMITS.pool) return `At most ${TEAM_LIMITS.pool} champions in the pool.`;
  if (f.avoid.length > TEAM_LIMITS.avoid) return `At most ${TEAM_LIMITS.avoid} hated matchups.`;
  if (f.notes.length > TEAM_LIMITS.notes) return `Notes must be ${TEAM_LIMITS.notes} characters or fewer.`;
  if (f.pool.some((e) => e.note.length > TEAM_LIMITS.note) || f.avoid.some((a) => a.note.length > TEAM_LIMITS.note)) return "A note is too long.";
  return null;
}

const COMFORT_LABEL = ["", "Can play", "Okay", "Comfortable", "Strong", "Signature"];
const SEVERITY_LABEL = ["", "Dislike", "Struggle", "Hate / auto-lose"];
const PREF_OPTIONS: { id: RolePrefLevel | null; label: string; title: string }[] = [
  { id: "main", label: "Main", title: "Main role" },
  { id: "secondary", label: "2nd", title: "Secondary role" },
  { id: "fill", label: "Fill", title: "Can fill if needed" },
  { id: null, label: "—", title: "Doesn't play this role" },
];

// ---- Page --------------------------------------------------------------------------

export function PlayerEditor() {
  const { teamId = "", playerId = "" } = useParams();
  const state = useTeam(teamId || undefined);
  return <TeamGate state={state}>{({ team, you }) => <EditorGate key={playerId} state={state} team={team} you={you} playerId={playerId} />}</TeamGate>;
}

function EditorGate({ state, team, you, playerId }: { state: UseTeam; team: TeamProfile; you: Principal; playerId: string }) {
  const player = team.players.find((p) => p.id === playerId);
  useTitle(player ? `${player.name} · ${team.name}` : team.name);
  if (!player) {
    return (
      <EmptyState title="Player not found" action={<ButtonLink to={`/t/${encodeURIComponent(team.id)}`}>Back to {team.name}</ButtonLink>}>
        This player isn't on the roster anymore. The owner may have removed them.
      </EmptyState>
    );
  }
  return <Editor state={state} team={team} you={you} player={player} />;
}

function Editor({ state, team, you, player }: { state: UseTeam; team: TeamProfile; you: Principal; player: PlayerProfile }) {
  const game = team.game;
  const { data, error: dataError } = useGameData(game);
  const canEdit = canEditPlayer(team, you, player.id);
  const blockReason = editBlockReason(team, you, player.id);
  const isYou = you.kind === "player" && you.playerId === player.id;
  const scout = team.kind === "scout";
  const unit = GAMES[game].unit;

  const [base, setBase] = useState(() => fromPlayer(player, game));
  const [form, setForm] = useState(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [picker, setPicker] = useState<"pool" | "avoid" | null>(null);

  const baseJson = useMemo(() => JSON.stringify(toRequest(base, game)), [base, game]);
  const formJson = useMemo(() => JSON.stringify(toRequest(form, game)), [form, game]);
  const dirty = canEdit && formJson !== baseJson;
  const invalid = dirty ? validate(form, team, player.id) : null;
  const guard = useUnsavedChangesGuard(dirty);

  // Adopt server changes (another tab, owner edits, reverts) while there are no local edits.
  useEffect(() => {
    if (dirty) return;
    const b = fromPlayer(player, game);
    setBase(b);
    setForm(b);
    // Deliberately keyed on the server copy only (not on `dirty`).
  }, [player.updatedAt, player.id, game]);

  // Losing edit rights (e.g. the team got locked) drops local edits so the read-only view shows the saved profile.
  useEffect(() => {
    if (!canEdit) setForm(base);
  }, [canEdit, base]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const set = <K extends keyof PlayerForm>(k: K, v: PlayerForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!dirty || invalid || saving || !state.key) return;
    setSaving(true);
    setError(null);
    try {
      const res = await teamApi.updatePlayer(team.id, state.key, player.id, toRequest(form, game));
      const updated = res.team.players.find((p) => p.id === player.id);
      if (updated) {
        const b = fromPlayer(updated, game);
        setBase(b);
        setForm(b);
      }
      state.setTeam(res.team);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const poolIds = useMemo(() => new Set(form.pool.map((e) => e.championId)), [form.pool]);
  const avoidIds = useMemo(() => new Set(form.avoid.map((a) => a.championId)), [form.avoid]);
  const poolFull = form.pool.length >= TEAM_LIMITS.pool;
  const avoidFull = form.avoid.length >= TEAM_LIMITS.avoid;
  const blockedWhenFull = (ids: Set<string>, full: boolean) =>
    full && data ? new Set(data.champions.filter((c) => !ids.has(c.id)).map((c) => c.id)) : undefined;

  const togglePool = (id: string) =>
    setForm((f) =>
      f.pool.some((e) => e.championId === id)
        ? { ...f, pool: f.pool.filter((e) => e.championId !== id) }
        : f.pool.length >= TEAM_LIMITS.pool
          ? f
          : { ...f, pool: [...f.pool, { championId: id, comfort: 3, roles: [], note: "" }] },
    );
  const toggleAvoid = (id: string) =>
    setForm((f) =>
      f.avoid.some((a) => a.championId === id)
        ? { ...f, avoid: f.avoid.filter((a) => a.championId !== id) }
        : f.avoid.length >= TEAM_LIMITS.avoid
          ? f
          : { ...f, avoid: [...f.avoid, { championId: id, severity: 2, note: "" }] },
    );
  const updatePool = (id: string, patch: Partial<PoolRow>) => set("pool", form.pool.map((e) => (e.championId === id ? { ...e, ...patch } : e)));
  const updateAvoid = (id: string, patch: Partial<AvoidRow>) => set("avoid", form.avoid.map((a) => (a.championId === id ? { ...a, ...patch } : a)));
  const toggleIn = (list: string[], id: string, order: Map<string, number>) => (list.includes(id) ? list.filter((x) => x !== id) : ordered([...list, id], order));

  const teamHref = `/t/${encodeURIComponent(team.id)}`;
  const displayName = form.name.trim() || player.name;

  return (
    <div className="pb-4">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Link to={teamHref} className="text-muted hover:text-text">
            ← {team.name}
          </Link>
          <GameBadge game={game} />
          {scout && <Badge tone="warn">Opponent</Badge>}
        </div>
        <h1 className="font-display text-2xl font-bold break-words sm:text-3xl">{displayName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {isYou && <Badge tone="accent">You</Badge>}
          {player.claimed ? <Badge tone="good">Linked</Badge> : <Badge>Open slot</Badge>}
          <span title={fullDate(player.updatedAt)}>Updated {timeAgo(player.updatedAt)}</span>
        </p>
      </header>

      {blockReason && (
        <div className="mb-5">
          <Banner tone={team.locked && isYou ? "warn" : "neutral"} action={<ButtonLink to={teamHref} size="sm">Back to team</ButtonLink>}>
            <b className="text-text">Read-only.</b> {blockReason}
          </Banner>
        </div>
      )}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        {/* Main column (desktop). On mobile, `contents` lets the cards interleave with the side column via `order`. */}
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <Card
            className="order-2"
            title={`${scout ? "Their " : ""}${unit} pool · ${form.pool.length}`}
            actions={
              canEdit && (
                <div className="flex gap-2">
                  {form.pool.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => set("pool", [...form.pool].sort((a, b) => b.comfort - a.comfort))}>
                      Sort
                    </Button>
                  )}
                  <Button size="sm" variant="primary" onClick={() => setPicker("pool")}>
                    + Add
                  </Button>
                </div>
              )
            }
          >
            <p className="mb-3 text-xs text-muted">
              Comfort: 1 = can play it · 3 = comfortable · 5 = signature. Tag roles only if {scout ? "they play" : "you play"} a {unit.toLowerCase()} somewhere unusual.
            </p>
            {form.pool.length === 0 ? (
              <EmptyRow>{canEdit ? `Add the ${GAMES[game].unitPlural.toLowerCase()} ${scout ? "they" : "you"} play.` : "No pool yet."}</EmptyRow>
            ) : (
              <ul className="space-y-2">
                {form.pool.map((e) => (
                  <PoolItem key={e.championId} game={game} data={data} row={e} readOnly={!canEdit} onChange={(p) => updatePool(e.championId, p)} onRemove={() => togglePool(e.championId)} />
                ))}
              </ul>
            )}
          </Card>

          <Card
            className="order-4"
            title={`${scout ? "Struggles against" : "Hate to play against"} · ${form.avoid.length}`}
            actions={
              canEdit && (
                <Button size="sm" onClick={() => setPicker("avoid")}>
                  + Add
                </Button>
              )
            }
          >
            <p className="mb-3 text-xs text-muted">
              {scout
                ? `${unit}s this player struggles into. Suggestions lean toward picking them.`
                : `${unit}s you'd rather not face. Suggestions lean toward banning them and avoid picks that leave you exposed.`}
            </p>
            {form.avoid.length === 0 ? (
              <EmptyRow>{canEdit ? "Nothing yet." : "None listed."}</EmptyRow>
            ) : (
              <ul className="space-y-2">
                {form.avoid.map((a) => (
                  <AvoidItem key={a.championId} data={data} row={a} readOnly={!canEdit} onChange={(p) => updateAvoid(a.championId, p)} onRemove={() => toggleAvoid(a.championId)} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <Card className="order-1" title="Profile">
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold tracking-wider text-muted uppercase">Name</span>
                <Input value={form.name} maxLength={TEAM_LIMITS.playerName} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} />
              </label>
              <div>
                <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">Roles</div>
                <ul className="space-y-1.5">
                  {GAMES[game].roles.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <RoleIcon game={game} role={r.id} className={cn("size-4", form.roles[r.id] ? "text-accent" : "text-faint")} />
                        <span className="truncate">{r.label}</span>
                      </span>
                      <RolePrefControl value={form.roles[r.id] ?? null} disabled={!canEdit} onChange={(v) => {
                        const roles = { ...form.roles };
                        if (v) roles[r.id] = v;
                        else delete roles[r.id];
                        set("roles", roles);
                      }} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <Card className="order-3" title="Playstyle">
            <div className="flex flex-wrap gap-1.5">
              {PLAYSTYLES.map((p) => (
                <Chip
                  key={p.id}
                  active={form.playstyles.includes(p.id)}
                  tone="blue"
                  title={p.description}
                  onClick={canEdit ? () => set("playstyles", toggleIn(form.playstyles, p.id, PLAYSTYLE_ORDER)) : undefined}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
            {form.playstyles.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs text-faint">
                {PLAYSTYLES.filter((p) => form.playstyles.includes(p.id)).map((p) => (
                  <li key={p.id}>
                    <span className="text-muted">{p.label}:</span> {p.description}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-1.5 text-xs font-semibold tracking-wider text-good uppercase">Strengths</div>
              <div className="flex flex-wrap gap-1.5">
                {TRAITS.map((t) => {
                  const other = form.weaknesses.includes(t.id);
                  return (
                    <Chip
                      key={t.id}
                      active={form.strengths.includes(t.id)}
                      tone="good"
                      disabled={other}
                      title={other ? `${t.label} is marked as a weakness` : t.description}
                      onClick={canEdit ? () => set("strengths", toggleIn(form.strengths, t.id, TRAIT_ORDER)) : undefined}
                    >
                      {t.label}
                    </Chip>
                  );
                })}
              </div>
              <div className="mt-4 mb-1.5 text-xs font-semibold tracking-wider text-bad uppercase">Weaknesses</div>
              <div className="flex flex-wrap gap-1.5">
                {TRAITS.map((t) => {
                  const other = form.strengths.includes(t.id);
                  return (
                    <Chip
                      key={t.id}
                      active={form.weaknesses.includes(t.id)}
                      tone="bad"
                      disabled={other}
                      title={other ? `${t.label} is marked as a strength` : t.description}
                      onClick={canEdit ? () => set("weaknesses", toggleIn(form.weaknesses, t.id, TRAIT_ORDER)) : undefined}
                    >
                      {t.label}
                    </Chip>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card className="order-5" title="Notes">
            <Textarea
              value={form.notes}
              maxLength={TEAM_LIMITS.notes}
              rows={5}
              disabled={!canEdit}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={canEdit ? (scout ? "Habits, tells, what tilts them…" : "Anything the drafter should know, like comfort picks for stage or champs you're practicing…") : ""}
            />
            <div className="mt-1 text-right text-xs text-faint">
              {form.notes.length}/{TEAM_LIMITS.notes}
            </div>
          </Card>
        </div>
      </div>

      {canEdit && (dirty || error || saved) && (
        <div className="sticky bottom-3 z-30 mt-5 flex flex-col gap-2 rounded-xl border border-line-strong bg-panel-2/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {error ? (
              <span className="text-bad">{error}</span>
            ) : invalid ? (
              <span className="text-warn">{invalid}</span>
            ) : dirty ? (
              <span className="text-muted">Unsaved changes.</span>
            ) : (
              <span className="text-good">Saved.</span>
            )}
          </div>
          {dirty && (
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => setForm(base)} disabled={saving}>
                Discard
              </Button>
              <Button variant="primary" onClick={save} loading={saving} disabled={!!invalid}>
                Save changes
              </Button>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <ChampionPickerModal
            open={picker === "pool"}
            onClose={() => setPicker(null)}
            title={`${unit} pool`}
            multi
            game={game}
            data={data}
            error={dataError}
            selected={poolIds}
            disabled={blockedWhenFull(poolIds, poolFull)}
            disabledReason={`pool is full (${TEAM_LIMITS.pool} max)`}
            onPick={togglePool}
            footer={`${form.pool.length} in pool · click to add or remove`}
          />
          <ChampionPickerModal
            open={picker === "avoid"}
            onClose={() => setPicker(null)}
            title={scout ? "Struggles against" : "Hate to play against"}
            multi
            game={game}
            data={data}
            error={dataError}
            selected={avoidIds}
            disabled={blockedWhenFull(avoidIds, avoidFull)}
            disabledReason={`list is full (${TEAM_LIMITS.avoid} max)`}
            onPick={toggleAvoid}
            footer={`${form.avoid.length} selected · click to add or remove`}
          />
        </>
      )}
      {guard.modal}
    </div>
  );
}

// ---- Pieces --------------------------------------------------------------------------

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-faint">{children}</p>;
}

function RolePrefControl({ value, onChange, disabled }: { value: RolePrefLevel | null; onChange: (v: RolePrefLevel | null) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" className="flex shrink-0 rounded-md border border-line bg-panel-2 p-0.5">
      {PREF_OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              "h-7 min-w-10 rounded px-2 text-xs font-semibold transition-colors",
              active
                ? o.id === "main"
                  ? "bg-accent/20 text-accent"
                  : o.id === "secondary"
                    ? "bg-blue/20 text-blue"
                    : o.id === "fill"
                      ? "bg-panel-3 text-text"
                      : "bg-panel-3 text-muted"
                : "text-faint hover:text-text",
              disabled && "cursor-default hover:text-faint",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PoolItem({
  game,
  data,
  row,
  readOnly,
  onChange,
  onRemove,
}: {
  game: GameId;
  data: GameData | null;
  row: PoolRow;
  readOnly: boolean;
  onChange: (patch: Partial<PoolRow>) => void;
  onRemove: () => void;
}) {
  const champ = data?.byId.get(row.championId);
  const champRoles = new Set(champ?.roles ?? []);
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-panel-2/60 p-2.5">
      <ChampIcon champ={champ} size={44} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="truncate font-semibold">{champ?.name ?? row.championId}</span>
          <span className="flex items-center gap-2">
            <Stars value={row.comfort} onChange={readOnly ? undefined : (v) => onChange({ comfort: v as PoolRow["comfort"] })} />
            <span className="hidden w-20 text-xs text-muted sm:inline">{COMFORT_LABEL[row.comfort]}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Roles for this champion">
          {GAMES[game].roles.map((r) => {
            const on = row.roles.includes(r.id);
            const usual = champRoles.has(r.id);
            if (readOnly && !on) return null;
            return (
              <button
                key={r.id}
                type="button"
                disabled={readOnly}
                aria-pressed={on}
                title={`${r.label}${usual ? " (usual role)" : ""}`}
                onClick={() => onChange({ roles: on ? row.roles.filter((x) => x !== r.id) : [...row.roles, r.id] })}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] font-semibold transition-colors",
                  on ? "border-accent/60 bg-accent/15 text-accent" : usual ? "border-dashed border-line-strong text-muted hover:text-text" : "border-line text-faint hover:text-muted",
                )}
              >
                <RoleIcon game={game} role={r.id} className="size-3" />
                {r.short}
              </button>
            );
          })}
          {row.roles.length === 0 && <span className="text-[10px] text-faint">{readOnly ? "Usual roles" : "auto"}</span>}
        </div>
        {readOnly ? (
          row.note && <p className="text-xs text-muted">{row.note}</p>
        ) : (
          <Input
            value={row.note}
            maxLength={TEAM_LIMITS.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Note (optional)"
            aria-label={`Note for ${champ?.name ?? row.championId}`}
            className="h-8 text-xs"
          />
        )}
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="self-start rounded p-1 text-faint hover:bg-panel-3 hover:text-bad"
          aria-label={`Remove ${champ?.name ?? row.championId}`}
          title="Remove"
        >
          ✕
        </button>
      )}
    </li>
  );
}

function AvoidItem({
  data,
  row,
  readOnly,
  onChange,
  onRemove,
}: {
  data: GameData | null;
  row: AvoidRow;
  readOnly: boolean;
  onChange: (patch: Partial<AvoidRow>) => void;
  onRemove: () => void;
}) {
  const champ = data?.byId.get(row.championId);
  return (
    <li className="flex gap-3 rounded-lg border border-bad/20 bg-bad/5 p-2.5">
      <ChampIcon champ={champ} size={40} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="truncate font-semibold">{champ?.name ?? row.championId}</span>
          <span className="flex items-center gap-2">
            <Stars value={row.severity} max={3} color="bad" onChange={readOnly ? undefined : (v) => onChange({ severity: v as AvoidRow["severity"] })} />
            <span className="w-24 text-xs text-muted">{SEVERITY_LABEL[row.severity]}</span>
          </span>
        </div>
        {readOnly ? (
          row.note && <p className="text-xs text-muted">{row.note}</p>
        ) : (
          <Input
            value={row.note}
            maxLength={TEAM_LIMITS.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Why? (optional)"
            aria-label={`Note for ${champ?.name ?? row.championId}`}
            className="h-8 text-xs"
          />
        )}
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="self-start rounded p-1 text-faint hover:bg-panel-3 hover:text-bad"
          aria-label={`Remove ${champ?.name ?? row.championId}`}
          title="Remove"
        >
          ✕
        </button>
      )}
    </li>
  );
}

/** Loaded-state view (exported for render smoke tests). */
export { Editor as PlayerEditorView };

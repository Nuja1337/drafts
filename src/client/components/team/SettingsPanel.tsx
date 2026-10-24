// Settings tab: name/tag/notes, preferred & avoided archetypes, matchup overrides, danger zone.
// Owners edit (dirty tracking + unsaved guard); everyone else sees a read-only summary.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { UpdateTeamReq } from "../../../shared/api";
import { ARCHETYPE_DEFS, GAMES } from "../../../shared/games";
import type { Archetype, TeamOverride, TeamProfile } from "../../../shared/types";
import type { GameData } from "../../lib/gameData";
import { forgetTeam } from "../../lib/keys";
import { errorMessage, TEAM_LIMITS, teamApi } from "../../lib/teams";
import { Button, Card, ChampIcon, Field, Input, Slider, Textarea } from "../../ui";
import { ChampionSelect } from "../ChampionPicker";
import { Chip, Pill } from "../common";
import { ConfirmModal } from "../ConfirmModal";
import { signed } from "../format";
import { useUnsavedChangesGuard } from "../UnsavedGuard";

interface OverrideRow {
  rowId: number;
  a: string | null;
  b: string | null;
  adv: number;
  note: string;
}

interface SettingsForm {
  name: string;
  tag: string;
  notes: string;
  preferred: Archetype[];
  avoid: Archetype[];
  overrides: OverrideRow[];
}

let nextRowId = 1;
const newRow = (o?: TeamOverride): OverrideRow => ({ rowId: nextRowId++, a: o?.a ?? null, b: o?.b ?? null, adv: o?.adv ?? 0, note: o?.note ?? "" });

const fromTeam = (t: TeamProfile): SettingsForm => ({
  name: t.name,
  tag: t.tag,
  notes: t.notes,
  preferred: [...t.preferredArchetypes],
  avoid: [...t.avoidArchetypes],
  overrides: t.overrides.map(newRow),
});

const toOverrides = (rows: OverrideRow[]): TeamOverride[] =>
  rows.map((r) => {
    const o: TeamOverride = { a: r.a ?? "", b: r.b ?? "", adv: Math.round(r.adv * 100) / 100 };
    const note = r.note.trim();
    if (note) o.note = note;
    return o;
  });

/** Comparable snapshot (row ids and whitespace-only differences ignored). */
const snapshot = (f: SettingsForm) =>
  JSON.stringify({
    name: f.name.trim(),
    tag: f.tag.trim(),
    notes: f.notes.trimEnd(),
    preferred: f.preferred,
    avoid: f.avoid,
    overrides: toOverrides(f.overrides),
  });

function validate(f: SettingsForm): string | null {
  const name = f.name.trim();
  if (!name) return "Name is required.";
  if (name.length > TEAM_LIMITS.teamName) return `Name must be ${TEAM_LIMITS.teamName} characters or fewer.`;
  if (f.tag.trim().length > TEAM_LIMITS.tag) return `Tag must be ${TEAM_LIMITS.tag} characters or fewer.`;
  if (f.notes.length > TEAM_LIMITS.notes) return `Notes must be ${TEAM_LIMITS.notes} characters or fewer.`;
  if (f.overrides.length > TEAM_LIMITS.overrides) return `At most ${TEAM_LIMITS.overrides} matchup overrides.`;
  const seen = new Set<string>();
  for (const [i, r] of f.overrides.entries()) {
    if (!r.a || !r.b) return `Matchup override ${i + 1}: choose both sides.`;
    if (r.a === r.b) return `Matchup override ${i + 1}: pick two different champions.`;
    const pair = [r.a, r.b].sort().join("|");
    if (seen.has(pair)) return `Matchup override ${i + 1} duplicates another override for the same pair.`;
    seen.add(pair);
    if (r.note.length > TEAM_LIMITS.note) return `Matchup override ${i + 1}: note is too long.`;
  }
  return null;
}

function ArchetypeChips({
  game,
  value,
  other,
  onChange,
  tone,
  otherLabel,
}: {
  game: TeamProfile["game"];
  value: Archetype[];
  other: Archetype[];
  onChange?: (v: Archetype[]) => void;
  tone: "good" | "bad";
  otherLabel: string;
}) {
  const defs = ARCHETYPE_DEFS.filter((d) => d.games.includes(game));
  return (
    <div className="flex flex-wrap gap-1.5">
      {defs.map((d) => {
        const active = value.includes(d.id);
        const blocked = !active && other.includes(d.id);
        return (
          <Chip
            key={d.id}
            active={active}
            tone={tone}
            disabled={blocked}
            title={blocked ? `Already marked as ${otherLabel}` : d.description}
            onClick={onChange ? () => onChange(active ? value.filter((x) => x !== d.id) : [...value, d.id]) : undefined}
          >
            {d.label}
          </Chip>
        );
      })}
    </div>
  );
}

function OverrideEditorRow({
  row,
  game,
  data,
  onChange,
  onRemove,
}: {
  row: OverrideRow;
  game: TeamProfile["game"];
  data: GameData | null;
  onChange: (r: OverrideRow) => void;
  onRemove: () => void;
}) {
  const nameA = row.a ? (data?.byId.get(row.a)?.name ?? row.a) : "A";
  const nameB = row.b ? (data?.byId.get(row.b)?.name ?? row.b) : "B";
  const verdict = Math.abs(row.adv) < 0.05 ? "Even matchup" : row.adv > 0 ? `${nameA} favored` : `${nameB} favored`;
  return (
    <li className="rounded-lg border border-line bg-panel-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChampionSelect game={game} data={data} value={row.a} onChange={(a) => onChange({ ...row, a })} label="Champion A" exclude={row.b ? new Set([row.b]) : undefined} />
        <span className="font-display text-xs font-bold text-faint">VS</span>
        <ChampionSelect game={game} data={data} value={row.b} onChange={(b) => onChange({ ...row, b })} label="Champion B" exclude={row.a ? new Set([row.a]) : undefined} />
        <button type="button" onClick={onRemove} className="ml-auto rounded-md px-2 py-1 text-xs text-faint hover:bg-panel-3 hover:text-bad" aria-label="Remove override">
          Remove
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
        <div>
          <Slider value={row.adv} min={-1} max={1} step={0.1} onChange={(adv) => onChange({ ...row, adv })} />
          <div className="mt-0.5 flex justify-between text-[11px] text-faint">
            <span>{nameB} wins</span>
            <span className={row.adv > 0.05 ? "text-good" : row.adv < -0.05 ? "text-bad" : "text-muted"}>{verdict}</span>
            <span>{nameA} wins</span>
          </div>
        </div>
        <Input value={row.note} maxLength={TEAM_LIMITS.note} onChange={(e) => onChange({ ...row, note: e.target.value })} placeholder="Why? (optional)" aria-label="Override note" />
      </div>
    </li>
  );
}

function ReadOnlySettings({ team, data }: { team: TeamProfile; data: GameData | null }) {
  const name = (id: string) => data?.byId.get(id)?.name ?? id;
  const label = (id: Archetype) => ARCHETYPE_DEFS.find((d) => d.id === id)?.label ?? id;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Notes">
        {team.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{team.notes}</p> : <p className="text-sm text-faint">No team notes.</p>}
      </Card>
      <Card title="Game plan">
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs text-faint">Preferred styles</div>
            <div className="flex flex-wrap gap-1">
              {team.preferredArchetypes.length ? team.preferredArchetypes.map((a) => <Pill key={a} tone="good">{label(a)}</Pill>) : <span className="text-faint">None set</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-faint">Styles to avoid</div>
            <div className="flex flex-wrap gap-1">
              {team.avoidArchetypes.length ? team.avoidArchetypes.map((a) => <Pill key={a} tone="bad">{label(a)}</Pill>) : <span className="text-faint">None set</span>}
            </div>
          </div>
        </div>
      </Card>
      <Card title={`Matchup overrides · ${team.overrides.length}`} className="lg:col-span-2">
        {team.overrides.length ? (
          <ul className="divide-y divide-line">
            {team.overrides.map((o) => (
              <li key={`${o.a}>${o.b}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <ChampIcon champ={data?.byId.get(o.a)} size={28} />
                <span>{name(o.a)}</span>
                <span className="text-xs text-faint">vs</span>
                <ChampIcon champ={data?.byId.get(o.b)} size={28} />
                <span>{name(o.b)}</span>
                <span className={o.adv > 0 ? "font-semibold text-good" : o.adv < 0 ? "font-semibold text-bad" : "text-muted"}>{signed(o.adv, 1)}</span>
                {o.note && <span className="w-full text-xs text-muted sm:w-auto">{o.note}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">No overrides. The dataset's matchups are used as-is.</p>
        )}
      </Card>
    </div>
  );
}

export function SettingsPanel({
  team,
  ownerKey,
  data,
  onTeam,
}: {
  team: TeamProfile;
  /** Null for non-owners (read-only view). */
  ownerKey: string | null;
  data: GameData | null;
  onTeam: (t: TeamProfile) => void;
}) {
  if (!ownerKey) return <ReadOnlySettings team={team} data={data} />;
  return <OwnerSettings team={team} ownerKey={ownerKey} data={data} onTeam={onTeam} />;
}

function OwnerSettings({ team, ownerKey, data, onTeam }: { team: TeamProfile; ownerKey: string; data: GameData | null; onTeam: (t: TeamProfile) => void }) {
  const navigate = useNavigate();
  const [base, setBase] = useState(() => fromTeam(team));
  const [form, setForm] = useState(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = useMemo(() => snapshot(form) !== snapshot(base), [form, base]);
  const invalid = dirty ? validate(form) : null;
  const guard = useUnsavedChangesGuard(dirty);
  const scout = team.kind === "scout";
  const unit = GAMES[team.game].unit.toLowerCase();

  // Pick up changes made elsewhere (reverts, other tabs) while there are no local edits. Runs only on new server data.
  useEffect(() => {
    if (dirty) return;
    const b = fromTeam(team);
    setBase(b);
    setForm(b);
  }, [team]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (row: OverrideRow) => set("overrides", form.overrides.map((r) => (r.rowId === row.rowId ? row : r)));

  const save = async () => {
    if (!dirty || invalid || saving) return;
    const req: UpdateTeamReq = {};
    const name = form.name.trim();
    const tag = form.tag.trim();
    const notes = form.notes.trimEnd();
    if (name !== base.name) req.name = name;
    if (tag !== base.tag) req.tag = tag;
    if (notes !== base.notes) req.notes = notes;
    if (JSON.stringify(form.preferred) !== JSON.stringify(base.preferred)) req.preferredArchetypes = form.preferred;
    if (JSON.stringify(form.avoid) !== JSON.stringify(base.avoid)) req.avoidArchetypes = form.avoid;
    const overrides = toOverrides(form.overrides);
    if (JSON.stringify(overrides) !== JSON.stringify(toOverrides(base.overrides))) req.overrides = overrides;
    setSaving(true);
    setError(null);
    try {
      const res = await teamApi.update(team.id, ownerKey, req);
      const b = fromTeam(res.team);
      setBase(b);
      setForm(b);
      onTeam(res.team);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Profile">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label={scout ? "Opponent name" : "Team name"}>
                <Input value={form.name} maxLength={TEAM_LIMITS.teamName} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Tag">
                <Input
                  value={form.tag}
                  maxLength={TEAM_LIMITS.tag}
                  onChange={(e) => set("tag", e.target.value.toUpperCase())}
                  className="font-display tracking-wider uppercase"
                />
              </Field>
            </div>
            <Field label="Notes" hint={`${form.notes.length}/${TEAM_LIMITS.notes} · Visible to everyone with a link to this ${scout ? "profile" : "team"}.`}>
              <Textarea
                value={form.notes}
                maxLength={TEAM_LIMITS.notes}
                rows={5}
                onChange={(e) => set("notes", e.target.value)}
                placeholder={scout ? "Tendencies, favourite comps, who shotcalls…" : "Game plan, shotcalling, comfort comps…"}
              />
            </Field>
          </div>
        </Card>

        <Card title="Game plan">
          <div className="space-y-5">
            <div>
              <div className="mb-1 text-sm font-semibold">{scout ? "Comps they like" : "Comps we want"}</div>
              <p className="mb-2 text-xs text-muted">Suggestions lean toward {unit}s that build these win conditions.</p>
              <ArchetypeChips game={team.game} value={form.preferred} other={form.avoid} onChange={(v) => set("preferred", v)} tone="good" otherLabel="avoided" />
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">{scout ? "Comps they struggle with" : "Comps we avoid"}</div>
              <p className="mb-2 text-xs text-muted">Styles {scout ? "they don't play well" : "your team doesn't play well"}.</p>
              <ArchetypeChips game={team.game} value={form.avoid} other={form.preferred} onChange={(v) => set("avoid", v)} tone="bad" otherLabel="preferred" />
            </div>
          </div>
        </Card>
      </div>

      <Card
        title={`Matchup overrides · ${form.overrides.length}`}
        actions={
          <Button size="sm" onClick={() => set("overrides", [...form.overrides, newRow()])} disabled={form.overrides.length >= TEAM_LIMITS.overrides}>
            + Add override
          </Button>
        }
      >
        <p className="mb-3 text-xs text-muted">
          If you disagree with the data, set how {scout ? "this team" : "your team"} rates a matchup by sliding toward the {unit} that wins it. Overrides replace the
          dataset's value in suggestions for {scout ? "this profile" : "your team"}.
        </p>
        {form.overrides.length ? (
          <ul className="space-y-2">
            {form.overrides.map((r) => (
              <OverrideEditorRow
                key={r.rowId}
                row={r}
                game={team.game}
                data={data}
                onChange={setRow}
                onRemove={() => set("overrides", form.overrides.filter((x) => x.rowId !== r.rowId))}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-faint">No overrides yet.</p>
        )}
      </Card>

      {/* Save bar: sticks to the bottom of the viewport while there are edits. */}
      <div
        className={
          dirty || error || saved
            ? "sticky bottom-3 z-30 flex flex-col gap-2 rounded-xl border border-line-strong bg-panel-2/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between"
            : "hidden"
        }
      >
        <div className="min-w-0 text-sm">
          {error ? (
            <span className="text-bad">{error}</span>
          ) : invalid ? (
            <span className="text-warn">{invalid}</span>
          ) : dirty ? (
            <span className="text-muted">You have unsaved changes.</span>
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

      <section className="rounded-xl border border-bad/40 bg-bad/5 p-4">
        <h3 className="font-display font-semibold text-bad">Danger zone</h3>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Permanently delete this {scout ? "profile" : "team"}, its players and activity log. Every link stops working. This can't be undone.
          </p>
          <Button variant="danger" className="shrink-0" onClick={() => setDeleting(true)}>
            Delete {scout ? "profile" : "team"}
          </Button>
        </div>
      </section>

      <ConfirmModal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${team.name}?`}
        confirmLabel={`Delete ${scout ? "profile" : "team"} forever`}
        requireText={team.name}
        onConfirm={async () => {
          await teamApi.remove(team.id, ownerKey);
          guard.bypass();
          await navigate("/teams", { replace: true });
          forgetTeam(team.id);
        }}
      >
        <p>
          This deletes <b className="text-text">{team.name}</b> with all {team.players.length} player profile{team.players.length === 1 ? "" : "s"}, overrides and history.
          Owner, player, view and invite links all stop working immediately.
        </p>
      </ConfirmModal>
      {guard.modal}
    </div>
  );
}

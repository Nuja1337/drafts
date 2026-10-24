// /rooms/new?game=&a=&b= — configure and create a draft room (a/b preselect team profiles), then share its links.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PROFILE_ID_RE, TEAM_NAME_MAX, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS } from "../../shared/draft";
import { formatsFor } from "../../shared/formats";
import { GAMES } from "../../shared/games";
import type { CreateRoomReq, CreateRoomRes, FearlessMode, RoomConfig, RoomMode } from "../../shared/room";
import { GAME_IDS, SIDES, TEAM_SLOTS, type GameId, type Side, type TeamSlot } from "../../shared/types";
import { api } from "../lib/api";
import { listTeamKeys, saveRoom } from "../lib/keys";
import { roomUrl, saveRoomLinks } from "../room/links";
import { Button, Card, CopyField, cn, ErrorNote, Field, Input, Select, Toggle } from "../ui";

// Side-neutral on purpose: names belong to slots, and sides swap between games of a series.
const DEFAULT_NAMES: Record<TeamSlot, string> = { A: "Team A", B: "Team B" };
/** Defaults from earlier versions, still treated as "not a real name" when a profile is attached. */
const PLACEHOLDER_NAMES = new Set(["Team A", "Team B", "Blue team", "Red team"]);
const NAME_MAX = TEAM_NAME_MAX;
const SECONDS_MIN = TIMER_MIN_SECONDS;
const SECONDS_MAX = TIMER_MAX_SECONDS;
const BEST_OF: RoomConfig["bestOf"][] = [1, 2, 3, 5];

const MODES: { id: RoomMode; title: string; text: string }[] = [
  { id: "captains", title: "Two captains", text: "Each team gets its own link and drafts for itself (scrims, in-houses, tournaments)." },
  {
    id: "host",
    title: "Single host",
    text: "One person enters both sides, for example to mirror a real in-game champ select. Teammates watch the suggestions live.",
  },
];

const FEARLESS: { id: FearlessMode; title: string; text: string }[] = [
  { id: "off", title: "Off", text: "Every game starts fresh, and anything can be picked again." },
  { id: "soft", title: "Soft", text: "A team can't re-pick champions it already played earlier in the series. The other team still can." },
  { id: "hard", title: "Hard", text: "Once a champion is picked in the series, nobody can pick it again." },
];

const isGame = (v: string | null): v is GameId => !!v && (GAME_IDS as readonly string[]).includes(v);
const clampSeconds = (v: number) => (Number.isFinite(v) ? Math.min(SECONDS_MAX, Math.max(SECONDS_MIN, Math.round(v))) : 30);

/**
 * Profiles (and matching names) to start with: ?a= / ?b= team ids this browser holds a key for, and otherwise your own
 * team in slot A when there is exactly one for this game.
 */
function initialProfiles(game: GameId, params: URLSearchParams): { profiles: Record<TeamSlot, string>; names: Record<TeamSlot, string> } {
  const keys = listTeamKeys().filter((k) => k.game === game && PROFILE_ID_RE.test(k.teamId));
  const profiles: Record<TeamSlot, string> = { A: "", B: "" };
  const names: Record<TeamSlot, string> = { A: "", B: "" };
  const use = (slot: TeamSlot, k: (typeof keys)[number]) => {
    profiles[slot] = k.teamId;
    names[slot] = k.teamName.slice(0, NAME_MAX);
  };
  for (const slot of TEAM_SLOTS) {
    const k = keys.find((x) => x.teamId === params.get(slot.toLowerCase()));
    if (k && !Object.values(profiles).includes(k.teamId)) use(slot, k);
  }
  if (!profiles.A && !params.has("a")) {
    const own = keys.filter((k) => k.kind === "team" && k.teamId !== profiles.B);
    if (own.length === 1) use("A", own[0]);
  }
  return { profiles, names };
}

function OptionCard({ checked, onSelect, title, children, name }: { checked: boolean; onSelect: () => void; title: ReactNode; children?: ReactNode; name: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
        checked ? "border-accent bg-accent/5" : "border-line bg-panel-2/40 hover:border-line-strong",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-1 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {children && <span className="mt-0.5 block text-xs text-muted">{children}</span>}
      </span>
    </label>
  );
}

interface Created {
  res: CreateRoomRes;
  config: RoomConfig;
}

export function RoomNew() {
  const [params, setParams] = useSearchParams();
  const game: GameId = isGame(params.get("game")) ? (params.get("game") as GameId) : "lol";
  const def = GAMES[game];
  const formats = useMemo(() => formatsFor(game), [game]);

  const [formatByGame, setFormatByGame] = useState<Record<GameId, string>>({ lol: GAMES.lol.defaultFormatId, dota2: GAMES.dota2.defaultFormatId });
  const [mode, setMode] = useState<RoomMode>("captains");
  const [bestOf, setBestOf] = useState<RoomConfig["bestOf"]>(1);
  const [fearless, setFearless] = useState<FearlessMode>("off");
  const [timerOn, setTimerOn] = useState(true);
  // Until the user flips it, the timer follows the mode: off for single host (the host mirrors a real champ select,
  // whose own clock is authoritative), on for two captains.
  const [timerTouched, setTimerTouched] = useState(false);
  const [pickSeconds, setPickSeconds] = useState("30");
  const [banSeconds, setBanSeconds] = useState("30");
  // Team links (?a= / ?b=, e.g. "Draft against them" on a scout profile) preselect profiles this browser holds a key for.
  const [initial] = useState(() => initialProfiles(game, params));
  const [names, setNames] = useState<Record<TeamSlot, string>>(initial.names);
  // Dota 2 CM: the coin-toss winner may give game-1 first pick to either side (LoL: blue always picks first).
  const [dotaFirstSide, setDotaFirstSide] = useState<Side>("blue");
  const [profileByGame, setProfileByGame] = useState<Record<GameId, Record<TeamSlot, string>>>(() => ({
    lol: { A: "", B: "" },
    dota2: { A: "", B: "" },
    [game]: initial.profiles,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const formatId = formats.some((f) => f.id === formatByGame[game]) ? formatByGame[game] : (formats[0]?.id ?? def.defaultFormatId);
  const profiles = profileByGame[game];
  const teamKeys = listTeamKeys().filter((k) => k.game === game && PROFILE_ID_RE.test(k.teamId));
  const ownTeams = teamKeys.filter((k) => k.kind === "team");
  const scouts = teamKeys.filter((k) => k.kind === "scout");
  const effectiveFearless: FearlessMode = bestOf === 1 ? "off" : fearless;

  const setGame = (g: GameId) => setParams({ game: g }, { replace: true });

  const setProfile = (slot: TeamSlot, teamId: string) => {
    setProfileByGame((prev) => ({ ...prev, [game]: { ...prev[game], [slot]: teamId } }));
    // Fill in the team name when it is still a default.
    const k = teamKeys.find((x) => x.teamId === teamId);
    if (k && (!names[slot].trim() || PLACEHOLDER_NAMES.has(names[slot].trim()))) {
      setNames((n) => ({ ...n, [slot]: k.teamName.slice(0, NAME_MAX) }));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const pick = clampSeconds(Number(pickSeconds));
    const ban = clampSeconds(Number(banSeconds));
    const config: RoomConfig = {
      game,
      formatId,
      mode,
      bestOf,
      fearless: effectiveFearless,
      timer: { enabled: timerOn, pickSeconds: pick, banSeconds: ban },
      teams: {
        A: { name: names.A.trim().slice(0, NAME_MAX) || DEFAULT_NAMES.A, profileId: profiles.A || null },
        B: { name: names.B.trim().slice(0, NAME_MAX) || DEFAULT_NAMES.B, profileId: profiles.B || null },
      },
      ...(game === "dota2" ? { firstSide: dotaFirstSide } : {}),
    };
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<CreateRoomRes>("POST", "/rooms", { config } satisfies CreateRoomReq);
      if (!res?.roomId || !res.hostKey) throw new Error("The server returned an incomplete room.");
      saveRoom({ roomId: res.roomId, key: res.hostKey, label: `${config.teams.A.name} vs ${config.teams.B.name}`, game });
      saveRoomLinks(res.roomId, { hostKey: res.hostKey, captainKeys: res.captainKeys });
      setPickSeconds(String(pick));
      setBanSeconds(String(ban));
      setCreated({ res, config });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) return <SharePanel created={created} onAnother={() => setCreated(null)} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">New draft room</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Set up a live pick/ban room. Everyone in the room sees the board update in real time, with pick and ban suggestions from matchups, synergies, comp needs,
          the meta and your team's profiles.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Game">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Game">
              {GAME_IDS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={game === g}
                  onClick={() => setGame(g)}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors",
                    game === g ? "border-accent bg-accent/10" : "border-line bg-panel-2/40 hover:border-line-strong",
                  )}
                >
                  <span className="block font-display text-lg font-bold">{GAMES[g].short}</span>
                  <span className="block text-xs text-muted">{GAMES[g].name}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Draft format">
            <div className="space-y-2">
              {formats.map((f) => (
                <OptionCard key={f.id} name="format" checked={formatId === f.id} onSelect={() => setFormatByGame((p) => ({ ...p, [game]: f.id }))} title={f.name}>
                  {f.description}
                </OptionCard>
              ))}
            </div>
          </Card>

          <Card title="Room mode">
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <OptionCard
                  key={m.id}
                  name="mode"
                  checked={mode === m.id}
                  onSelect={() => {
                    setMode(m.id);
                    if (!timerTouched) setTimerOn(m.id === "captains");
                  }}
                  title={m.title}
                >
                  {m.text}
                </OptionCard>
              ))}
            </div>
          </Card>

          <Card title="Series">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">Length</div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Series length">
                  {BEST_OF.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={bestOf === n}
                      onClick={() => setBestOf(n)}
                      className={cn(
                        "h-10 min-w-16 rounded-lg border px-3 text-sm font-semibold transition-colors",
                        bestOf === n ? "border-accent bg-accent/10 text-text" : "border-line bg-panel-2/40 text-muted hover:text-text",
                      )}
                    >
                      Bo{n}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-faint">
                  {bestOf === 1 ? "A single game." : bestOf === 2 ? "Two games, so a 1–1 draw is possible." : `First to ${Math.floor(bestOf / 2) + 1} wins.`} Sides and first pick
                  are chosen before each game.
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">Fearless draft</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {FEARLESS.map((f) => (
                    <OptionCard key={f.id} name="fearless" checked={effectiveFearless === f.id} onSelect={() => setFearless(f.id)} title={f.title}>
                      {f.text}
                    </OptionCard>
                  ))}
                </div>
                {bestOf === 1 && <p className="mt-1.5 text-xs text-faint">Fearless only matters in a series. Pick Bo2 or longer to turn it on.</p>}
              </div>
            </div>
          </Card>

          <Card title="Turn timer">
            <div className="space-y-3">
              <Toggle
                checked={timerOn}
                onChange={(v) => {
                  setTimerTouched(true);
                  setTimerOn(v);
                }}
                label={timerOn ? "Timer on" : "No timer"}
              />
              <p className="text-xs text-muted">
                {timerOn
                  ? "When time runs out, the hovered pick or ban locks in. A ban with nothing hovered is skipped, and a pick with nothing hovered pauses the draft."
                  : "Turns wait until someone locks in."}
                {mode === "host" && " In single-host mode the in-game client keeps time, so only turn this on for practice drafts."}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                <Field label="Pick seconds">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={SECONDS_MIN}
                    max={SECONDS_MAX}
                    value={pickSeconds}
                    disabled={!timerOn}
                    onChange={(e) => setPickSeconds(e.target.value)}
                    onBlur={() => setPickSeconds(String(clampSeconds(Number(pickSeconds))))}
                  />
                </Field>
                <Field label="Ban seconds">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={SECONDS_MIN}
                    max={SECONDS_MAX}
                    value={banSeconds}
                    disabled={!timerOn}
                    onChange={(e) => setBanSeconds(e.target.value)}
                    onBlur={() => setBanSeconds(String(clampSeconds(Number(banSeconds))))}
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Teams">
            <div className="space-y-5">
              {(["A", "B"] as const).map((slot) => (
                <div key={slot} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
                    <span className={cn("size-2 rounded-full", slot === "A" ? "bg-blue" : "bg-red")} />
                    <span className={slot === "A" ? "text-blue" : "text-red"}>
                      Team {slot} · starts on {def.sideLabels[slot === "A" ? "blue" : "red"]}
                    </span>
                  </div>
                  <Input
                    value={names[slot]}
                    maxLength={NAME_MAX}
                    onChange={(e) => setNames((n) => ({ ...n, [slot]: e.target.value }))}
                    placeholder={DEFAULT_NAMES[slot]}
                    aria-label={`Team ${slot} name`}
                  />
                  <Select value={profiles[slot]} onChange={(e) => setProfile(slot, e.target.value)} aria-label={`Team ${slot} profile`}>
                    <option value="">No team profile</option>
                    {ownTeams.length > 0 && (
                      <optgroup label="Your teams">
                        {ownTeams.map((k) => (
                          <option key={k.teamId} value={k.teamId} disabled={k.teamId === profiles[slot === "A" ? "B" : "A"]}>
                            {k.teamName}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {scouts.length > 0 && (
                      <optgroup label="Scout profiles">
                        {scouts.map((k) => (
                          <option key={k.teamId} value={k.teamId} disabled={k.teamId === profiles[slot === "A" ? "B" : "A"]}>
                            {k.teamName}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </div>
              ))}
              {game === "dota2" && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">First pick (game 1)</div>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="First pick in game 1">
                    {SIDES.map((s) => (
                      <OptionCard key={s} name="firstSide" checked={dotaFirstSide === s} onSelect={() => setDotaFirstSide(s)} title={def.sideLabels[s]}>
                        {(names[s === "blue" ? "A" : "B"].trim() || DEFAULT_NAMES[s === "blue" ? "A" : "B"]).slice(0, NAME_MAX)}
                      </OptionCard>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-faint">In Captains Mode the coin-toss winner chooses a side or first pick. Later games are set before each game.</p>
                </div>
              )}
              <p className="text-xs text-faint">
                {teamKeys.length === 0 ? (
                  <>
                    No saved {def.short} profiles yet.{" "}
                    <Link to="/teams/new" className="text-accent hover:underline">
                      Create a team
                    </Link>{" "}
                    to get suggestions built around your players' pools. You can also attach one later in the lobby.
                  </>
                ) : (
                  "Attach your team (and a scout profile of your opponent) for player-aware suggestions. Only people holding a profile's key can read it."
                )}
              </p>
            </div>
          </Card>

          <Card title="Summary">
            <ul className="space-y-1 text-sm text-muted">
              <li>
                <span className="text-text">{def.short}</span> · {formats.find((f) => f.id === formatId)?.name}
              </li>
              <li>{MODES.find((m) => m.id === mode)?.title} mode</li>
              <li>
                {bestOf === 1 ? "Single game" : `Best of ${bestOf}`}
                {effectiveFearless !== "off" && ` · ${effectiveFearless} fearless`}
              </li>
              <li>{timerOn ? `${clampSeconds(Number(pickSeconds))}s picks · ${clampSeconds(Number(banSeconds))}s bans` : "No timer"}</li>
              {game === "dota2" && <li>{def.sideLabels[dotaFirstSide]} has first pick in game 1</li>}
            </ul>
            <div className="mt-4 space-y-3">
              <ErrorNote error={error} />
              <Button type="submit" variant="primary" size="lg" className="w-full font-display tracking-wider uppercase" loading={submitting}>
                Create room
              </Button>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}

function SharePanel({ created, onAnother }: { created: Created; onAnother: () => void }) {
  const navigate = useNavigate();
  const { res, config } = created;
  const captains = config.mode === "captains";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-[0.25em] text-accent uppercase">Room ready</div>
        <h1 className="mt-1 font-display text-3xl font-bold break-words">
          <span className="text-blue">{config.teams.A.name}</span> <span className="text-faint">vs</span> <span className="text-red">{config.teams.B.name}</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          {GAMES[config.game].short} · {config.bestOf === 1 ? "single game" : `best of ${config.bestOf}`} · {captains ? "two captains" : "single host"}. Links are
          saved in this browser, and you can reopen them from the room's Share button.
        </p>
      </div>

      <Card title="Share links">
        <div className="space-y-5">
          {captains && res.captainKeys && (
            <>
              <div>
                <CopyField label={`Captain link for ${config.teams.A.name}`} value={roomUrl(res.roomId, res.captainKeys.A)} />
                <p className="mt-1 text-xs text-faint">Send to {config.teams.A.name}'s captain. It lets them pick and ban for that team.</p>
              </div>
              <div>
                <CopyField label={`Captain link for ${config.teams.B.name}`} value={roomUrl(res.roomId, res.captainKeys.B)} />
                <p className="mt-1 text-xs text-faint">Send to {config.teams.B.name}'s captain.</p>
              </div>
            </>
          )}
          <div>
            <CopyField label="Spectator link" value={roomUrl(res.roomId)} />
            <p className="mt-1 text-xs text-faint">Read-only. Share it with teammates, coaches and viewers so they can watch the board and suggestions live.</p>
          </div>
          <div className="rounded-lg border border-warn/30 bg-warn/5 p-3">
            <CopyField label="Host link (keep private)" value={roomUrl(res.roomId, res.hostKey)} />
            <p className="mt-1 text-xs text-warn">
              Full control: start, pause, undo, reset and results{captains ? ", and it can act for either team" : ""}. Use it to open the room on another device.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" size="lg" onClick={() => navigate(`/r/${encodeURIComponent(res.roomId)}`)} className="font-display tracking-wider uppercase">
          Enter room
        </Button>
        <Button variant="ghost" size="lg" onClick={onAnother}>
          Create another
        </Button>
      </div>
    </div>
  );
}

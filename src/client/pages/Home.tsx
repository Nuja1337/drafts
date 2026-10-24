// Landing page: product pitch, primary CTAs, locally remembered teams/rooms, how it works.
import { useState } from "react";
import { Link } from "react-router";
import { GAMES } from "../../shared/games";
import type { GameId } from "../../shared/types";
import { ButtonLink } from "../components/common";
import { useTitle } from "../components/useTitle";
import { RoleIcon } from "../components/RoleIcon";
import { RoomCard, TeamCard } from "../components/TeamCard";
import { useGameData } from "../lib/gameData";
import { forgetRoom } from "../lib/keys";
import { useStoredRooms, useStoredTeams } from "../lib/teams";
import { ChampIcon, cn } from "../ui";

const STEPS = [
  {
    title: "Build your team profile",
    body: "Each player adds their champion pool with comfort, preferred roles, playstyles, strengths, weaknesses and the matchups they hate. Scout opponents the same way.",
  },
  {
    title: "Open a draft room",
    body: "Choose tournament, ranked, Captains Mode or All Pick, and add timers or a fearless series. Share captain links, or run both sides yourself as host.",
  },
  {
    title: "Draft with suggestions",
    body: "Every turn, picks and bans are ranked by matchups, synergies, comp needs, meta and your players, and each one shows why.",
  },
];

const FACTORS = [
  { label: "Matchups & counters", body: "Lane-weighted counters against what's already locked, and blind-pick risk for what's still to come." },
  { label: "Synergy & comp", body: "Fills what the comp is missing (engage, frontline, damage split) and fits your win condition." },
  { label: "Meta", body: "Per-role tiers and win rates, refreshed automatically." },
  { label: "Your players", body: "Pools and comfort, role preferences, playstyles, strengths and weaknesses." },
  { label: "Hated matchups", body: "Flags enemy picks your players struggle against and suggests banning them." },
  { label: "Deny", body: "Knows what the scouted enemy wants and when to take it away." },
];

/** Illustrative suggestion card for the hero (uses real portraits when the LoL bundle is available). */
function ExampleSuggestions() {
  const { data } = useGameData("lol");
  const rows = [
    { id: "Orianna", role: "mid", player: "Nova", score: 92, reasons: ["Signature pick ★★★★★", "Safe into Zed in lane", "Completes engage comp"] },
    { id: "Sejuani", role: "jungle", player: "Brick", score: 84, reasons: ["Synergy with Orianna", "Frontline needed"] },
    { id: "Rakan", role: "support", player: "Wisp", score: 79, reasons: ["Engage + peel", "Comfort ★★★★"] },
  ];
  return (
    <div className="relative rounded-2xl border border-line-strong bg-panel/90 p-4 shadow-2xl shadow-black/40 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-blue" />
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">Blue · pick 3</span>
        </div>
        <span className="rounded-md border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-faint">Example</span>
      </div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id} className={cn("flex gap-3 rounded-xl border p-2.5", i === 0 ? "border-accent/50 bg-accent/5" : "border-line bg-panel-2/60")}>
            <ChampIcon champ={data?.byId.get(r.id)} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display font-semibold">{data?.byId.get(r.id)?.name ?? r.id}</span>
                <RoleIcon game="lol" role={r.role} className="size-3.5 text-muted" />
                <span className="truncate text-xs text-muted">{r.player}</span>
                <span className={cn("ml-auto font-display text-sm font-bold tabular-nums", i === 0 ? "text-accent" : "text-muted")}>{r.score}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.reasons.map((t) => (
                  <span key={t} className="rounded-full border border-line-strong bg-panel-3 px-2 py-0.5 text-[10px] text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">Ban suggestion: LeBlanc, because Nova hates facing it (auto-lose)</div>
    </div>
  );
}

export function Home() {
  useTitle(null);
  const teams = useStoredTeams();
  const rooms = useStoredRooms();
  const [game, setGame] = useState<GameId>(() => (teams[0]?.game === "dota2" ? "dota2" : "lol"));
  const myTeams = teams.filter((t) => t.kind === "team");
  const scouts = teams.filter((t) => t.kind === "scout");
  const shownTeams = [...myTeams, ...scouts].slice(0, 6);

  return (
    <div className="space-y-14 sm:space-y-20">
      {/* Hero */}
      <section className="relative isolate grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-[min(56rem,100%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-accent)_14%,transparent),transparent)]"
        />
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-widest text-faint uppercase">
            <span className="text-accent">League of Legends</span>
            <span aria-hidden>·</span>
            <span className="text-red">Dota 2</span>
          </div>
          <h1 className="font-display text-4xl leading-[1.05] font-bold sm:text-5xl lg:text-6xl">
            Draft suggestions built around <span className="text-accent">your</span> team.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
            Drafts suggests picks and bans live during champ select. It weighs matchups, synergies, comp needs and the meta against what your players play, how
            they like to play, and the matchups they hate.
          </p>

          <div className="mt-7 space-y-3">
            <div className="inline-flex rounded-lg border border-line bg-panel-2 p-1" role="radiogroup" aria-label="Game">
              {(Object.keys(GAMES) as GameId[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={game === g}
                  onClick={() => setGame(g)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                    game === g ? (g === "lol" ? "bg-accent/15 text-accent" : "bg-red/15 text-red") : "text-muted hover:text-text",
                  )}
                >
                  {GAMES[g].name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/rooms/new?game=${game}`} variant="primary" size="lg">
                Start a draft
              </ButtonLink>
              <ButtonLink to={`/teams/new?game=${game}`} size="lg">
                Create your team
              </ButtonLink>
            </div>
            <Link to={`/teams/new?kind=scout&game=${game}`} className="inline-block text-sm text-muted underline-offset-4 hover:text-text hover:underline">
              or scout an opponent →
            </Link>
          </div>
        </div>
        <ExampleSuggestions />
      </section>

      {/* Remembered in this browser */}
      {(shownTeams.length > 0 || rooms.length > 0) && (
        <section className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="min-w-0">
            <div className="mb-3 flex items-end justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">Your teams</h2>
              <Link to="/teams" className="text-sm text-muted hover:text-text">
                {teams.length > shownTeams.length ? `All ${teams.length} →` : "Manage →"}
              </Link>
            </div>
            {shownTeams.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {shownTeams.map((t) => (
                  <TeamCard key={t.teamId} entry={t} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
                No teams on this device yet. <Link to={`/teams/new?game=${game}`} className="text-accent hover:underline">Create one</Link> or open an invite link.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="mb-3 font-display text-xl font-semibold">Recent rooms</h2>
            {rooms.length ? (
              <div className="space-y-2">
                {rooms.slice(0, 5).map((r) => (
                  <RoomCard key={r.roomId} room={r} onForget={() => forgetRoom(r.roomId)} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">Rooms you open will show up here.</p>
            )}
          </div>
        </section>
      )}

      {/* How it works */}
      <section>
        <h2 className="mb-5 font-display text-2xl font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border border-line bg-panel p-5">
              <span className="font-display text-4xl font-bold text-line-strong">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* What the engine weighs */}
      <section className="rounded-2xl border border-line bg-panel/60 p-5 sm:p-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">What each suggestion weighs</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Scores are built from weighted, explainable factors you can tune during the draft.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink to="/data/lol" size="sm" variant="ghost">
              LoL data
            </ButtonLink>
            <ButtonLink to="/data/dota2" size="sm" variant="ghost">
              Dota 2 data
            </ButtonLink>
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {FACTORS.map((f) => (
            <div key={f.label} className="border-l-2 border-accent/50 pl-3">
              <dt className="font-display font-semibold">{f.label}</dt>
              <dd className="mt-0.5 text-sm text-muted">{f.body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

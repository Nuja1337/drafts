// Suggestions sidebar: perspective switch, win gauge, the analysis tabs (picks, bans, threats, comps, lanes, coach — the
// first three follow the draft) and the weights panel.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CoachReq } from "../../shared/api";
import type { CompAnalysis, EngineOutput, EngineWeights, LaneMatchup } from "../../shared/engine/types";
import { ATTRIBUTES, archetypeDef, GAMES } from "../../shared/games";
import type { Champion, GameId, Side, TeamProfile } from "../../shared/types";
import { Button, cn, Slider, Spinner } from "../ui";
import { CurveChart, DamageBar, Radar, ScoreBar, WinGauge } from "./charts";
import { CoachTab } from "./CoachTab";
import { IconCheck, IconSliders, IconWarn } from "./icons";
import { Portrait } from "./Portrait";
import { SuggestionList } from "./SuggestionList";
import { autoTab, type AnalysisTab, type Turn } from "./view";

type Lookup = (id: string | null | undefined) => Champion | undefined;
type TabId = AnalysisTab;

const TABS: { id: TabId; label: string }[] = [
  { id: "picks", label: "Picks" },
  { id: "bans", label: "Bans" },
  { id: "threats", label: "Threats" },
  { id: "comps", label: "Comps" },
  { id: "lanes", label: "Lanes" },
  { id: "coach", label: "Coach" },
];
/** Tabs that follow the draft: switching between them is automatic, so reading another tab is never interrupted. */
const FOLLOW_TABS: readonly TabId[] = ["picks", "bans", "threats"];

const WEIGHT_INFO: { id: keyof EngineWeights; label: string; hint: string }[] = [
  { id: "meta", label: "Meta", hint: "Tier and win rate in the role this patch." },
  { id: "comfort", label: "Comfort", hint: "Player pools, main roles and playstyle fit." },
  { id: "counter", label: "Counter", hint: "Beats enemy picks already locked (lanes count more)." },
  { id: "synergy", label: "Synergy", hint: "Combos with our locked picks." },
  { id: "composition", label: "Composition", hint: "Fills comp needs: damage split, frontline, engage…" },
  { id: "team", label: "Team prefs", hint: "Preferred styles, strengths/weaknesses, hated matchups." },
  { id: "risk", label: "Blind risk", hint: "Penalty for picks easily countered later." },
  { id: "deny", label: "Deny", hint: "Value of taking/banning what the enemy wants." },
];

export function Suggestions({
  game,
  output,
  engineError,
  dataLoading,
  perspective,
  onPerspective,
  names,
  profiles,
  yourSide,
  lookup,
  onSelect,
  isAvailable,
  weights,
  setWeight,
  resetWeights,
  weightsDefault,
  buildCoachContext,
  next,
  complete,
  className,
}: {
  game: GameId;
  output: EngineOutput | null;
  engineError: string | null;
  dataLoading: boolean;
  perspective: Side;
  onPerspective: (side: Side) => void;
  names: Record<Side, string>;
  profiles: Record<Side, TeamProfile | null>;
  yourSide: Side | null;
  lookup: Lookup;
  onSelect: (id: string) => void;
  isAvailable: (id: string) => boolean;
  weights: EngineWeights;
  setWeight: (k: keyof EngineWeights, v: number) => void;
  resetWeights: () => void;
  weightsDefault: boolean;
  buildCoachContext: () => CoachReq["context"] | null;
  /** The next step of the draft (null when complete) and whether this game is fully drafted. */
  next: Turn | null;
  complete: boolean;
  className?: string;
}) {
  const auto = autoTab(next, complete, perspective);
  const [tab, setTabState] = useState<TabId>(() => auto ?? "picks");
  const [showWeights, setShowWeights] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const lastAuto = useRef<TabId | null>(auto);
  // Follow the draft, but only away from a draft-following tab or the one we picked automatically last time.
  useEffect(() => {
    if (!auto) return;
    const prev = lastAuto.current;
    lastAuto.current = auto;
    setTabState((t) => (FOLLOW_TABS.includes(t) || t === prev ? auto : t));
  }, [auto, next?.index, complete]);
  const setTab = (t: TabId) => {
    setShowWeights(false);
    setTabState(t);
  };
  const enemy: Side = perspective === "blue" ? "red" : "blue";
  const g = GAMES[game];
  const openRoles = output ? g.roles.filter((r) => (output.picksByRole[r.id]?.length ?? 0) > 0) : [];
  const activeRole = roleFilter && openRoles.some((r) => r.id === roleFilter) ? roleFilter : null;

  let body: ReactNode;
  if (showWeights) {
    body = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-sans text-xs font-semibold tracking-normal text-text">Suggestion weights</h3>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowWeights(false)}>
            Done
          </Button>
        </div>
        <p className="text-xs text-muted">Tune how much each factor matters to you. Saved in this browser; affects only your view.</p>
        {WEIGHT_INFO.map((w) => (
          <div key={w.id}>
            <Slider label={w.label} value={weights[w.id]} onChange={(v) => setWeight(w.id, v)} min={0} max={2} step={0.1} />
            <p className="mt-0.5 pl-31 text-[11px] text-faint">{w.hint}</p>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={resetWeights} disabled={weightsDefault}>
          Reset to defaults
        </Button>
      </div>
    );
  } else if (tab === "coach") {
    body = <CoachTab game={game} perspective={perspective} perspectiveName={names[perspective]} buildContext={buildCoachContext} ready={!!output} />;
  } else if (dataLoading) {
    body = (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
        <Spinner className="size-4" /> Loading {g.short} data…
      </div>
    );
  } else if (engineError) {
    body = <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">Analysis failed: {engineError}</div>;
  } else if (!output) {
    body = <p className="py-10 text-center text-sm text-muted">Analysis isn't available yet.</p>;
  } else if (tab === "picks") {
    const items = activeRole ? (output.picksByRole[activeRole] ?? []) : output.picks;
    body = (
      <div className="space-y-2">
        {openRoles.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter suggestions by open role">
            <Chip active={!activeRole} onClick={() => setRoleFilter(null)}>
              Best
            </Chip>
            {openRoles.map((r) => (
              <Chip key={r.id} active={activeRole === r.id} onClick={() => setRoleFilter(r.id)} title={r.label}>
                {r.short}
              </Chip>
            ))}
          </div>
        )}
        <SuggestionList items={items} game={game} side={perspective} lookup={lookup} onSelect={onSelect} isAvailable={isAvailable} empty="No picks to suggest — all roles are filled." />
      </div>
    );
  } else if (tab === "bans") {
    body = <SuggestionList items={output.bans} game={game} side={perspective} lookup={lookup} onSelect={onSelect} isAvailable={isAvailable} empty="No ban suggestions right now." />;
  } else if (tab === "threats") {
    body = (
      <div className="space-y-2">
        <p className="text-xs text-muted">
          What <span className={enemy === "blue" ? "text-blue" : "text-red"}>{names[enemy]}</span> most likely wants next.
        </p>
        <SuggestionList items={output.enemyThreats} game={game} side={enemy} lookup={lookup} onSelect={onSelect} isAvailable={isAvailable} empty="No threats identified." />
      </div>
    );
  } else if (tab === "comps") {
    body = <CompsView output={output} names={names} />;
  } else {
    body = <LanesView game={game} lanes={output.lanes} lookup={lookup} names={names} />;
  }

  return (
    <aside className={cn("flex min-h-0 min-w-0 flex-col bg-panel", className)} aria-label="Draft suggestions">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <h2 className="font-display text-sm font-bold tracking-widest text-muted uppercase">Analysis</h2>
            <button
              type="button"
              onClick={() => setShowWeights((v) => !v)}
              aria-pressed={showWeights}
              aria-label="Suggestion weights"
              title={weightsDefault ? "Tune suggestion weights" : "Tune suggestion weights (customized)"}
              className={cn(
                "relative rounded-md border p-1 transition-colors",
                showWeights ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-muted hover:border-line-strong hover:text-text",
              )}
            >
              <IconSliders className="size-3.5" />
              {!weightsDefault && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent" aria-hidden />}
            </button>
          </span>
          {output && <WinGauge value={output.winEstimate} side={perspective} label={names[perspective]} />}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1" role="group" aria-label="Suggestions perspective">
          {(["blue", "red"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onPerspective(s)}
              aria-pressed={perspective === s}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
                perspective === s ? (s === "blue" ? "bg-blue/20 text-text ring-1 ring-blue/60" : "bg-red/20 text-text ring-1 ring-red/60") : "text-muted hover:text-text",
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", s === "blue" ? "bg-blue" : "bg-red")} />
              <span className="truncate">{names[s]}</span>
              {yourSide === s && <span className="shrink-0 text-[10px] font-normal text-faint">(you)</span>}
            </button>
          ))}
        </div>
        {!profiles[perspective] && !showWeights && (
          <p className="text-[11px] text-muted">No team profile loaded for {names[perspective]} — suggestions ignore player pools.</p>
        )}
      </div>
      <div role="tablist" aria-label="Analysis views" className="grid grid-cols-6 border-b border-line px-1 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={!showWeights && tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "min-w-0 truncate border-b-2 px-0.5 py-2 text-center text-xs font-semibold whitespace-nowrap transition-colors lg:text-[11px] xl:text-xs",
              !showWeights && tab === t.id ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" role="tabpanel">
        {body}
      </div>
    </aside>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        active ? "border-accent/60 bg-accent/15 text-accent" : "border-line bg-panel-2 text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function CompSide({ comp, name, side }: { comp: CompAnalysis; name: string; side: Side }) {
  const archetypes = comp.archetypes.slice(0, 3);
  return (
    <section className="space-y-2 rounded-lg border border-line bg-panel-2/40 p-2.5">
      <h3 className="flex items-center gap-1.5 font-sans text-xs font-semibold tracking-normal">
        <span className={cn("size-2 rounded-full", side === "blue" ? "bg-blue" : "bg-red")} />
        <span className="truncate">{name}</span>
        <span className="ml-auto text-[11px] font-normal text-faint">{comp.championIds.length}/5</span>
      </h3>
      <DamageBar damage={comp.damage} />
      {archetypes.length > 0 && (
        <div className="space-y-1">
          {archetypes.map((a) => (
            <ScoreBar key={a.id} label={archetypeDef(a.id)?.label ?? a.id} value={a.score} side={side} title={archetypeDef(a.id)?.description} />
          ))}
        </div>
      )}
      {(comp.strengths.length > 0 || comp.warnings.length > 0) && (
        <ul className="space-y-0.5 text-[11px]">
          {comp.strengths.map((s) => (
            <li key={`s-${s}`} className="flex gap-1.5 text-muted">
              <IconCheck className="mt-0.5 size-3 shrink-0 text-good" title="Strength" />
              {s}
            </li>
          ))}
          {comp.warnings.map((s) => (
            <li key={`w-${s}`} className="flex gap-1.5 text-muted">
              <IconWarn className="mt-0.5 size-3 shrink-0 text-warn" title="Warning" />
              {s}
            </li>
          ))}
        </ul>
      )}
      {comp.championIds.length === 0 && <p className="text-[11px] text-faint">No picks yet.</p>}
    </section>
  );
}

function CompsView({ output, names }: { output: EngineOutput; names: Record<Side, string> }) {
  const { blue, red } = output.comps;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-sans text-xs font-semibold tracking-normal text-muted">Attributes</h3>
        <Radar values={{ blue: blue.attributeScores, red: red.attributeScores }} names={names} />
        <details className="mt-1 text-[11px]">
          <summary className="cursor-pointer text-faint hover:text-text">Attribute table</summary>
          <table className="mt-1 w-full tabular-nums">
            <thead>
              <tr className="text-faint">
                <th className="py-0.5 text-left font-normal">Attribute</th>
                <th className="text-right font-normal text-blue">{names.blue.slice(0, 10)}</th>
                <th className="text-right font-normal text-red">{names.red.slice(0, 10)}</th>
              </tr>
            </thead>
            <tbody>
              {ATTRIBUTES.map((a) => (
                <tr key={a.id} className="border-t border-line/60">
                  <td className="py-0.5 text-muted" title={a.description}>
                    {a.label}
                  </td>
                  <td className="text-right text-text">{Math.round(blue.attributeScores[a.id] ?? 0)}</td>
                  <td className="text-right text-text">{Math.round(red.attributeScores[a.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      <div>
        <h3 className="mb-1 font-sans text-xs font-semibold tracking-normal text-muted">Power curve</h3>
        <CurveChart curves={{ blue: blue.curve, red: red.curve }} names={names} />
      </div>
      <CompSide comp={blue} name={names.blue} side="blue" />
      <CompSide comp={red} name={names.red} side="red" />
    </div>
  );
}

function LanesView({ game, lanes, lookup, names }: { game: GameId; lanes: LaneMatchup[]; lookup: Lookup; names: Record<Side, string> }) {
  const g = GAMES[game];
  if (lanes.length === 0) return <p className="py-6 text-center text-sm text-muted">Lane matchups appear once roles are locked.</p>;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[11px] text-faint">
        <span className="text-blue">{names.blue}</span>
        <span className="text-red">{names.red}</span>
      </div>
      {lanes.map((l) => {
        const role = g.roles.find((r) => r.id === l.role);
        // Dota lanes pair different positions (pos1 vs pos3): name both sides then.
        const vs = l.vs && l.vs !== l.role ? g.roles.find((r) => r.id === l.vs) : undefined;
        const b = lookup(l.blue);
        const r = lookup(l.red);
        const adv = l.adv === null || !Number.isFinite(l.adv) ? null : Math.max(-1, Math.min(1, l.adv));
        return (
          <div key={l.role} className="rounded-lg border border-line bg-panel-2/40 p-2">
            <div className="flex items-center gap-2">
              <Portrait champ={b} fallbackId={l.blue} className="size-8" />
              <div className="min-w-0 flex-1">
                <div
                  className="text-center text-[10px] font-semibold tracking-widest text-muted uppercase"
                  title={vs ? `${role?.label ?? l.role} vs ${vs.label}` : role?.label}
                >
                  {role?.short ?? l.role}
                  {vs && ` vs ${vs.short}`}
                </div>
                <div className="relative mt-1 h-2 rounded-full bg-panel-3" role="img" aria-label={adv === null ? "Matchup unknown" : `Blue advantage ${Math.round(adv * 100)}`}>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                  {adv !== null && adv !== 0 && (
                    <span
                      className={cn("absolute inset-y-0", adv > 0 ? "right-1/2 rounded-l-full bg-blue" : "left-1/2 rounded-r-full bg-red")}
                      style={{ width: `${Math.abs(adv) * 50}%` }}
                    />
                  )}
                </div>
              </div>
              <Portrait champ={r} fallbackId={l.red} className="size-8" />
            </div>
            <p className="mt-1 text-[11px] text-muted">{l.text}</p>
          </div>
        );
      })}
    </div>
  );
}

// Builds the grounded, human-readable context for the AI coach (POST /api/coach) from an engine run.
// Everything is names and short sentences; roles are human labels (e.g. "Top", "Carry (Pos 1)"), not ids.
import type { CoachChampionInfo, CoachReq } from "../api";
import { archetypeDef, GAMES, roleLabel, traitDef } from "../games";
import { otherSide } from "../types";
import type { PlayerProfile, Role, Side } from "../types";
import { bundleIndex } from "./context";
import { topReasons } from "./explain";
import { NO_MATCHUP_DATA } from "./summary";
import type { CompAnalysis, EngineInput, EngineOutput, Reason, Suggestion } from "./types";

type Context = CoachReq["context"];

const MAX_TEXT = 160;
const clip = (s: string, n = MAX_TEXT): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const fmtDelta = (d: number): string => `${d >= 0 ? "+" : "-"}${Math.abs(d) >= 10 ? Math.abs(d).toFixed(0) : Math.abs(d).toFixed(1)}`;
const reasonText = (r: Reason): string => clip(`${r.text} (${fmtDelta(r.delta)})`);

export function buildCoachContext(input: EngineInput, output: EngineOutput, names: { our: string; enemy: string }, phase: string): Context {
  const data = input.data;
  const game = data.game;
  const idx = bundleIndex(data);
  const name = (id: string | null | undefined): string => (id ? (idx.info.get(id)?.c.name ?? id) : "?");
  const label = (r: Role | null | undefined): string | null => (r ? roleLabel(game, r) : null);
  const P: Side = input.perspective === "red" ? "red" : "blue";
  const E = otherSide(P);
  const sideLabels = GAMES[game].sideLabels;

  const nextAction = output.next
    ? `${output.next.side === P ? "Our" : "Enemy"} ${output.next.type} (${sideLabels[output.next.side]} side)`
    : null;

  const champs = (side: Side): CoachChampionInfo[] => {
    const slots = output.roles[side] ?? [];
    const listed = new Set(slots.map((s) => s.championId));
    const out: CoachChampionInfo[] = slots.map((s) => ({
      name: clip(name(s.championId), 40),
      role: label(s.role),
      ...(s.playerName ? { player: clip(s.playerName, 40) } : {}),
    }));
    // Picks the engine couldn't place (only possible with malformed drafts).
    for (const a of input.actions ?? []) {
      if (a?.type === "pick" && a.side === side && a.championId && !listed.has(a.championId)) {
        listed.add(a.championId);
        out.push({ name: clip(name(a.championId), 40), role: null });
      }
    }
    return out;
  };

  const bans = (input.actions ?? [])
    .filter((a) => a?.type === "ban" && !!a.championId)
    .map((a) => `${clip(name(a.championId), 40)} (by ${a.side === P ? "us" : "them"})`);

  const comp = (c: CompAnalysis | undefined): Context["ourComp"] => {
    if (!c || c.championIds.length === 0) return { archetypes: [], strengths: [], warnings: [], damage: "n/a", curve: "n/a" };
    return {
      archetypes: c.archetypes
        .filter((a) => a.score >= 30)
        .slice(0, 2)
        .map((a) => `${archetypeDef(a.id)?.label ?? a.id} (${a.score})`),
      strengths: c.strengths.slice(0, 4).map((s) => clip(s)),
      warnings: c.warnings.slice(0, 4).map((s) => clip(s)),
      damage: `${Math.round(c.damage.physical * 100)}% physical / ${Math.round(c.damage.magic * 100)}% magic`,
      curve: `early ${c.curve.early.toFixed(1)} · mid ${c.curve.mid.toFixed(1)} · late ${c.curve.late.toFixed(1)} (0-3)`,
    };
  };

  const pickSug = (s: Suggestion) => ({
    name: clip(name(s.championId), 40),
    role: label(s.role),
    ...(s.playerName ? { player: clip(s.playerName, 40) } : {}),
    reasons: topReasons(s, 3).map(reasonText),
  });

  const laneMatchups: NonNullable<Context["laneMatchups"]> = [];
  for (const l of output.lanes ?? []) {
    const ours = P === "blue" ? l.blue : l.red;
    const theirs = P === "blue" ? l.red : l.blue;
    if (!ours || !theirs) continue;
    const role = P === "blue" ? l.role : l.vs;
    laneMatchups.push({ role: label(role) ?? role, ours: clip(name(ours), 40), theirs: clip(name(theirs), 40), verdict: verdict(l.adv, l.text, P) });
  }

  return {
    ourTeamName: clip(names.our || GAMES[game].sideLabels[P], 60),
    enemyTeamName: clip(names.enemy || GAMES[game].sideLabels[E], 60),
    phase: clip(phase, 60),
    nextAction,
    ourPicks: champs(P),
    enemyPicks: champs(E),
    bans,
    ourComp: comp(output.comps?.[P]),
    enemyComp: comp(output.comps?.[E]),
    topPickSuggestions: (output.picks ?? []).slice(0, 5).map(pickSug),
    topBanSuggestions: (output.bans ?? []).slice(0, 5).map((s) => ({ name: clip(name(s.championId), 40), reasons: topReasons(s, 3).map(reasonText) })),
    ...(laneMatchups.length ? { laneMatchups } : {}),
    ...playerNotesField(input, output, P, name),
  };
}

function verdict(adv: number | null, text: string, P: Side): string {
  if (adv === null) return "Unknown";
  if (text.endsWith(NO_MATCHUP_DATA)) return "No data";
  const a = P === "blue" ? adv : -adv;
  const m = Math.abs(a);
  if (m < 0.05) return "Even";
  const w = m >= 0.3 ? "Strongly " : m >= 0.17 ? "" : "Slightly ";
  return `${w}${a > 0 ? "favored" : "unfavored"}`.replace(/^./, (c) => c.toUpperCase());
}

/** Short notes about our players (hated matchups, weaknesses) and scouted enemy players (comfort picks still open, matchups they struggle against that we can still pick, weaknesses). */
function playerNotesField(input: EngineInput, output: EngineOutput, P: Side, name: (id: string) => string): { playerNotes?: string[] } {
  const notes: string[] = [];
  const E = otherSide(P);
  const enemyPicked = new Set((input.actions ?? []).filter((a) => a?.type === "pick" && a.side === E && a.championId).map((a) => a.championId!));
  // What the ENEMY can no longer pick (taken this game + their own fearless locks) — differs from ours under soft fearless.
  const enemyGone = new Set<string>(Array.isArray(input.unavailable?.[E]) ? input.unavailable[E] : []);
  // What WE can no longer pick.
  const usGone = new Set<string>(Array.isArray(input.unavailable?.[P]) ? input.unavailable[P] : []);
  for (const a of input.actions ?? []) {
    if (!a?.championId) continue;
    enemyGone.add(a.championId);
    usGone.add(a.championId);
  }
  const ours = input.teams?.[P];
  const players = (t: typeof ours): PlayerProfile[] => (t && t.game === input.data.game && Array.isArray(t.players) ? t.players : []);
  // Players in our lineup first (they're the ones who'll face the enemy picks).
  const lineup = new Set((output.roles[P] ?? []).map((s) => s.playerId).filter(Boolean));
  const sorted = [...players(ours)].sort((a, b) => Number(lineup.has(b.id)) - Number(lineup.has(a.id)));
  for (const p of sorted.slice(0, 6)) {
    const pname = clip(p.name || "Player", 40);
    const avoid = Array.isArray(p.avoid) ? p.avoid : [];
    const facing = avoid.filter((a) => enemyPicked.has(a.championId)).map((a) => name(a.championId));
    if (facing.length) notes.push(clip(`${pname} hates facing ${facing.join(", ")} (enemy picked)`));
    const hated = avoid.filter((a) => a.severity >= 2 && !enemyGone.has(a.championId)).map((a) => name(a.championId));
    if (hated.length) notes.push(clip(`${pname} struggles against ${hated.slice(0, 4).join(", ")} (still available)`));
    const weak = (Array.isArray(p.weaknesses) ? p.weaknesses : []).slice(0, 3);
    if (weak.length) notes.push(clip(`${pname}'s weaknesses: ${weak.map((w) => (traitDef(w)?.label ?? w).toLowerCase()).join(", ")}`));
    if (typeof p.notes === "string" && p.notes.trim()) notes.push(clip(`${pname}: ${p.notes}`, 120));
  }
  for (const p of players(input.teams?.[E]).slice(0, 6)) {
    const pool = (Array.isArray(p.pool) ? p.pool : [])
      .filter((e) => e.comfort >= 4 && !enemyGone.has(e.championId))
      .sort((a, b) => b.comfort - a.comfort || (a.championId < b.championId ? -1 : 1))
      .slice(0, 3);
    if (pool.length) notes.push(clip(`Their ${p.name || "player"} is comfortable on ${pool.map((e) => `${name(e.championId)} (${e.comfort}/5)`).join(", ")}`));
    const hates = (Array.isArray(p.avoid) ? p.avoid : []).filter((a) => a.severity >= 2 && !usGone.has(a.championId)).map((a) => name(a.championId));
    if (hates.length) notes.push(clip(`Their ${p.name || "player"} struggles against ${hates.slice(0, 4).join(", ")} (we can still pick)`));
    const weak = (Array.isArray(p.weaknesses) ? p.weaknesses : []).slice(0, 3);
    if (weak.length) notes.push(clip(`Their ${p.name || "player"}'s weaknesses: ${weak.map((w) => (traitDef(w)?.label ?? w).toLowerCase()).join(", ")}`));
  }
  return notes.length ? { playerNotes: notes.slice(0, 10) } : {};
}

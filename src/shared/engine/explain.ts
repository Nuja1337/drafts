// Score accumulation with explainable reasons, plus helpers for UIs (top reasons, one-line explanations).
import { TUNING } from "./tuning";
import type { EngineWeights, Reason, ReasonKind, Suggestion } from "./types";

/** Which EngineWeights multiplier a contribution belongs to ("structure" is never weighted). */
export type Component = keyof EngineWeights | "structure";

export type Caps = Partial<Record<Component, number>>;

interface Part {
  comp: Component;
  kind: ReasonKind;
  raw: number;
  text: string | null;
}

export const round1 = (x: number): number => Math.round(x * 10) / 10 || 0;
export const round2 = (x: number): number => Math.round(x * 100) / 100 || 0;
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * Collects signed contributions. Texts are only materialized when `explain` is set, so the numeric
 * first pass over every candidate stays cheap; the explain pass reproduces the exact same numbers.
 */
export class ScoreAcc {
  private readonly parts: Part[] = [];
  constructor(readonly explain: boolean) {}

  add(comp: Component, kind: ReasonKind, raw: number, text?: () => string): void {
    if (!Number.isFinite(raw) || raw === 0) return;
    this.parts.push({ comp, kind, raw, text: this.explain && text ? text() : null });
  }

  /** Applies per-component caps (scaling every part of an over-cap component) and weights. */
  finish(base: number, weights: EngineWeights, caps: Caps): { score: number; reasons: Reason[] } {
    const sums: Partial<Record<Component, number>> = {};
    for (const p of this.parts) sums[p.comp] = (sums[p.comp] ?? 0) + p.raw;
    let score = base;
    const reasons: Reason[] = [];
    for (const p of this.parts) {
      const cap = caps[p.comp];
      const sum = Math.abs(sums[p.comp] ?? 0);
      const factor = cap !== undefined && sum > cap ? cap / sum : 1;
      const w = p.comp === "structure" ? 1 : weights[p.comp];
      const delta = p.raw * factor * w;
      score += delta;
      if (p.text && Math.abs(delta) >= TUNING.minReason) reasons.push({ kind: p.kind, delta: round1(delta), text: p.text });
    }
    return { score, reasons: sortReasons(reasons) };
  }
}

/** Sorts reasons by |delta| (largest first), then kind/text for stability. */
export function sortReasons(reasons: Reason[]): Reason[] {
  return reasons.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
}

/** The n most influential reasons of a suggestion (reasons are already sorted by |delta|). */
export function topReasons(s: Pick<Suggestion, "reasons">, n = 3): Reason[] {
  return sortReasons([...s.reasons]).slice(0, Math.max(0, n));
}

const fmtDelta = (d: number): string => `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(Math.abs(d) >= 10 ? 0 : 1)}`;

/** One-line explanation, e.g. "82 · +20 Bob's signature pick (5/5); +14 Counters Darius (lane)". */
export function explainScore(s: Pick<Suggestion, "score" | "reasons">, n = 3): string {
  const top = topReasons(s, n);
  const head = String(Math.round(s.score));
  return top.length ? `${head} · ${top.map((r) => `${fmtDelta(r.delta)} ${r.text}`).join("; ")}` : head;
}

/** Deterministic ordering: score desc, then champion id asc. */
export const bySuggestion = (a: { score: number; championId: string }, b: { score: number; championId: string }): number =>
  b.score - a.score || (a.championId < b.championId ? -1 : a.championId > b.championId ? 1 : 0);

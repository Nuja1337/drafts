// Engine weight sliders, persisted per viewer in localStorage.
import { useCallback, useState } from "react";
import { DEFAULT_WEIGHTS, type EngineWeights } from "../../shared/engine/types";

const STORE = "drafts.engineWeights.v1";
const KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof EngineWeights)[];

const clamp = (v: number) => Math.min(2, Math.max(0, Math.round(v * 10) / 10));

function load(): EngineWeights {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...DEFAULT_WEIGHTS };
    for (const k of KEYS) {
      const v = parsed?.[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp(v);
    }
    return out;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

function persist(w: EngineWeights) {
  try {
    localStorage.setItem(STORE, JSON.stringify(w));
  } catch {
    /* ignore: weights still apply for this session */
  }
}

export function useWeights() {
  const [weights, setWeights] = useState<EngineWeights>(load);
  const setWeight = useCallback((k: keyof EngineWeights, v: number) => {
    setWeights((prev) => {
      const next = { ...prev, [k]: clamp(v) };
      persist(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    const next = { ...DEFAULT_WEIGHTS };
    persist(next);
    setWeights(next);
  }, []);
  const isDefault = KEYS.every((k) => weights[k] === DEFAULT_WEIGHTS[k]);
  return { weights, setWeight, reset, isDefault };
}

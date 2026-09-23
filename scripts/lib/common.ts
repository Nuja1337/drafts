// Types and small helpers shared by the per-game bundle builders.
import type { GameDataBundle } from "../../src/shared/types";
import type { CachedFetcher } from "./fetchCache";

export interface BuildContext {
  /** Repository root. */
  root: string;
  fetcher: CachedFetcher;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface BuildReport {
  bundle: GameDataBundle;
  /** Summary lines for the build log. */
  lines: string[];
}

/** Number of cells in a sparse matrix. */
export const countCells = (m: Record<string, Record<string, unknown>>): number => Object.values(m).reduce((s, r) => s + Object.keys(r).length, 0);

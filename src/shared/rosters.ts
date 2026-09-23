// Champion / hero ids per game, small enough for the DraftRoom Durable Object to validate locks without loading the
// full data bundles. src/shared/rosters/<game>.json is written by scripts/build-data.ts next to public/data/<game>.json.
import dota2 from "./rosters/dota2.json";
import lol from "./rosters/lol.json";
import type { GameId } from "./types";

const IDS: Record<GameId, Set<string>> = { lol: new Set(lol), dota2: new Set(dota2) };
/** Every known id of any game, lower-cased (catches case variants and cross-game ids). */
const FOLDED = new Set([...lol, ...dota2].map((id) => id.toLowerCase()));
/** Data Dragon id shape (e.g. "MonkeyKing", "JarvanIV"). */
const DDRAGON_ID_RE = /^[A-Z][A-Za-z]{1,39}$/;

export const isKnownChampion = (game: GameId, id: string): boolean => IDS[game]?.has(id) ?? false;

/**
 * Whether `id` may be drafted in a `game` room: a known id, or — LoL only — a champion released after this build.
 * LoL clients add brand-new champions from newer Data Dragon patches (src/client/lib/gameData.ts lolOverlay), so an
 * unknown id is accepted when it has Data Dragon's shape and isn't a case variant of any known id of either game.
 */
export function isDraftableChampion(game: GameId, id: string): boolean {
  if (isKnownChampion(game, id)) return true;
  return game === "lol" && DDRAGON_ID_RE.test(id) && !FOLDED.has(id.toLowerCase());
}

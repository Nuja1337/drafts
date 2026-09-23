// Ranked champion/hero search shared by the draft grid, the picker and the data browser: exact names, ids and common
// shorthand first ("am", "pa", "wr", "j4"), then initials, prefixes and substrings.
import type { Champion, GameId, Role } from "../../shared/types";
import { searchKey } from "../components/format";

/** Community shorthand that the name/initials rules miss (checked against public/data ids in champSearch.test.ts). */
export const SEARCH_ALIASES: Record<GameId, Record<string, string>> = {
  dota2: {
    wr: "windrunner",
    np: "furion",
    pa: "phantom_assassin",
    es: "earthshaker",
    od: "obsidian_destroyer",
    kotl: "keeper_of_the_light",
    bs: "bloodseeker",
    ls: "life_stealer",
    bb: "bristleback",
    tb: "terrorblade",
    bm: "beastmaster",
    cm: "crystal_maiden",
    wk: "skeleton_king",
    sf: "nevermore",
    qop: "queenofpain",
    ul: "abyssal_underlord",
    void: "faceless_void",
    rylai: "crystal_maiden",
  },
  lol: {
    ww: "Warwick",
    j4: "JarvanIV",
    asol: "AurelionSol",
    kog: "KogMaw",
    gp: "Gangplank",
    tk: "TahmKench",
    mf: "MissFortune",
    tf: "TwistedFate",
    lb: "Leblanc",
    yi: "MasterYi",
    mundo: "DrMundo",
  },
};

export interface IndexedChampion {
  champ: Champion;
  key: string;
  idKey: string;
  /** Word initials, e.g. "Anti-Mage" → "am"; "Nature's Prophet" → "nsp" and "np". */
  initials: string[];
  aliases: string[];
}

const initialsOf = (name: string, splitter: RegExp): string =>
  name
    .split(splitter)
    .filter(Boolean)
    .map((w) => searchKey(w).charAt(0))
    .join("");

export function indexChampions(champions: readonly Champion[], game?: GameId): IndexedChampion[] {
  const aliasesById = new Map<string, string[]>();
  for (const [alias, id] of Object.entries(game ? SEARCH_ALIASES[game] : {})) aliasesById.set(id, [...(aliasesById.get(id) ?? []), alias]);
  return champions
    .map((champ) => ({
      champ,
      key: searchKey(champ.name),
      idKey: searchKey(champ.id),
      initials: [...new Set([initialsOf(champ.name, /[\s\-'.&]+/), initialsOf(champ.name.replace(/'/g, ""), /[\s\-.&]+/)])],
      aliases: aliasesById.get(champ.id) ?? [],
    }))
    .sort((a, b) => a.champ.name.localeCompare(b.champ.name));
}

/**
 * How well a champion matches a normalized query (lower is better, null = no match): exact name/id/alias, then short
 * initials ("cm", "qop"), prefixes, longer initials, alias prefixes and finally substrings.
 */
export function matchRank(i: IndexedChampion, q: string): number | null {
  if (!q) return 0;
  if (i.key === q || i.idKey === q || i.aliases.includes(q)) return 0;
  if (q.length >= 2 && q.length <= 3 && i.initials.includes(q)) return 1;
  if (i.key.startsWith(q) || i.idKey.startsWith(q)) return 2;
  if (q.length >= 2 && i.initials.includes(q)) return 3;
  if (q.length >= 2 && i.aliases.some((a) => a.startsWith(q))) return 4;
  if (i.key.includes(q) || i.idKey.includes(q)) return 5;
  return null;
}

/** Champions matching `query` (all of them when empty), best match first; ties keep `tieBreak` order, else name order. */
export function searchChampions(
  index: readonly IndexedChampion[],
  query: string,
  role: Role | "all" = "all",
  tieBreak?: (a: Champion, b: Champion) => number,
): Champion[] {
  const q = searchKey(query);
  const ranked: { c: Champion; r: number }[] = [];
  for (const i of index) {
    if (role !== "all" && !i.champ.roles.includes(role)) continue;
    const r = matchRank(i, q);
    if (r !== null) ranked.push({ c: i.champ, r });
  }
  return ranked.sort((a, b) => a.r - b.r || (tieBreak ? tieBreak(a.c, b.c) : 0)).map((x) => x.c);
}

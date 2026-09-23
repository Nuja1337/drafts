import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameDataBundle, GameId } from "../../shared/types";
import { searchKey } from "../components/format";
import { indexChampions, SEARCH_ALIASES, searchChampions } from "./champSearch";

const bundle = (game: GameId): GameDataBundle => JSON.parse(readFileSync(new URL(`../../../public/data/${game}.json`, import.meta.url), "utf8"));
const data = { lol: bundle("lol"), dota2: bundle("dota2") };
const index = { lol: indexChampions(data.lol.champions, "lol"), dota2: indexChampions(data.dota2.champions, "dota2") };
const first = (game: GameId, q: string) => searchChampions(index[game], q)[0]?.id;

describe("champion search", () => {
  it("every alias points at a real champion id", () => {
    for (const game of ["lol", "dota2"] as const) {
      const ids = new Set(data[game].champions.map((c) => c.id));
      for (const [alias, id] of Object.entries(SEARCH_ALIASES[game])) expect(ids.has(id), `${game} alias ${alias} → ${id}`).toBe(true);
    }
  });

  it("resolves Dota shorthand to the intended hero first", () => {
    const cases: Record<string, string> = {
      am: "antimage",
      pa: "phantom_assassin",
      wr: "windrunner",
      io: "wisp",
      cm: "crystal_maiden",
      sf: "nevermore",
      qop: "queenofpain",
      np: "furion",
      wk: "skeleton_king",
      es: "earthshaker",
      shadow: "shadow_demon",
    };
    for (const [q, id] of Object.entries(cases)) expect(first("dota2", q), q).toBe(id);
  });

  it("resolves LoL shorthand and exact names first", () => {
    const cases: Record<string, string> = { vi: "Vi", mf: "MissFortune", tf: "TwistedFate", ww: "Warwick", j4: "JarvanIV", asol: "AurelionSol", kaisa: "Kaisa", "kai'sa": "Kaisa", ahri: "Ahri", lee: "LeeSin" };
    for (const [q, id] of Object.entries(cases)) expect(first("lol", q), q).toBe(id);
  });

  it("keeps substring matches after better ones, filters by role and returns everything for an empty query", () => {
    const vi = searchChampions(index.lol, "vi").map((c) => c.id);
    expect(vi[0]).toBe("Vi");
    expect(vi).toContain("Anivia");
    expect(searchChampions(index.lol, "").length).toBe(data.lol.champions.length);
    const mids = searchChampions(index.lol, "", "mid");
    expect(mids.length).toBeGreaterThan(0);
    expect(mids.every((c) => c.roles.includes("mid"))).toBe(true);
    expect(searchChampions(index.lol, "zzzz")).toEqual([]);
  });

  it("uses the tie-break order inside a match tier", () => {
    const prefix = searchChampions(index.lol, "ka").filter((c) => searchKey(c.name).startsWith("ka")).map((c) => c.name);
    expect(prefix.length).toBeGreaterThan(3);
    const reversed = searchChampions(index.lol, "ka", "all", (a, b) => b.name.localeCompare(a.name)).map((c) => c.name);
    expect(reversed.slice(0, prefix.length)).toEqual([...prefix].reverse());
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveLolChampion } from "../../shared/derive";
import { formatMatchupLine, parseMatchupBlob, refreshAdv } from "../../shared/matchupMath";
import type { Champion, GameDataBundle } from "../../shared/types";
import { blendMatchups, dotaOverlay, lolOverlay, type GameData } from "./gameData";

const hero = (id: string, key: number): Champion => ({
  id,
  key,
  name: id,
  image: `https://cdn.cloudflare.steamstatic.com/${id}.png`,
  roles: ["pos1"],
  tags: [],
  damage: "physical",
  range: "melee",
  attributes: { engage: 0, disengage: 0, peel: 0, poke: 0, burst: 0, dps: 0, frontline: 0, cc: 0, mobility: 0, waveclear: 0, splitpush: 0, pick: 0, sustain: 0, siege: 0 },
  powerCurve: { early: 1, mid: 1, late: 1 },
  archetypes: ["scaling"],
  meta: { pos1: { tier: "B", winRate: 0.5, games: 10 } },
  difficulty: 2,
  curated: true,
});

const index = (b: GameDataBundle): GameData => ({ ...b, byId: new Map(b.champions.map((c) => [c.id, c])) });

const names = ["a", "b", "c", "d", "e", "f"];
const dota = (): GameData =>
  index({
    game: "dota2",
    version: "7.41",
    generatedAt: "2026-09-01T00:00:00.000Z",
    sources: [],
    champions: names.map((n, i) => hero(n, i + 1)),
    matchups: { a: { b: { adv: 0.3, n: 100, lane: true } }, b: { a: { adv: -0.3, n: 100, lane: true } } },
    synergies: {},
  });

/** Every pair 200 games at 50%, except a (1) vs b (2). */
function blob(abGames: number, abWins: number): string {
  const lines: string[] = [];
  for (let x = 1; x <= 6; x++) {
    const entries: [number, number, number][] = [];
    for (let y = 1; y <= 6; y++) {
      if (x === y) continue;
      if (x === 1 && y === 2) entries.push([2, abGames, abWins]);
      else if (x === 2 && y === 1) entries.push([1, abGames, abGames - abWins]);
      else entries.push([y, 200, 100]);
    }
    lines.push(formatMatchupLine(x, entries));
  }
  return lines.join("|");
}

describe("dota live overlay", () => {
  it("updates cells with more games, keeps lane flags and mirrors", async () => {
    const data = dota();
    const out = await dotaOverlay(data, async () => ({ game: "dota2", updatedAt: "2026-09-10T00:00:00.000Z", matchups: blob(400, 200) }));
    expect(out).not.toBeNull();
    const cell = out!.matchups.a.b;
    expect(cell.n).toBe(400);
    expect(cell.lane).toBe(true);
    expect(cell.adv).toBeLessThan(0.3); // new even games pull the old +0.3 down
    expect(cell.adv).toBeGreaterThan(0);
    expect(out!.matchups.b.a.adv).toBe(-cell.adv);
    expect(out!.live?.updatedPairs).toBeGreaterThan(0);
    // the static bundle is untouched
    expect(data.matchups.a.b.adv).toBe(0.3);
  });
  it("leaves cells alone when the live sample is not larger", () => {
    const { matchups } = blendMatchups(dota(), parseMatchupBlob(blob(100, 80)));
    expect(matchups.a.b.adv).toBe(0.3);
  });
  it("matches refreshAdv for a known cell", () => {
    const { matchups } = blendMatchups(dota(), parseMatchupBlob(blob(300, 150)));
    expect(matchups.a.b.adv).toBeCloseTo(refreshAdv(0.3, 100, 0, 300), 3);
  });
  it("waits for a near-complete rotation before blending matchups", () => {
    const partial = parseMatchupBlob(blob(400, 300));
    partial.delete(5);
    const data = dota();
    const { matchups, updatedPairs } = blendMatchups(data, partial);
    expect(updatedPairs).toBe(0);
    expect(matchups).toBe(data.matchups);
  });
  it("ignores stale or empty live data and refreshes meta numbers", async () => {
    expect(await dotaOverlay(dota(), async () => ({ game: "dota2", updatedAt: null }))).toBeNull();
    expect(await dotaOverlay(dota(), async () => ({ game: "dota2", updatedAt: "2026-08-01T00:00:00.000Z", matchups: blob(400, 300) }))).toBeNull();
    expect(await dotaOverlay(dota(), async () => null)).toBeNull();
    const out = await dotaOverlay(dota(), async () => ({ game: "dota2", updatedAt: "2026-09-10T00:00:00.000Z", meta: { a: { winRate: 0.55, games: 999 } } }));
    expect(out!.byId.get("a")!.meta.pos1).toEqual({ tier: "B", winRate: 0.55, games: 999 });
  });
});

describe("lol live overlay", () => {
  afterEach(() => vi.unstubAllGlobals());
  const src = (id: string, key: string) => ({ id, key, name: id, title: "t", tags: ["Fighter"], info: { attack: 7, defense: 5, magic: 2, difficulty: 5 }, image: { full: `${id}.png` } });
  const lol = (): GameData =>
    index({
      game: "lol",
      version: "16.18.1",
      generatedAt: "2026-09-01T00:00:00.000Z",
      sources: ["Data Dragon 16.18.1"],
      champions: Array.from({ length: 120 }, (_, i) => deriveLolChampion(src(`Champ${i}`, String(i + 1)), "16.18.1")),
      matchups: {},
      synergies: {},
    });
  const stubFetch = (latest: string, extra: string[]) => {
    const all = [...Array.from({ length: 120 }, (_, i) => src(`Champ${i}`, String(i + 1))), ...extra.map((id, i) => src(id, String(900 + i)))];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/versions.json")) return new Response(JSON.stringify([latest, "16.18.1"]));
        if (url.includes(`/cdn/${latest}/data/en_US/champion.json`)) return new Response(JSON.stringify({ data: Object.fromEntries(all.map((c) => [c.id, c])) }));
        return new Response("nope", { status: 404 });
      }),
    );
  };
  it("rewrites portraits to the newer patch and adds unknown champions as derived", async () => {
    stubFetch("16.19.1", ["Brandnew"]);
    const out = await lolOverlay(lol());
    expect(out).not.toBeNull();
    expect(out!.byId.get("Champ3")!.image).toContain("/cdn/16.19.1/img/champion/Champ3.png");
    expect(out!.byId.get("Brandnew")).toMatchObject({ curated: false, roles: ["top"] });
    expect(out!.live).toMatchObject({ version: "16.19.1", added: ["Brandnew"] });
    expect(out!.version).toBe("16.18.1");
  });
  it("does nothing when the bundle is current or the network fails", async () => {
    stubFetch("16.18.1", []);
    expect(await lolOverlay(lol())).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await lolOverlay(lol())).toBeNull();
  });
});

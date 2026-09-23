// Draft formats. Steps use "first"/"second" relative to the side that has first pick this game.
import type { DraftFormat, FormatStep } from "./room";
import type { GameId } from "./types";

/**
 * Parses a compact step spec: tokens are F|S (first/second side) + b|p (ban/pick), e.g. "Fb Sb Fp Sp".
 * Throws on malformed tokens so a typo can never ship a silently wrong format.
 */
const seq = (spec: string): FormatStep[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((tok) => {
      if (!/^[FS][bp]$/.test(tok)) throw new Error(`Bad format step token "${tok}"`);
      return { side: tok[0] === "F" ? "first" : "second", type: tok[1] === "p" ? "pick" : "ban" };
    });

export const FORMATS: DraftFormat[] = [
  {
    id: "lol-tournament",
    game: "lol",
    name: "Tournament Draft",
    description: "Standard pro draft: 3 bans each, 3 picks each, 2 bans each, 2 picks each.",
    // Bans B R B R B R | Picks B R R B B R | Bans R B R B | Picks R B B R  (first side = Blue in LoL)
    steps: seq("Fb Sb Fb Sb Fb Sb  Fp Sp Sp Fp Fp Sp  Sb Fb Sb Fb  Sp Fp Fp Sp"),
    phases: [
      { start: 0, label: "Ban phase 1" },
      { start: 6, label: "Pick phase 1" },
      { start: 12, label: "Ban phase 2" },
      { start: 16, label: "Pick phase 2" },
    ],
  },
  {
    id: "lol-ranked",
    game: "lol",
    name: "Ranked / Clash Draft",
    description: "5 bans each (entered alternating), then picks 1-2-2-2-2-1.",
    steps: seq("Fb Sb Fb Sb Fb Sb Fb Sb Fb Sb  Fp Sp Sp Fp Fp Sp Sp Fp Fp Sp"),
    phases: [
      { start: 0, label: "Bans" },
      { start: 10, label: "Picks" },
    ],
  },
  {
    // Captains Mode as of patch 7.40 (Liquipedia "Game Modes" changelog):
    // 7.34 introduced 3-2-2 bans (first pick) / 4-1-2 bans (second pick) / 1-3-1 picks;
    // 7.40 reordered ban phase 1 to F F S S F S S and ban phase 3 to F S F S.
    id: "dota2-cm",
    game: "dota2",
    name: "Captains Mode",
    description: "Competitive Dota 2 Captains Mode (patch 7.40): 7 bans / 2 picks / 3 bans / 6 picks / 4 bans / 2 picks.",
    steps: seq("Fb Fb Sb Sb Fb Sb Sb  Fp Sp  Fb Fb Sb  Sp Fp Fp Sp Sp Fp  Fb Sb Fb Sb  Fp Sp"),
    phases: [
      { start: 0, label: "Ban phase 1" },
      { start: 7, label: "Pick phase 1" },
      { start: 9, label: "Ban phase 2" },
      { start: 12, label: "Pick phase 2" },
      { start: 18, label: "Ban phase 3" },
      { start: 22, label: "Pick phase 3" },
    ],
  },
  {
    id: "dota2-allpick",
    game: "dota2",
    name: "Ranked All Pick (simplified)",
    description: "5 ban nominations each (entered alternating), then picks 1-2-2-2-2-1.",
    steps: seq("Fb Sb Fb Sb Fb Sb Fb Sb Fb Sb  Fp Sp Sp Fp Fp Sp Sp Fp Fp Sp"),
    phases: [
      { start: 0, label: "Bans" },
      { start: 10, label: "Picks" },
    ],
  },
];

export const formatsFor = (game: GameId): DraftFormat[] => FORMATS.filter((f) => f.game === game);

export const getFormat = (id: string): DraftFormat | undefined => FORMATS.find((f) => f.id === id);

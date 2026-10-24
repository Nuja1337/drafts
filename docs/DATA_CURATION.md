# Curated champion/hero data

Files: `data/lol/curated/*.json` and `data/dota2/curated/*.json`, each a JSON array of `CuratedChampion`
(see `src/shared/types.ts`). Validate with `npx tsx scripts/validate-curated.ts <lol|dota2> [file]`.
Valid ids: `data/sources/lol-roster.json` (Data Dragon ids, e.g. `MonkeyKing`, `KSante`, `Belveth`, `Chogath`) and
`data/sources/dota2-roster.json` (short names, e.g. `antimage`, `nevermore`, `furion`, `wisp`, `skeleton_king`,
`obsidian_destroyer`, `rattletrap`, `shredder`, `magnataur`, `doom_bringer`, `abyssal_underlord`, `windrunner`, `zuus`).

The engine turns these numbers into draft advice, so **calibration and consistency matter more than prose**.
Write what a high-elo coach or analyst would say about the current patch, and leave out patch-notes trivia.

## Fields

- `roles`: positions it is genuinely played in, most common first. Include an off-role only if it is a real,
  recurring pick there (solo queue or pro flex). LoL: `top|jungle|mid|bot|support`. Dota 2: `pos1..pos5`.
- `damage`: `physical` | `magic` | `mixed` (mixed only when it genuinely deals a substantial share of both).
- `range`: `melee` | `ranged` (basic attack).
- `attributes`: integers 0–3, **relative to the whole roster**:
  - 3 = elite, one of the best at this (top ~10% of the roster).
  - 2 = clearly strong / a reason to pick it.
  - 1 = has some.
  - 0 = none / negligible.
  Most champions have only 2–4 attributes at 2+, and at most 1–2 at 3. Avoid inflating.
  Anchors (LoL): engage 3 Malphite, Leona, Rell, Amumu, Sejuani, Rakan · disengage 3 Janna, Gragas(ult), Poppy, Braum ·
  peel 3 Lulu, Janna, Braum, Taric · poke 3 Xerath, Jayce, Ziggs, Varus, Vel'Koz · burst 3 Zed, LeBlanc, Syndra, Kha'Zix ·
  dps 3 Jinx, Vayne, Kog'Maw, Master Yi · frontline 3 Ornn, Sion, K'Sante, Malphite · cc 3 Leona, Nautilus, Lissandra, Sejuani ·
  mobility 3 Kalista, Ahri, Irelia, Lee Sin · waveclear 3 Ziggs, Anivia, Sivir, Taliyah · splitpush 3 Fiora, Jax, Tryndamere, Yorick ·
  pick 3 Blitzcrank, Thresh, Pyke, Ahri · sustain 3 Soraka, Yuumi, Aatrox, Vladimir · siege 3 Ziggs, Caitlyn, Xerath, Sivir.
  Anchors (Dota 2): engage 3 Enigma, Magnus, Tidehunter, Earthshaker, Axe · disengage 3 Oracle, Winter Wyvern, Dark Willow ·
  peel 3 Oracle, Dazzle, Abaddon, Omniknight · poke 2 Jakiro, Skywrath, Sniper · burst 3 Lion, Lina, Zeus, Tinker ·
  dps 3 Medusa, Terrorblade, Troll Warlord, Luna · frontline 3 Tidehunter, Bristleback, Centaur, Dragon Knight ·
  cc 3 Magnus, Earthshaker, Tidehunter, Lion · mobility 3 Storm Spirit, Ember Spirit, Puck, Anti-Mage ·
  waveclear 3 Death Prophet, Leshrac, Gyrocopter, Luna · splitpush 3 Nature's Prophet, Tinker, Anti-Mage ·
  pick 3 Pudge, Bounty Hunter, Riki, Spirit Breaker · sustain 3 Dazzle, Oracle, Necrophos, Huskar(self) ·
  siege 3 Lycan, Death Prophet, Chen, Broodmother.
- `powerCurve`: early / mid / late, 0–3 each. Early-game bullies (Renekton, Lee Sin, Draven, Huskar, Ursa) have high
  early and fall off, while hyper-carries (Kassadin, Kayle, Jinx, Medusa, Spectre, Anti-Mage) are low early and 3 late.
- `archetypes`: 1–4 of `engage | poke | pick | split | protect | dive | skirmish | early | scaling | push`, best first.
  `push` = deathball / early tower pushing (mostly Dota, also LoL siege comps).
- `strongVs` / `weakVs`: 3–8 each (up to 12 for very common champions). `s`: 3 = well-known hard counter,
  2 = clear advantage, 1 = slight edge. Set `lane: true` when it is a lane matchup (same lane in LoL, lane opponents in
  Dota) and omit it for general teamfight/kit interactions (e.g. Anti-Mage vs mana-reliant heroes, grievous-wounds style
  interactions, Silencer vs channelers). **Direction matters:** `strongVs` = champions THIS one beats, and `weakVs` =
  champions that beat THIS one. Double-check you didn't swap them. A champion must not appear in both lists.
- `synergies`: 2–6 teammates it combos with (e.g. Yasuo+Malphite, Xayah+Rakan, Kalista+Thresh, Magnus+Sven/Phantom
  Lancer, Io+Gyrocopter). `s` as above.
- `meta`: tier per role it is played in: `S` (must-pick/ban, ~5%), `A` (strong, ~20%), `B` (solid, ~40%),
  `C` (situational, ~25%), `D` (weak, ~10%). Base this on your best knowledge of the **current 2026 meta**
  (LoL patch ~26.x / Data Dragon 16.x; Dota 2 7.39+). When unsure, use `B`. Only roles in `roles`.
- `difficulty`: 1 easy, 2 medium, 3 hard (mechanics + game knowledge).
- `notes`: 1–2 sentences, draft-relevant: identity, win condition, what it needs from teammates, what beats it.

## Unknown / new champions

If you don't confidently know a champion's kit (e.g. very recent releases such as LoL's Locke, Zaahen, Yunara, Mel,
Ambessa, Aurora, or Dota's Largo, Kez, Ringmaster), look it up before writing:
- LoL kit: `https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/champion/<Id>.json` (spells, passive, tags, info),
  plus a web search for its role/matchups.
- Dota kit: Liquipedia / the Dota 2 wiki via web search.
Never invent matchups for a champion you don't understand. A few accurate relations are better than many guesses.

## Example (LoL)

```json
{
  "id": "Malphite",
  "roles": ["top", "support", "mid"],
  "damage": "magic",
  "range": "melee",
  "attributes": { "engage": 3, "disengage": 0, "peel": 1, "poke": 1, "burst": 2, "dps": 0, "frontline": 3, "cc": 2, "mobility": 1, "waveclear": 1, "splitpush": 0, "pick": 1, "sustain": 0, "siege": 0 },
  "powerCurve": { "early": 1, "mid": 3, "late": 2 },
  "archetypes": ["engage", "dive"],
  "strongVs": [{ "id": "Tryndamere", "s": 3, "lane": true }, { "id": "Yasuo", "s": 2, "lane": true }, { "id": "Jax", "s": 2, "lane": true }, { "id": "Fiora", "s": 1, "lane": true }],
  "weakVs": [{ "id": "Sylas", "s": 2 }, { "id": "Mordekaiser", "s": 2, "lane": true }, { "id": "Kennen", "s": 2, "lane": true }, { "id": "Vayne", "s": 2, "lane": true }],
  "synergies": [{ "id": "Yasuo", "s": 3 }, { "id": "Yone", "s": 2 }, { "id": "Orianna", "s": 2 }, { "id": "MissFortune", "s": 2 }],
  "meta": { "top": "B", "support": "C", "mid": "C" },
  "difficulty": 1,
  "notes": "Point-and-click wombo engage with Unstoppable Force, and huge armor stacking vs AD-heavy comps. Weak into AP lanes, and split pushers outscale him if the enemy plays around his ult."
}
```

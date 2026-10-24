# drafts architecture

Team-aware pick/ban drafting for League of Legends and Dota 2. One Cloudflare Worker (free tier) serves the React SPA
(Workers Static Assets), a small JSON API (Hono), live draft rooms (one Durable Object per room, WebSocket hibernation),
team profiles (D1), a cron job refreshing live data (KV), and an AI coach (Workers AI).

## Hard constraints

- **Free tier only.** Workers Free: 10 ms CPU per request, 50 subrequests per invocation, 100k requests/day.
  KV: 1,000 writes/day (never write KV per request). D1: 100k row writes/day. Workers AI: 10k neurons/day.
  Durable Objects: SQLite-backed classes only, using the WebSocket **hibernation** API (`ctx.acceptWebSocket`).
- Heavy data (champion data, matchup matrices) is **static JSON built at build time** (`public/data/<game>.json`),
  served by the asset layer, so it never costs Worker CPU. The browser runs the scoring engine.
- **Relative imports only** (no path aliases) so Vite, wrangler, tsx and vitest all resolve identically.
- Keys (owner/player/view/host/captain) are random secrets, and the server stores **only SHA-256 hashes**.
- Future: Discord OAuth accounts. Keep auth resolving to a `Principal` (owner | player | viewer) so an account system can
  map users onto the same principals later. Don't build accounts now.

## Layout

```
src/shared/            pure TS shared by everything (no DOM, no Workers APIs)
  types.ts             domain types (GameDataBundle, TeamProfile, CuratedChampion, …)        [contract]
  games.ts             roles, attributes, archetypes, playstyles, traits                     [contract]
  room.ts              room state + WebSocket protocol types                                  [contract]
  api.ts               HTTP API request/response types + route list                           [contract]
  formats.ts           draft formats (LoL tournament/ranked, Dota CM/AP)
  draft.ts             pure draft state helpers + the permission-aware reducer used by the DO and the client
  rosters.ts           champion/hero ids per game (rosters/<game>.json) so the DO can validate locks without the bundles
  derive.ts            heuristic Champion defaults for uncurated champions
  engine/              the scoring engine: analyzeDraft(input) → EngineOutput (types.ts is the contract)
src/worker/
  index.ts             entry: mounts sub-apps under /api, exports DraftRoom, cron → runScheduled
  lib/http.ts          AppEnv, ApiError, rateLimit, readJsonBounded, randomId/randomKey, sha256, bearer
  lib/net.ts           client network key for limits (IPv4 address or IPv6 /64)
  lib/quota.ts         per-network daily counters in D1 (daily_usage: coach calls, team creations)
  lib/d1size.ts        D1 size tracking: warn > 350 MB, refuse new teams/players/joins > 400 MB (503 storage_full)
  teams/               teams, players, invites, keys, audit (D1)
  rooms/               POST/GET /api/rooms, WS upgrade → DraftRoom DO
  coach.ts             POST /api/coach (Workers AI)
  live.ts              GET /api/live/:game + cron refresh (OpenDota → KV)
  maintenance.ts       daily D1 cleanup from the cron: past days' counters, audit entries > 180 days
src/client/
  main.tsx, App.tsx    router (react-router, createBrowserRouter)
  index.css            Tailwind v4 theme tokens (bg, panel, panel-2/3, line, text, muted, faint, accent, blue, red, good, bad, warn)
  ui/index.tsx         primitives: Button, Card, Input, Textarea, Select, Field, Badge, Spinner, Tabs, Modal, Toggle, Slider, Stars, CopyField, EmptyState, ErrorNote, ChampIcon, cn
  lib/api.ts           api<T>(method, path, body?, key?), throws ApiRequestError
  lib/keys.ts          localStorage key store for teams + rooms
  lib/gameData.ts      useGameData(game) / loadGameData(game) → GameData (bundle + byId)
  lib/useRoom.ts       WebSocket room hook
  components/          shared feature components (Layout, ChampionPicker, …)
  pages/               route pages
  room/                draft room components
scripts/
  build-data.ts        builds public/data/<game>.json (+ src/shared/rosters/<game>.json, commit both together)
                       from live sources + data/<game>/curated/*.json
  validate-curated.ts  validates curated files
data/<game>/curated/   hand-curated CuratedChampion[] JSON (see docs/DATA_CURATION.md)
data/sources/          roster snapshots (ids/names/tags) used for validation
migrations/            D1 migrations (0001 schema, 0002 daily_usage counters), applied remotely before deploying
public/_headers        long-lived Cache-Control for the content-hashed /assets/*
```

## Key contracts (beyond the type files)

### `src/shared/draft.ts`

```ts
export function stepSide(step: FormatStep, firstSide: Side): Side;
export function nextStep(format: DraftFormat, firstSide: Side, actions: DraftAction[]): { index: number; side: Side; type: ActionType } | null;
export function picksOf(actions: DraftAction[], side: Side): string[];            // champion ids in pick order
export function bansOf(actions: DraftAction[], side?: Side): (string | null)[];
/** Champions each side may not pick because of fearless rules (series history + config.fearless + current sides). */
export function fearlessLocked(state: RoomState): Record<Side, string[]>;
/** Everything `side` can't select right now: picked/banned this game + fearless locks. */
export function unavailableFor(state: RoomState, side: Side): Set<string>;
export function isDraftComplete(state: RoomState): boolean;
export function phaseLabel(format: DraftFormat, index: number): string;
export function initialRoomState(id: string, config: RoomConfig, now: number): RoomState;
```

### `src/client/lib/useRoom.ts`

```ts
export function useRoom(roomId: string, key: string | null): {
  state: RoomState | null;
  you: RoomRole | null;
  status: "connecting" | "open" | "reconnecting" | "closed";
  error: string | null;             // last server error message (clears on next state)
  send: (msg: ClientMsg) => void;
  serverNow: () => number;          // Date.now() corrected by server clock offset (for timers)
};
```

Room links: host `/r/:roomId?k=<hostKey>`, captains `/r/:roomId?k=<captainKey>`, spectators `/r/:roomId`.
The Room page strips `?k=` from the URL and uses it for the visit. `RoomView` stores it (`lib/keys.ts`) only after the
server's welcome confirms host or captain, and never over a stronger stored key (host > captain). Keys never go in
the socket URL. A client with a key connects to `/api/rooms/:roomId/ws?auth=1` and sends `{t:"auth", key}` as its
first frame, and the server holds the welcome until then (a bad key is welcomed as a spectator plus a `bad_key` error).
Team links use `/t/:teamId?key=<ownerKey|viewKey>` (TeamDashboard imports and strips it). The host can replace a
leaked captain link with `{t:"rotateKey", slot}`. Only that socket gets `keyRotated`, and sockets on the old key close with 4001.
Protocol details (the `"ka"` keepalive frame, close codes 4404/4410/4409 final, 4429 room full, 4001 link revoked,
the `index` stale-turn guard on hover/lock, `setWinner.game` for correcting an earlier result) are documented in
`src/shared/room.ts`. Limits per room: ≤170 spectators (≤20 per network), ≤10 sockets per keyed role (the 11th
replaces the oldest with 4409), and a per-role budget of accepted state changes (hovers persist at most every 2 s).

### Engine

`analyzeDraft(input: EngineInput): EngineOutput` in `src/shared/engine/index.ts`. It is pure and deterministic.
The client calls it on every state change for the side the viewer cares about.

### Team auth

`Authorization: Bearer <key>`. Owner key `own_…` (team master), player key `ply_…` (edit own profile only, blocked when
team locked), view key `view_…` (read only). Invite code (short, rotatable) lets someone join and receive a player key.
All writes are rate limited (WRITE_LIMITER) and recorded in the audit log, and the owner can revert any revertible entry.
A player's own edits within 15 minutes merge into one entry (one revert undoes the burst). Audit lists omit the
before/after snapshots, and each team's log is capped at 2M characters. Team creation is capped per network per day.

Rate limits key on the client network (IPv4 address or IPv6 /64, `lib/net.ts`). The coach also has a daily
per-network cap (25 model calls, `daily_usage`). Daily limits fail open with a logged warning if migration 0002 is
missing.

## Local dev

- `npx vite --port <port>` runs the full app (SPA + Worker + DO + D1 + KV) in workerd. This is the normal way to develop.
  Set `CF_PERSIST=.wrangler/state-<name>` to isolate local state from other dev servers. It listens on `localhost`
  (IPv6 `::1` on Windows), so use `http://localhost:<port>`, not `127.0.0.1`.
- `npx wrangler dev` runs the output of the **last `vite build`**. `vite build` writes `.wrangler/deploy/config.json`, which
  redirects wrangler to `dist/drafts/wrangler.json` (assets from `dist/client`). Run `npx vite build` first or it
  serves stale code. `wrangler.jsonc` itself has no `assets.directory` (the Vite plugin sets it), so for an API-only
  Worker without building use `npx wrangler dev -c wrangler.jsonc --assets public --port <port> --persist-to .wrangler/state-<name>`.
- Local D1 schema: `npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state-<name>`.
  Before deploying: `npx wrangler d1 migrations apply DB --remote`.
- Cron locally: `curl "http://localhost:<port>/cdn-cgi/handler/scheduled"` (vite) or `/cdn-cgi/local/scheduled` (wrangler dev).
  Each run makes ≤ 11 OpenDota calls and one KV write. The run in the first 20 minutes of each UTC day also does the
  D1 maintenance (`maintenance.ts`). Pass `?time=<epoch ms>` to simulate it.
- `npx tsc -b` typechecks everything, and `npx vitest run` runs unit tests.
- End-to-end smoke tests against a running server: `node scripts/smoke-teams.mjs <baseUrl>` and
  `node scripts/smoke-rooms.mjs <baseUrl>` (≈45 s, since they wait on real turn timers).

### Coach context builder

`src/shared/engine/coach.ts`:

```ts
export function buildCoachContext(input: EngineInput, output: EngineOutput, names: { our: string; enemy: string }, phase: string): CoachReq["context"];
```

The client sends that context to `POST /api/coach`. The Worker only formats it into a prompt and calls Workers AI.

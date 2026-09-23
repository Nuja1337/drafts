# drafts

Team-aware pick/ban drafting for League of Legends and Dota 2. Live draft rooms suggest picks and bans from matchups,
synergies, comp needs and the meta, weighed against your players' champion pools, playstyles, strengths/weaknesses and
the champions they hate playing against.

Live: https://drafts.ajshaham.workers.dev

Runs entirely on the Cloudflare free tier: one Worker serving the React app, a Hono API, draft rooms (Durable Objects),
team profiles (D1), live Dota data (cron + KV) and an AI coach (Workers AI). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```sh
npm install
npx wrangler d1 migrations apply DB --local   # local D1 schema
npm run dev                                    # app + Worker + DO + D1 at http://localhost:5173
npm test                                       # unit tests
npx tsc -b                                     # typecheck
```

## Data

Champion data is built into static bundles (`public/data/<game>.json`) from Data Dragon / OpenDota plus the hand-curated
knowledge in `data/<game>/curated/` (rubric: [docs/DATA_CURATION.md](docs/DATA_CURATION.md)).

```sh
npx tsx scripts/validate-curated.ts lol       # or dota2
npm run data                                  # rebuild both bundles (OpenDota responses cached 24h in data/cache/)
```

## Deploy

```sh
npm run db:migrate:remote   # only when migrations/ changed
npm run deploy              # vite build + wrangler deploy
```

Not endorsed by Riot Games or Valve. League of Legends is a trademark of Riot Games, Inc. Dota 2 is a trademark of Valve Corporation.

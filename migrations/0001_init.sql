-- D1 schema: team profiles, player slots and the per-team audit log.
-- Secrets: owner and player keys are stored only as SHA-256 hex hashes. The view key and the invite code are
-- low-privilege values the owner must be able to read back, so they are stored in plaintext (both rotatable).
-- JSON columns hold arrays validated by the Worker (src/worker/teams/schema.ts).

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'scout')),
  game TEXT NOT NULL CHECK (game IN ('lol', 'dota2')),
  name TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  preferred_archetypes TEXT NOT NULL DEFAULT '[]', -- JSON Archetype[]
  avoid_archetypes TEXT NOT NULL DEFAULT '[]',     -- JSON Archetype[]
  overrides TEXT NOT NULL DEFAULT '[]',            -- JSON TeamOverride[]
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  owner_key_hash TEXT NOT NULL,
  view_key TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per roster slot. key_hash NULL = unclaimed (no player key issued).
-- The composite primary key doubles as the "players of a team" index.
CREATE TABLE players (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',      -- JSON RolePref[]
  pool TEXT NOT NULL DEFAULT '[]',       -- JSON PoolEntry[]
  playstyles TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  strengths TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  weaknesses TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  avoid TEXT NOT NULL DEFAULT '[]',      -- JSON AvoidEntry[]
  notes TEXT NOT NULL DEFAULT '',
  key_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);

-- Append-only change log (pruned to the newest ~300 rows per team). seq gives a stable tiebreak.
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_json TEXT, -- JSON snapshot, NULL for creations
  after_json TEXT,  -- JSON snapshot, NULL for removals
  revertible INTEGER NOT NULL DEFAULT 0 CHECK (revertible IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX audit_team_entry ON audit (team_id, id);
CREATE INDEX audit_team_time ON audit (team_id, created_at, seq);

CREATE TABLE IF NOT EXISTS user_roles (
  clerk_user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS cohort_members_user_idx ON cohort_members (clerk_user_id);

CREATE TABLE IF NOT EXISTS item_types (
  key TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS cycles_cohort_idx ON cycles (cohort_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS cycle_participants (
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, clerk_user_id)
);

CREATE TABLE IF NOT EXISTS cycle_item_types (
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  item_type_key TEXT NOT NULL REFERENCES item_types(key),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, item_type_key)
);

ALTER TABLE cycles ADD COLUMN IF NOT EXISTS last_seq BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'void')),
  item_type_key TEXT NOT NULL REFERENCES item_types(key),
  -- NULL means untagged: credited to the group, to no individual.
  subject_user_id TEXT,
  actor_user_id TEXT NOT NULL,
  voids_entry_id UUID REFERENCES ledger_entries(id),
  client_entry_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  -- clock_timestamp(), not now(): now() is transaction-start time, and appends
  -- queue on the cycle row lock, so transactions that begin together would share
  -- a timestamp. This column records when the row was actually written.
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (kind = 'log' OR voids_entry_id IS NOT NULL),
  UNIQUE (cycle_id, seq),
  UNIQUE (cycle_id, client_entry_id)
);

CREATE INDEX IF NOT EXISTS ledger_entries_cycle_seq_idx ON ledger_entries (cycle_id, seq);
CREATE INDEX IF NOT EXISTS ledger_entries_subject_idx ON ledger_entries (cycle_id, subject_user_id);

CREATE TABLE IF NOT EXISTS user_current_cycle (
  clerk_user_id TEXT PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mirrors cohort_members_user_idx. Both participant-scoped queries added for the
-- member API filter on this column, and v0.2 shipped without it.
CREATE INDEX IF NOT EXISTS cycle_participants_user_idx ON cycle_participants (clerk_user_id);

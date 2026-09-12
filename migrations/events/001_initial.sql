CREATE SCHEMA IF NOT EXISTS osiris_events;
CREATE TABLE osiris_events.metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch uuid NOT NULL,
  cursor bigint NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  retention_floor bigint NOT NULL DEFAULT 0 CHECK (retention_floor >= 0 AND retention_floor <= cursor)
);
CREATE TABLE osiris_events.events (
  id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  cursor bigint NOT NULL UNIQUE CHECK (cursor > 0),
  content_hash text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE osiris_events.identities (
  source_id text NOT NULL,
  upstream_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES osiris_events.events(id),
  PRIMARY KEY (source_id, upstream_id)
);
CREATE INDEX identities_event ON osiris_events.identities(event_id);
CREATE TABLE osiris_events.revisions (
  cursor bigint PRIMARY KEY CHECK (cursor > 0),
  event_id uuid NOT NULL REFERENCES osiris_events.events(id),
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (event_id, revision)
);
CREATE TABLE osiris_events.evidence (
  event_id uuid NOT NULL REFERENCES osiris_events.events(id),
  evidence_key text NOT NULL,
  payload jsonb NOT NULL,
  first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, evidence_key)
);
CREATE TABLE osiris_events.batches (
  id uuid PRIMARY KEY,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

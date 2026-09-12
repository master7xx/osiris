CREATE TABLE osiris_events.collector (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  expires_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_error text
);
CREATE TABLE osiris_events.signals (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE osiris_events.collector ADD COLUMN source_health jsonb NOT NULL DEFAULT '[]'::jsonb;

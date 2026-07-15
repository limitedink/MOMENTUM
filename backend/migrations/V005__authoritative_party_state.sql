-- V005__authoritative_party_state.sql
-- One server-owned activity state, contribution ledger, and command idempotency journal per party.

CREATE TABLE IF NOT EXISTS party_states (
  party_id UUID PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0,
  activity_kind TEXT NOT NULL DEFAULT 'expedition',
  status TEXT NOT NULL DEFAULT 'idle',
  destination TEXT,
  started_at TIMESTAMPTZ,
  completes_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT party_states_revision_check CHECK (revision >= 0),
  CONSTRAINT party_states_activity_kind_check CHECK (activity_kind = 'expedition'),
  CONSTRAINT party_states_status_check CHECK (status IN ('idle', 'active', 'completed')),
  CONSTRAINT party_states_destination_check CHECK (destination IS NULL OR destination = 'forest'),
  CONSTRAINT party_states_shape_check CHECK (
    (status = 'idle' AND destination IS NULL AND started_at IS NULL AND completes_at IS NULL)
    OR
    (status IN ('active', 'completed') AND destination = 'forest' AND started_at IS NOT NULL AND completes_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_party_states_completes_at
  ON party_states(completes_at)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION prevent_party_state_revision_decrease()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'party state revision cannot decrease';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_party_state_revision_monotonic'
  ) THEN
    CREATE TRIGGER trg_party_state_revision_monotonic
    BEFORE UPDATE ON party_states
    FOR EACH ROW
    EXECUTE FUNCTION prevent_party_state_revision_decrease();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_party_states_updated_at'
  ) THEN
    CREATE TRIGGER trg_party_states_updated_at
    BEFORE UPDATE ON party_states
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS party_state_contributions (
  party_id UUID NOT NULL REFERENCES party_states(party_id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (party_id, player_id),
  CONSTRAINT party_state_contributions_membership_fk
    FOREIGN KEY (party_id, player_id)
    REFERENCES party_memberships(party_id, player_id)
    ON DELETE CASCADE,
  CONSTRAINT party_state_contributions_amount_check CHECK (amount >= 0)
);

CREATE TABLE IF NOT EXISTS party_commands (
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  resulting_revision BIGINT,
  current_revision BIGINT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, command_id),
  CONSTRAINT party_commands_status_check CHECK (status IN ('accepted', 'rejected')),
  CONSTRAINT party_commands_revision_check CHECK (
    (status = 'accepted' AND resulting_revision IS NOT NULL AND error_code IS NULL)
    OR
    (status = 'rejected' AND resulting_revision IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_party_commands_created_at
  ON party_commands(created_at);

CREATE INDEX IF NOT EXISTS idx_party_commands_player_id
  ON party_commands(player_id);

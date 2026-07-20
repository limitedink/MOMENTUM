CREATE TABLE IF NOT EXISTS party_expedition_assignment_history (
  id BIGSERIAL PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES party_states(party_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  target_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  CONSTRAINT party_expedition_assignment_history_slot_check CHECK (slot_id ~ '^slot-[1-4]$')
);

CREATE INDEX IF NOT EXISTS idx_party_expedition_assignment_history_window
  ON party_expedition_assignment_history(party_id, effective_from, effective_to);

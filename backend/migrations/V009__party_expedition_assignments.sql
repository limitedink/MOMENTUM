-- Generalized four-slot expedition assignments and server-owned player profiles.
-- The legacy forest columns remain in party_states for backwards-compatible
-- clients while the JSON profile is the authoritative input to scoring.

ALTER TABLE party_states
  ADD COLUMN IF NOT EXISTS expedition_id TEXT NOT NULL DEFAULT 'forest';

CREATE TABLE IF NOT EXISTS party_expedition_assignments (
  party_id UUID NOT NULL REFERENCES party_states(party_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  player_id UUID NOT NULL,
  role_id TEXT NOT NULL,
  target_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  PRIMARY KEY (party_id, slot_id),
  CONSTRAINT party_expedition_assignments_membership_fk
    FOREIGN KEY (party_id, player_id)
    REFERENCES party_memberships(party_id, player_id)
    ON DELETE CASCADE,
  CONSTRAINT party_expedition_assignments_slot_check
    CHECK (slot_id ~ '^slot-[1-4]$')
);

CREATE INDEX IF NOT EXISTS idx_party_expedition_assignments_player
  ON party_expedition_assignments(party_id, player_id, active);

CREATE TABLE IF NOT EXISTS player_profiles (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_player_profiles_updated_at'
  ) THEN
    CREATE TRIGGER trg_player_profiles_updated_at
    BEFORE UPDATE ON player_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_player_profiles_updated_at
  ON player_profiles(updated_at);

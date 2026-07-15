-- Versioned. Persistent parties and one-party-per-player memberships.

CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  join_code TEXT NOT NULL UNIQUE,
  max_members SMALLINT NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parties_max_members_check CHECK (max_members BETWEEN 2 AND 8)
);

CREATE TABLE IF NOT EXISTS party_memberships (
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, player_id),
  CONSTRAINT party_memberships_one_party_per_player UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS idx_party_memberships_party_id
  ON party_memberships(party_id);

CREATE OR REPLACE FUNCTION ensure_party_leader_membership()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM party_memberships
    WHERE party_id = NEW.id AND player_id = NEW.leader_id
  ) THEN
    RAISE EXCEPTION 'party leader must be a party member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_party_leader_membership'
  ) THEN
    CREATE CONSTRAINT TRIGGER trg_party_leader_membership
    AFTER INSERT OR UPDATE OF leader_id ON parties
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ensure_party_leader_membership();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parties_updated_at'
  ) THEN
    CREATE TRIGGER trg_parties_updated_at
    BEFORE UPDATE ON parties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

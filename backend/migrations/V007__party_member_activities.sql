-- Persist the activity each party member has selected for the shared roster.
-- The party state revision is still the broadcast/version boundary; this table
-- keeps the member choice available after reconnects and backend restarts.
CREATE TABLE IF NOT EXISTS party_member_activities (
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  activity_id TEXT NOT NULL DEFAULT 'rest',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, player_id),
  CONSTRAINT party_member_activities_membership_fk
    FOREIGN KEY (party_id, player_id)
    REFERENCES party_memberships(party_id, player_id)
    ON DELETE CASCADE,
  CONSTRAINT party_member_activities_activity_check
    CHECK (activity_id IN ('forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'))
);

CREATE INDEX IF NOT EXISTS idx_party_member_activities_updated_at
  ON party_member_activities(updated_at);

-- Record activity changes during an expedition and create one claimable reward
-- per member when the server reconciles the expedition as complete.

CREATE TABLE IF NOT EXISTS party_state_activity_segments (
  id BIGSERIAL PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES party_states(party_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CONSTRAINT party_state_activity_segments_activity_check
    CHECK (activity_id IN ('forest_patrol', 'pine_chopping', 'camp_cooking', 'rest')),
  CONSTRAINT party_state_activity_segments_time_check
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_party_state_activity_segments_lookup
  ON party_state_activity_segments(party_id, player_id, started_at);

CREATE TABLE IF NOT EXISTS party_state_rewards (
  party_id UUID NOT NULL REFERENCES party_states(party_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL,
  reward_json JSONB NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, player_id, reward_id)
);

CREATE INDEX IF NOT EXISTS idx_party_state_rewards_pending
  ON party_state_rewards(party_id, player_id, created_at)
  WHERE claimed_at IS NULL;

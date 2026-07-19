-- Development identity names are presentation data; player IDs remain immutable
-- authentication and ownership identifiers.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE players
SET display_name = 'Player'
WHERE display_name IS NULL;

ALTER TABLE players
  ALTER COLUMN display_name SET DEFAULT 'Player',
  ALTER COLUMN display_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'players_display_name_length_check'
  ) THEN
    ALTER TABLE players
      ADD CONSTRAINT players_display_name_length_check
      CHECK (char_length(display_name) BETWEEN 1 AND 24);
  END IF;
END $$;

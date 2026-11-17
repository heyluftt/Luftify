-- Position events and checkpoints previously shared one timestamp. That made
-- the persisted seek counter unreliable, while listening time remained valid.
UPDATE listening_sessions
SET seek_count = 0;

-- An unfinished row can only stem from an earlier process lifetime. Closing it
-- keeps later checkpoints from making the historical session look live.
UPDATE listening_sessions
SET ended_at_ms = updated_at_ms,
    end_reason = COALESCE(end_reason, 'unclean-shutdown')
WHERE ended_at_ms IS NULL;

-- P1.5-4: one pending IMAP STORE per message (seen / flagged).
CREATE UNIQUE INDEX IF NOT EXISTS idx_local_actions_message_flag
    ON local_actions (message_id, kind)
    WHERE kind IN ('imap_seen', 'imap_flagged');
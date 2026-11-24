-- CONDSTORE cursor on sync_state; local sender classification stats (not SmartBack).
ALTER TABLE sync_state ADD COLUMN highest_modseq INTEGER;

CREATE TABLE sender_category_stats (
    account_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    from_addr           TEXT    NOT NULL,
    person_count        INTEGER NOT NULL DEFAULT 0,
    notification_count  INTEGER NOT NULL DEFAULT 0,
    newsletter_count    INTEGER NOT NULL DEFAULT 0,
    other_count         INTEGER NOT NULL DEFAULT 0,
    last_parsed_category TEXT,
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (account_id, from_addr)
);

CREATE INDEX idx_sender_category_stats_account ON sender_category_stats (account_id);
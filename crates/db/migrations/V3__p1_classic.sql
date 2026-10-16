-- P1: Smart Inbox, FTS5, snooze/pin, threads, signatures/drafts, send-later.

ALTER TABLE messages ADD COLUMN list_unsubscribe TEXT;
ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN snoozed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN snooze_until TEXT;
ALTER TABLE messages ADD COLUMN thread_key TEXT;
ALTER TABLE messages ADD COLUMN category_manual INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_messages_category ON messages (folder_id, category, date_utc DESC);
CREATE INDEX idx_messages_thread ON messages (account_id, thread_key, date_utc DESC);
CREATE INDEX idx_messages_snooze ON messages (snoozed, snooze_until);
CREATE INDEX idx_messages_pinned ON messages (folder_id, pinned DESC, date_utc DESC);

-- FTS5 over envelope + body text (aligns with Classic search_fts5 field set).
CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_id UNINDEXED,
    message_from,
    message_to,
    subject,
    search_body,
    additional_text,
    tokenize = 'unicode61'
);

ALTER TABLE outbox ADD COLUMN send_at TEXT;
ALTER TABLE outbox ADD COLUMN draft_id INTEGER;

CREATE TABLE signatures (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    body_text       TEXT    NOT NULL,
    is_default      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE drafts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_addrs        TEXT    NOT NULL DEFAULT '',
    cc_addrs        TEXT    NOT NULL DEFAULT '',
    subject         TEXT    NOT NULL DEFAULT '',
    text_body       TEXT    NOT NULL DEFAULT '',
    in_reply_to     TEXT,
    references_header TEXT,
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Optional per-sender category override (local; not Spark SmartBack).
CREATE TABLE sender_category (
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    from_addr       TEXT    NOT NULL,
    category        TEXT    NOT NULL,
    PRIMARY KEY (account_id, from_addr)
);

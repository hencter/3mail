-- P0 schema aligned with architecture.md / behavior-spec (envelope + sync cursors).
-- No plaintext secrets. Bodies lazy-loaded. FTS deferred to P1.

CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL UNIQUE,
    display_name    TEXT,
    imap_host       TEXT    NOT NULL,
    imap_port       INTEGER NOT NULL,
    smtp_host       TEXT    NOT NULL,
    smtp_port       INTEGER NOT NULL,
    -- Keyring service/user suffix; secret never stored here.
    keyring_user    TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE folders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    imap_path       TEXT    NOT NULL,
    role            TEXT,          -- inbox | sent | drafts | trash | archive | other
    uidvalidity     INTEGER,
    uidnext         INTEGER,
    highest_modseq  INTEGER,
    total_count     INTEGER NOT NULL DEFAULT 0,
    unseen_count    INTEGER NOT NULL DEFAULT 0,
    last_sync_at    TEXT,
    UNIQUE (account_id, imap_path)
);

CREATE TABLE messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id           INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid                 INTEGER NOT NULL,
    message_id_header   TEXT,
    in_reply_to         TEXT,
    references_header   TEXT,
    subject             TEXT,
    from_addr           TEXT,
    to_addrs            TEXT,
    cc_addrs            TEXT,
    date_utc            TEXT,
    unseen              INTEGER NOT NULL DEFAULT 1,
    starred             INTEGER NOT NULL DEFAULT 0,
    answered            INTEGER NOT NULL DEFAULT 0,
    has_attachments     INTEGER NOT NULL DEFAULT 0,
    snippet             TEXT,
    category            TEXT    NOT NULL DEFAULT 'other',
    size_bytes          INTEGER,
    UNIQUE (account_id, folder_id, uid)
);

CREATE INDEX idx_messages_folder_date ON messages (folder_id, date_utc DESC);
CREATE INDEX idx_messages_unseen ON messages (folder_id, unseen);

CREATE TABLE bodies (
    message_id  INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    text_body   TEXT,
    html_body   TEXT,
    fetched_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE attachments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    part_id         TEXT,
    filename        TEXT,
    mime_type       TEXT,
    size_bytes      INTEGER,
    local_path      TEXT
);

CREATE TABLE sync_state (
    folder_id       INTEGER PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
    uidvalidity     INTEGER,
    uidnext         INTEGER,
    last_error      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_addrs        TEXT    NOT NULL,
    cc_addrs        TEXT,
    subject         TEXT    NOT NULL,
    text_body       TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed
    last_error      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at         TEXT
);

-- P1 placeholders (unused in P0 UI).
CREATE TABLE local_actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL, -- snooze | pin | send_later
    payload_json    TEXT,
    due_at          TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

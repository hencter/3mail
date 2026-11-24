-- P1.5-52: stable Message-ID for IMAP draft APPEND + link to synced server row.
ALTER TABLE drafts ADD COLUMN message_id_header TEXT;
ALTER TABLE drafts ADD COLUMN server_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;
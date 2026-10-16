-- A local draft opened from a message already sitting in the Drafts mailbox.
ALTER TABLE drafts ADD COLUMN source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;

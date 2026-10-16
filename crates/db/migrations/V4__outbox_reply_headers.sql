-- Persist threading headers for scheduled sends (P1-6).
ALTER TABLE outbox ADD COLUMN in_reply_to TEXT;
ALTER TABLE outbox ADD COLUMN references_header TEXT;

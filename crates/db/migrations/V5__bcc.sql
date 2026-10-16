-- Bcc for local drafts and scheduled sends (P1.5-25).
ALTER TABLE drafts ADD COLUMN bcc_addrs TEXT NOT NULL DEFAULT '';
ALTER TABLE outbox ADD COLUMN bcc_addrs TEXT;

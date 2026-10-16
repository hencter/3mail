-- HTML compose (P1.5-43): drafts / scheduled sends / signatures carry an HTML body.
ALTER TABLE drafts ADD COLUMN html_body TEXT;
ALTER TABLE outbox ADD COLUMN html_body TEXT;
ALTER TABLE signatures ADD COLUMN body_html TEXT;

-- P1.5-40: envelopes synced earlier lost display names. Forgetting uidnext makes the next
-- sync of each folder re-fetch its recent envelopes (rows are upserted, nothing is deleted).
UPDATE sync_state SET uidnext = NULL;

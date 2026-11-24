-- P1.5-26: staged paths for files attached at compose time (JSON array).

ALTER TABLE outbox ADD COLUMN attachments_json TEXT;
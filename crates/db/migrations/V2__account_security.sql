-- Persist IMAP/SMTP TLS mode (ssl = implicit TLS, starttls = upgrade).
ALTER TABLE accounts ADD COLUMN imap_security TEXT NOT NULL DEFAULT 'ssl';
ALTER TABLE accounts ADD COLUMN smtp_security TEXT NOT NULL DEFAULT 'starttls';

ALTER TABLE authorized_persons ADD COLUMN request_date TEXT;

-- Dla istniejących rekordów ustawiamy datę wniosku na datę utworzenia (YYYY-MM-DD),
-- aby rekordy historyczne miały wypełnione pole.
UPDATE authorized_persons
SET request_date = substr(created_at, 1, 10)
WHERE request_date IS NULL;

DROP INDEX IF EXISTS idx_authorized_persons_pesel_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_persons_pesel_request_date_unique
ON authorized_persons(pesel, request_date)
WHERE pesel IS NOT NULL AND request_date IS NOT NULL;

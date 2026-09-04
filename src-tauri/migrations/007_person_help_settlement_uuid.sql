ALTER TABLE person_help_entries
ADD COLUMN settlement_uuid TEXT;

ALTER TABLE person_help_entries
ADD COLUMN invoice_number TEXT;

ALTER TABLE person_help_entries
ADD COLUMN stay_from TEXT;

ALTER TABLE person_help_entries
ADD COLUMN stay_to TEXT;

ALTER TABLE person_help_entries
ADD COLUMN stay_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_person_help_entries_settlement_uuid
ON person_help_entries(settlement_uuid);

CREATE INDEX IF NOT EXISTS idx_person_help_entries_invoice_number
ON person_help_entries(invoice_number);

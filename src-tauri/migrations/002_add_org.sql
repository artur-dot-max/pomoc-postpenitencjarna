CREATE TABLE IF NOT EXISTS organization_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  org_name       TEXT,
  center_name    TEXT,
  contact_person TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

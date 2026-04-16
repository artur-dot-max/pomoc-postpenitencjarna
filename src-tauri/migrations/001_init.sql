PRAGMA foreign_keys = ON;

-- Proste role/uprawnienia
-- Admin: wszystko
-- Staff: dodaje/edytuje, raporty, eksport
-- ReadOnly: tylko podgląd
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('Admin','Staff','ReadOnly')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  pesel       TEXT,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_last_name ON clients(last_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_pesel_unique ON clients(pesel) WHERE pesel IS NOT NULL;

-- Dane osoby uprawnionej (podstawowe)
CREATE TABLE IF NOT EXISTS authorized_persons (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name                TEXT NOT NULL,
  last_name                 TEXT NOT NULL,
  citizenship               TEXT,
  pesel                     TEXT,
  birth_date                TEXT,
  phone                     TEXT,
  email                     TEXT,
  gender                    TEXT CHECK (gender IN ('K', 'M', 'INNE', 'NIE_PODANO')),
  ukr_status                INTEGER NOT NULL DEFAULT 0 CHECK (ukr_status IN (0, 1)),
  address                   TEXT,
  identity_document         TEXT,
  marital_status            TEXT CHECK (marital_status IN ('PANNA_KAWALER', 'MALZENSTWO', 'ROZWOD', 'WDOWIEC_WDOWA', 'SEPARACJA', 'NIE_PODANO')),
  disability                TEXT,
  funds_on_release          REAL,
  detention_facility        TEXT,
  info_source               TEXT,
  assistance_needed         TEXT,
  incarceration_date        TEXT,
  release_date              TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_authorized_persons_last_name ON authorized_persons(last_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_persons_pesel_unique ON authorized_persons(pesel) WHERE pesel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_authorized_persons_release_date ON authorized_persons(release_date);

CREATE TABLE IF NOT EXISTS help_types (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  help_type_id  INTEGER NOT NULL,
  worker_id     INTEGER NOT NULL,     -- pracownik (user)
  provided_at   TEXT NOT NULL,         -- np. '2025-12-30' albo '2025-12-30 14:00'
  quantity      REAL DEFAULT 1,
  unit          TEXT,
  notes         TEXT,

  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (help_type_id) REFERENCES help_types(id),
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_help_events_client_date ON help_events(client_id, provided_at);
CREATE INDEX IF NOT EXISTS idx_help_events_type_date ON help_events(help_type_id, provided_at);
CREATE INDEX IF NOT EXISTS idx_help_events_worker_date ON help_events(worker_id, provided_at);

-- Udzielona pomoc (prosty zapis)
CREATE TABLE IF NOT EXISTS assistance_records (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  authorized_person_id     INTEGER NOT NULL,
  provided_at              TEXT NOT NULL,
  support_type             TEXT NOT NULL,
  amount                   REAL,
  description              TEXT,
  helper_full_name         TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (authorized_person_id) REFERENCES authorized_persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assistance_records_date ON assistance_records(provided_at);
CREATE INDEX IF NOT EXISTS idx_assistance_records_person_date ON assistance_records(authorized_person_id, provided_at);

-- Dane organizacji (pojedynczy rekord)
CREATE TABLE IF NOT EXISTS organization_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  org_name       TEXT,
  center_name    TEXT,
  contact_person TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup_crypto;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rand::RngCore;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_sql::Builder;

#[derive(Serialize)]
struct ImportResult {
    mode: String,
    imported_persons: usize,
    imported_help_entries: usize,
    imported_users: usize,
    skipped_duplicate_persons: usize,
    skipped_duplicate_help_entries: usize,
}

#[derive(Debug)]
struct PersonRow {
    id: i64,
    person_uuid: Option<String>,
    request_number: Option<String>,
    request_date: Option<String>,
    assistance_extension_approved: Option<i64>,
    correspondence_assistance: Option<i64>,
    first_name: Option<String>,
    last_name: Option<String>,
    citizenship: Option<String>,
    pesel: Option<String>,
    birth_date: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    gender: Option<String>,
    ukr_status: Option<i64>,
    address: Option<String>,
    identity_document: Option<String>,
    marital_status: Option<String>,
    disability: Option<String>,
    funds_on_release: Option<f64>,
    detention_facility: Option<String>,
    incarceration_date: Option<String>,
    release_date: Option<String>,
    info_source: Option<String>,
    assistance_needed: Option<String>,
    created_at: Option<String>,
}

#[derive(Debug)]
struct HelpRow {
    id: i64,
    event_uuid: Option<String>,
    person_id: i64,
    help_date: Option<String>,
    help_type: Option<String>,
    help_type_label: Option<String>,
    help_amount: Option<f64>,
    help_quantity: Option<f64>,
    help_provider: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug)]
struct OrgRow {
    id: i64,
    org_name: Option<String>,
    center_name: Option<String>,
    contract_number: Option<String>,
    contact_person: Option<String>,
    contact_phone: Option<String>,
    contact_email: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug)]
struct UserImportRow {
    id: i64,
    username: String,
    password_hash: String,
    role: String,
    is_active: i64,
    first_name: Option<String>,
    last_name: Option<String>,
    position: Option<String>,
}

const ENSURE_HELP_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS person_help_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid      TEXT UNIQUE,
  person_id       INTEGER NOT NULL,
  help_date       TEXT,
  help_type       TEXT,
  help_type_label TEXT,
  help_amount     REAL,
  help_quantity   REAL,
  help_provider   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
)
"#;
const LICENSE_FILE_NAME: &str = "license.dat";
const LICENSE_SECRET: &str = "PP-LIC-2026-CHANGE-THIS-SECRET";

#[derive(Serialize)]
struct LicenseStatus {
    activated: bool,
}

fn sha256_hex_upper(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02X}"));
    }
    out
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

fn activation_token(license_key: &str) -> String {
    sha256_hex_upper(&format!("ACTIVATED|{}|{}", license_key, LICENSE_SECRET))
}

fn allowed_license_keys() -> HashSet<String> {
    include_str!("../license_keys.txt")
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(normalize_key)
        .filter(|line| !line.is_empty())
        .collect()
}

fn allowed_recovery_codes() -> HashSet<String> {
    include_str!("../recovery_codes.txt")
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(normalize_key)
        .filter(|line| !line.is_empty())
        .collect()
}

fn ensure_users_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL,
          is_active     INTEGER NOT NULL DEFAULT 1,
          first_name    TEXT,
          last_name     TEXT,
          position      TEXT
        )
        "#,
    )
}

fn license_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app_db_path(app)?;
    path.set_file_name(LICENSE_FILE_NAME);
    Ok(path)
}

#[tauri::command]
fn license_status(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    let path = license_file_path(&app)?;
    let activated_token = fs::read_to_string(path)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let activated = !activated_token.is_empty();
    Ok(LicenseStatus { activated })
}

#[tauri::command]
fn activate_license_key(app: tauri::AppHandle, license_key: String) -> Result<(), String> {
    let normalized_input = normalize_key(&license_key);
    if normalized_input.is_empty() {
        return Err("Nie podano klucza licencji.".to_string());
    }
    let allowed = allowed_license_keys();
    if !allowed.contains(&normalized_input) {
        return Err("Nieprawidłowy klucz licencji.".to_string());
    }
    let path = license_file_path(&app)?;
    fs::write(path, activation_token(&normalized_input))
        .map_err(|e| format!("Nie udało się zapisać aktywacji licencji: {e}"))?;
    Ok(())
}

fn ensure_used_recovery_codes_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS used_recovery_codes (
          code     TEXT PRIMARY KEY,
          used_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
}

const USED_RECOVERY_CODE_MESSAGE: &str =
    "Wpisany kod resetu hasła zostal już wcześniej wykorzystany, proszę o kontakt telefoniczny lub mailowy w celu uzyskania nowego kodu";

#[tauri::command]
fn verify_recovery_code(
    app: tauri::AppHandle,
    recovery_code: String,
    db_path: Option<String>,
) -> Result<(), String> {
    let normalized_input = normalize_key(&recovery_code);
    if normalized_input.is_empty() {
        return Err("Nie podano kodu resetu.".to_string());
    }
    let allowed = allowed_recovery_codes();
    if !allowed.contains(&normalized_input) {
        return Err("Nieprawidłowy kod resetu hasła.".to_string());
    }
    let _ = db_path;
    ensure_recovery_code_available(&app, &normalized_input)?;
    Ok(())
}

#[tauri::command]
fn reset_password_with_recovery_code(
    app: tauri::AppHandle,
    username: String,
    new_password: String,
    recovery_code: String,
    db_path: Option<String>,
) -> Result<(), String> {
    let normalized_input = normalize_key(&recovery_code);
    if normalized_input.is_empty() {
        return Err("Nie podano kodu resetu.".to_string());
    }
    let allowed = allowed_recovery_codes();
    if !allowed.contains(&normalized_input) {
        return Err("Nieprawidłowy kod resetu hasła.".to_string());
    }

    let trimmed_username = username.trim();
    if trimmed_username.is_empty() {
        return Err("Podaj login użytkownika.".to_string());
    }
    let trimmed_password = new_password.trim();
    if trimmed_password.is_empty() {
        return Err("Podaj nowe hasło.".to_string());
    }

    let db_path = resolve_contract_db_path(&app, db_path)?;
    let mut conn =
        Connection::open(&db_path).map_err(|e| format!("Nie udało się otworzyć bazy danych: {e}"))?;
    ensure_users_table(&conn)
        .map_err(|e| format!("Nie udało się przygotować tabeli użytkowników: {e}"))?;
    ensure_recovery_code_available(&app, &normalized_input)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Nie udało się rozpocząć resetu hasła: {e}"))?;
    let affected = tx
        .execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            params![trimmed_password, trimmed_username],
        )
        .map_err(|e| format!("Nie udało się zresetować hasła: {e}"))?;
    if affected == 0 {
        return Err("Nie znaleziono użytkownika o podanym loginie.".to_string());
    }
    tx.commit()
        .map_err(|e| format!("Nie udało się zatwierdzić resetu hasła: {e}"))?;
    mark_recovery_code_used(&app, &normalized_input)?;
    Ok(())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn sqlite_string_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Nie udało się pobrać katalogu danych aplikacji: {e}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Nie udało się utworzyć katalogu danych aplikacji: {e}"))?;
    Ok(app_dir.join("app.db"))
}

fn resolve_contract_db_path(
    app: &tauri::AppHandle,
    db_path: Option<String>,
) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Nie udało się pobrać katalogu danych aplikacji: {e}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Nie udało się utworzyć katalogu danych aplikacji: {e}"))?;

    let raw = db_path.unwrap_or_else(|| "app.db".to_string());
    let trimmed = raw.trim();
    let relative = if trimmed.is_empty() { "app.db" } else { trimmed };
    let candidate = PathBuf::from(relative);
    if candidate.is_absolute() || candidate.components().count() != 1 {
        return Err("Nieprawidłowa ścieżka bazy danych.".to_string());
    }

    Ok(app_dir.join(candidate))
}

fn create_database_snapshot(source_path: &PathBuf) -> Result<PathBuf, String> {
    if !source_path.exists() {
        return Err("Plik bazy danych nie istnieje.".to_string());
    }

    let parent = source_path
        .parent()
        .ok_or_else(|| "Nie udało się ustalić katalogu bazy danych.".to_string())?;
    let snapshot_path = parent.join(format!("export-snapshot-{}.db", now_millis()));

    let source_conn =
        Connection::open(source_path).map_err(|e| format!("Nie udało się otworzyć bazy danych: {e}"))?;
    let snapshot_sql = format!(
        "VACUUM INTO '{}'",
        sqlite_string_literal(&snapshot_path.to_string_lossy())
    );
    source_conn
        .execute(&snapshot_sql, [])
        .map_err(|e| format!("Nie udało się przygotować spójnej migawki bazy danych: {e}"))?;

    Ok(snapshot_path)
}

fn validate_export_file_name(file_name: &str, default_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    let candidate = if trimmed.is_empty() { default_name } else { trimmed };
    let path = Path::new(candidate);
    if path.is_absolute() || path.components().count() != 1 {
        return Err("Nieprawidłowa nazwa pliku w archiwum.".to_string());
    }
    let mut normalized = candidate.to_string();
    if !normalized.to_lowercase().ends_with(".db") {
        normalized.push_str(".db");
    }
    Ok(normalized)
}

fn create_database_snapshot_with_file_name(
    source_path: &PathBuf,
    file_name: &str,
) -> Result<PathBuf, String> {
    if !source_path.exists() {
        return Err("Plik bazy danych nie istnieje.".to_string());
    }

    let parent = source_path
        .parent()
        .ok_or_else(|| "Nie udało się ustalić katalogu bazy danych.".to_string())?;
    let temp_dir = parent.join(format!("export-snapshot-{}", now_millis()));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Nie udało się przygotować katalogu eksportu: {e}"))?;
    let snapshot_file_name = validate_export_file_name(file_name, "baza_danych.db")?;
    let snapshot_path = temp_dir.join(snapshot_file_name);

    let source_conn =
        Connection::open(source_path).map_err(|e| format!("Nie udało się otworzyć bazy danych: {e}"))?;
    let snapshot_sql = format!(
        "VACUUM INTO '{}'",
        sqlite_string_literal(&snapshot_path.to_string_lossy())
    );
    source_conn
        .execute(&snapshot_sql, [])
        .map_err(|e| format!("Nie udało się przygotować spójnej migawki bazy danych: {e}"))?;

    Ok(snapshot_path)
}

fn cleanup_snapshot_path(snapshot_path: &Path) {
    let _ = fs::remove_file(snapshot_path);
    if let Some(parent) = snapshot_path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn create_person_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

fn recovery_registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app_db_path(app)?;
    path.set_file_name("recovery_codes.db");
    Ok(path)
}

fn open_recovery_registry(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = recovery_registry_path(app)?;
    let conn =
        Connection::open(&path).map_err(|e| format!("Nie udało się otworzyć rejestru kodów resetu: {e}"))?;
    ensure_used_recovery_codes_table(&conn)
        .map_err(|e| format!("Nie udało się przygotować rejestru kodów resetu: {e}"))?;
    Ok(conn)
}

fn ensure_recovery_code_available(app: &tauri::AppHandle, normalized_input: &str) -> Result<(), String> {
    let conn = open_recovery_registry(app)?;
    let already_used: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM used_recovery_codes WHERE code = ?",
            params![normalized_input],
            |row| row.get(0),
        )
        .map_err(|e| format!("Nie udało się sprawdzić kodu resetu: {e}"))?;
    if already_used > 0 {
        return Err(USED_RECOVERY_CODE_MESSAGE.to_string());
    }
    Ok(())
}

fn mark_recovery_code_used(app: &tauri::AppHandle, normalized_input: &str) -> Result<(), String> {
    let conn = open_recovery_registry(app)?;
    conn.execute(
        "INSERT INTO used_recovery_codes (code, used_at) VALUES (?, datetime('now'))",
        params![normalized_input],
    )
    .map_err(|error| {
        if matches!(
            error,
            rusqlite::Error::SqliteFailure(_, Some(ref message))
                if message.contains("UNIQUE constraint failed: used_recovery_codes.code")
        ) {
            USED_RECOVERY_CODE_MESSAGE.to_string()
        } else {
            format!("Nie udało się zablokować kodu resetu: {error}")
        }
    })?;
    Ok(())
}

fn source_table_exists(source: &Connection, table_name: &str) -> rusqlite::Result<bool> {
    let count: i64 = source.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table_name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn source_column_exists(source: &Connection, table_name: &str, column_name: &str) -> rusqlite::Result<bool> {
    let mut stmt = source.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for column in columns {
        if column? == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn read_source_persons(source: &Connection) -> rusqlite::Result<Vec<PersonRow>> {
    let has_person_uuid = source_column_exists(source, "authorized_persons", "person_uuid")?;
    let has_request_number = source_column_exists(source, "authorized_persons", "request_number")?;
    let has_request_date = source_column_exists(source, "authorized_persons", "request_date")?;
    let has_assistance_extension =
        source_column_exists(source, "authorized_persons", "assistance_extension_approved")?;
    let has_correspondence_assistance =
        source_column_exists(source, "authorized_persons", "correspondence_assistance")?;
    let request_date_select = if has_request_date {
        "request_date"
    } else {
        "NULL AS request_date"
    };
    let request_number_select = if has_request_number {
        "request_number"
    } else {
        "NULL AS request_number"
    };
    let assistance_extension_select = if has_assistance_extension {
        "assistance_extension_approved"
    } else {
        "0 AS assistance_extension_approved"
    };
    let correspondence_assistance_select = if has_correspondence_assistance {
        "correspondence_assistance"
    } else {
        "0 AS correspondence_assistance"
    };
    let person_uuid_select = if has_person_uuid {
        "person_uuid"
    } else {
        "NULL AS person_uuid"
    };
    let sql = format!(
        r#"
        SELECT
          id, {request_number_select}, {request_date_select}, {assistance_extension_select}, {correspondence_assistance_select}, first_name, last_name, citizenship, pesel, birth_date, phone, email, gender,
          {person_uuid_select},
          ukr_status, address, identity_document, marital_status, disability, funds_on_release,
          detention_facility, incarceration_date, release_date, info_source, assistance_needed,
          created_at
        FROM authorized_persons
        ORDER BY id
        "#
    );
    let mut stmt = source.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(PersonRow {
            id: row.get(0)?,
            request_number: row.get(1)?,
            request_date: row.get(2)?,
            assistance_extension_approved: row.get(3)?,
            correspondence_assistance: row.get(4)?,
            first_name: row.get(5)?,
            last_name: row.get(6)?,
            citizenship: row.get(7)?,
            pesel: row.get(8)?,
            birth_date: row.get(9)?,
            phone: row.get(10)?,
            email: row.get(11)?,
            gender: row.get(12)?,
            person_uuid: row.get(13)?,
            ukr_status: row.get(14)?,
            address: row.get(15)?,
            identity_document: row.get(16)?,
            marital_status: row.get(17)?,
            disability: row.get(18)?,
            funds_on_release: row.get(19)?,
            detention_facility: row.get(20)?,
            incarceration_date: row.get(21)?,
            release_date: row.get(22)?,
            info_source: row.get(23)?,
            assistance_needed: row.get(24)?,
            created_at: row.get(25)?,
        })
    })?;
    rows.collect()
}

fn read_source_help(source: &Connection) -> rusqlite::Result<Vec<HelpRow>> {
    source.execute(ENSURE_HELP_TABLE_SQL, [])?;
    let has_event_uuid = source_column_exists(source, "person_help_entries", "event_uuid")?;
    let event_uuid_select = if has_event_uuid {
        "event_uuid"
    } else {
        "NULL AS event_uuid"
    };
    let mut stmt = source.prepare(
        &format!(
            r#"
        SELECT
          id, {event_uuid_select}, person_id, help_date, help_type, help_type_label, help_amount, help_quantity,
          help_provider, created_at, updated_at
        FROM person_help_entries
        ORDER BY id
        "#,
        ),
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(HelpRow {
            id: row.get(0)?,
            event_uuid: row.get(1)?,
            person_id: row.get(2)?,
            help_date: row.get(3)?,
            help_type: row.get(4)?,
            help_type_label: row.get(5)?,
            help_amount: row.get(6)?,
            help_quantity: row.get(7)?,
            help_provider: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

fn read_source_org(source: &Connection) -> rusqlite::Result<Option<OrgRow>> {
    let has_contract_number = source_column_exists(source, "organization_settings", "contract_number")?;
    let contract_number_select = if has_contract_number {
        "contract_number"
    } else {
        "NULL AS contract_number"
    };
    let mut stmt = source.prepare(
        &format!(
        r#"
        SELECT id, org_name, center_name, {contract_number_select}, contact_person, contact_phone, contact_email, updated_at
        FROM organization_settings
        WHERE id = 1
        LIMIT 1
        "#,
        ),
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        Ok(Some(OrgRow {
            id: row.get(0)?,
            org_name: row.get(1)?,
            center_name: row.get(2)?,
            contract_number: row.get(3)?,
            contact_person: row.get(4)?,
            contact_phone: row.get(5)?,
            contact_email: row.get(6)?,
            updated_at: row.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

fn read_source_users(source: &Connection) -> rusqlite::Result<Vec<UserImportRow>> {
    if !source_table_exists(source, "users")? {
      return Ok(Vec::new());
    }
    let mut stmt = source.prepare(
        r#"
        SELECT id, username, password_hash, role, is_active, first_name, last_name, position
        FROM users
        ORDER BY id
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(UserImportRow {
            id: row.get(0)?,
            username: row.get(1)?,
            password_hash: row.get(2)?,
            role: row.get(3)?,
            is_active: row.get(4)?,
            first_name: row.get(5)?,
            last_name: row.get(6)?,
            position: row.get(7)?,
        })
    })?;
    rows.collect()
}

fn ensure_target_schema(target: &Transaction<'_>) -> rusqlite::Result<()> {
    target.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS authorized_persons (
          id                        INTEGER PRIMARY KEY AUTOINCREMENT,
          person_uuid               TEXT UNIQUE,
          request_number            TEXT,
          request_date              TEXT,
          assistance_extension_approved INTEGER NOT NULL DEFAULT 0,
          correspondence_assistance INTEGER NOT NULL DEFAULT 0,
          first_name                TEXT NOT NULL,
          last_name                 TEXT NOT NULL,
          citizenship               TEXT,
          pesel                     TEXT,
          birth_date                TEXT,
          phone                     TEXT,
          email                     TEXT,
          gender                    TEXT,
          ukr_status                INTEGER NOT NULL DEFAULT 0,
          address                   TEXT,
          identity_document         TEXT,
          marital_status            TEXT,
          disability                TEXT,
          funds_on_release          REAL,
          detention_facility        TEXT,
          info_source               TEXT,
          assistance_needed         TEXT,
          incarceration_date        TEXT,
          release_date              TEXT,
          created_at                TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS organization_settings (
          id             INTEGER PRIMARY KEY CHECK (id = 1),
          org_name       TEXT,
          center_name    TEXT,
          contract_number TEXT,
          contact_person TEXT,
          contact_phone  TEXT,
          contact_email  TEXT,
          updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL,
          is_active     INTEGER NOT NULL DEFAULT 1,
          first_name    TEXT,
          last_name     TEXT,
          position      TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_persons_person_uuid_unique
        ON authorized_persons(person_uuid)
        WHERE person_uuid IS NOT NULL AND TRIM(COALESCE(person_uuid, '')) <> '';
        "#,
    )?;
    let mut stmt = target.prepare("PRAGMA table_info(authorized_persons)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut has_correspondence_assistance = false;
    let mut has_person_uuid = false;
    let mut has_request_number = false;
    for column in columns {
        let column_name = column?;
        if column_name == "correspondence_assistance" {
            has_correspondence_assistance = true;
        }
        if column_name == "person_uuid" {
            has_person_uuid = true;
        }
        if column_name == "request_number" {
            has_request_number = true;
        }
    }
    if !has_correspondence_assistance {
        target.execute(
            "ALTER TABLE authorized_persons ADD COLUMN correspondence_assistance INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !has_person_uuid {
        target.execute("ALTER TABLE authorized_persons ADD COLUMN person_uuid TEXT", [])?;
    }
    if !has_request_number {
        target.execute("ALTER TABLE authorized_persons ADD COLUMN request_number TEXT", [])?;
    }
    let mut missing_uuid_stmt = target.prepare(
        "SELECT id FROM authorized_persons WHERE person_uuid IS NULL OR TRIM(COALESCE(person_uuid, '')) = ''",
    )?;
    let missing_uuid_rows = missing_uuid_stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut missing_ids = Vec::new();
    for item in missing_uuid_rows {
        missing_ids.push(item?);
    }
    drop(missing_uuid_stmt);
    for person_id in missing_ids {
        target.execute(
            "UPDATE authorized_persons SET person_uuid = ? WHERE id = ?",
            params![create_person_uuid(), person_id],
        )?;
    }
    target.execute("DROP INDEX IF EXISTS idx_authorized_persons_pesel_request_date_unique", [])?;
    target.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_persons_person_uuid_unique ON authorized_persons(person_uuid) WHERE person_uuid IS NOT NULL AND TRIM(COALESCE(person_uuid, '')) <> ''",
        [],
    )?;
    target.execute(ENSURE_HELP_TABLE_SQL, [])?;
    let mut help_stmt = target.prepare("PRAGMA table_info(person_help_entries)")?;
    let help_columns = help_stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut has_event_uuid = false;
    for column in help_columns {
        if column? == "event_uuid" {
            has_event_uuid = true;
            break;
        }
    }
    if !has_event_uuid {
        target.execute("ALTER TABLE person_help_entries ADD COLUMN event_uuid TEXT", [])?;
    }
    target.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_person_help_entries_event_uuid ON person_help_entries(event_uuid)",
        [],
    )?;
    let mut org_stmt = target.prepare("PRAGMA table_info(organization_settings)")?;
    let org_columns = org_stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut has_contract_number = false;
    for column in org_columns {
        if column? == "contract_number" {
            has_contract_number = true;
            break;
        }
    }
    if !has_contract_number {
        target.execute(
            "ALTER TABLE organization_settings ADD COLUMN contract_number TEXT",
            [],
        )?;
    }
    Ok(())
}

fn import_replace(
    target: &Transaction<'_>,
    persons: &[PersonRow],
    helps: &[HelpRow],
    users: &[UserImportRow],
    org: &Option<OrgRow>,
) -> rusqlite::Result<ImportResult> {
    target.execute("DELETE FROM person_help_entries", [])?;
    target.execute("DELETE FROM authorized_persons", [])?;
    target.execute("DELETE FROM organization_settings", [])?;
    target.execute("DELETE FROM users", [])?;
    target.execute(
        "DELETE FROM sqlite_sequence WHERE name IN ('authorized_persons', 'person_help_entries', 'users')",
        [],
    )?;

    for person in persons {
        target.execute(
            r#"
            INSERT INTO authorized_persons (
              id, person_uuid, request_number, request_date, assistance_extension_approved, correspondence_assistance, first_name, last_name, citizenship, pesel, birth_date, phone, email, gender,
              ukr_status, address, identity_document, marital_status, disability, funds_on_release,
              detention_facility, incarceration_date, release_date, info_source, assistance_needed,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                person.id,
                person
                    .person_uuid
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(create_person_uuid),
                person.request_number,
                person.request_date,
                person.assistance_extension_approved.unwrap_or(0),
                person.correspondence_assistance.unwrap_or(0),
                person.first_name,
                person.last_name,
                person.citizenship,
                person.pesel,
                person.birth_date,
                person.phone,
                person.email,
                person.gender,
                person.ukr_status.unwrap_or(0),
                person.address,
                person.identity_document,
                person.marital_status,
                person.disability,
                person.funds_on_release,
                person.detention_facility,
                person.incarceration_date,
                person.release_date,
                person.info_source,
                person.assistance_needed,
                person.created_at,
            ],
        )?;
    }

    for help in helps {
        target.execute(
            r#"
            INSERT INTO person_help_entries (
              id, event_uuid, person_id, help_date, help_type, help_type_label, help_amount, help_quantity,
              help_provider, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                help.id,
                help.event_uuid,
                help.person_id,
                help.help_date,
                help.help_type,
                help.help_type_label,
                help.help_amount,
                help.help_quantity,
                help.help_provider,
                help.created_at,
                help.updated_at,
            ],
        )?;
    }

    for user in users {
        target.execute(
            r#"
            INSERT INTO users (
              id, username, password_hash, role, is_active, first_name, last_name, position
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                user.id,
                user.username,
                user.password_hash,
                user.role,
                user.is_active,
                user.first_name,
                user.last_name,
                user.position,
            ],
        )?;
    }

    if let Some(org_row) = org {
        target.execute(
            r#"
            INSERT INTO organization_settings (
              id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                org_row.id,
                org_row.org_name,
                org_row.center_name,
                org_row.contract_number,
                org_row.contact_person,
                org_row.contact_phone,
                org_row.contact_email,
                org_row.updated_at
            ],
        )?;
    }

    Ok(ImportResult {
        mode: "replace".to_string(),
        imported_persons: persons.len(),
        imported_help_entries: helps.len(),
        imported_users: users.len(),
        skipped_duplicate_persons: 0,
        skipped_duplicate_help_entries: 0,
    })
}

fn import_append(
    target: &Transaction<'_>,
    persons: &[PersonRow],
    helps: &[HelpRow],
    users: &[UserImportRow],
    org: &Option<OrgRow>,
) -> rusqlite::Result<ImportResult> {
    let mut person_map: HashMap<i64, i64> = HashMap::new();
    let mut imported_persons = 0usize;
    let mut skipped_duplicate_persons = 0usize;

    for person in persons {
        let normalized_person_uuid = person
            .person_uuid
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if let Some(person_uuid) = normalized_person_uuid.as_ref() {
            let existing_person_id: Option<i64> = target
                .query_row(
                    "SELECT id FROM authorized_persons WHERE person_uuid = ? LIMIT 1",
                    params![person_uuid],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(existing_id) = existing_person_id {
                person_map.insert(person.id, existing_id);
                skipped_duplicate_persons += 1;
                continue;
            }
        }

        target.execute(
            r#"
            INSERT INTO authorized_persons (
              person_uuid, request_number, request_date, assistance_extension_approved, correspondence_assistance, first_name, last_name, citizenship, pesel, birth_date, phone, email, gender,
              ukr_status, address, identity_document, marital_status, disability, funds_on_release,
              detention_facility, incarceration_date, release_date, info_source, assistance_needed,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                normalized_person_uuid.unwrap_or_else(create_person_uuid),
                person.request_number,
                person.request_date,
                person.assistance_extension_approved.unwrap_or(0),
                person.correspondence_assistance.unwrap_or(0),
                person.first_name,
                person.last_name,
                person.citizenship,
                person.pesel,
                person.birth_date,
                person.phone,
                person.email,
                person.gender,
                person.ukr_status.unwrap_or(0),
                person.address,
                person.identity_document,
                person.marital_status,
                person.disability,
                person.funds_on_release,
                person.detention_facility,
                person.incarceration_date,
                person.release_date,
                person.info_source,
                person.assistance_needed,
                person.created_at,
            ],
        )?;
        person_map.insert(person.id, target.last_insert_rowid());
        imported_persons += 1;
    }

    let mut imported_help_entries = 0usize;
    let mut skipped_duplicate_help_entries = 0usize;
    for help in helps {
        let Some(new_person_id) = person_map.get(&help.person_id) else {
            continue;
        };

        if let Some(event_uuid) = help.event_uuid.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
            let existing_by_uuid: Option<i64> = target
                .query_row(
                    "SELECT id FROM person_help_entries WHERE event_uuid = ? LIMIT 1",
                    params![event_uuid],
                    |row| row.get(0),
                )
                .optional()?;
            if existing_by_uuid.is_some() {
                skipped_duplicate_help_entries += 1;
                continue;
            }
        } else {
            let existing_help_id: Option<i64> = target
                .query_row(
                    r#"
                    SELECT id
                    FROM person_help_entries
                    WHERE person_id = ?
                      AND COALESCE(help_date, '') = COALESCE(?, '')
                      AND COALESCE(help_type, '') = COALESCE(?, '')
                      AND COALESCE(help_type_label, '') = COALESCE(?, '')
                      AND COALESCE(help_amount, -999999999.0) = COALESCE(?, -999999999.0)
                      AND COALESCE(help_quantity, -999999999.0) = COALESCE(?, -999999999.0)
                      AND COALESCE(help_provider, '') = COALESCE(?, '')
                    LIMIT 1
                    "#,
                    params![
                        new_person_id,
                        help.help_date,
                        help.help_type,
                        help.help_type_label,
                        help.help_amount,
                        help.help_quantity,
                        help.help_provider,
                    ],
                    |row| row.get(0),
                )
                .optional()?;
            if existing_help_id.is_some() {
                skipped_duplicate_help_entries += 1;
                continue;
            }
        }

        target.execute(
            r#"
            INSERT INTO person_help_entries (
              event_uuid, person_id, help_date, help_type, help_type_label, help_amount, help_quantity,
              help_provider, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                help.event_uuid,
                new_person_id,
                help.help_date,
                help.help_type,
                help.help_type_label,
                help.help_amount,
                help.help_quantity,
                help.help_provider,
                help.created_at,
                help.updated_at,
            ],
        )?;
        imported_help_entries += 1;
    }

    let mut imported_users = 0usize;
    for user in users {
        let affected = target.execute(
            r#"
            INSERT OR IGNORE INTO users (
              username, password_hash, role, is_active, first_name, last_name, position
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                user.username,
                user.password_hash,
                user.role,
                user.is_active,
                user.first_name,
                user.last_name,
                user.position,
            ],
        )?;
        if affected > 0 {
            imported_users += 1;
        }
    }

    if let Some(org_row) = org {
        let existing_count: i64 =
            target.query_row("SELECT COUNT(*) FROM organization_settings WHERE id = 1", [], |r| {
                r.get(0)
            })?;
        if existing_count == 0 {
            target.execute(
                r#"
                INSERT INTO organization_settings (
                  id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                params![
                    1i64,
                    org_row.org_name,
                    org_row.center_name,
                    org_row.contract_number,
                    org_row.contact_person,
                    org_row.contact_phone,
                    org_row.contact_email,
                    org_row.updated_at
                ],
            )?;
        }
    }

    Ok(ImportResult {
        mode: "append".to_string(),
        imported_persons,
        imported_help_entries,
        imported_users,
        skipped_duplicate_persons,
        skipped_duplicate_help_entries,
    })
}

fn import_database_bytes(
    app: &tauri::AppHandle,
    raw: Vec<u8>,
    mode: String,
    db_path: Option<String>,
) -> Result<ImportResult, String> {
    let db_path = resolve_contract_db_path(app, db_path)?;

    let mut temp_path = db_path.clone();
    temp_path.set_file_name(format!("import-{}.db", now_millis()));
    fs::write(&temp_path, raw)
        .map_err(|e| format!("Nie udało się przygotować tymczasowego pliku importu: {e}"))?;

    let source = Connection::open_with_flags(&temp_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Nie udało się otworzyć importowanej bazy: {e}"))?;
    let mut target = Connection::open(&db_path)
        .map_err(|e| format!("Nie udało się otworzyć docelowej bazy: {e}"))?;

    let persons = read_source_persons(&source)
        .map_err(|e| format!("Błąd odczytu osób z importowanej bazy: {e}"))?;
    let helps = read_source_help(&source)
        .map_err(|e| format!("Błąd odczytu wpisów pomocy z importowanej bazy: {e}"))?;
    let users = read_source_users(&source)
        .map_err(|e| format!("Błąd odczytu kont użytkowników z importowanej bazy: {e}"))?;
    let org = read_source_org(&source).map_err(|e| format!("Błąd odczytu danych organizacji: {e}"))?;

    let tx = target
        .transaction()
        .map_err(|e| format!("Nie udało się rozpocząć transakcji importu: {e}"))?;
    ensure_target_schema(&tx)
        .map_err(|e| format!("Nie udało się przygotować struktury docelowej bazy: {e}"))?;

    let result = match mode.as_str() {
        "replace" => import_replace(&tx, &persons, &helps, &users, &org),
        "append" => import_append(&tx, &persons, &helps, &users, &org),
        _ => Err(rusqlite::Error::InvalidParameterName(
            "Nieznany tryb importu".to_string(),
        )),
    }
    .map_err(|e| format!("Import nie powiódł się: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Nie udało się zatwierdzić importu: {e}"))?;
    let _ = fs::remove_file(temp_path);
    Ok(result)
}

#[tauri::command]
fn export_database_base64(app: tauri::AppHandle, db_path: Option<String>) -> Result<String, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;
    let snapshot_path = create_database_snapshot(&db_path)?;
    let content = fs::read(&snapshot_path)
        .map_err(|e| format!("Nie udało się odczytać pliku bazy danych: {e}"))?;
    let _ = fs::remove_file(&snapshot_path);
    Ok(BASE64.encode(content))
}

#[tauri::command]
fn export_database_to_path(
    app: tauri::AppHandle,
    target_path: String,
    db_path: Option<String>,
) -> Result<String, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;

    let raw_target = target_path.trim();
    if raw_target.is_empty() {
        return Err("Nie podano ścieżki eksportu.".to_string());
    }

    let mut destination = PathBuf::from(raw_target);
    if destination.exists() && destination.is_dir() {
        destination = destination.join(format!("pomoc_postpenitencjarna_{}.db", now_millis()));
    } else if raw_target.ends_with('\\') || raw_target.ends_with('/') {
        destination = destination.join(format!("pomoc_postpenitencjarna_{}.db", now_millis()));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Nie udało się utworzyć folderu docelowego: {e}"))?;
    }

    let snapshot_path = create_database_snapshot(&db_path)?;
    fs::copy(&snapshot_path, &destination)
        .map_err(|e| format!("Nie udało się wyeksportować bazy do pliku: {e}"))?;
    let _ = fs::remove_file(&snapshot_path);

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn export_encrypted_database_to_path(
    app: tauri::AppHandle,
    target_path: String,
    db_path: Option<String>,
) -> Result<backup_crypto::BackupEncryptResult, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;

    let raw_target = target_path.trim();
    if raw_target.is_empty() {
        return Err("Nie podano sciezki eksportu.".to_string());
    }

    let mut destination = PathBuf::from(raw_target);
    if destination.exists() && destination.is_dir() {
        destination = destination.join(format!("pomoc_postpenitencjarna_{}.enc", now_millis()));
    } else if raw_target.ends_with('\\') || raw_target.ends_with('/') {
        destination = destination.join(format!("pomoc_postpenitencjarna_{}.enc", now_millis()));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Nie udało się utworzyć folderu docelowego: {e}"))?;
    }

    let snapshot_path = create_database_snapshot(&db_path)?;
    let result = backup_crypto::encrypt_backup_file(&snapshot_path, &destination);
    let _ = fs::remove_file(&snapshot_path);
    result
}

#[tauri::command]
fn export_encrypted_database_archive_to_path(
    app: tauri::AppHandle,
    target_path: String,
    archive_kind: String,
    db_path: Option<String>,
) -> Result<backup_crypto::BackupRarResult, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;

    let raw_target = target_path.trim();
    if raw_target.is_empty() {
        return Err("Nie podano sciezki eksportu.".to_string());
    }

    let archive_kind = archive_kind.trim().to_lowercase();
    if archive_kind != "rar" && archive_kind != "7z" {
        return Err("Nieobslugiwany format archiwum.".to_string());
    }

    let destination = PathBuf::from(raw_target);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Nie udało się utworzyć folderu docelowego: {e}"))?;
    }

    let mut temp_enc_path = destination.clone();
    temp_enc_path.set_file_name(format!("tmp-ministry-export-{}.enc", now_millis()));

    let snapshot_path = create_database_snapshot(&db_path)?;
    backup_crypto::encrypt_backup_file(&snapshot_path, &temp_enc_path)?;
    let _ = fs::remove_file(&snapshot_path);
    let archive_result =
        backup_crypto::archive_file_without_password(&temp_enc_path, &destination, &archive_kind);
    let _ = fs::remove_file(&temp_enc_path);
    archive_result
}

#[tauri::command]
fn create_password_protected_rar(
    app: tauri::AppHandle,
    out_path: String,
    password: String,
    db_path: Option<String>,
    archive_entry_name: Option<String>,
) -> Result<backup_crypto::BackupRarResult, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;
    let destination = PathBuf::from(out_path.trim());
    let snapshot_file_name = archive_entry_name.unwrap_or_else(|| "baza_danych.db".to_string());
    let snapshot_path = create_database_snapshot_with_file_name(&db_path, &snapshot_file_name)?;
    let result = backup_crypto::create_password_protected_rar(&snapshot_path, &destination, &password);
    cleanup_snapshot_path(&snapshot_path);
    result
}

#[tauri::command]
fn create_password_protected_7z(
    app: tauri::AppHandle,
    out_path: String,
    password: String,
    db_path: Option<String>,
    archive_entry_name: Option<String>,
) -> Result<backup_crypto::BackupRarResult, String> {
    let db_path = resolve_contract_db_path(&app, db_path)?;
    let destination = PathBuf::from(out_path.trim());
    let snapshot_file_name = archive_entry_name.unwrap_or_else(|| "baza_danych.db".to_string());
    let snapshot_path = create_database_snapshot_with_file_name(&db_path, &snapshot_file_name)?;
    let result = backup_crypto::create_password_protected_7z(&snapshot_path, &destination, &password);
    cleanup_snapshot_path(&snapshot_path);
    result
}

#[tauri::command]
fn import_database_base64(
    app: tauri::AppHandle,
    database_base64: String,
    mode: String,
    db_path: Option<String>,
) -> Result<ImportResult, String> {
    let raw = BASE64
        .decode(database_base64.as_bytes())
        .map_err(|e| format!("Nieprawidłowy format pliku bazy (base64): {e}"))?;
    import_database_bytes(&app, raw, mode, db_path)
}

#[tauri::command]
fn import_database_from_path(
    app: tauri::AppHandle,
    source_path: String,
    mode: String,
    db_path: Option<String>,
) -> Result<ImportResult, String> {
    let raw_source = source_path.trim();
    if raw_source.is_empty() {
        return Err("Nie podano ścieżki pliku bazy do importu.".to_string());
    }
    let source = PathBuf::from(raw_source);
    let raw =
        fs::read(&source).map_err(|e| format!("Nie udało się odczytać wskazanego pliku bazy: {e}"))?;
    import_database_bytes(&app, raw, mode, db_path)
}

#[tauri::command]
fn delete_contract_database(app: tauri::AppHandle, db_path: String) -> Result<(), String> {
    let target = resolve_contract_db_path(&app, Some(db_path))?;
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|e| format!("Nie udało się usunąć pliku bazy danych: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn save_report_file_to_path(target_path: String, file_base64: String) -> Result<String, String> {
    let raw_target = target_path.trim();
    if raw_target.is_empty() {
        return Err("Nie podano ścieżki zapisu raportu.".to_string());
    }

    let destination = PathBuf::from(raw_target);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Nie udało się utworzyć folderu docelowego: {e}"))?;
    }

    let bytes = BASE64
        .decode(file_base64.as_bytes())
        .map_err(|e| format!("Nieprawidłowy format raportu (base64): {e}"))?;

    fs::write(&destination, bytes)
        .map_err(|e| format!("Nie udało się zapisać raportu do pliku: {e}"))?;

    Ok(destination.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            license_status,
            activate_license_key,
            verify_recovery_code,
            reset_password_with_recovery_code,
            export_database_to_path,
            export_encrypted_database_to_path,
            export_encrypted_database_archive_to_path,
            create_password_protected_rar,
            create_password_protected_7z,
            export_database_base64,
            import_database_base64,
            import_database_from_path,
            delete_contract_database,
            save_report_file_to_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

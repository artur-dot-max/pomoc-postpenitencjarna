use std::fs;
use std::path::Path;
use std::process::Command;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::Serialize;

pub const BACKUP_MAGIC: &[u8; 8] = b"AFSENC01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// Ryzyko znane: haslo mozna odzyskac z binarki.
// Lepsza opcja: ustawienie BACKUP_ENC_PASSWORD podczas builda.
const FALLBACK_BACKUP_PASSWORD: &str = "DepartamentFunduszyINieodplatnejPomocyPrawnej";
pub const BACKUP_PASSWORD: &str = match option_env!("BACKUP_ENC_PASSWORD") {
    Some(v) => v,
    None => FALLBACK_BACKUP_PASSWORD,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEncryptResult {
    pub format_magic: String,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRarResult {
    pub archive_path: String,
    pub input_bytes: u64,
    pub tool_used: String,
}

fn archive_file_with_tool(
    input_path: &Path,
    out_path: &Path,
    kind: &str,
    password: Option<&str>,
) -> Result<BackupRarResult, String> {
    if !input_path.exists() {
        return Err(format!("Nie znaleziono pliku wejściowego: {}", input_path.display()));
    }

    let input_bytes = fs::metadata(input_path)
        .map_err(|e| format!("Nie można odczytać metadanych pliku wejściowego: {e}"))?
        .len();

    let out_str = out_path
        .to_str()
        .ok_or_else(|| "Nieprawidłowa ścieżka pliku archiwum".to_string())?;
    let input_str = input_path
        .to_str()
        .ok_or_else(|| "Nieprawidłowa ścieżka pliku wejściowego".to_string())?;

    let (candidates, args_builder): (&[&str], Box<dyn Fn(&str, &str, Option<&str>) -> Vec<String>>) =
        match kind {
            "rar" => (
                &[
                    "rar",
                    "winrar",
                    r"C:\Program Files\WinRAR\Rar.exe",
                    r"C:\Program Files\WinRAR\WinRAR.exe",
                    r"C:\Program Files (x86)\WinRAR\Rar.exe",
                    r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
                ],
                Box::new(|out, input, password| {
                    let mut args = vec!["a".to_string(), "-y".to_string(), "-ep1".to_string()];
                    if let Some(value) = password {
                        args.push(format!("-hp{value}"));
                    }
                    args.push(out.to_string());
                    args.push(input.to_string());
                    args
                }),
            ),
            "7z" => (
                &[
                    "7z",
                    "7za",
                    r"C:\Program Files\7-Zip\7z.exe",
                    r"C:\Program Files (x86)\7-Zip\7z.exe",
                ],
                Box::new(|out, input, password| {
                    let mut args =
                        vec!["a".to_string(), "-y".to_string(), "-t7z".to_string(), out.to_string(), input.to_string()];
                    if let Some(value) = password {
                        args.insert(3, format!("-p{value}"));
                        args.insert(4, "-mhe=on".to_string());
                    }
                    args
                }),
            ),
            _ => return Err("Nieobsługiwany typ archiwum.".to_string()),
        };

    let mut last_non_not_found_error: Option<String> = None;

    for candidate in candidates {
        let args = args_builder(out_str, input_str, password);
        let output = Command::new(candidate).args(&args).output();

        match output {
            Ok(out) => {
                if out.status.success() {
                    return Ok(BackupRarResult {
                        archive_path: out_str.to_string(),
                        input_bytes,
                        tool_used: candidate.to_string(),
                    });
                }

                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let details = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    format!("kod wyjścia: {:?}", out.status.code())
                };
                last_non_not_found_error = Some(format!(
                    "{} zwrócił błąd ({candidate}): {details}",
                    if kind == "rar" { "RAR/WinRAR" } else { "7-Zip" }
                ));
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                last_non_not_found_error = Some(format!(
                    "Nie można uruchomić narzędzia {} ({candidate}): {e}",
                    if kind == "rar" { "RAR" } else { "7-Zip" }
                ));
            }
        }
    }

    if let Some(err) = last_non_not_found_error {
        return Err(err);
    }

    Err(if kind == "rar" {
        "Nie znaleziono WinRAR/RAR. Zainstaluj WinRAR (z obsługą wiersza poleceń), aby tworzyć archiwa .rar."
            .to_string()
    } else {
        "Nie znaleziono 7-Zip (7z.exe / 7za). Zainstaluj 7-Zip, aby tworzyć archiwa .7z.".to_string()
    })
}

fn argon2_instance() -> Result<Argon2<'static>, String> {
    let params =
        Params::new(64 * 1024, 3, 1, Some(KEY_LEN)).map_err(|e| format!("Błąd parametrów Argon2: {e}"))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let mut key = [0u8; KEY_LEN];
    argon2_instance()?
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "Błąd wyprowadzenia klucza".to_string())?;
    Ok(key)
}

fn encrypt_bytes_with_password(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Błąd inicjalizacji AES-GCM".to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "Błąd szyfrowania".to_string())?;

    let mut out = Vec::with_capacity(BACKUP_MAGIC.len() + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(BACKUP_MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn encrypt_backup_file(db_path: &Path, out_path: &Path) -> Result<BackupEncryptResult, String> {
    let plaintext = fs::read(db_path).map_err(|e| format!("Nie można odczytać pliku bazy: {e}"))?;
    let encrypted = encrypt_bytes_with_password(&plaintext, BACKUP_PASSWORD)?;
    fs::write(out_path, &encrypted).map_err(|e| format!("Nie można zapisać pliku backup.enc: {e}"))?;

    Ok(BackupEncryptResult {
        format_magic: String::from_utf8_lossy(BACKUP_MAGIC).to_string(),
        input_bytes: plaintext.len() as u64,
        output_bytes: encrypted.len() as u64,
    })
}

pub fn create_password_protected_rar(
    db_path: &Path,
    out_path: &Path,
    password: &str,
) -> Result<BackupRarResult, String> {
    let password = password.trim();
    if password.is_empty() {
        return Err("Hasło do pliku RAR nie może być puste".to_string());
    }
    if !db_path.exists() {
        return Err(format!("Nie znaleziono pliku bazy: {}", db_path.display()));
    }

    archive_file_with_tool(db_path, out_path, "rar", Some(password))
}

pub fn create_password_protected_7z(
    db_path: &Path,
    out_path: &Path,
    password: &str,
) -> Result<BackupRarResult, String> {
    let password = password.trim();
    if password.is_empty() {
        return Err("Hasło do pliku 7Z nie może być puste".to_string());
    }
    if !db_path.exists() {
        return Err(format!("Nie znaleziono pliku bazy: {}", db_path.display()));
    }

    archive_file_with_tool(db_path, out_path, "7z", Some(password))
}

pub fn archive_file_without_password(
    input_path: &Path,
    out_path: &Path,
    kind: &str,
) -> Result<BackupRarResult, String> {
    archive_file_with_tool(input_path, out_path, kind, None)
}

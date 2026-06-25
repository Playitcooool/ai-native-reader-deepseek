use crate::db::models::{ProviderSettings, ProviderSettingsInput, TestProviderResult};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

pub struct DbState(pub Mutex<rusqlite::Connection>);

#[tauri::command]
pub fn get_provider_settings(db: State<DbState>) -> Result<Vec<ProviderSettings>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, provider_type, base_url, api_key, model, is_default, is_translation, created_at, updated_at FROM provider_settings ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let settings = stmt
        .query_map([], |row| {
            Ok(ProviderSettings {
                id: row.get(0)?,
                provider_type: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                is_default: row.get::<_, Option<bool>>(5)?,
                is_translation: row.get::<_, Option<bool>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(settings)
}

#[tauri::command]
pub fn save_provider_settings(
    db: State<DbState>,
    input: ProviderSettingsInput,
) -> Result<ProviderSettings, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    match &input.id {
        Some(id) => {
            // UPDATE existing row
            let is_default = input.is_default.unwrap_or(false);
            let is_translation = input.is_translation.unwrap_or(false);
            if is_default {
                tx.execute("UPDATE provider_settings SET is_default = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            if is_translation {
                tx.execute("UPDATE provider_settings SET is_translation = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "UPDATE provider_settings SET provider_type = ?1, base_url = ?2, api_key = ?3, model = ?4, is_default = ?5, is_translation = ?6, updated_at = ?7 WHERE id = ?8",
                rusqlite::params![input.provider_type, input.base_url, input.api_key, input.model, is_default, is_translation, now, id],
            ).map_err(|e| e.to_string())?;

            // Read back the updated row
            let row = tx.query_row(
                "SELECT id, provider_type, base_url, api_key, model, is_default, is_translation, created_at, updated_at FROM provider_settings WHERE id = ?1",
                rusqlite::params![id],
                |row| {
                    Ok(ProviderSettings {
                        id: row.get(0)?,
                        provider_type: row.get(1)?,
                        base_url: row.get(2)?,
                        api_key: row.get(3)?,
                        model: row.get(4)?,
                        is_default: row.get::<_, Option<bool>>(5)?,
                        is_translation: row.get::<_, Option<bool>>(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                },
            ).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(row)
        }
        None => {
            // INSERT new row
            let id = Uuid::new_v4().to_string();
            let is_default = input.is_default.unwrap_or(false);
            let is_translation = input.is_translation.unwrap_or(false);
            if is_default {
                tx.execute("UPDATE provider_settings SET is_default = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            if is_translation {
                tx.execute("UPDATE provider_settings SET is_translation = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "INSERT INTO provider_settings (id, provider_type, base_url, api_key, model, is_default, is_translation, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![id, input.provider_type, input.base_url, input.api_key, input.model, is_default, is_translation, now, now],
            ).map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;
            Ok(ProviderSettings {
                id,
                provider_type: input.provider_type,
                base_url: input.base_url,
                api_key: input.api_key,
                model: input.model,
                is_default: Some(is_default),
                is_translation: Some(is_translation),
                created_at: now.clone(),
                updated_at: now,
            })
        }
    }
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, provider_id: String) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE provider_settings SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE provider_settings SET is_default = 1 WHERE id = ?1",
        rusqlite::params![provider_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider(
    http_client: State<'_, reqwest::Client>,
    db: State<'_, DbState>,
    provider_id: String,
) -> Result<TestProviderResult, String> {
    let (base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT base_url, api_key, model FROM provider_settings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(rusqlite::params![provider_id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.next()
            .ok_or("Provider not found")?
            .map_err(|e| e.to_string())?
    };

    let base_url = base_url.ok_or("Provider is missing a base URL. Check Settings.")?;
    let api_key = api_key.ok_or("Provider is missing an API key. Check Settings.")?;

    let result = crate::ai::provider::test_provider(&http_client, &base_url, &api_key, &model).await;
    Ok(TestProviderResult {
        ok: result.ok,
        provider_id,
        model: result.model,
        latency_ms: Some(result.latency_ms),
        error_code: result.error_code,
        error_message: result.error_message,
    })
}

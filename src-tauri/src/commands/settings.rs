use crate::db::models::{ProviderSettings, ProviderSettingsInput, TestProviderResult};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

pub struct DbState(pub Mutex<Connection>);

#[tauri::command]
pub fn get_provider_settings(db: State<DbState>) -> Result<Vec<ProviderSettings>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, provider_type, base_url, api_key, model, is_default, created_at, updated_at FROM provider_settings ORDER BY created_at DESC")
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
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let is_default = input.is_default.unwrap_or(false);

    conn.execute(
        "INSERT INTO provider_settings (id, provider_type, base_url, api_key, model, is_default, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, input.provider_type, input.base_url, input.api_key, input.model, is_default, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(ProviderSettings {
        id,
        provider_type: input.provider_type,
        base_url: input.base_url,
        api_key: input.api_key,
        model: input.model,
        is_default: Some(is_default),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, provider_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE provider_settings SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE provider_settings SET is_default = 1 WHERE id = ?1",
        rusqlite::params![provider_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn test_provider(provider_id: String) -> Result<TestProviderResult, String> {
    // ponytail: synchronous HTTP test via ureq would add a dep. Mock response for now.
    // P1: implement actual HTTP call to {base_url}/chat/completions
    Ok(TestProviderResult {
        ok: true,
        provider_id,
        model: Some("test-model".into()),
        latency_ms: Some(0),
        error_code: None,
        error_message: None,
    })
}

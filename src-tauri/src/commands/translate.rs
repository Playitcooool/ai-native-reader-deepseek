use crate::ai::prompts;
use crate::ai::provider::ChatMessage;
use crate::commands::settings::DbState;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct TranslateTextInput {
    pub selected_text: String,
}

/// Translate selected text using the translation provider (or fallback to default).
/// Non-streaming — returns the translated text directly.
#[tauri::command]
pub async fn translate_text(
    http_client: State<'_, reqwest::Client>,
    db: State<'_, DbState>,
    input: TranslateTextInput,
) -> Result<String, String> {
    // Read provider: translation provider first, fallback to default
    let (base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT base_url, api_key, model FROM provider_settings WHERE is_translation = 1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        match rows.next() {
            Some(Ok(r)) => r,
            _ => {
                // Fallback to default provider
                let mut stmt = conn
                    .prepare(
                        "SELECT base_url, api_key, model FROM provider_settings WHERE is_default = 1 LIMIT 1",
                    )
                    .map_err(|e| e.to_string())?;
                let mut rows = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?;
                match rows.next() {
                    Some(Ok(r)) => r,
                    _ => {
                        return Err(
                            "No provider configured. Open Settings to add one.".to_string()
                        )
                    }
                }
            }
        }
    };

    let base_url = base_url.ok_or("Provider is missing a base URL. Check Settings.")?;
    let api_key = api_key.ok_or("Provider is missing an API key. Check Settings.")?;

    let (system, user) = prompts::translate(&input.selected_text);
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system,
        },
        ChatMessage {
            role: "user".to_string(),
            content: user,
        },
    ];

    let response = crate::ai::provider::chat_completion(
        &http_client,
        &base_url,
        &api_key,
        &model,
        messages,
        Some(0.0), // temperature 0 for deterministic translation
        Some(1024),
    )
    .await?;

    let translation = response
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or("AI returned an empty response. Try again.")?;

    if translation.is_empty() {
        return Err("AI returned an empty response. Try again.".to_string());
    }

    Ok(translation)
}

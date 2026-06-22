use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use crate::ai::context_builder::{self, ContextPack};
use crate::ai::provider::{self, ChatMessage};
use crate::commands::settings::DbState;

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSession {
    pub id: String,
    pub document_id: String,
    pub title: Option<String>,
    pub scope_type: String,
    pub scope_json: String,
    pub session_summary: Option<String>,
    pub last_compacted_message_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct GetOrCreateSessionInput {
    pub document_id: String,
    pub scope_type: String,
    pub scope_json: String,
}

#[tauri::command]
pub fn get_or_create_ai_session(
    db: State<DbState>,
    input: GetOrCreateSessionInput,
) -> Result<AiSession, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Try to find an existing reusable session
    let existing = conn
        .query_row(
            "SELECT id, document_id, title, scope_type, scope_json, session_summary, last_compacted_message_id, created_at, updated_at
             FROM ai_sessions
             WHERE document_id = ?1 AND scope_type = ?2 AND scope_json = ?3
             ORDER BY updated_at DESC LIMIT 1",
            rusqlite::params![input.document_id, input.scope_type, input.scope_json],
            |row| {
                Ok(AiSession {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    title: row.get(2)?,
                    scope_type: row.get(3)?,
                    scope_json: row.get(4)?,
                    session_summary: row.get(5)?,
                    last_compacted_message_id: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        );

    if let Ok(session) = existing {
        return Ok(session);
    }

    // Create new session
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO ai_sessions (id, document_id, scope_type, scope_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, input.document_id, input.scope_type, input.scope_json, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(AiSession {
        id,
        document_id: input.document_id,
        title: None,
        scope_type: input.scope_type,
        scope_json: input.scope_json,
        session_summary: None,
        last_compacted_message_id: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_session_messages(
    db: State<DbState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, citations_json, context_snapshot_json, page_number, selection_anchor_json, is_compacted, created_at
             FROM ai_messages WHERE session_id = ?1
             ORDER BY created_at ASC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(rusqlite::params![session_id, limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "role": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "citations_json": row.get::<_, Option<String>>(3)?,
                "context_snapshot_json": row.get::<_, Option<String>>(4)?,
                "page_number": row.get::<_, Option<i64>>(5)?,
                "selection_anchor_json": row.get::<_, Option<String>>(6)?,
                "is_compacted": row.get::<_, bool>(7)?,
                "created_at": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(messages)
}

#[derive(Debug, Deserialize)]
pub struct SaveAiMessageInput {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub page_number: Option<i64>,
    pub context_snapshot_json: Option<String>,
    pub citations_json: Option<String>,
}

#[tauri::command]
pub fn save_ai_message(
    db: State<DbState>,
    input: SaveAiMessageInput,
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO ai_messages (id, session_id, role, content, citations_json, context_snapshot_json, page_number, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, input.session_id, input.role, input.content,
            input.citations_json, input.context_snapshot_json, input.page_number, now],
    )
    .map_err(|e| e.to_string())?;

    // Update session timestamp
    conn.execute(
        "UPDATE ai_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, input.session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "id": id,
        "session_id": input.session_id,
        "role": input.role,
        "content": input.content,
        "created_at": now,
    }))
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn compact_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<AiSession, String> {
    let (_document_id, old_messages) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Get document_id
        let doc_id: String = conn
            .query_row(
                "SELECT document_id FROM ai_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .map_err(|_| "Session not found".to_string())?;

        // Get compactable messages (older, not already compacted)
        let mut stmt = conn
            .prepare(
                "SELECT role, content FROM ai_messages
                 WHERE session_id = ?1 AND is_compacted = 0
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let msgs: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        (doc_id, msgs)
    };

    // Build compaction prompt
    let summary_prompt = old_messages
        .iter()
        .map(|(role, content)| format!("[{}]\n{}", role, content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let compact_prompt = format!(
        "Summarize the following PDF reading session conversation. Include:\n\
         - What section/page the user was reading\n\
         - Important explanations already given\n\
         - Unresolved questions\n\
         - Concepts the user struggled with\n\
         - Saved notes or citations that matter\n\n\
         Conversation:\n{}",
        summary_prompt
    );

    // Get provider settings for compaction
    let (base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
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
            _ => return Err("No default provider configured".to_string()),
        }
    };

    let base_url = base_url.ok_or("Missing base_url")?;
    let api_key = api_key.ok_or("Missing api_key")?;

    // Call AI for compaction
    let result = provider::chat_completion(
        &base_url,
        &api_key,
        &model,
        vec![ChatMessage {
            role: "user".into(),
            content: compact_prompt,
        }],
        Some(0.3),
        Some(1000),
    )
    .await;

    let summary = match result {
        Ok(resp) => resp
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default(),
        Err(e) => return Err(format!("Compaction failed: {}", e)),
    };

    if summary.is_empty() {
        return Err("Compaction produced empty summary".to_string());
    }

    // Save compaction atomically
    let now = Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE ai_sessions SET session_summary = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![summary.trim(), now, session_id],
    )
    .map_err(|e| e.to_string())?;

    // Mark all old messages as compacted (keep them, just mark them)
    conn.execute(
        "UPDATE ai_messages SET is_compacted = 1 WHERE session_id = ?1 AND is_compacted = 0",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    // Return updated session
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, title, scope_type, scope_json, session_summary, last_compacted_message_id, created_at, updated_at
             FROM ai_sessions WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let session = stmt
        .query_row(rusqlite::params![session_id], |row| {
            Ok(AiSession {
                id: row.get(0)?,
                document_id: row.get(1)?,
                title: row.get(2)?,
                scope_type: row.get(3)?,
                scope_json: row.get(4)?,
                session_summary: row.get(5)?,
                last_compacted_message_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(session)
}

// ---------------------------------------------------------------------------
// Reading State
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReadingState {
    pub document_id: String,
    pub current_page_number: i64,
    pub current_toc_node_id: Option<String>,
    pub progress_ratio: Option<f64>,
    pub recent_pages_json: Option<String>,
    pub last_selection_anchor_json: Option<String>,
    pub last_opened_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReadingStateInput {
    pub document_id: String,
    pub current_page_number: Option<i64>,
    pub current_toc_node_id: Option<String>,
    pub progress_ratio: Option<f64>,
    pub recent_page_number: Option<i64>,
    pub last_selection_anchor: Option<String>,
}

#[tauri::command]
pub fn get_reading_state(
    db: State<DbState>,
    document_id: String,
) -> Result<Option<ReadingState>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT document_id, current_page_number, current_toc_node_id, progress_ratio,
                    recent_pages_json, last_selection_anchor_json, last_opened_at, updated_at
             FROM reading_states WHERE document_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id], |row| {
            Ok(ReadingState {
                document_id: row.get(0)?,
                current_page_number: row.get(1)?,
                current_toc_node_id: row.get(2)?,
                progress_ratio: row.get(3)?,
                recent_pages_json: row.get(4)?,
                last_selection_anchor_json: row.get(5)?,
                last_opened_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.next().and_then(|r| r.ok()))
}

#[tauri::command]
pub fn update_reading_state(
    db: State<DbState>,
    input: UpdateReadingStateInput,
) -> Result<ReadingState, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    // Get or create reading state
    let existing = conn
        .query_row(
            "SELECT document_id, current_page_number, current_toc_node_id, progress_ratio,
                    recent_pages_json, last_selection_anchor_json, last_opened_at, updated_at
             FROM reading_states WHERE document_id = ?1",
            rusqlite::params![input.document_id],
            |row| {
                Ok(ReadingState {
                    document_id: row.get(0)?,
                    current_page_number: row.get(1)?,
                    current_toc_node_id: row.get(2)?,
                    progress_ratio: row.get(3)?,
                    recent_pages_json: row.get(4)?,
                    last_selection_anchor_json: row.get(5)?,
                    last_opened_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .ok();

    // Build the update
    let page = input.current_page_number.unwrap_or(existing.as_ref().map(|r| r.current_page_number).unwrap_or(1));
    let toc_id = input.current_toc_node_id.or(existing.as_ref().and_then(|r| r.current_toc_node_id.clone()));
    let progress = input.progress_ratio.or(existing.as_ref().and_then(|r| r.progress_ratio));
    let selection = input.last_selection_anchor.or(existing.as_ref().and_then(|r| r.last_selection_anchor_json.clone()));

    // Update recent pages
    let recent = if let Some(new_page) = input.recent_page_number {
        let mut pages: Vec<i64> = existing
            .as_ref()
            .and_then(|r| r.recent_pages_json.as_deref())
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        pages.retain(|&p| p != new_page);
        pages.insert(0, new_page);
        pages.truncate(10);
        Some(serde_json::to_string(&pages).unwrap_or_default())
    } else {
        existing.as_ref().and_then(|r| r.recent_pages_json.clone())
    };

    let last_opened = existing.as_ref().and_then(|r| r.last_opened_at.clone()).unwrap_or_else(|| now.clone());

    conn.execute(
        "INSERT OR REPLACE INTO reading_states
         (document_id, current_page_number, current_toc_node_id, progress_ratio, recent_pages_json, last_selection_anchor_json, last_opened_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![input.document_id, page, toc_id, progress, recent, selection, last_opened, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(ReadingState {
        document_id: input.document_id,
        current_page_number: page,
        current_toc_node_id: toc_id,
        progress_ratio: progress,
        recent_pages_json: recent,
        last_selection_anchor_json: selection,
        last_opened_at: Some(last_opened),
        updated_at: now,
    })
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_citations_for_message(
    db: State<DbState>,
    message_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, message_id, document_id, page_number, toc_node_id, quote, anchor_json
             FROM ai_answer_citations WHERE message_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let citations = stmt
        .query_map(rusqlite::params![message_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "message_id": row.get::<_, String>(1)?,
                "document_id": row.get::<_, String>(2)?,
                "page_number": row.get::<_, i64>(3)?,
                "toc_node_id": row.get::<_, Option<String>>(4)?,
                "quote": row.get::<_, Option<String>>(5)?,
                "anchor_json": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(citations)
}

// ---------------------------------------------------------------------------
// AI Workflow: generic runner for all modes
// ---------------------------------------------------------------------------

/// Input accepted by run_ai_workflow.
/// All modes use the same input shape; the handler picks the relevant fields.
#[derive(Debug, Deserialize)]
pub struct RunAiWorkflowInput {
    pub document_id: String,
    pub document_title: Option<String>,
    /// One of: selection_explain | page_summary | range_summary | chapter_qa
    pub mode: String,
    pub page_number: i64,
    pub selected_text: Option<String>,
    pub start_page: Option<i64>,
    pub end_page: Option<i64>,
    pub question: Option<String>,
    /// If provided, reuse/save to this session; if empty, a new session is created.
    pub existing_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AiWorkflowResult {
    pub message_id: String,
    pub session_id: String,
    pub answer_md: String,
    pub context_snapshot: ContextPack,
}

#[tauri::command]
pub async fn run_ai_workflow(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    input: RunAiWorkflowInput,
) -> Result<AiWorkflowResult, String> {
    // 1. Resolve session
    let scope_type = &input.mode;
    let (scope_json, session_id) = {
        let sid = input.existing_session_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let scope = format!("{{\"scopeType\":\"{}\"}}", input.mode);
        (scope, sid)
    };

    // 2. Build context
    let title = input.document_title.as_deref().unwrap_or("Untitled");

    let context_pack = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        context_builder::build_context_pack_for_mode(
            &conn,
            &input.document_id,
            title,
            &input.mode,
            input.page_number,
            input.selected_text.as_deref(),
            input.start_page,
            input.end_page,
            Some(&session_id),
        )
    };

    // 3. Build prompt messages
    let evidence_text = context_pack
        .hard_evidence
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    // Extract TOC breadcrumb and section info from context pack
    let toc_breadcrumb = context_pack.hard_evidence.iter().find(|item| item.kind == "toc_breadcrumb");
    let toc_path = toc_breadcrumb.map(|item| item.text.trim_start_matches("Section: ")).unwrap_or("");
    let toc_node_id = toc_breadcrumb.and_then(|item| item.toc_node_id.as_deref());

    let memory_text = context_pack
        .soft_memory
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    // For chapter_qa, look up the section page range from the TOC node
    let (section_start, section_end) = if input.mode == "chapter_qa" {
        if let Some(node_id) = toc_node_id {
            if let Ok(conn) = db.0.lock() {
                let range = conn.query_row(
                    "SELECT start_page, COALESCE(end_page, start_page) FROM toc_nodes WHERE id = ?1",
                    rusqlite::params![node_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                ).unwrap_or((input.page_number, input.page_number));
                range
            } else {
                (input.page_number, input.page_number)
            }
        } else {
            (input.page_number, input.page_number)
        }
    } else {
        (1, 1)
    };

    let (system_prompt, user_prompt) = match input.mode.as_str() {
        "selection_explain" => {
            let sel = input.selected_text.as_deref().unwrap_or("");
            crate::ai::prompts::explain_selection(title, input.page_number, toc_path, sel, &evidence_text)
        }
        "page_summary" => {
            crate::ai::prompts::summarize_page(title, input.page_number, toc_path, &evidence_text)
        }
        "range_summary" => {
            let sp = input.start_page.unwrap_or(input.page_number);
            let ep = input.end_page.unwrap_or(input.page_number);
            crate::ai::prompts::summarize_range(title, sp, ep, toc_path, &evidence_text)
        }
        "chapter_qa" => {
            let q = input.question.as_deref().unwrap_or("");
            crate::ai::prompts::ask_current_section(title, input.page_number, toc_path, section_start, section_end, q, &evidence_text)
        }
        _ => return Err(format!("Unknown mode: {}", input.mode)),
    };

    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];

    // Add memory context
    if !memory_text.is_empty() {
        messages.push(ChatMessage {
            role: "user".into(),
            content: format!("[Previous context]\n{}", memory_text),
        });
        messages.push(ChatMessage {
            role: "assistant".into(),
            content: "Understood. I'll consider this context in my response.".into(),
        });
    }

    messages.push(ChatMessage {
        role: "user".into(),
        content: user_prompt,
    });

    // 4. Get provider settings
    let (base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
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
            _ => return Err("No default provider configured. Open Settings to add one.".to_string()),
        }
    };

    // 5. Call AI provider with streaming
    let base_url = base_url.ok_or("Missing base_url")?;
    let api_key = api_key.ok_or("Missing api_key")?;
    let answer = provider::chat_completion_stream(
        &base_url,
        &api_key,
        &model,
        messages,
        Some(0.3),
        Some(4096),
        |token| {
            app.emit("ai-stream-chunk", serde_json::json!({"token": token})).ok();
        },
    )
    .await
    .map_err(|e| format!("AI request failed: {}", e))?;

    if answer.is_empty() {
        return Err("AI returned empty response".to_string());
    }

    // 6. Save messages
    let now = Utc::now().to_rfc3339();
    let user_msg_id = Uuid::new_v4().to_string();
    let assistant_msg_id = Uuid::new_v4().to_string();
    let context_json = serde_json::to_string(&context_pack).unwrap_or_default();

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Ensure session exists
        conn.execute(
            "INSERT OR IGNORE INTO ai_sessions (id, document_id, scope_type, scope_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![session_id, input.document_id, scope_type, scope_json, now, now],
        )
        .map_err(|e| e.to_string())?;

        // Save user message
        let user_content: String = input.selected_text.clone().or(input.question.clone()).unwrap_or_else(|| {
            match input.mode.as_str() {
                "page_summary" => format!("Summarize page {}", input.page_number),
                "range_summary" => format!("Summarize pages {}–{}", input.start_page.unwrap_or(input.page_number), input.end_page.unwrap_or(input.page_number)),
                _ => input.mode.clone(),
            }
        });
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, page_number, context_snapshot_json, created_at)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6)",
            rusqlite::params![user_msg_id, session_id, user_content,
                input.page_number, context_json, now],
        )
        .map_err(|e| e.to_string())?;

        // Save assistant message
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, page_number, context_snapshot_json, created_at)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6)",
            rusqlite::params![assistant_msg_id, session_id, answer, input.page_number, context_json, now],
        )
        .map_err(|e| e.to_string())?;

        // Update session timestamp
        conn.execute(
            "UPDATE ai_sessions SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // 7. Signal streaming complete
    app.emit("ai-stream-end", serde_json::json!({
        "message_id": assistant_msg_id,
        "session_id": session_id,
    })).ok();

    Ok(AiWorkflowResult {
        message_id: assistant_msg_id,
        session_id,
        answer_md: answer,
        context_snapshot: context_pack,
    })
}

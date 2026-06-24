use serde::Serialize;
use tauri::State;
use chrono::Utc;

use super::settings::DbState;
use crate::ai::context_builder::cache_page_text;

#[derive(Debug, Serialize)]
pub struct PageText {
    pub id: String,
    pub document_id: String,
    pub page_number: i64,
    pub text: Option<String>,
    pub text_status: String,
    pub char_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSearchResult {
    pub page_num: i64,
    pub context: String,
}

fn page_row_id(document_id: &str, page_number: i64) -> String {
    // Deterministic ID from document_id + page_number so upserts don't orphan FKs
    format!("p_{}_{}", document_id, page_number)
}

#[tauri::command]
pub fn save_page_text(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
    text: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = page_row_id(&document_id, page_number);
    let now = Utc::now().to_rfc3339();
    let char_count = text.chars().count() as i64;

    conn.execute(
        "INSERT OR REPLACE INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7)",
        rusqlite::params![id, document_id, page_number, text, char_count, now, now],
    )
    .map_err(|e| e.to_string())?;
    cache_page_text(&document_id, page_number, &text);
    Ok(())
}

#[tauri::command]
pub fn get_page_text(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<Option<PageText>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, page_number, text, text_status, char_count
             FROM pages WHERE document_id = ?1 AND page_number = ?2",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id, page_number], |row| {
            Ok(PageText {
                id: row.get(0)?,
                document_id: row.get(1)?,
                page_number: row.get(2)?,
                text: row.get(3)?,
                text_status: row.get(4)?,
                char_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.next().and_then(|r| r.ok()))
}

#[tauri::command]
pub fn get_pages_text(
    db: State<DbState>,
    document_id: String,
    start_page: i64,
    end_page: i64,
) -> Result<Vec<PageText>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, page_number, text, text_status, char_count
             FROM pages WHERE document_id = ?1 AND page_number BETWEEN ?2 AND ?3
             ORDER BY page_number",
        )
        .map_err(|e| e.to_string())?;

    let pages = stmt
        .query_map(rusqlite::params![document_id, start_page, end_page], |row| {
            Ok(PageText {
                id: row.get(0)?,
                document_id: row.get(1)?,
                page_number: row.get(2)?,
                text: row.get(3)?,
                text_status: row.get(4)?,
                char_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(pages)
}

#[tauri::command]
pub fn count_indexed_pages(db: State<DbState>, document_id: String) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM pages WHERE document_id = ?1 AND text_status = 'ready'",
        rusqlite::params![document_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_pages_text(
    db: State<DbState>,
    document_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<PageSearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let max_results = limit.unwrap_or(200).clamp(1, 1000);
    let like = format!("%{}%", escape_like(q.to_ascii_lowercase()));
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT page_number, text
             FROM pages
             WHERE document_id = ?1
               AND text_status = 'ready'
               AND LOWER(COALESCE(text, '')) LIKE ?2 ESCAPE '\\'
             ORDER BY page_number
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![document_id, like, max_results], |row| {
            let page_num: i64 = row.get(0)?;
            let text: String = row.get(1)?;
            Ok(PageSearchResult {
                page_num,
                context: snippet(&text, q, 40),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn escape_like(input: String) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn snippet(text: &str, query: &str, radius: usize) -> String {
    let haystack = text.to_ascii_lowercase();
    let needle = query.to_ascii_lowercase();
    let Some(pos) = haystack.find(&needle) else {
        return text.chars().take(radius * 2).collect();
    };
    let start = text[..pos].char_indices().rev().nth(radius).map(|(i, _)| i).unwrap_or(0);
    let end = text[pos..]
        .char_indices()
        .nth(query.chars().count() + radius)
        .map(|(i, _)| pos + i)
        .unwrap_or(text.len());
    format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        text[start..end].trim(),
        if end < text.len() { "..." } else { "" },
    )
}

#[derive(Debug, serde::Deserialize)]
pub struct PageTextInput {
    pub page_number: i64,
    pub text: String,
}

#[tauri::command]
pub fn save_pages_text(
    db: State<DbState>,
    document_id: String,
    pages: Vec<PageTextInput>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for p in &pages {
        let id = page_row_id(&document_id, p.page_number);
        let char_count = p.text.chars().count() as i64;
        tx.execute(
            "INSERT OR REPLACE INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7)",
            rusqlite::params![id, document_id, p.page_number, p.text, char_count, now, now],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    for p in &pages {
        cache_page_text(&document_id, p.page_number, &p.text);
    }
    Ok(())
}

#[tauri::command]
pub fn mark_page_text_failed(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE pages SET text_status = 'failed' WHERE document_id = ?1 AND page_number = ?2",
        rusqlite::params![document_id, page_number],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

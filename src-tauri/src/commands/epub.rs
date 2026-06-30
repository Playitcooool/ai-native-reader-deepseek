use crate::commands::settings::DbState;
use crate::epub;
use chrono::Utc;
use std::path::PathBuf;
use tauri::Manager;
use tauri::State;
use uuid::Uuid;

fn covers_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).ok();
    Ok(dir)
}

#[tauri::command]
pub fn extract_epub_content(
    db: State<DbState>,
    document_id: String,
    file_path: String,
) -> Result<i32, String> {
    let (chapters, total, toc, meta_title, meta_author) =
        epub::extractor::extract_chapters(&file_path)?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    for ch in &chapters {
        let page_id = format!("p_{}_{}", document_id, ch.index + 1);
        conn.execute(
            "INSERT OR REPLACE INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7)",
            rusqlite::params![
                page_id,
                document_id,
                (ch.index + 1) as i64,
                &ch.text,
                ch.text.len() as i64,
                now,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "DELETE FROM toc_nodes WHERE document_id = ?1 AND source = 'epub_nav'",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;

    // Save TOC
    for (order, (label, level)) in toc.iter().enumerate() {
        let node_id = Uuid::new_v4().to_string();
        let start_page = ((order + 1).min(total.max(1))) as i64;
        let end_page = toc
            .iter()
            .enumerate()
            .skip(order + 1)
            .find(|(_, (_, next_level))| next_level <= level)
            .map(|(next_order, _)| (next_order as i64).min(total as i64))
            .unwrap_or(total as i64);
        conn.execute(
            "INSERT INTO toc_nodes (id, document_id, parent_id, title, level, order_index, start_page, end_page, source, confidence, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 'epub_nav', 1.0, ?8, ?8)",
            rusqlite::params![node_id, document_id, label, level, order as i64, start_page, end_page, now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Update document metadata (title, author) from EPUB
    if meta_title.is_some() || meta_author.is_some() {
        conn.execute(
            "UPDATE documents SET title = COALESCE(NULLIF(?1, ''), title), author = COALESCE(NULLIF(?2, ''), author) WHERE id = ?3",
            rusqlite::params![meta_title, meta_author, document_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Update page_count and has_native_toc
    conn.execute(
        "UPDATE documents SET page_count = ?1, has_native_toc = 1, parse_status = 'ready' WHERE id = ?2",
        rusqlite::params![total as i64, document_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(chapters.len() as i32)
}

#[tauri::command]
pub fn get_document_cover(
    document_id: String,
    file_path: String,
    document_type: String,
    app: tauri::AppHandle,
) -> Result<Option<Vec<u8>>, String> {
    // Check disk cache first
    let cached = get_cached_cover_inner(&app, &document_id);
    if let Some(data) = cached {
        return Ok(Some(data));
    }
    if document_type == "epub" {
        match epub::cover::extract_cover(&file_path) {
            Some((data, _mime)) => {
                // Cache it
                let _ = std::fs::write(covers_dir(&app)?.join(&document_id), &data);
                Ok(Some(data))
            }
            None => Ok(None),
        }
    } else {
        Ok(None) // PDFs render covers via pdfjs page 1 in the frontend
    }
}

fn get_cached_cover_inner(app: &tauri::AppHandle, document_id: &str) -> Option<Vec<u8>> {
    let path = covers_dir(app).ok()?.join(document_id);
    if path.exists() {
        std::fs::read(path).ok()
    } else {
        None
    }
}

#[tauri::command]
pub fn get_cached_cover(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Option<Vec<u8>>, String> {
    Ok(get_cached_cover_inner(&app, &document_id))
}

#[tauri::command]
pub fn cache_cover(
    app: tauri::AppHandle,
    document_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let path = covers_dir(&app)?.join(&document_id);
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

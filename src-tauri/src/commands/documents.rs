use crate::db::models::Document;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;
use super::settings::DbState;

use std::io::Read;

pub(crate) fn compute_sha256(path: &str) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("Failed to read file: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[tauri::command]
pub fn import_document(db: State<DbState>, file_path: String) -> Result<Document, String> {
    let path = PathBuf::from(&file_path);
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Invalid file path".to_string())?;

    let doc_type = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| match e.to_lowercase().as_str() {
            "epub" => "epub".to_string(),
            _ => "pdf".to_string(),
        })
        .unwrap_or_else(|| "pdf".to_string());

    // Extract metadata from PDFs; EPUB metadata extracted later by extract_epub_content
    let (meta_title, meta_author) = if doc_type == "pdf" {
        crate::pdf::extract_metadata(&file_path)
    } else {
        (None, None)
    };

    let sha256 = compute_sha256(&file_path)?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let title = meta_title.clone().unwrap_or_else(|| filename.clone());

    conn.execute(
        "INSERT INTO documents (id, title, original_filename, file_path, file_sha256, page_count, created_at, updated_at, last_opened_at, parse_status, has_native_toc, document_type, author)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, 'pending', 0, ?9, ?10)",
        rusqlite::params![id, title, filename, file_path, sha256, now, now, now, doc_type, meta_author],
    )
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    Ok(Document {
        id,
        title: Some(title),
        original_filename: filename,
        file_path,
        file_sha256: Some(sha256),
        page_count: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: Some(now),
        last_page: Some(1),
        last_zoom: Some(1.0),
        parse_status: Some("pending".into()),
        has_native_toc: Some(false),
        document_type: doc_type,
        author: meta_author,
    })
}

#[tauri::command]
pub fn get_documents(db: State<DbState>) -> Result<Vec<Document>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents
             ORDER BY last_opened_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let docs = stmt
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(docs)
}

#[tauri::command]
pub fn get_document(db: State<DbState>, document_id: String) -> Result<Option<Document>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.next().and_then(|r| r.ok()))
}

#[tauri::command]
pub fn read_document_bytes(db: State<DbState>, document_id: String) -> Result<Vec<u8>, String> {
    let file_path: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_path FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Document not found".to_string(),
            _ => e.to_string(),
        })?
    };

    fs::read(&file_path).map_err(|e| format!("Failed to read document at {}: {}", file_path, e))
}

#[tauri::command]
pub fn update_last_page(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET last_page = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![page_number, now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_last_zoom(
    db: State<DbState>,
    document_id: String,
    zoom: f64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET last_zoom = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![zoom, now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_page_count(
    db: State<DbState>,
    document_id: String,
    page_count: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE documents SET page_count = ?1 WHERE id = ?2",
        rusqlite::params![page_count, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn refresh_document_metadata(
    db: State<DbState>,
    document_id: String,
    file_path: String,
    document_type: String,
) -> Result<Document, String> {
    let (meta_title, meta_author) = if document_type == "pdf" {
        crate::pdf::extract_metadata(&file_path)
    } else {
        (None, None)
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if meta_title.is_some() || meta_author.is_some() {
        conn.execute(
            "UPDATE documents SET title = COALESCE(NULLIF(?1, ''), title), author = COALESCE(NULLIF(?2, ''), author) WHERE id = ?3",
            rusqlite::params![meta_title, meta_author, document_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Return the updated document
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let doc = stmt
        .query_row(rusqlite::params![document_id], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(doc)
}

#[tauri::command]
pub fn delete_document(db: State<DbState>, document_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM documents WHERE id = ?1", rusqlite::params![document_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use super::settings::DbState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateAnnotationInput {
    pub document_id: String,
    pub page_number: i64,
    pub toc_node_id: Option<String>,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub selected_text: Option<String>,
    pub note_text: Option<String>,
    pub color: Option<String>,
    pub anchor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Annotation {
    pub id: String,
    pub document_id: String,
    pub page_number: i64,
    pub toc_node_id: Option<String>,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub selected_text: Option<String>,
    pub note_text: Option<String>,
    pub color: Option<String>,
    pub anchor_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct GetAnnotationsInput {
    pub document_id: String,
    pub page_number: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn row_to_annotation(row: &rusqlite::Row) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get(0)?,
        document_id: row.get(1)?,
        page_number: row.get(2)?,
        toc_node_id: row.get(3)?,
        annotation_type: row.get(4)?,
        selected_text: row.get(5)?,
        note_text: row.get(6)?,
        color: row.get(7)?,
        anchor_json: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[tauri::command]
pub fn create_annotation(
    db: State<DbState>,
    input: CreateAnnotationInput,
) -> Result<Annotation, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO annotations (id, document_id, page_number, toc_node_id, type, selected_text, note_text, color, anchor_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            id, input.document_id, input.page_number, input.toc_node_id,
            input.annotation_type, input.selected_text, input.note_text,
            input.color, input.anchor, now, now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Annotation {
        id,
        document_id: input.document_id,
        page_number: input.page_number,
        toc_node_id: input.toc_node_id,
        annotation_type: input.annotation_type,
        selected_text: input.selected_text,
        note_text: input.note_text,
        color: input.color,
        anchor_json: input.anchor,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_annotations(
    db: State<DbState>,
    input: GetAnnotationsInput,
) -> Result<Vec<Annotation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let limit = input.limit.unwrap_or(100).min(200);
    let offset = input.offset.unwrap_or(0);

    let result = if let Some(pn) = input.page_number {
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, page_number, toc_node_id, type, selected_text, note_text, color, anchor_json, created_at, updated_at
                 FROM annotations WHERE document_id = ?1 AND page_number = ?2
                 ORDER BY created_at DESC LIMIT ?3 OFFSET ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![input.document_id, pn, limit, offset], row_to_annotation)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, page_number, toc_node_id, type, selected_text, note_text, color, anchor_json, created_at, updated_at
                 FROM annotations WHERE document_id = ?1
                 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![input.document_id, limit, offset], row_to_annotation)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    Ok(result)
}

#[tauri::command]
pub fn get_annotations_for_page(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<Vec<Annotation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, page_number, toc_node_id, type, selected_text, note_text, color, anchor_json, created_at, updated_at
             FROM annotations WHERE document_id = ?1 AND page_number = ?2
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let annotations = stmt
        .query_map(rusqlite::params![document_id, page_number], row_to_annotation)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(annotations)
}

#[tauri::command]
pub fn update_annotation(
    db: State<DbState>,
    annotation_id: String,
    note_text: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    if let Some(text) = note_text {
        conn.execute(
            "UPDATE annotations SET note_text = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![text, now, annotation_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(c) = color {
        conn.execute(
            "UPDATE annotations SET color = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![c, now, annotation_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_annotation(
    db: State<DbState>,
    annotation_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM annotations WHERE id = ?1",
        rusqlite::params![annotation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

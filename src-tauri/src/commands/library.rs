use crate::commands::documents;
use crate::commands::settings::DbState;
use chrono::Utc;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub struct LibraryState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub db_path: String,
}

#[tauri::command]
pub fn set_library_folder(
    db: State<DbState>,
    library: State<LibraryState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM library_folder WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO library_folder (id, folder_path) VALUES (1, ?1)",
        rusqlite::params![path],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    scan_folder_into_db(&db.0, &path)?;
    start_watcher(&library, &app, &path)?;

    Ok(())
}

#[tauri::command]
pub fn get_library_folder(db: State<DbState>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(conn
        .query_row(
            "SELECT folder_path FROM library_folder WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .ok())
}

#[tauri::command]
pub fn clear_library_folder(
    db: State<DbState>,
    library: State<LibraryState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM library_folder WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    drop(conn);
    *library.watcher.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Called on app startup — reads folder path from DB and starts watcher.
pub fn init_watcher_if_configured(app_handle: &AppHandle) {
    let db = app_handle.state::<DbState>();
    let folder: Option<String> = db
        .0
        .lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT folder_path FROM library_folder WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .ok()
        });
    if let Some(ref path) = folder {
        if scan_folder_into_db(&db.0, path).is_ok() {
            let library = app_handle.state::<LibraryState>();
            let _ = start_watcher(&library, app_handle, path);
        }
    }
}

fn scan_folder_into_db(
    conn_mutex: &Mutex<rusqlite::Connection>,
    folder_path: &str,
) -> Result<i32, String> {
    // Quick query under the lock to get existing paths
    let existing: std::collections::HashSet<String> = {
        let conn = conn_mutex.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT file_path FROM documents")
            .map_err(|e| e.to_string())?;
        let result: std::collections::HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
        // lock released here when conn + stmt drop
    };

    // Walk filesystem and compute hashes OUTSIDE the lock
    let mut pending: Vec<(String, String, String, String)> = Vec::new(); // (path, filename, sha256, doc_type)
    let mut dirs = vec![std::path::PathBuf::from(folder_path)];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let file_path = entry.path();
            if file_path.is_dir() {
                dirs.push(file_path);
            } else if let Some(ext) = file_path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) {
                if ext == "pdf" || ext == "epub" {
                    let path_str = file_path.to_string_lossy().to_string();
                    if existing.contains(&path_str) {
                        continue;
                    }
                    let filename = file_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let sha256 = documents::compute_sha256(&path_str)?;
                    let doc_type = if ext == "epub" { "epub" } else { "pdf" };
                    pending.push((path_str, filename, sha256, doc_type.to_string()));
                }
            }
        }
    }

    if pending.is_empty() {
        return Ok(0);
    }

    // Acquire lock only for the INSERTs
    let conn = conn_mutex.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    for (path_str, filename, sha256, doc_type) in &pending {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO documents (id, title, original_filename, file_path, file_sha256, page_count, created_at, updated_at, last_opened_at, parse_status, has_native_toc, document_type)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, 'pending', 0, ?9)",
            rusqlite::params![id, filename, filename, path_str, sha256, now, now, now, doc_type],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(pending.len() as i32)
}

fn start_watcher(
    library: &LibraryState,
    app_handle: &AppHandle,
    folder_path: &str,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(folder_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *library.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);

    let db_path = library.db_path.clone();
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let c = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
        for event in rx {
            let Ok(Event {
                kind: EventKind::Create(_),
                paths,
                ..
            }) = event
            else {
                continue;
            };
            let mut imported = false;
            for path in &paths {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) {
                    if ext == "pdf" || ext == "epub" {
                        let path_str = path.to_string_lossy().to_string();
                        let exists: bool = c
                            .query_row(
                                "SELECT COUNT(*) FROM documents WHERE file_path = ?1",
                                rusqlite::params![path_str],
                                |row| row.get::<_, i64>(0),
                            )
                            .unwrap_or(0)
                            > 0;
                        if !exists {
                            let filename = path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let sha256 =
                                documents::compute_sha256(&path_str).unwrap_or_default();
                            let doc_type = if ext == "epub" { "epub" } else { "pdf" };
                            let id = Uuid::new_v4().to_string();
                            let now = Utc::now().to_rfc3339();
                            let _ = c.execute(
                                "INSERT INTO documents (id,title,original_filename,file_path,\
                                 file_sha256,page_count,created_at,updated_at,last_opened_at,\
                                 parse_status,has_native_toc,document_type)
                                 VALUES (?1,?2,?3,?4,?5,NULL,?6,?7,?8,'pending',0,?9)",
                                rusqlite::params![
                                    id, filename, filename, path_str, sha256, now, now, now, doc_type
                                ],
                            );
                            imported = true;
                        }
                    }
                }
            }
            if imported {
                let _ = handle.emit("library-folder-updated", ());
            }
        }
    });
    Ok(())
}

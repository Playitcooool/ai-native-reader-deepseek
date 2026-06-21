use rusqlite::{Connection, Result};
use std::path::Path;

pub fn initialize_database(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT,
            original_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_sha256 TEXT,
            page_count INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT,
            last_page INTEGER DEFAULT 1,
            last_zoom REAL DEFAULT 1.0,
            parse_status TEXT DEFAULT 'pending',
            has_native_toc INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS pages (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            text TEXT,
            text_status TEXT DEFAULT 'pending',
            char_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(document_id, page_number),
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS toc_nodes (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            parent_id TEXT,
            title TEXT NOT NULL,
            level INTEGER NOT NULL,
            order_index INTEGER NOT NULL,
            start_page INTEGER NOT NULL,
            end_page INTEGER,
            source TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY(parent_id) REFERENCES toc_nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            toc_node_id TEXT,
            type TEXT NOT NULL,
            selected_text TEXT,
            note_text TEXT,
            color TEXT,
            anchor_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY(toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ai_sessions (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            title TEXT,
            scope_type TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            session_summary TEXT,
            last_compacted_message_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            citations_json TEXT,
            context_snapshot_json TEXT,
            page_number INTEGER,
            selection_anchor_json TEXT,
            is_compacted INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reading_states (
            document_id TEXT PRIMARY KEY,
            current_page_number INTEGER DEFAULT 1,
            current_toc_node_id TEXT,
            progress_ratio REAL DEFAULT 0,
            recent_pages_json TEXT,
            last_selection_anchor_json TEXT,
            last_opened_at TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY(current_toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ai_answer_citations (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            toc_node_id TEXT,
            quote TEXT,
            bbox_json TEXT,
            anchor_json TEXT,
            confidence REAL DEFAULT 1.0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY(toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS learning_memories (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            concept TEXT NOT NULL,
            concept_normalized TEXT NOT NULL,
            status TEXT NOT NULL,
            related_page_numbers_json TEXT,
            evidence_message_ids_json TEXT,
            confidence REAL DEFAULT 0.5,
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(document_id, concept_normalized),
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provider_settings (
            id TEXT PRIMARY KEY,
            provider_type TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            model TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

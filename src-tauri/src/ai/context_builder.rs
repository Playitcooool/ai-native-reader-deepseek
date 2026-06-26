use serde::{Deserialize, Serialize};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn get_document_type(conn: &Connection, document_id: &str) -> String {
    conn.query_row(
        "SELECT document_type FROM documents WHERE id = ?1",
        rusqlite::params![document_id],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "pdf".to_string())
}

fn page_label(doc_type: &str) -> &'static str {
    if doc_type == "epub" { "ch" } else { "p" }
}

fn page_text_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Seed the page text cache with a value (called from save_page_text commands).
pub fn cache_page_text(document_id: &str, page_number: i64, text: &str) {
    let key = format!("{}:{}", document_id, page_number);
    if let Ok(mut cache) = page_text_cache().lock() {
        // Simple bounded cache: only insert, never grow unbounded.
        // Keep it simple: LRU not worth it for our access pattern.
        if cache.len() < 200 {
            // This is safe: HashMap keys are Copy-like (String → &str lookup via String)
            let _ = cache.insert(key, text.to_string());
        }
    }
}

/// Update the cache helper — called before constructing context.
fn lookup_page_text(document_id: &str, page: i64) -> Option<String> {
    let key = format!("{}:{}", document_id, page);
    if let Ok(cache) = page_text_cache().lock() {
        if let Some(text) = cache.get(&key) {
            return Some(text.clone());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SelectionAnchor {
    #[serde(rename = "type")]
    pub anchor_type: String,
    pub page_number: i64,
    pub selected_text: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContextItem {
    pub id: String,
    pub kind: String,
    pub priority: i64,
    pub text: String,
    pub page_number: Option<i64>,
    pub toc_node_id: Option<String>,
    pub is_hard_evidence: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Citation {
    pub id: String,
    pub document_id: String,
    pub page_number: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContextPack {
    pub document_id: String,
    pub session_id: Option<String>,
    pub mode: String,
    pub scope_type: String,
    pub hard_evidence: Vec<ContextItem>,
    pub soft_memory: Vec<ContextItem>,
    pub citation_targets: Vec<Citation>,
    pub token_estimate: i64,
    pub char_estimate: i64,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARS_CLOUD: i64 = 20000;
#[allow(dead_code)]
const MAX_CHARS_LOCAL: i64 = 8000;
const NEARBY_PAGES: i64 = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn estimate_tokens(chars: i64) -> i64 {
    (chars as f64 / 3.0).ceil() as i64
}

fn trim_text(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        text.to_string()
    } else {
        format!("{}... [trimmed]", &text[..max_chars])
    }
}

/// Format the full TOC tree as a compact indented index string.
/// `label` is "p" for PDFs, "ch" for epubs — from `page_label()`.
/// Returns empty string if no TOC nodes exist for this document.
fn get_full_toc_index(conn: &Connection, document_id: &str, label: &str) -> String {
    let mut lines = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT title, level, start_page, end_page FROM toc_nodes
         WHERE document_id = ?1
         ORDER BY order_index",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![document_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        }) {
            for row in rows.flatten() {
                let (title, level, start, end) = row;
                let indent = "  ".repeat(level.max(0) as usize);
                let page_range = match end {
                    Some(e) if e != start => format!("{}.{}-{}", label, start, e),
                    _ => format!("{}.{}", label, start),
                };
                lines.push(format!("{}{} ({})", indent, title, page_range));
            }
        }
    }
    lines.join("\n")
}

fn get_toc_breadcrumb(
    conn: &Connection,
    document_id: &str,
    page_number: i64,
) -> (String, Option<String>) {
    let mut path_parts: Vec<String> = Vec::new();
    let mut deepest_id: Option<String> = None;
    let mut last_level: i64 = -1;

    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, level FROM toc_nodes
         WHERE document_id = ?1 AND start_page <= ?2 AND (end_page >= ?2 OR end_page IS NULL)
         ORDER BY level ASC",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![document_id, page_number], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        }) {
            for row in rows.flatten() {
                let (id, title, level) = row;
                if level > last_level {
                    path_parts.push(title);
                    last_level = level;
                    deepest_id = Some(id);
                }
            }
        }
    }

    let path = if path_parts.is_empty() {
        String::new()
    } else {
        path_parts.join(" > ")
    };

    (path, deepest_id)
}

fn get_page_text(conn: &Connection, document_id: &str, page: i64) -> Option<String> {
    // Check cache first
    if let Some(text) = lookup_page_text(document_id, page) {
        return Some(text);
    }
    // Fall through to DB
    if let Ok(mut stmt) = conn.prepare(
        "SELECT text FROM pages WHERE document_id = ?1 AND page_number = ?2 AND text_status = 'ready'",
    ) {
        if let Ok(mut rows) = stmt.query_map(rusqlite::params![document_id, page], |row| row.get::<_, String>(0)) {
            let text = rows.next().and_then(|r| r.ok());
            if let Some(ref t) = text {
                cache_page_text(document_id, page, t);
            }
            return text;
        }
    }
    None
}

fn get_recent_turns(
    conn: &Connection,
    session_id: &str,
    limit: i64,
) -> Vec<ContextItem> {
    let mut turns = Vec::new();

    if let Ok(mut stmt) = conn.prepare(
        "SELECT role, content, page_number FROM ai_messages
         WHERE session_id = ?1 AND is_compacted = 0
         ORDER BY created_at DESC LIMIT ?2",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![session_id, limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        }) {
            for row in rows.flatten() {
                let (role, content, page) = row;
                turns.push(ContextItem {
                    id: format!("turn_{}", turns.len()),
                    kind: "session_recent_turn".into(),
                    priority: 6,
                    text: format!("[{}]\n{}", role, trim_text(&content, 500)),
                    page_number: page,
                    toc_node_id: None,
                    is_hard_evidence: false,
                });
            }
        }
    }
    turns.reverse(); // oldest first
    turns
}

fn get_session_summary(conn: &Connection, session_id: &str) -> Option<String> {
    if let Ok(mut stmt) = conn.prepare(
        "SELECT session_summary FROM ai_sessions WHERE id = ?1 AND session_summary IS NOT NULL",
    ) {
        if let Ok(mut rows) = stmt.query_map(rusqlite::params![session_id], |row| row.get::<_, String>(0)) {
            return rows.next().and_then(|r| r.ok());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Context Builders
// ---------------------------------------------------------------------------

pub fn build_selection_context(
    conn: &Connection,
    document_id: &str,
    _title: &str,
    page_number: i64,
    selected_text: &str,
    session_id: Option<&str>,
) -> ContextPack {
    let mut hard_evidence = Vec::new();
    let mut soft_memory = Vec::new();
    let mut warnings = Vec::new();
    let mut char_estimate: i64 = 0;

    let doc_type = get_document_type(conn, document_id);
    let label = page_label(&doc_type);

    // 1. Selected text (priority 1)
    hard_evidence.push(ContextItem {
        id: "selected_text".into(),
        kind: "selected_text".into(),
        priority: 1,
        text: selected_text.to_string(),
        page_number: Some(page_number),
        toc_node_id: None,
        is_hard_evidence: true,
    });
    char_estimate += selected_text.len() as i64;

    // 2. Current page text (priority 2)
    let (toc_path, toc_node_id) = get_toc_breadcrumb(conn, document_id, page_number);
    if let Some(text) = get_page_text(conn, document_id, page_number) {
        hard_evidence.push(ContextItem {
            id: "current_page".into(),
            kind: "page_text".into(),
            priority: 2,
            text: format!("[{}.{}]\n{}", label, page_number, text),
            page_number: Some(page_number),
            toc_node_id: toc_node_id.clone(),
            is_hard_evidence: true,
        });
        char_estimate += text.len() as i64;
    } else {
        warnings.push(format!("Page {} text not yet extracted.", page_number));
    }

    // 3. TOC breadcrumb
    if !toc_path.is_empty() {
        hard_evidence.push(ContextItem {
            id: "toc_breadcrumb".into(),
            kind: "toc_breadcrumb".into(),
            priority: 3,
            text: format!("Section: {}", toc_path),
            page_number: None,
            toc_node_id: toc_node_id.clone(),
            is_hard_evidence: true,
        });
    }

    // 4. Nearby pages within budget
    let available = MAX_CHARS_CLOUD - char_estimate;
    for offset in 1..=NEARBY_PAGES {
        if available <= 0 { break; }
        for &page in &[page_number - offset, page_number + offset] {
            if page < 1 { continue; }
            if let Some(text) = get_page_text(conn, document_id, page) {
                if (text.len() as i64) < available {
                    hard_evidence.push(ContextItem {
                        id: format!("nearby_page_{}", page),
                        kind: "nearby_page".into(),
                        priority: 4,
                        text: format!("[{}.{}]\n{}", label, page, text),
                        page_number: Some(page),
                        toc_node_id: None,
                        is_hard_evidence: true,
                    });
                }
            }
        }
    }

    // 5. Soft memory: recent turns
    if let Some(sid) = session_id {
        let turns = get_recent_turns(conn, sid, 6);
        for t in turns {
            if char_estimate + (t.text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += t.text.len() as i64;
                soft_memory.push(t);
            }
        }

        // 6. Session summary
        if let Some(summary) = get_session_summary(conn, sid) {
            let summary_text = format!("Previous session summary:\n{}", summary);
            if char_estimate + (summary_text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += summary_text.len() as i64;
                soft_memory.push(ContextItem {
                    id: "session_summary".into(),
                    kind: "session_summary".into(),
                    priority: 7,
                    text: summary_text,
                    page_number: None,
                    toc_node_id: None,
                    is_hard_evidence: false,
                });
            }
        }
    }

    ContextPack {
        document_id: document_id.to_string(),
        session_id: session_id.map(|s| s.to_string()),
        mode: "selection_explain".into(),
        scope_type: "selection".into(),
        hard_evidence,
        soft_memory,
        citation_targets: vec![],
        token_estimate: estimate_tokens(char_estimate),
        char_estimate,
        warnings,
    }
}

pub fn build_page_context(
    conn: &Connection,
    document_id: &str,
    _title: &str,
    page_number: i64,
    session_id: Option<&str>,
) -> ContextPack {
    let mut hard_evidence = Vec::new();
    let mut soft_memory = Vec::new();
    let mut warnings = Vec::new();
    let mut char_estimate: i64 = 0;

    let (toc_path, toc_node_id) = get_toc_breadcrumb(conn, document_id, page_number);

    let doc_type = get_document_type(conn, document_id);
    let label = page_label(&doc_type);

    // Current page text
    if let Some(text) = get_page_text(conn, document_id, page_number) {
        hard_evidence.push(ContextItem {
            id: "current_page".into(),
            kind: "page_text".into(),
            priority: 2,
            text: format!("[{}.{}]\n{}", label, page_number, text),
            page_number: Some(page_number),
            toc_node_id: toc_node_id.clone(),
            is_hard_evidence: true,
        });
        char_estimate += text.len() as i64;
    } else {
        warnings.push(format!("Page {} text not yet extracted.", page_number));
    }

    // TOC breadcrumb
    if !toc_path.is_empty() {
        hard_evidence.push(ContextItem {
            id: "toc_breadcrumb".into(),
            kind: "toc_breadcrumb".into(),
            priority: 3,
            text: format!("Section: {}", toc_path),
            page_number: None,
            toc_node_id: toc_node_id.clone(),
            is_hard_evidence: true,
        });
    }

    // Nearby pages
    let available = MAX_CHARS_CLOUD - char_estimate;
    for offset in 1..=NEARBY_PAGES {
        if available <= 0 { break; }
        for &page in &[page_number - offset, page_number + offset] {
            if page < 1 { continue; }
            if let Some(text) = get_page_text(conn, document_id, page) {
                if (text.len() as i64) < available {
                    hard_evidence.push(ContextItem {
                        id: format!("nearby_page_{}", page),
                        kind: "nearby_page".into(),
                        priority: 4,
                        text: format!("[{}.{}]\n{}", label, page, text),
                        page_number: Some(page),
                        toc_node_id: None,
                        is_hard_evidence: true,
                    });
                }
            }
        }
    }

    // Soft memory: turns + summary
    if let Some(sid) = session_id {
        for t in get_recent_turns(conn, sid, 3) {
            if char_estimate + (t.text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += t.text.len() as i64;
                soft_memory.push(t);
            }
        }

        // Session summary
        if let Some(summary) = get_session_summary(conn, sid) {
            let summary_text = format!("Previous session summary:\n{}", summary);
            if char_estimate + (summary_text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += summary_text.len() as i64;
                soft_memory.push(ContextItem {
                    id: "session_summary".into(),
                    kind: "session_summary".into(),
                    priority: 7,
                    text: summary_text,
                    page_number: None,
                    toc_node_id: None,
                    is_hard_evidence: false,
                });
            }
        }
    }

    ContextPack {
        document_id: document_id.to_string(),
        session_id: session_id.map(|s| s.to_string()),
        mode: "page_summary".into(),
        scope_type: "page".into(),
        hard_evidence,
        soft_memory,
        citation_targets: vec![],
        token_estimate: estimate_tokens(char_estimate),
        char_estimate,
        warnings,
    }
}

pub fn build_range_context(
    conn: &Connection,
    document_id: &str,
    _title: &str,
    start_page: i64,
    end_page: i64,
    mode: &str,
    session_id: Option<&str>,
    toc_node_id: Option<&str>,
) -> ContextPack {
    let mut hard_evidence = Vec::new();
    let mut soft_memory = Vec::new();
    let mut warnings = Vec::new();
    let mut char_estimate: i64 = 0;
    let doc_type = get_document_type(conn, document_id);
    let label = page_label(&doc_type);
    let toc_node_id = toc_node_id.filter(|id| !id.is_empty());
    let section_title = toc_node_id.and_then(|id| {
        conn.query_row(
            "SELECT title FROM toc_nodes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, String>(0),
        ).ok()
    });

    let mut page_texts: Vec<(i64, String)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT page_number, text FROM pages
         WHERE document_id = ?1 AND page_number BETWEEN ?2 AND ?3 AND text_status = 'ready'
         ORDER BY page_number",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![document_id, start_page, end_page], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }) {
            for row in rows.flatten() {
                page_texts.push(row);
            }
        }
    }

    for (page, text) in &page_texts {
        let entry = format!("--- Page {} ---\n{}", page, text);
        if char_estimate + (entry.len() as i64) <= MAX_CHARS_CLOUD {
            hard_evidence.push(ContextItem {
                id: format!("range_page_{}", page),
                kind: "range_text".into(),
                priority: 1,
                text: entry.clone(),
                page_number: Some(*page),
                toc_node_id: toc_node_id.map(|id| id.to_string()),
                is_hard_evidence: true,
            });
            char_estimate += entry.len() as i64;
        } else {
            warnings.push(format!(
                "Range too large: included {} of {} pages (budget: {} chars).",
                hard_evidence.len(),
                page_texts.len(),
                MAX_CHARS_CLOUD
            ));
            break;
        }
    }

    if page_texts.is_empty() {
        warnings.push("No page text available for this range. Extraction may still be in progress.".into());
    }

    if let Some(title) = section_title {
        hard_evidence.push(ContextItem {
            id: "section_context".into(),
            kind: "toc_breadcrumb".into(),
            priority: 3,
            text: format!("Section: {} ({}.{}-{})", title, label, start_page, end_page),
            page_number: None,
            toc_node_id: toc_node_id.map(|id| id.to_string()),
            is_hard_evidence: true,
        });
    }

    if let Some(sid) = session_id {
        for t in get_recent_turns(conn, sid, 3) {
            if char_estimate + (t.text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += t.text.len() as i64;
                soft_memory.push(t);
            }
        }
    }

    ContextPack {
        document_id: document_id.to_string(),
        session_id: session_id.map(|s| s.to_string()),
        mode: mode.into(),
        scope_type: if toc_node_id.is_some() { "section".into() } else { "range".into() },
        hard_evidence,
        soft_memory,
        citation_targets: vec![],
        token_estimate: estimate_tokens(char_estimate),
        char_estimate,
        warnings,
    }
}

pub fn build_toc_index_context(
    conn: &Connection,
    document_id: &str,
    _title: &str,
    toc_node_id: &str,
    session_id: Option<&str>,
) -> ContextPack {
    let mut hard_evidence = Vec::new();
    let mut soft_memory = Vec::new();
    let mut warnings = Vec::new();
    let mut char_estimate: i64 = 0;

    let doc_type = get_document_type(conn, document_id);
    let label = page_label(&doc_type);

    // 1. Full TOC index (priority 3, always included in every request)
    let toc_index = get_full_toc_index(conn, document_id, label);
    if !toc_index.is_empty() {
        hard_evidence.push(ContextItem {
            id: "full_toc_index".into(),
            kind: "full_toc_index".into(),
            priority: 3,
            text: toc_index.clone(),
            page_number: None,
            toc_node_id: None,
            is_hard_evidence: true,
        });
        char_estimate += toc_index.len() as i64;
    }

    // 2. Resolve target TOC node → section page range
    let (section_title, section_start, section_end) = if !toc_node_id.is_empty() {
        conn.query_row(
            "SELECT title, start_page, COALESCE(end_page, start_page) FROM toc_nodes WHERE id = ?1",
            rusqlite::params![toc_node_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            )),
        ).unwrap_or_else(|_| (String::new(), 1, 1))
    } else {
        (String::new(), 1, 1)
    };

    // 3. Fetch section page texts (budget: MAX_CHARS_CLOUD minus what we've used)
    if !section_title.is_empty() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT page_number, text FROM pages
             WHERE document_id = ?1 AND page_number BETWEEN ?2 AND ?3 AND text_status = 'ready'
             ORDER BY page_number",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![document_id, section_start, section_end], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    let (page, text) = row;
                    let entry = format!("[{}.{}]\n{}", label, page, text);
                    if char_estimate + (entry.len() as i64) <= MAX_CHARS_CLOUD {
                        char_estimate += entry.len() as i64;
                        hard_evidence.push(ContextItem {
                            id: format!("section_page_{}", page),
                            kind: "range_text".into(),
                            priority: 2,
                            text: entry,
                            page_number: Some(page),
                            toc_node_id: Some(toc_node_id.to_string()),
                            is_hard_evidence: true,
                        });
                    } else {
                        warnings.push(format!(
                            "Section too large: included {} of {} pages (budget: {} chars).",
                            hard_evidence.len(),
                            section_end - section_start + 1,
                            MAX_CHARS_CLOUD
                        ));
                        break;
                    }
                }
            }
        } else {
            warnings.push(format!("Section {} has no extracted pages yet.", toc_node_id));
        }

        // Section context breadcrumb
        hard_evidence.push(ContextItem {
            id: "section_context".into(),
            kind: "toc_breadcrumb".into(),
            priority: 5,
            text: format!("Target section: {} ({}.{}-{})", section_title, label, section_start, section_end),
            page_number: None,
            toc_node_id: Some(toc_node_id.to_string()),
            is_hard_evidence: true,
        });
    }

    // 4. Soft memory: recent turns + summary
    if let Some(sid) = session_id {
        for t in get_recent_turns(conn, sid, 3) {
            if char_estimate + (t.text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += t.text.len() as i64;
                soft_memory.push(t);
            }
        }

        if let Some(summary) = get_session_summary(conn, sid) {
            let summary_text = format!("Previous session summary:\n{}", summary);
            if char_estimate + (summary_text.len() as i64) < MAX_CHARS_CLOUD {
                char_estimate += summary_text.len() as i64;
                soft_memory.push(ContextItem {
                    id: "session_summary".into(),
                    kind: "session_summary".into(),
                    priority: 7,
                    text: summary_text,
                    page_number: None,
                    toc_node_id: None,
                    is_hard_evidence: false,
                });
            }
        }
    }

    ContextPack {
        document_id: document_id.to_string(),
        session_id: session_id.map(|s| s.to_string()),
        mode: "toc_index_qa".into(),
        scope_type: "toc_index".into(),
        hard_evidence,
        soft_memory,
        citation_targets: vec![],
        token_estimate: estimate_tokens(char_estimate),
        char_estimate,
        warnings,
    }
}

pub fn build_context_pack_for_mode(
    conn: &Connection,
    document_id: &str,
    title: &str,
    mode: &str,
    page_number: i64,
    selected_text: Option<&str>,
    start_page: Option<i64>,
    end_page: Option<i64>,
    session_id: Option<&str>,
    toc_node_id: Option<&str>,
) -> ContextPack {
    match mode {
        "selection_explain" => {
            let text = selected_text.unwrap_or("");
            build_selection_context(conn, document_id, title, page_number, text, session_id)
        }
        "page_summary" => {
            build_page_context(conn, document_id, title, page_number, session_id)
        }
        "range_summary" | "range_qa" => {
            let s = start_page.unwrap_or(page_number);
            let e = end_page.unwrap_or(page_number);
            build_range_context(conn, document_id, title, s, e, mode, session_id, None)
        }
        "chapter_qa" => {
            let s = start_page.unwrap_or(page_number);
            let e = end_page.unwrap_or(page_number);
            build_range_context(conn, document_id, title, s, e, "chapter_qa", session_id, toc_node_id)
        }
        "toc_index_qa" => {
            let nid = toc_node_id.unwrap_or("");
            build_toc_index_context(conn, document_id, title, nid, session_id)
        }
        _ => {
            build_page_context(conn, document_id, title, page_number, session_id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build_context_pack_for_mode;

    #[test]
    fn range_qa_builds_evidence_for_ready_pages() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE pages (
                document_id TEXT,
                page_number INTEGER,
                text TEXT,
                text_status TEXT,
                char_count INTEGER
            )",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO pages (document_id, page_number, text, text_status, char_count)
             VALUES ('doc', 20, 'twenty', 'ready', 6), ('doc', 21, 'twenty one', 'ready', 10)",
            [],
        ).unwrap();

        let pack = build_context_pack_for_mode(
            &conn,
            "doc",
            "Doc",
            "range_qa",
            20,
            None,
            Some(20),
            Some(21),
            None,
            None,
        );

        let pages: Vec<i64> = pack
            .hard_evidence
            .iter()
            .filter(|item| item.kind == "range_text")
            .filter_map(|item| item.page_number)
            .collect();
        assert_eq!(pages, vec![20, 21]);
        assert_eq!(pack.mode, "range_qa");
    }
}

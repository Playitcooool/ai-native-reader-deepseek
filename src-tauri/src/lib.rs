pub mod ai;
pub mod commands;
pub mod db;
pub mod epub;

use commands::library::LibraryState;
use commands::settings::DbState;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if event.id() == "open_pdf" {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-open-pdf", ()).ok();
        }
    } else if event.id() == "open_folder" {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-open-folder", ()).ok();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_dir = app_handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("reader.db");
            let conn =
                db::migrations::initialize_database(&db_path).expect("failed to initialize database");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(reqwest::Client::new());

            app.manage(LibraryState {
                watcher: std::sync::Mutex::new(None),
                db_path: db_path.to_string_lossy().to_string(),
            });

            // Start watcher if a folder was previously configured
            commands::library::init_watcher_if_configured(app.handle());

            // Build native menus
            let open = MenuItemBuilder::with_id("open_pdf", "Open PDF…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let open_folder = MenuItemBuilder::with_id("open_folder", "Open Folder…")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open)
                .item(&open_folder)
                .separator()
                .item(&quit)
                .build()?;

            // macOS routes Cmd+C/V/X/A through the menu system; without an Edit
            // submenu these shortcuts don't reach webview text inputs.
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let menu = MenuBuilder::new(app).item(&file_menu).item(&edit_menu).build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            commands::documents::import_document,
            commands::documents::get_documents,
            commands::documents::get_document,
            commands::documents::read_document_bytes,
            commands::documents::update_last_page,
            commands::documents::update_last_zoom,
            commands::documents::update_page_count,
            commands::documents::delete_document,
            commands::pages::save_page_text,
            commands::pages::save_pages_text,
            commands::pages::get_page_text,
            commands::pages::get_pages_text,
            commands::pages::count_indexed_pages,
            commands::pages::search_pages_text,
            commands::pages::mark_page_text_failed,
            commands::toc::save_toc_nodes,
            commands::toc::get_toc_tree,
            commands::toc::get_toc_node_for_page,
            commands::notes::create_annotation,
            commands::notes::get_annotations,
            commands::notes::get_annotations_for_page,
            commands::notes::update_annotation,
            commands::notes::delete_annotation,
            commands::settings::get_provider_settings,
            commands::settings::save_provider_settings,
            commands::settings::set_default_provider,
            commands::settings::test_provider,
            commands::ai::get_or_create_ai_session,
            commands::ai::get_session_messages,
            commands::ai::save_ai_message,
            commands::ai::compact_session,
            commands::ai::get_reading_state,
            commands::ai::update_reading_state,
            commands::ai::get_citations_for_message,
            commands::ai::run_ai_workflow,
            commands::library::set_library_folder,
            commands::library::get_library_folder,
            commands::library::clear_library_folder,
            commands::stats::record_reading_heartbeat,
            commands::stats::get_reading_stats,
            commands::epub::get_document_cover,
            commands::epub::get_cached_cover,
            commands::epub::cache_cover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

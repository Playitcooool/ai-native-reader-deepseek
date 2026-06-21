pub mod ai;
pub mod commands;
pub mod db;

use commands::settings::DbState;
use std::sync::Mutex;
use tauri::Manager;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::documents::import_pdf,
            commands::documents::get_documents,
            commands::documents::get_document,
            commands::documents::update_last_page,
            commands::documents::update_last_zoom,
            commands::documents::update_page_count,
            commands::documents::delete_document,
            commands::pages::save_page_text,
            commands::pages::get_page_text,
            commands::pages::get_pages_text,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
            commands::settings::get_provider_settings,
            commands::settings::save_provider_settings,
            commands::settings::set_default_provider,
            commands::settings::test_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

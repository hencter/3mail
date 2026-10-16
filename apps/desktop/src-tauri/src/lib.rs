mod commands;
mod state;

use std::sync::Arc;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use three_mail_db::Db;
use three_mail_sync::{spawn_sync_actor, SyncEvent};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("three_mail=info".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("mail.sqlite3");
            let db = Arc::new(Db::open(&db_path)?);

            let handle = app.handle().clone();
            let sink: three_mail_sync::EventSink = Arc::new(move |ev| match ev {
                SyncEvent::MailUpdated(p) => {
                    let _ = handle.emit("mail_updated", &p);
                }
                SyncEvent::SyncProgress(p) => {
                    let _ = handle.emit("sync_progress", &p);
                }
                SyncEvent::SyncError(p) => {
                    let _ = handle.emit("sync_error", &p);
                }
                SyncEvent::OutboxUpdated(p) => {
                    let _ = handle.emit("outbox_updated", &p);
                }
            });

            let sync = spawn_sync_actor(db.clone(), data_dir.clone(), sink);
            app.manage(AppState { db, sync });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::list_folders,
            commands::list_messages,
            commands::list_threads,
            commands::list_thread_messages,
            commands::search_messages,
            commands::get_message,
            commands::list_signatures,
            commands::list_drafts,
            commands::list_outbox,
            commands::test_account,
            commands::add_account,
            commands::remove_account,
            commands::start_sync,
            commands::mark_read,
            commands::fetch_body,
            commands::archive_message,
            commands::delete_message,
            commands::move_message,
            commands::move_to_folder,
            commands::move_messages,
            commands::mark_messages,
            commands::create_folder,
            commands::list_pinned,
            commands::download_attachment,
            commands::open_attachment,
            commands::set_starred,
            commands::send_message,
            commands::snooze_message,
            commands::pin_message,
            commands::set_category,
            commands::save_draft,
            commands::delete_draft,
            commands::upsert_signature,
            commands::delete_signature,
            commands::cancel_outbox,
            commands::retry_outbox,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

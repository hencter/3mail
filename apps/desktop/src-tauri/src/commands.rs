use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use three_mail_core::{
    AccountConfig, AccountId, AccountSummary, AddAccount, AttachmentId, CreateFolder, Draft,
    FolderId, MarkMessages, MoveMessages,
    CorrespondenceItem, FolderSummary, MarkRead, MessageCategory, MessageDetail, MessageId,
    MessageListItem,
    MoveMessage, OutboxItem, SaveDraft, SendMessage, Signature, SnoozeMessage, StartSync,
    ThreadSummary, UpsertSignature, WriteIntent,
};
use three_mail_db as db;

use crate::state::AppState;

static COMPOSE_PAYLOAD: Mutex<Option<String>> = Mutex::new(None);

fn open_tool_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.unminimize();
        let _ = win.show();
        win.set_focus().map_err(|e| e.to_string())?;
        if label == "compose" {
            let _ = win.emit("compose-load", ());
        }
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(title)
    .inner_size(width, height)
    .min_inner_size(520.0, 420.0)
    .resizable(true)
    .center();

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stage_compose_payload(payload: String) {
    if let Ok(mut slot) = COMPOSE_PAYLOAD.lock() {
        *slot = Some(payload);
    }
}

#[tauri::command]
pub fn take_compose_payload() -> Option<String> {
    COMPOSE_PAYLOAD
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

#[tauri::command]
pub async fn open_compose_window(app: tauri::AppHandle) -> Result<(), String> {
    open_tool_window(&app, "compose", "New Message", 760.0, 640.0)
}

#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_tool_window(&app, "settings", "Settings", 900.0, 640.0)
}

#[tauri::command]
pub fn list_accounts(state: tauri::State<'_, AppState>) -> Result<Vec<AccountSummary>, String> {
    db::list_accounts(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_folders(
    state: tauri::State<'_, AppState>,
    account_id: i64,
) -> Result<Vec<FolderSummary>, String> {
    db::list_folders(&state.db, AccountId(account_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_messages(
    state: tauri::State<'_, AppState>,
    folder_id: i64,
    limit: Option<i64>,
    offset: Option<i64>,
    category: Option<String>,
    include_snoozed: Option<bool>,
    snoozed_only: Option<bool>,
) -> Result<Vec<MessageListItem>, String> {
    db::list_messages(
        &state.db,
        FolderId(folder_id),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
        category.as_deref(),
        include_snoozed.unwrap_or(false),
        snoozed_only.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_threads(
    state: tauri::State<'_, AppState>,
    folder_id: i64,
    limit: Option<i64>,
    offset: Option<i64>,
    category: Option<String>,
) -> Result<Vec<ThreadSummary>, String> {
    db::list_threads(
        &state.db,
        FolderId(folder_id),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
        category.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_thread_messages(
    state: tauri::State<'_, AppState>,
    account_id: i64,
    thread_key: String,
) -> Result<Vec<MessageListItem>, String> {
    db::list_thread_messages(&state.db, AccountId(account_id), &thread_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_correspondence(
    state: tauri::State<'_, AppState>,
    account_id: i64,
    contact_email: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<CorrespondenceItem>, String> {
    let account = db::get_account(&state.db, AccountId(account_id))
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "account not found".to_string())?;
    db::list_correspondence(
        &state.db,
        AccountId(account_id),
        &account.email,
        &contact_email,
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_messages(
    state: tauri::State<'_, AppState>,
    query: String,
    account_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<MessageListItem>, String> {
    db::search_messages(
        &state.db,
        account_id.map(AccountId),
        &query,
        limit.unwrap_or(50),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
) -> Result<Option<MessageDetail>, String> {
    db::get_message(&state.db, MessageId(message_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_signatures(
    state: tauri::State<'_, AppState>,
    account_id: i64,
) -> Result<Vec<Signature>, String> {
    db::list_signatures(&state.db, AccountId(account_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_drafts(
    state: tauri::State<'_, AppState>,
    account_id: i64,
) -> Result<Vec<Draft>, String> {
    db::list_drafts(&state.db, AccountId(account_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_outbox(
    state: tauri::State<'_, AppState>,
    account_id: i64,
) -> Result<Vec<OutboxItem>, String> {
    db::list_outbox(&state.db, AccountId(account_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_account(
    state: tauri::State<'_, AppState>,
    payload: AccountConfig,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::TestAccount(payload))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_account(
    state: tauri::State<'_, AppState>,
    payload: AccountConfig,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::AddAccount(AddAccount { config: payload }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_account(
    state: tauri::State<'_, AppState>,
    account_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::RemoveAccount {
            account_id: AccountId(account_id),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_sync(
    state: tauri::State<'_, AppState>,
    account_id: i64,
    folder_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::StartSync(StartSync {
            account_id: AccountId(account_id),
            folder_id: folder_id.map(FolderId),
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mark_read(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    seen: bool,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MarkRead(MarkRead {
            message_id: MessageId(message_id),
            seen,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_body(
    state: tauri::State<'_, AppState>,
    message_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::FetchBody {
            message_id: MessageId(message_id),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pinned(
    state: tauri::State<'_, AppState>,
    account_id: i64,
    limit: Option<i64>,
) -> Result<Vec<MessageListItem>, String> {
    db::list_pinned_messages(&state.db, AccountId(account_id), limit.unwrap_or(80))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    target_role: String,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MoveMessage(MoveMessage {
            message_id: MessageId(message_id),
            target_role: Some(target_role),
            target_imap_path: None,
            target_folder_id: None,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_to_folder(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    folder_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MoveMessage(MoveMessage {
            message_id: MessageId(message_id),
            target_role: None,
            target_imap_path: None,
            target_folder_id: Some(FolderId(folder_id)),
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_messages(
    state: tauri::State<'_, AppState>,
    message_ids: Vec<i64>,
    folder_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MoveMessages(MoveMessages {
            message_ids: message_ids.into_iter().map(MessageId).collect(),
            target_folder_id: FolderId(folder_id),
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mark_messages(
    state: tauri::State<'_, AppState>,
    message_ids: Vec<i64>,
    seen: bool,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MarkMessages(MarkMessages {
            message_ids: message_ids.into_iter().map(MessageId).collect(),
            seen,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(
    state: tauri::State<'_, AppState>,
    account_id: i64,
    name: String,
    parent_imap_path: Option<String>,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::CreateFolder(CreateFolder {
            account_id: AccountId(account_id),
            name,
            parent_imap_path,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::MoveMessage(MoveMessage {
            message_id: MessageId(message_id),
            target_role: Some("archive".into()),
            target_imap_path: None,
            target_folder_id: None,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::DeleteMessage {
            message_id: MessageId(message_id),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_attachment(
    state: tauri::State<'_, AppState>,
    attachment_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::DownloadAttachment {
            attachment_id: AttachmentId(attachment_id),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_attachment(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    attachment_id: i64,
) -> Result<serde_json::Value, String> {
    let res = state
        .sync
        .enqueue_wait(WriteIntent::DownloadAttachment {
            attachment_id: AttachmentId(attachment_id),
        })
        .await
        .map_err(|e| e.to_string())?;
    let path = res
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "attachment path missing".to_string())?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub async fn export_attachments(
    state: tauri::State<'_, AppState>,
    attachment_ids: Vec<i64>,
    directory: String,
) -> Result<serde_json::Value, String> {
    use std::path::Path;

    let dest_dir = Path::new(&directory);
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let mut saved = 0u32;
    for attachment_id in attachment_ids {
        let res = state
            .sync
            .enqueue_wait(WriteIntent::DownloadAttachment {
                attachment_id: AttachmentId(attachment_id),
            })
            .await
            .map_err(|e| e.to_string())?;
        let src = res
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "attachment path missing".to_string())?;
        let att = db::get_attachment(&state.db, AttachmentId(attachment_id))
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("attachment {attachment_id} not found"))?;
        let base = att
            .filename
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("attachment-{}", attachment_id))
            .replace(['/', '\\', ':'], "_");
        let mut dest = dest_dir.join(&base);
        let mut n = 1u32;
        while dest.exists() {
            let stem = Path::new(&base)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("attachment");
            let ext = Path::new(&base).extension().and_then(|s| s.to_str());
            let name = match ext {
                Some(ext) => format!("{stem}-{n}.{ext}"),
                None => format!("{stem}-{n}"),
            };
            dest = dest_dir.join(name);
            n += 1;
        }
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        saved += 1;
    }
    Ok(serde_json::json!({ "ok": true, "saved": saved, "directory": directory }))
}

#[tauri::command]
pub async fn set_starred(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    starred: bool,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::SetStarred {
            message_id: MessageId(message_id),
            starred,
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, AppState>,
    payload: SendMessage,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::SendMessage(payload))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn snooze_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    until: Option<String>,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::SnoozeMessage(SnoozeMessage {
            message_id: MessageId(message_id),
            until,
        }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pin_message(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    pinned: bool,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::PinMessage {
            message_id: MessageId(message_id),
            pinned,
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_category(
    state: tauri::State<'_, AppState>,
    message_id: i64,
    category: String,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::SetCategory {
            message_id: MessageId(message_id),
            category: MessageCategory::parse(&category),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_draft(
    state: tauri::State<'_, AppState>,
    payload: SaveDraft,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::SaveDraft(payload))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_draft(
    state: tauri::State<'_, AppState>,
    draft_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::DeleteDraft { draft_id })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_signature(
    state: tauri::State<'_, AppState>,
    payload: UpsertSignature,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::UpsertSignature(payload))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_signature(
    state: tauri::State<'_, AppState>,
    signature_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::DeleteSignature { signature_id })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_outbox(
    state: tauri::State<'_, AppState>,
    outbox_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::CancelOutbox { outbox_id })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn retry_outbox(
    state: tauri::State<'_, AppState>,
    outbox_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .sync
        .enqueue_wait(WriteIntent::RetryOutbox { outbox_id })
        .await
        .map_err(|e| e.to_string())
}

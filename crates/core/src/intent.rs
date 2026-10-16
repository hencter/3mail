use serde::{Deserialize, Serialize};

use crate::models::{AccountId, AttachmentId, FolderId, MessageCategory, MessageId, TlsMode};

/// Write intents from the UI. Commands enqueue these; only the Sync Actor executes them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WriteIntent {
    TestAccount(AccountConfig),
    AddAccount(AddAccount),
    RemoveAccount { account_id: AccountId },
    StartSync(StartSync),
    CancelSync { account_id: AccountId },
    MarkRead(MarkRead),
    SetStarred { message_id: MessageId, starred: bool },
    FetchBody { message_id: MessageId },
    MoveMessage(MoveMessage),
    MoveMessages(MoveMessages),
    MarkMessages(MarkMessages),
    CreateFolder(CreateFolder),
    DeleteMessage { message_id: MessageId },
    DownloadAttachment { attachment_id: AttachmentId },
    SendMessage(SendMessage),
    SnoozeMessage(SnoozeMessage),
    PinMessage { message_id: MessageId, pinned: bool },
    SetCategory {
        message_id: MessageId,
        category: MessageCategory,
    },
    SaveDraft(SaveDraft),
    DeleteDraft { draft_id: i64 },
    UpsertSignature(UpsertSignature),
    DeleteSignature { signature_id: i64 },
    CancelOutbox { outbox_id: i64 },
    RetryOutbox { outbox_id: i64 },
    /// Internal: process due snoozes + scheduled sends.
    ProcessDueLocal,
}

/// Shared IMAP/SMTP endpoint config (add account + connection test).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    pub email: String,
    pub display_name: Option<String>,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: TlsMode,
    /// Application password or account password — stored in OS keyring, never in SQLite.
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddAccount {
    #[serde(flatten)]
    pub config: AccountConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSync {
    pub account_id: AccountId,
    pub folder_id: Option<FolderId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkRead {
    pub message_id: MessageId,
    pub seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveMessage {
    pub message_id: MessageId,
    /// Target folder role: `archive` | `trash` | `inbox`, or omit to use imap_path.
    pub target_role: Option<String>,
    pub target_imap_path: Option<String>,
    /// Any local folder, possibly in another account (then APPEND + delete).
    #[serde(default)]
    pub target_folder_id: Option<FolderId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolder {
    pub account_id: AccountId,
    /// Display name of the new folder (one level, Unicode).
    pub name: String,
    /// Wire path of the parent folder; `None` creates at the top level.
    #[serde(default)]
    pub parent_imap_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessage {
    pub account_id: AccountId,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    pub subject: String,
    pub text_body: String,
    /// When set, sent as multipart/alternative alongside `text_body`; any signature is already inline.
    #[serde(default)]
    pub html_body: Option<String>,
    /// When set (RFC3339 UTC), enqueue to outbox instead of sending immediately.
    pub send_at: Option<String>,
    /// Append this signature body (if set) before send / schedule.
    pub signature_id: Option<i64>,
    pub draft_id: Option<i64>,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveMessages {
    pub message_ids: Vec<MessageId>,
    pub target_folder_id: FolderId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkMessages {
    pub message_ids: Vec<MessageId>,
    pub seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnoozeMessage {
    pub message_id: MessageId,
    /// RFC3339 UTC; omit / null to clear snooze.
    pub until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveDraft {
    pub draft_id: Option<i64>,
    pub account_id: AccountId,
    pub to_addrs: String,
    pub cc_addrs: String,
    #[serde(default)]
    pub bcc_addrs: String,
    pub subject: String,
    pub text_body: String,
    #[serde(default)]
    pub html_body: Option<String>,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    /// Kept once set; a later save may omit it.
    #[serde(default)]
    pub source_message_id: Option<MessageId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertSignature {
    pub signature_id: Option<i64>,
    pub account_id: AccountId,
    pub name: String,
    pub body_text: String,
    #[serde(default)]
    pub body_html: Option<String>,
    pub is_default: bool,
}

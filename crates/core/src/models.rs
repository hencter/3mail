use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AccountId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FolderId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MessageId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AttachmentId(pub i64);

/// How to establish TLS for IMAP or SMTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    /// Implicit TLS from the first byte (IMAP 993 / SMTP 465).
    #[default]
    Ssl,
    /// Plain connect then STARTTLS (IMAP 143 / SMTP 587).
    StartTls,
}

impl TlsMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ssl => "ssl",
            Self::StartTls => "starttls",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "starttls" => Self::StartTls,
            _ => Self::Ssl,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSummary {
    pub id: AccountId,
    pub email: String,
    pub display_name: Option<String>,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: TlsMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderSummary {
    pub id: FolderId,
    pub account_id: AccountId,
    pub name: String,
    pub imap_path: String,
    pub role: Option<String>,
    pub unseen_count: i64,
    pub total_count: i64,
    /// True once this folder has a `sync_state` row (envelopes have been fetched at least once).
    pub synced: bool,
}

/// Local Smart Inbox bucket (header heuristics + optional sender override).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MessageCategory {
    Person,
    Notification,
    Newsletter,
    #[default]
    Other,
}

impl MessageCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Notification => "notification",
            Self::Newsletter => "newsletter",
            Self::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "person" | "personal" => Self::Person,
            "notification" | "notifications" => Self::Notification,
            "newsletter" | "newsletters" => Self::Newsletter,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageListItem {
    pub id: MessageId,
    pub account_id: AccountId,
    pub folder_id: FolderId,
    pub uid: i64,
    pub subject: Option<String>,
    pub from_addr: Option<String>,
    pub date: Option<DateTime<Utc>>,
    pub unseen: bool,
    pub starred: bool,
    pub has_attachments: bool,
    pub snippet: Option<String>,
    /// Local Smart Inbox bucket.
    pub category: String,
    pub pinned: bool,
    pub snoozed: bool,
    pub snooze_until: Option<DateTime<Utc>>,
    pub thread_key: Option<String>,
    pub thread_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceItem {
    #[serde(flatten)]
    pub list: MessageListItem,
    /// `inbound` = from contact; `outbound` = from this account toward contact.
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadSummary {
    pub thread_key: String,
    pub account_id: AccountId,
    pub folder_id: FolderId,
    pub subject: Option<String>,
    pub from_addr: Option<String>,
    pub date: Option<DateTime<Utc>>,
    pub unseen: bool,
    pub starred: bool,
    pub pinned: bool,
    pub category: String,
    pub snippet: Option<String>,
    pub has_attachments: bool,
    pub message_count: i64,
    /// Newest message id in the thread (for open/detail).
    pub latest_message_id: MessageId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub id: i64,
    pub account_id: AccountId,
    pub name: String,
    pub body_text: String,
    pub is_default: bool,
    pub body_html: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub id: i64,
    pub account_id: AccountId,
    pub to_addrs: String,
    pub cc_addrs: String,
    pub bcc_addrs: String,
    pub subject: String,
    pub text_body: String,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub html_body: Option<String>,
    /// Message in the Drafts mailbox this local draft was opened from.
    pub source_message_id: Option<MessageId>,
    pub message_id_header: Option<String>,
    pub server_message_id: Option<MessageId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxItem {
    pub id: i64,
    pub account_id: AccountId,
    pub to_addrs: String,
    pub cc_addrs: Option<String>,
    pub bcc_addrs: Option<String>,
    pub subject: String,
    pub text_body: String,
    pub status: String,
    pub send_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub draft_id: Option<i64>,
    pub html_body: Option<String>,
    #[serde(default)]
    pub attachments: Vec<crate::intent::StagedSendAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentSummary {
    pub id: AttachmentId,
    pub message_id: MessageId,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub downloaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDetail {
    pub list: MessageListItem,
    pub to_addrs: Option<String>,
    pub cc_addrs: Option<String>,
    pub message_id_header: Option<String>,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub text_body: Option<String>,
    pub html_body: Option<String>,
    pub body_loaded: bool,
    pub attachments: Vec<AttachmentSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    Connecting,
    ListingFolders,
    Fetching,
    Idle,
    Done,
    Error,
}

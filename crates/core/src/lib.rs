//! Domain types, DTOs, write intents, and events for 3mail.
//! No network, no SQLite — pure shared vocabulary.

mod error;
mod events;
mod intent;
mod mailfmt;
mod models;

pub use error::{Error, Result};
pub use events::{MailUpdated, OutboxUpdated, SyncErrorEvent, SyncProgress};
pub use intent::{
    AccountConfig, AddAccount, CreateFolder, MarkMessages, MarkRead, MoveMessage, MoveMessages, SaveDraft, SendMessage, SnoozeMessage,
    StartSync, UpsertSignature, WriteIntent,
};
pub use mailfmt::{normalize_mail_date, parse_mail_date, split_addr_list};
pub use models::{
    AccountId, AccountSummary, AttachmentId, AttachmentSummary, Draft, FolderId, FolderSummary,
    MessageCategory, MessageDetail, MessageId, MessageListItem, OutboxItem, Signature, SyncPhase,
    ThreadSummary, TlsMode,
};

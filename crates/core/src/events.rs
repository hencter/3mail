use serde::{Deserialize, Serialize};

use crate::models::{AccountId, FolderId, SyncPhase};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailUpdated {
    pub account_id: AccountId,
    pub folder_id: Option<FolderId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub account_id: AccountId,
    pub phase: SyncPhase,
    pub n: u64,
    pub total: Option<u64>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncErrorEvent {
    pub account_id: Option<AccountId>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxUpdated {
    pub account_id: AccountId,
}

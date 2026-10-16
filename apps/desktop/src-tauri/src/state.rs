use std::sync::Arc;

use three_mail_db::Db;
use three_mail_sync::SyncHandle;

pub struct AppState {
    pub db: Arc<Db>,
    pub sync: SyncHandle,
}

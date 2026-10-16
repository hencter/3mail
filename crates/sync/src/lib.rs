//! Sync/Write Actor: sole writer to SQLite and driver of IMAP/SMTP.

mod actor;
mod keyring_store;

pub use actor::{spawn_sync_actor, EventSink, SyncEvent, SyncHandle};
pub use keyring_store::{
    delete_secret, keyring_user_for_email, load_secret, store_secret, KEYRING_SERVICE,
};

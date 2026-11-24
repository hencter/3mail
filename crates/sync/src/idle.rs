//! Dedicated IMAP IDLE connections (one thread) — enqueue StartSync on mailbox changes.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use three_mail_core::{AccountId, FolderId, StartSync, WriteIntent};
use three_mail_db::{self as db, find_folder_by_role, list_accounts, Db};
use three_mail_mail::{capability_idle, connect, idle_until_change, imap_capabilities, select_mailbox};

use crate::actor::Job;
use crate::keyring_store::load_secret;

const POLL_FALLBACK_SECS: u64 = 120;
const IDLE_TIMEOUT: Duration = Duration::from_secs(29 * 60);

/// Background sync queue only (see `SyncHandle::enqueue`).
pub fn spawn_idle_listener(db: Arc<Db>, sync_tx: mpsc::UnboundedSender<Job>) {
    std::thread::Builder::new()
        .name("three-mail-idle".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("idle runtime");
            rt.block_on(idle_main_loop(db, sync_tx));
        })
        .expect("spawn idle thread");
}

async fn idle_main_loop(db: Arc<Db>, sync_tx: mpsc::UnboundedSender<Job>) {
    loop {
        let accounts = match list_accounts(&db) {
            Ok(a) => a,
            Err(e) => {
                warn!(error = %e, "IDLE: list_accounts failed");
                tokio::time::sleep(Duration::from_secs(POLL_FALLBACK_SECS)).await;
                continue;
            }
        };
        if accounts.is_empty() {
            tokio::time::sleep(Duration::from_secs(POLL_FALLBACK_SECS)).await;
            continue;
        }
        for account in accounts {
            if let Err(e) = idle_account_round(&db, &sync_tx, account.id).await {
                debug!(account_id = account.id.0, error = %e, "IDLE round ended");
            }
        }
    }
}

async fn idle_account_round(
    db: &Db,
    sync_tx: &mpsc::UnboundedSender<Job>,
    account_id: AccountId,
) -> Result<(), three_mail_core::Error> {
    let account = db::get_account(db, account_id)?
        .ok_or_else(|| three_mail_core::Error::NotFound(format!("account {}", account_id.0)))?;
    let keyring_user = db::account_keyring_user(db, account_id)?
        .ok_or_else(|| three_mail_core::Error::msg("missing keyring user"))?;
    let secret = load_secret(&keyring_user)?;

    let inbox = find_folder_by_role(db, account_id, "inbox")?;
    let Some(inbox) = inbox else {
        return Ok(());
    };

    let mut session = connect(
        &account.imap_host,
        account.imap_port,
        account.imap_security,
        &account.email,
        &secret,
    )
    .await?;

    let caps = imap_capabilities(&mut session).await?;
    if !capability_idle(&caps) {
        enqueue_sync(sync_tx, account_id, inbox.id);
        tokio::time::sleep(Duration::from_secs(POLL_FALLBACK_SECS)).await;
        let _ = session.logout().await;
        return Ok(());
    }

    let folder_path = inbox.imap_path;
    let _ = select_mailbox(&mut session, &folder_path).await?;

    let (mut session, should_sync) = idle_until_change(session, IDLE_TIMEOUT).await?;
    let _ = session.logout().await;
    if should_sync {
        info!(account_id = account_id.0, "IDLE: new mail activity");
        enqueue_sync(sync_tx, account_id, inbox.id);
    } else {
        debug!(account_id = account_id.0, "IDLE: no activity this round");
    }

    Ok(())
}

fn enqueue_sync(sync_tx: &mpsc::UnboundedSender<Job>, account_id: AccountId, folder_id: FolderId) {
    let _ = sync_tx.send(Job {
        intent: WriteIntent::StartSync(StartSync {
            account_id,
            folder_id: Some(folder_id),
        }),
        reply: None,
    });
}
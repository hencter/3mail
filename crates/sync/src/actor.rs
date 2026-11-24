use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::sync::{mpsc, oneshot};
use tracing::{error, info, warn};

use three_mail_core::{
    AccountConfig, AccountId, AddAccount, AttachmentId, CreateFolder, Error, MarkMessages,
    MoveMessages, FolderId, MailUpdated, MarkRead,
    MessageCategory, MessageId, MoveMessage, OutboxUpdated, Result, SaveDraft, SendMessage,
    split_addr_list, AccountSummary, SnoozeMessage, StartSync, SyncErrorEvent, SyncPhase,
    SyncProgress, UpsertSignature, WriteIntent,
};
use three_mail_db::{
    self as db, clear_folder_messages, delete_account, delete_draft, delete_message_row,
    draft_source_message,
    delete_outbox, delete_signature, enqueue_outbox, ensure_draft_message_id, find_account_by_email,
    find_folder_by_role, find_message_by_header, get_draft, set_draft_server_link,
    set_outbox_attachments_json, upsert_flag_retry,
    bump_sender_category_stat, get_account, get_attachment, get_folder, get_outbox_account,
    get_sender_category_override, get_sender_learned_category, get_signature,
    attachment_id_by_part, clear_flag_retry, insert_account, is_category_manual, list_due_outbox,
    list_flag_retries, local_only_pins, mark_local_pins_flagged,
    message_envelope_fields,
    message_imap_coords, refresh_folder_counts, redecode_mime_subjects, reindex_message_fts,
    replace_attachments, save_draft, set_attachment_path, set_message_category,
    set_message_headers_from_parse, set_message_list_unsubscribe, set_message_seen,
    set_message_snippet, set_message_starred, set_message_thread_key, set_outbox_status, set_pinned,
    set_snooze, thread_imap_coords,
    unsnooze_due, update_account, upsert_body, upsert_folder, upsert_message_envelope,
    upsert_sender_category, upsert_signature, Db, EnvelopeUpsert,
};
use crate::outbox_attach::{remove_staging, stage_attachments};
use three_mail_mail::{
    append_draft, append_message, build_rfc822_bytes, classify_message, connect, create_mailbox,
    decode_mime_header,
    capability_condstore, encode_imap_utf7, fetch_condstore_changes, fetch_envelopes, fetch_raw_message,
    imap_capabilities, list_mailbox_names, mailbox_delimiter,
    parse_rfc822, select_mailbox, send_mail_with_headers, snippet_text, test_imap, test_smtp,
    MailAttachment,
    thread_key, uid_delete, uid_move_to, uid_set_flagged, uid_set_seen, uids_move_to, uids_set_flagged,
    uids_set_seen,
    ClassifyInput,
};

use crate::keyring_store::{delete_secret, keyring_user_for_email, load_secret, store_secret};

pub type EventSink = Arc<dyn Fn(SyncEvent) + Send + Sync>;

#[derive(Debug, Clone)]
pub enum SyncEvent {
    MailUpdated(MailUpdated),
    SyncProgress(SyncProgress),
    SyncError(SyncErrorEvent),
    OutboxUpdated(OutboxUpdated),
}

pub(crate) struct Job {
    pub(crate) intent: WriteIntent,
    pub(crate) reply: Option<oneshot::Sender<Result<serde_json::Value>>>,
}

#[derive(Clone)]
pub struct SyncHandle {
    interactive: mpsc::UnboundedSender<Job>,
    background: mpsc::UnboundedSender<Job>,
}

impl SyncHandle {
    pub fn enqueue(&self, intent: WriteIntent) {
        let _ = self.background.send(Job {
            intent,
            reply: None,
        });
    }

    pub async fn enqueue_wait(&self, intent: WriteIntent) -> Result<serde_json::Value> {
        let (tx, rx) = oneshot::channel();
        self.interactive
            .send(Job {
                intent,
                reply: Some(tx),
            })
            .map_err(|_| Error::msg("sync actor stopped"))?;
        rx.await.map_err(|_| Error::msg("sync actor dropped reply"))?
    }
}

async fn run_job(db: Arc<Db>, data_dir: &Path, sink: EventSink, job: Job) {
    let result = handle_intent(db, data_dir, sink.clone(), job.intent).await;
    if let Some(reply) = job.reply {
        let _ = reply.send(result);
    } else if let Err(e) = result {
        error!(error = %e, "sync job failed");
        sink(SyncEvent::SyncError(SyncErrorEvent {
            account_id: None,
            message: e.to_string(),
        }));
    }
}

fn skip_duplicate_background_sync(intent: &WriteIntent, last: &mut HashMap<i64, Instant>) -> bool {
    const MIN_GAP: Duration = Duration::from_secs(20);
    let WriteIntent::StartSync(s) = intent else {
        return false;
    };
    let Some(folder_id) = s.folder_id else {
        return false;
    };
    let now = Instant::now();
    if let Some(prev) = last.get(&folder_id.0) {
        if now.duration_since(*prev) < MIN_GAP {
            return true;
        }
    }
    last.insert(folder_id.0, now);
    false
}

pub fn spawn_sync_actor(db: Arc<Db>, data_dir: PathBuf, sink: EventSink) -> SyncHandle {
    let (interactive_tx, mut interactive_rx) = mpsc::unbounded_channel::<Job>();
    let (background_tx, mut background_rx) = mpsc::unbounded_channel::<Job>();
    let bg_tick = background_tx.clone();
    let db_idle = db.clone();
    std::thread::Builder::new()
        .name("three-mail-sync".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("sync runtime");
            rt.block_on(async move {
                let mut last_bg_sync: HashMap<i64, Instant> = HashMap::new();
                // Snooze wakeups and the 10s send-undo window. Online only.
                let mut due_interval = tokio::time::interval(Duration::from_secs(1));
                due_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        biased;
                        job = interactive_rx.recv() => {
                            let Some(job) = job else { break; };
                            run_job(db.clone(), &data_dir, sink.clone(), job).await;
                        }
                        job = background_rx.recv() => {
                            let Some(job) = job else { continue; };
                            if job.reply.is_none()
                                && skip_duplicate_background_sync(&job.intent, &mut last_bg_sync)
                            {
                                continue;
                            }
                            run_job(db.clone(), &data_dir, sink.clone(), job).await;
                        }
                        _ = due_interval.tick() => {
                            let _ = bg_tick.send(Job {
                                intent: WriteIntent::ProcessDueLocal,
                                reply: None,
                            });
                        }
                    }
                }
            });
        })
        .expect("spawn sync thread");
    let handle = SyncHandle {
        interactive: interactive_tx,
        background: background_tx.clone(),
    };
    crate::idle::spawn_idle_listener(db_idle, background_tx);
    handle
}

async fn handle_intent(
    db: Arc<Db>,
    data_dir: &Path,
    sink: EventSink,
    intent: WriteIntent,
) -> Result<serde_json::Value> {
    match intent {
        WriteIntent::TestAccount(cfg) => test_account(cfg).await,
        WriteIntent::AddAccount(a) => add_account(db, sink, a).await,
        WriteIntent::RemoveAccount { account_id } => remove_account(db, account_id).await,
        WriteIntent::StartSync(s) => start_sync(db, sink, s).await,
        WriteIntent::CancelSync { .. } => Ok(serde_json::json!({ "ok": true, "note": "noop" })),
        WriteIntent::MarkRead(m) => mark_read(db, sink, m).await,
        WriteIntent::SetStarred {
            message_id,
            starred,
        } => set_starred(db, sink, message_id, starred).await,
        WriteIntent::FetchBody { message_id } => fetch_body(db, data_dir, sink, message_id).await,
        WriteIntent::MoveMessage(m) => move_message(db, sink, m).await,
        WriteIntent::MoveMessages(m) => move_messages(db, sink, m).await,
        WriteIntent::MarkMessages(m) => mark_messages(db, sink, m).await,
        WriteIntent::CreateFolder(c) => create_folder(db, sink, c).await,
        WriteIntent::DeleteMessage { message_id } => {
            move_message(
                db,
                sink,
                MoveMessage {
                    message_id,
                    target_role: Some("trash".into()),
                    target_imap_path: None,
                    target_folder_id: None,
                },
            )
            .await
        }
        WriteIntent::DownloadAttachment { attachment_id } => {
            download_attachment(db, data_dir, sink, attachment_id).await
        }
        WriteIntent::SendMessage(m) => send_message(db, data_dir, sink, m).await,
        WriteIntent::SnoozeMessage(m) => snooze_message(db, sink, m).await,
        WriteIntent::PinMessage {
            message_id,
            pinned,
        } => pin_message(db, sink, message_id, pinned).await,
        WriteIntent::SetCategory {
            message_id,
            category,
        } => set_category(db, sink, message_id, category).await,
        WriteIntent::SaveDraft(d) => save_draft_intent(db, sink, d).await,
        WriteIntent::DeleteDraft { draft_id } => delete_draft_intent(db, sink, draft_id).await,
        WriteIntent::UpsertSignature(s) => upsert_signature_intent(db, sink, s).await,
        WriteIntent::DeleteSignature { signature_id } => {
            delete_signature(&db, signature_id)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        WriteIntent::CancelOutbox { outbox_id } => {
            remove_staging(data_dir, outbox_id);
            let account_id = delete_outbox(&db, outbox_id)?;
            if let Some(account_id) = account_id {
                sink(SyncEvent::OutboxUpdated(OutboxUpdated { account_id }));
            }
            Ok(serde_json::json!({ "ok": true }))
        }
        WriteIntent::RetryOutbox { outbox_id } => {
            let account_id = get_outbox_account(&db, outbox_id)?
                .ok_or_else(|| Error::NotFound("outbox".into()))?;
            set_outbox_status(&db, outbox_id, "pending", None)?;
            sink(SyncEvent::OutboxUpdated(OutboxUpdated { account_id }));
            Ok(serde_json::json!({ "ok": true }))
        }
        WriteIntent::ProcessDueLocal => process_due_local(db, data_dir, sink).await,
    }
}

async fn test_account(cfg: AccountConfig) -> Result<serde_json::Value> {
    test_imap(
        &cfg.imap_host,
        cfg.imap_port,
        cfg.imap_security,
        &cfg.email,
        &cfg.secret,
    )
    .await?;
    test_smtp(
        &cfg.smtp_host,
        cfg.smtp_port,
        cfg.smtp_security,
        &cfg.email,
        &cfg.secret,
    )
    .await?;
    Ok(serde_json::json!({ "ok": true, "imap": true, "smtp": true }))
}

async fn add_account(
    db: Arc<Db>,
    sink: EventSink,
    a: AddAccount,
) -> Result<serde_json::Value> {
    let cfg = &a.config;
    let email = cfg.email.trim().to_string();
    if email.is_empty() {
        return Err(Error::msg("email is required"));
    }
    let mut cfg = cfg.clone();
    cfg.email = email.clone();
    let typed_secret = cfg.secret.clone();
    let existing = find_account_by_email(&db, &email)?;
    if typed_secret.is_empty() {
        let existing = existing
            .clone()
            .ok_or_else(|| Error::msg("password is required"))?;
        let user = db::account_keyring_user(&db, existing.id)?
            .ok_or_else(|| Error::msg("missing keyring user"))?;
        cfg.secret = load_secret(&user)?;
    }
    test_account(cfg.clone()).await?;

    let keyring_user = keyring_user_for_email(&email);
    if !typed_secret.is_empty() {
        store_secret(&keyring_user, &cfg.secret)?;
    }

    let (id, updated) = if let Some(existing) = existing {
        if let Some(old_user) = db::account_keyring_user(&db, existing.id)? {
            if old_user != keyring_user {
                let _ = delete_secret(&old_user);
            }
        }
        update_account(
            &db,
            existing.id,
            cfg.display_name.as_deref(),
            &cfg.imap_host,
            cfg.imap_port,
            cfg.imap_security,
            &cfg.smtp_host,
            cfg.smtp_port,
            cfg.smtp_security,
            &keyring_user,
        )?;
        info!(account_id = existing.id.0, email = %email, "account updated");
        (existing.id, true)
    } else {
        let id = insert_account(
            &db,
            &email,
            cfg.display_name.as_deref(),
            &cfg.imap_host,
            cfg.imap_port,
            cfg.imap_security,
            &cfg.smtp_host,
            cfg.smtp_port,
            cfg.smtp_security,
            &keyring_user,
        )?;
        info!(account_id = id.0, email = %email, "account added");
        (id, false)
    };

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: id,
        folder_id: None,
    }));
    Ok(serde_json::json!({ "account_id": id.0, "updated": updated }))
}

async fn remove_account(db: Arc<Db>, account_id: AccountId) -> Result<serde_json::Value> {
    if let Some(user) = db::account_keyring_user(&db, account_id)? {
        let _ = delete_secret(&user);
    }
    delete_account(&db, account_id)?;
    Ok(serde_json::json!({ "ok": true }))
}

async fn with_imap_session<F, Fut, T>(db: &Db, account_id: AccountId, f: F) -> Result<T>
where
    F: FnOnce(three_mail_mail::ImapSession) -> Fut,
    Fut: std::future::Future<Output = Result<(three_mail_mail::ImapSession, T)>>,
{
    let account = get_account(db, account_id)?
        .ok_or_else(|| Error::NotFound(format!("account {}", account_id.0)))?;
    let keyring_user = db::account_keyring_user(db, account_id)?
        .ok_or_else(|| Error::msg("missing keyring user"))?;
    let secret = load_secret(&keyring_user)?;
    let session = connect(
        &account.imap_host,
        account.imap_port,
        account.imap_security,
        &account.email,
        &secret,
    )
    .await?;
    let (mut session, value) = f(session).await?;
    let _ = session.logout().await;
    Ok(value)
}

fn header_classify(
    from_addr: Option<&str>,
    subject: Option<&str>,
    list_unsubscribe: Option<&str>,
    list_id: Option<&str>,
    precedence: Option<&str>,
    auto_submitted: Option<&str>,
    x_mailer: Option<&str>,
) -> MessageCategory {
    classify_message(&ClassifyInput {
        from_addr,
        subject,
        list_unsubscribe,
        precedence,
        auto_submitted,
        list_id,
        x_mailer,
    })
}

fn resolve_category(
    db: &Db,
    account_id: AccountId,
    from_addr: Option<&str>,
    subject: Option<&str>,
    list_unsubscribe: Option<&str>,
    list_id: Option<&str>,
    precedence: Option<&str>,
    auto_submitted: Option<&str>,
    x_mailer: Option<&str>,
) -> Result<MessageCategory> {
    if let Some(from) = from_addr {
        if let Some(over) = get_sender_category_override(db, account_id, from)? {
            return Ok(MessageCategory::parse(&over));
        }
        if let Some(learned) = get_sender_learned_category(db, account_id, from)? {
            return Ok(learned);
        }
    }
    Ok(header_classify(
        from_addr,
        subject,
        list_unsubscribe,
        list_id,
        precedence,
        auto_submitted,
        x_mailer,
    ))
}

fn record_sender_header_stat(
    db: &Db,
    account_id: AccountId,
    from_addr: Option<&str>,
    subject: Option<&str>,
    list_unsubscribe: Option<&str>,
    list_id: Option<&str>,
    precedence: Option<&str>,
    auto_submitted: Option<&str>,
    x_mailer: Option<&str>,
) -> Result<()> {
    let Some(from) = from_addr else {
        return Ok(());
    };
    let parsed = header_classify(
        from_addr,
        subject,
        list_unsubscribe,
        list_id,
        precedence,
        auto_submitted,
        x_mailer,
    );
    bump_sender_category_stat(db, account_id, from, parsed)?;
    Ok(())
}

fn index_envelope_fts(
    db: &Db,
    message_id: MessageId,
    from: Option<&str>,
    to: Option<&str>,
    subject: Option<&str>,
) -> Result<()> {
    reindex_message_fts(db, message_id, from, to, subject, None, None)?;
    Ok(())
}

async fn mark_read(db: Arc<Db>, sink: EventSink, m: MarkRead) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, m.message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;
    set_message_seen(&db, m.message_id, m.seen)?;
    refresh_folder_counts(&db, coords.folder_id)?;

    let account_id = coords.account_id;
    let folder_id = coords.folder_id;
    let folder_path = coords.folder_path.clone();
    let uid = coords.uid as u32;
    let seen = m.seen;

    let result = with_imap_session(&db, account_id, |mut session| async move {
        uid_set_seen(&mut session, &folder_path, uid, seen).await?;
        Ok((session, ()))
    })
    .await;

    let mut imap_synced = true;
    if let Err(e) = result {
        warn!(error = %e, "IMAP STORE \\Seen failed; local flag kept");
        let payload =
            serde_json::json!({ "seen": seen }).to_string();
        let _ = upsert_flag_retry(&db, m.message_id, "imap_seen", &payload);
        sink(SyncEvent::SyncError(SyncErrorEvent {
            account_id: Some(account_id),
            message: format!("Read flag will retry when back online ({e})"),
        }));
        imap_synced = false;
    } else {
        let _ = clear_flag_retry(&db, m.message_id, "imap_seen");
    }

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "imap_synced": imap_synced }))
}

async fn set_starred(
    db: Arc<Db>,
    sink: EventSink,
    message_id: MessageId,
    starred: bool,
) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;
    set_message_starred(&db, message_id, starred)?;

    let account_id = coords.account_id;
    let folder_id = coords.folder_id;
    let folder_path = coords.folder_path.clone();
    let uid = coords.uid as u32;

    let result = with_imap_session(&db, account_id, |mut session| async move {
        uid_set_flagged(&mut session, &folder_path, uid, starred).await?;
        Ok((session, ()))
    })
    .await;
    let mut imap_synced = true;
    if let Err(e) = result {
        warn!(error = %e, "IMAP STORE \\Flagged failed; local flag kept");
        let payload = serde_json::json!({ "flagged": starred }).to_string();
        let _ = upsert_flag_retry(&db, message_id, "imap_flagged", &payload);
        sink(SyncEvent::SyncError(SyncErrorEvent {
            account_id: Some(account_id),
            message: format!("Pin/flag sync will retry ({e})"),
        }));
        imap_synced = false;
    } else {
        let _ = clear_flag_retry(&db, message_id, "imap_flagged");
    }

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "imap_synced": imap_synced }))
}

fn store_attachment_bytes(
    db: &Db,
    data_dir: &Path,
    account_id: AccountId,
    message_id: MessageId,
    attachment_id: AttachmentId,
    filename: &str,
    bytes: &[u8],
) -> Result<()> {
    let dir = data_dir
        .join("attachments")
        .join(account_id.0.to_string())
        .join(message_id.0.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| Error::msg(e.to_string()))?;
    let safe_name = filename.replace(['/', '\\', ':'], "_");
    let path = dir.join(&safe_name);
    std::fs::write(&path, bytes).map_err(|e| Error::msg(e.to_string()))?;
    set_attachment_path(db, attachment_id, &path.to_string_lossy())?;
    Ok(())
}

async fn fetch_body(
    db: Arc<Db>,
    data_dir: &Path,
    sink: EventSink,
    message_id: MessageId,
) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;

    let account_id = coords.account_id;
    let folder_id = coords.folder_id;
    let folder_path = coords.folder_path.clone();
    let uid = coords.uid as u32;

    let raw = with_imap_session(&db, account_id, |mut session| async move {
        let bytes = fetch_raw_message(&mut session, &folder_path, uid).await?;
        Ok((session, bytes))
    })
    .await?;

    let parsed = parse_rfc822(&raw);
    upsert_body(
        &db,
        message_id,
        parsed.text_body.as_deref(),
        parsed.html_body.as_deref(),
    )?;
    if let Some(snippet) = snippet_text(parsed.text_body.as_deref(), parsed.html_body.as_deref()) {
        set_message_snippet(&db, message_id, &snippet)?;
    }

    let meta: Vec<(
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
    )> = parsed
        .attachments
        .iter()
        .map(|a| {
            (
                a.filename.clone(),
                a.mime_type.clone(),
                a.size_bytes,
                Some(a.part_id.clone()),
                a.content_id.clone(),
            )
        })
        .collect();
    replace_attachments(&db, message_id, &meta)?;

    for part in &parsed.attachments {
        let persist = part.content_id.is_some()
            || part
                .mime_type
                .as_ref()
                .is_some_and(|m| m.starts_with("image/"));
        if !persist || part.bytes.is_empty() {
            continue;
        }
        let Some(att_id) = attachment_id_by_part(&db, message_id, &part.part_id)? else {
            continue;
        };
        let name = part
            .filename
            .clone()
            .or_else(|| part.content_id.clone())
            .unwrap_or_else(|| format!("part-{}", part.part_id));
        if let Err(e) =
            store_attachment_bytes(&db, data_dir, account_id, message_id, att_id, &name, &part.bytes)
        {
            warn!(error = %e, message_id = message_id.0, "inline attachment persist failed");
        }
    }

    let decoded_subject = parsed
        .headers
        .subject
        .as_deref()
        .map(decode_mime_header)
        .filter(|s| !s.is_empty());
    let decoded_from = parsed
        .headers
        .from
        .as_deref()
        .map(decode_mime_header)
        .filter(|s| !s.is_empty());
    set_message_headers_from_parse(
        &db,
        message_id,
        parsed.headers.message_id.as_deref(),
        parsed.headers.in_reply_to.as_deref(),
        parsed.headers.references.as_deref(),
        decoded_subject.as_deref(),
        decoded_from.as_deref(),
    )?;
    set_message_list_unsubscribe(&db, message_id, parsed.headers.list_unsubscribe.as_deref())?;

    let tk = thread_key(
        parsed.headers.message_id.as_deref(),
        parsed.headers.in_reply_to.as_deref(),
        parsed.headers.references.as_deref(),
    );
    set_message_thread_key(&db, message_id, tk.as_deref())?;

    if !is_category_manual(&db, message_id)? {
        let fields = message_envelope_fields(&db, message_id)?;
        let from = fields
            .as_ref()
            .and_then(|f| f.1.as_deref())
            .or(parsed.headers.from.as_deref());
        let subject = fields
            .as_ref()
            .and_then(|f| f.3.as_deref())
            .or(parsed.headers.subject.as_deref());
        let cat = resolve_category(
            &db,
            account_id,
            from,
            subject,
            parsed.headers.list_unsubscribe.as_deref(),
            parsed.headers.list_id.as_deref(),
            parsed.headers.precedence.as_deref(),
            parsed.headers.auto_submitted.as_deref(),
            parsed.headers.x_mailer.as_deref(),
        )?;
        set_message_category(&db, message_id, cat, false)?;
    }

    let fields = message_envelope_fields(&db, message_id)?;
    let (from, to, subject) = fields
        .map(|f| (f.1, f.2, f.3))
        .unwrap_or((None, None, None));
    let body_for_fts = parsed
        .text_body
        .clone()
        .or_else(|| parsed.html_body.clone());
    reindex_message_fts(
        &db,
        message_id,
        from.as_deref(),
        to.as_deref(),
        subject.as_deref(),
        body_for_fts.as_deref(),
        None,
    )?;

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(serde_json::json!({
        "ok": true,
        "has_text": parsed.text_body.is_some(),
        "has_html": parsed.html_body.is_some(),
        "attachments": parsed.attachments.len(),
    }))
}

async fn move_message(
    db: Arc<Db>,
    sink: EventSink,
    m: MoveMessage,
) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, m.message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;

    let account_id = coords.account_id;
    let folder_id = coords.folder_id;
    let folder_path = coords.folder_path.clone();
    let uid = coords.uid as u32;

    if let Some(target_id) = m.target_folder_id {
        let target = get_folder(&db, target_id)?
            .ok_or_else(|| Error::NotFound(format!("folder {}", target_id.0)))?;
        if target.id == folder_id {
            return Ok(serde_json::json!({ "ok": true, "target": target.imap_path }));
        }
        if target.account_id != account_id {
            return move_across_accounts(db, sink, m.message_id, coords, target).await;
        }
    }

    let target_path = if let Some(id) = m.target_folder_id {
        get_folder(&db, id)?
            .ok_or_else(|| Error::NotFound(format!("folder {}", id.0)))?
            .imap_path
    } else if let Some(path) = m.target_imap_path {
        path
    } else {
        let role = m
            .target_role
            .as_deref()
            .ok_or_else(|| Error::msg("target_role or target_imap_path required"))?;
        find_folder_by_role(&db, account_id, role)?
            .ok_or_else(|| Error::NotFound(format!("folder role {role}")))?
            .imap_path
    };

    let target = target_path.clone();
    with_imap_session(&db, account_id, |mut session| async move {
        uid_move_to(&mut session, &folder_path, uid, &target).await?;
        Ok((session, ()))
    })
    .await?;

    delete_message_row(&db, m.message_id)?;
    refresh_folder_counts(&db, folder_id)?;

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "target": target_path }))
}

/// One UID MOVE per source mailbox (UID set), or APPEND per message when the target is another account.
async fn move_messages(
    db: Arc<Db>,
    sink: EventSink,
    m: MoveMessages,
) -> Result<serde_json::Value> {
    let target = get_folder(&db, m.target_folder_id)?
        .ok_or_else(|| Error::NotFound(format!("folder {}", m.target_folder_id.0)))?;

    let mut same: std::collections::BTreeMap<(i64, String), Vec<(MessageId, u32, FolderId)>> =
        std::collections::BTreeMap::new();
    let mut other = Vec::new();
    for id in m.message_ids {
        let Some(coords) = message_imap_coords(&db, id)? else {
            continue;
        };
        if coords.folder_id == target.id {
            continue;
        }
        if coords.account_id == target.account_id {
            same.entry((coords.account_id.0, coords.folder_path.clone()))
                .or_default()
                .push((id, coords.uid as u32, coords.folder_id));
        } else {
            other.push((id, coords));
        }
    }

    for ((account, path), items) in &same {
        let account = AccountId(*account);
        let set = items
            .iter()
            .map(|(_, uid, _)| uid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let target_path = target.imap_path.clone();
        let path = path.clone();
        with_imap_session(&db, account, |mut session| async move {
            uids_move_to(&mut session, &path, &set, &target_path).await?;
            Ok((session, ()))
        })
        .await?;
        let folder_id = items[0].2;
        for (id, _, _) in items {
            delete_message_row(&db, *id)?;
        }
        refresh_folder_counts(&db, folder_id)?;
        sink(SyncEvent::MailUpdated(MailUpdated {
            account_id: account,
            folder_id: Some(folder_id),
        }));
    }
    if !same.is_empty() {
        sink(SyncEvent::MailUpdated(MailUpdated {
            account_id: target.account_id,
            folder_id: Some(target.id),
        }));
    }
    for (id, coords) in other {
        move_across_accounts(db.clone(), sink.clone(), id, coords, target.clone()).await?;
    }
    Ok(serde_json::json!({ "ok": true, "target": target.imap_path }))
}

async fn mark_messages(db: Arc<Db>, sink: EventSink, m: MarkMessages) -> Result<serde_json::Value> {
    let mut groups: std::collections::BTreeMap<(i64, String), Vec<u32>> =
        std::collections::BTreeMap::new();
    let mut folders = Vec::new();
    for id in &m.message_ids {
        let Some(coords) = message_imap_coords(&db, *id)? else {
            continue;
        };
        set_message_seen(&db, *id, m.seen)?;
        groups
            .entry((coords.account_id.0, coords.folder_path.clone()))
            .or_default()
            .push(coords.uid as u32);
        if !folders.contains(&(coords.account_id, coords.folder_id)) {
            folders.push((coords.account_id, coords.folder_id));
        }
    }
    for ((account, path), uids) in groups {
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let seen = m.seen;
        let result = with_imap_session(&db, AccountId(account), |mut session| async move {
            uids_set_seen(&mut session, &path, &set, seen).await?;
            Ok((session, ()))
        })
        .await;
        if let Err(e) = result {
            warn!(error = %e, "IMAP STORE \\Seen failed; local flags kept");
            let payload = serde_json::json!({ "seen": seen }).to_string();
            for id in &m.message_ids {
                let _ = upsert_flag_retry(&db, *id, "imap_seen", &payload);
            }
            sink(SyncEvent::SyncError(SyncErrorEvent {
                account_id: Some(AccountId(account)),
                message: format!("Read flags will retry ({e})"),
            }));
        } else {
            for id in &m.message_ids {
                let _ = clear_flag_retry(&db, *id, "imap_seen");
            }
        }
    }
    for (account_id, folder_id) in folders {
        refresh_folder_counts(&db, folder_id)?;
        sink(SyncEvent::MailUpdated(MailUpdated {
            account_id,
            folder_id: Some(folder_id),
        }));
    }
    Ok(serde_json::json!({ "ok": true }))
}

/// IMAP has no cross-server MOVE: copy the raw message into the other account, then delete the source.
async fn move_across_accounts(
    db: Arc<Db>,
    sink: EventSink,
    message_id: MessageId,
    coords: db::MessageImapCoords,
    target: three_mail_core::FolderSummary,
) -> Result<serde_json::Value> {
    let (seen, flagged) = db::get_message(&db, message_id)?
        .map(|d| (!d.list.unseen, d.list.starred))
        .unwrap_or((true, false));
    let uid = coords.uid as u32;

    let source_path = coords.folder_path.clone();
    let raw = with_imap_session(&db, coords.account_id, |mut session| async move {
        let raw = fetch_raw_message(&mut session, &source_path, uid).await?;
        Ok((session, raw))
    })
    .await?;

    let target_path = target.imap_path.clone();
    with_imap_session(&db, target.account_id, |mut session| async move {
        append_message(&mut session, &target_path, &raw, seen, flagged).await?;
        Ok((session, ()))
    })
    .await?;

    let source_path = coords.folder_path.clone();
    with_imap_session(&db, coords.account_id, |mut session| async move {
        uid_delete(&mut session, &source_path, uid).await?;
        Ok((session, ()))
    })
    .await?;

    delete_message_row(&db, message_id)?;
    refresh_folder_counts(&db, coords.folder_id)?;
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: coords.account_id,
        folder_id: Some(coords.folder_id),
    }));
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: target.account_id,
        folder_id: Some(target.id),
    }));
    Ok(serde_json::json!({ "ok": true, "target": target.imap_path }))
}

async fn create_folder(
    db: Arc<Db>,
    sink: EventSink,
    c: CreateFolder,
) -> Result<serde_json::Value> {
    let name = c.name.trim().to_string();
    if name.is_empty() {
        return Err(Error::msg("folder name is empty"));
    }
    let existing = db::list_folders(&db, c.account_id)?;
    let parent = c.parent_imap_path.clone();

    let imap_path = with_imap_session(&db, c.account_id, |mut session| async move {
        let delim = mailbox_delimiter(&mut session)
            .await?
            .unwrap_or_else(|| "/".into());
        if name.contains(delim.as_str()) {
            return Err(Error::msg(format!("folder name cannot contain “{delim}”")));
        }
        let leaf = encode_imap_utf7(&name);
        let prefix = match parent {
            Some(p) => Some(p),
            // Servers that keep personal folders under INBOX (e.g. `INBOX.Work`).
            None => {
                let inbox_prefix = format!("INBOX{delim}");
                let custom: Vec<_> = existing
                    .iter()
                    .filter(|f| !f.imap_path.eq_ignore_ascii_case("INBOX"))
                    .collect();
                (!custom.is_empty() && custom.iter().all(|f| f.imap_path.starts_with(&inbox_prefix)))
                    .then(|| "INBOX".to_string())
            }
        };
        let path = match prefix {
            Some(p) => format!("{p}{delim}{leaf}"),
            None => leaf,
        };
        create_mailbox(&mut session, &path).await?;
        Ok((session, path))
    })
    .await?;

    let display = three_mail_mail::decode_imap_utf7(&imap_path);
    let folder_id = upsert_folder(&db, c.account_id, &display, &imap_path, None)?;
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: c.account_id,
        folder_id: None,
    }));
    Ok(serde_json::json!({ "ok": true, "folder_id": folder_id.0, "imap_path": imap_path }))
}

async fn download_attachment(
    db: Arc<Db>,
    data_dir: &Path,
    sink: EventSink,
    attachment_id: AttachmentId,
) -> Result<serde_json::Value> {
    let att = get_attachment(&db, attachment_id)?
        .ok_or_else(|| Error::NotFound("attachment".into()))?;
    if let Some(path) = &att.local_path {
        if Path::new(path).exists() {
            return Ok(serde_json::json!({ "ok": true, "path": path }));
        }
    }

    let coords = message_imap_coords(&db, att.message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;

    let account_id = coords.account_id;
    let folder_id = coords.folder_id;
    let folder_path = coords.folder_path.clone();
    let uid = coords.uid as u32;
    let message_id = att.message_id;

    let raw = with_imap_session(&db, account_id, |mut session| async move {
        let bytes = fetch_raw_message(&mut session, &folder_path, uid).await?;
        Ok((session, bytes))
    })
    .await?;

    let parsed = parse_rfc822(&raw);
    let part = parsed
        .attachments
        .into_iter()
        .find(|a| {
            att.part_id
                .as_ref()
                .map(|p| p == &a.part_id)
                .unwrap_or(false)
                || att
                    .filename
                    .as_ref()
                    .zip(a.filename.as_ref())
                    .is_some_and(|(l, r)| l == r)
        })
        .ok_or_else(|| Error::NotFound("attachment part".into()))?;

    let dir = data_dir
        .join("attachments")
        .join(account_id.0.to_string())
        .join(message_id.0.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| Error::msg(e.to_string()))?;
    let safe_name = part
        .filename
        .clone()
        .unwrap_or_else(|| format!("part-{}", part.part_id));
    let safe_name = safe_name.replace(['/', '\\', ':'], "_");
    let path = dir.join(&safe_name);
    std::fs::write(&path, &part.bytes).map_err(|e| Error::msg(e.to_string()))?;
    let path_str = path.to_string_lossy().into_owned();
    set_attachment_path(&db, attachment_id, &path_str)?;

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "path": path_str }))
}

async fn start_sync(
    db: Arc<Db>,
    sink: EventSink,
    s: StartSync,
) -> Result<serde_json::Value> {
    let account = get_account(&db, s.account_id)?
        .ok_or_else(|| Error::NotFound(format!("account {}", s.account_id.0)))?;
    let keyring_user = db::account_keyring_user(&db, s.account_id)?
        .ok_or_else(|| Error::msg("missing keyring user"))?;
    let secret = load_secret(&keyring_user)?;

    emit_progress(&sink, s.account_id, SyncPhase::Connecting, 0, None, None);

    let mut session = connect(
        &account.imap_host,
        account.imap_port,
        account.imap_security,
        &account.email,
        &secret,
    )
    .await?;

    if let Err(e) = push_local_pins(&db, s.account_id, &mut session).await {
        warn!(error = %e, "could not mirror local pins to \\Flagged");
    }

    emit_progress(
        &sink,
        s.account_id,
        SyncPhase::ListingFolders,
        0,
        None,
        None,
    );

    let mailboxes = list_mailbox_names(&mut session).await?;
    let mut inbox_id: Option<FolderId> = None;
    for mb in &mailboxes {
        let fid = upsert_folder(&db, s.account_id, &mb.name, &mb.imap_path, mb.role)?;
        if mb.role == Some("inbox") {
            inbox_id = Some(fid);
        }
    }
    // Repair subjects that were stored before RFC 2047 decoding existed.
    let repaired = redecode_mime_subjects(&db, decode_mime_header)?;
    if repaired > 0 {
        info!(repaired, "re-decoded MIME subjects in local DB");
    }

    let folder_id = s.folder_id.or(inbox_id);
    let Some(folder_id) = folder_id else {
        warn!("no folder to sync");
        let _ = session.logout().await;
        emit_progress(&sink, s.account_id, SyncPhase::Done, 0, None, None);
        return Ok(serde_json::json!({ "folders": mailboxes.len() }));
    };

    let folder_path = {
        let folders = db::list_folders(&db, s.account_id)?;
        folders
            .into_iter()
            .find(|f| f.id == folder_id)
            .map(|f| f.imap_path)
            .ok_or_else(|| Error::NotFound("folder".into()))?
    };

    emit_progress(
        &sink,
        s.account_id,
        SyncPhase::Fetching,
        0,
        None,
        Some(folder_path.clone()),
    );

    let (uidvalidity, uidnext, select_modseq) = select_mailbox(&mut session, &folder_path).await?;

    let prev = db::get_sync_state(&db, folder_id)?;
    let mut full_rescan = true;
    let mut uid_set = "1:*".to_string();
    let mut prev_modseq: Option<u64> = None;

    if let Some((Some(prev_uv), Some(prev_un), prev_ms)) = prev {
        prev_modseq = prev_ms.and_then(|m| (m > 0).then(|| m as u64));
        if prev_uv as u32 == uidvalidity {
            full_rescan = false;
            if uidnext.map(|u| u > prev_un as u32).unwrap_or(true) {
                uid_set = format!("{}:*", prev_un);
            } else {
                let start = prev_un.saturating_sub(50).max(1);
                uid_set = format!("{start}:*");
            }
        } else {
            info!(
                folder_id = folder_id.0,
                old = prev_uv,
                new = uidvalidity,
                "UIDVALIDITY changed; rebuilding folder index"
            );
            clear_folder_messages(&db, folder_id)?;
            prev_modseq = None;
        }
    }

    let condstore = capability_condstore(&imap_capabilities(&mut session).await?);
    if condstore {
        if let Some(since) = prev_modseq {
            if let Ok(changed) =
                fetch_condstore_changes(&mut session, &folder_path, since).await
            {
                for env in &changed {
                    record_sender_header_stat(
                        &db,
                        s.account_id,
                        env.from.as_deref(),
                        env.subject.as_deref(),
                        env.list_unsubscribe.as_deref(),
                        env.list_id.as_deref(),
                        env.precedence.as_deref(),
                        env.auto_submitted.as_deref(),
                        env.x_mailer.as_deref(),
                    )?;
                    let cat = resolve_category(
                        &db,
                        s.account_id,
                        env.from.as_deref(),
                        env.subject.as_deref(),
                        env.list_unsubscribe.as_deref(),
                        env.list_id.as_deref(),
                        env.precedence.as_deref(),
                        env.auto_submitted.as_deref(),
                        env.x_mailer.as_deref(),
                    )?;
                    let tk = thread_key(
                        env.message_id.as_deref(),
                        env.in_reply_to.as_deref(),
                        env.references.as_deref(),
                    );
                    let mid = upsert_message_envelope(
                        &db,
                        &EnvelopeUpsert {
                            account_id: s.account_id,
                            folder_id,
                            uid: env.uid as i64,
                            message_id_header: env.message_id.clone(),
                            in_reply_to: env.in_reply_to.clone(),
                            references_header: env.references.clone(),
                            subject: env.subject.clone(),
                            from_addr: env.from.clone(),
                            to_addrs: env.to.clone(),
                            cc_addrs: env.cc.clone(),
                            date_utc: env.date.clone(),
                            unseen: env.unseen,
                            starred: env.starred,
                            snippet: env.snippet.clone(),
                            has_attachments: false,
                            category: Some(cat.as_str().to_string()),
                            list_unsubscribe: env.list_unsubscribe.clone(),
                            thread_key: tk,
                        },
                    )?;
                    index_envelope_fts(
                        &db,
                        mid,
                        env.from.as_deref(),
                        env.to.as_deref(),
                        env.subject.as_deref(),
                    )?;
                }
            }
        }
    }

    let (uidvalidity, uidnext, fetch_modseq, envelopes) =
        fetch_envelopes(&mut session, &folder_path, &uid_set).await?;
    let highest_modseq = fetch_modseq.or(select_modseq);

    let slice: &[three_mail_mail::EnvelopeFetch] = if full_rescan {
        let start = envelopes.len().saturating_sub(200);
        &envelopes[start..]
    } else {
        &envelopes[..]
    };

    for (i, env) in slice.iter().enumerate() {
        record_sender_header_stat(
            &db,
            s.account_id,
            env.from.as_deref(),
            env.subject.as_deref(),
            env.list_unsubscribe.as_deref(),
            env.list_id.as_deref(),
            env.precedence.as_deref(),
            env.auto_submitted.as_deref(),
            env.x_mailer.as_deref(),
        )?;
        let cat = resolve_category(
            &db,
            s.account_id,
            env.from.as_deref(),
            env.subject.as_deref(),
            env.list_unsubscribe.as_deref(),
            env.list_id.as_deref(),
            env.precedence.as_deref(),
            env.auto_submitted.as_deref(),
            env.x_mailer.as_deref(),
        )?;
        let tk = thread_key(
            env.message_id.as_deref(),
            env.in_reply_to.as_deref(),
            env.references.as_deref(),
        );
        let mid = upsert_message_envelope(
            &db,
            &EnvelopeUpsert {
                account_id: s.account_id,
                folder_id,
                uid: env.uid as i64,
                message_id_header: env.message_id.clone(),
                in_reply_to: env.in_reply_to.clone(),
                references_header: env.references.clone(),
                subject: env.subject.clone(),
                from_addr: env.from.clone(),
                to_addrs: env.to.clone(),
                cc_addrs: env.cc.clone(),
                date_utc: env.date.clone(),
                unseen: env.unseen,
                starred: env.starred,
                snippet: env.snippet.clone(),
                has_attachments: false,
                category: Some(cat.as_str().to_string()),
                list_unsubscribe: env.list_unsubscribe.clone(),
                thread_key: tk,
            },
        )?;
        index_envelope_fts(
            &db,
            mid,
            env.from.as_deref(),
            env.to.as_deref(),
            env.subject.as_deref(),
        )?;
        if i % 25 == 0 {
            emit_progress(
                &sink,
                s.account_id,
                SyncPhase::Fetching,
                i as u64,
                Some(slice.len() as u64),
                None,
            );
        }
    }

    db::set_sync_state(
        &db,
        folder_id,
        Some(uidvalidity as i64),
        uidnext.map(|u| u as i64),
        highest_modseq.map(|m| m as i64),
        None,
    )?;
    refresh_folder_counts(&db, folder_id)?;

    let _ = session.logout().await;

    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: s.account_id,
        folder_id: Some(folder_id),
    }));
    emit_progress(
        &sink,
        s.account_id,
        SyncPhase::Done,
        slice.len() as u64,
        Some(slice.len() as u64),
        None,
    );

    Ok(serde_json::json!({
        "folder_id": folder_id.0,
        "fetched": slice.len(),
        "uidvalidity": uidvalidity,
        "incremental": !full_rescan,
    }))
}

fn append_signature(body: &str, sig: &str) -> String {
    let sig = sig.trim_end();
    if sig.is_empty() {
        return body.to_string();
    }
    if body.trim_end().is_empty() {
        return sig.to_string();
    }
    format!("{}\n\n-- \n{}", body.trim_end(), sig)
}

fn from_mailbox(account: &AccountSummary) -> String {
    match account.display_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => format!("\"{}\" <{}>", name.replace('"', "'"), account.email),
        None => account.email.clone(),
    }
}

async fn send_message(
    db: Arc<Db>,
    data_dir: &Path,
    sink: EventSink,
    m: SendMessage,
) -> Result<serde_json::Value> {
    let mut body = m.text_body.clone();
    let html = m.html_body.clone().filter(|h| !h.trim().is_empty());
    if html.is_none() {
        if let Some(sig_id) = m.signature_id {
            if let Some(sig) = get_signature(&db, sig_id)? {
                body = append_signature(&body, &sig.body_text);
            }
        }
    }

    // Immediate send waits 10s in the outbox so it can be cancelled.
    // A time the user picked is stored as given.
    let chosen = m.send_at.as_deref().filter(|s| !s.is_empty());
    let undo = chosen.is_none();
    let send_at = chosen.map(str::to_string).unwrap_or_else(|| {
        (Utc::now() + chrono::Duration::seconds(10)).to_rfc3339()
    });
    let to = m.to.join(", ");
    let cc = if m.cc.is_empty() {
        None
    } else {
        Some(m.cc.join(", "))
    };
    let bcc = if m.bcc.is_empty() {
        None
    } else {
        Some(m.bcc.join(", "))
    };
    let id = enqueue_outbox(
        &db,
        m.account_id,
        &to,
        cc.as_deref(),
        bcc.as_deref(),
        &m.subject,
        &body,
        html.as_deref(),
        Some(&send_at),
        m.draft_id,
        m.in_reply_to.as_deref(),
        m.references_header.as_deref(),
        None,
    )?;
    if !m.attachments.is_empty() {
        let staged = stage_attachments(data_dir, id, &m.attachments)?;
        let json = serde_json::to_string(&staged).map_err(|e| Error::msg(e.to_string()))?;
        set_outbox_attachments_json(&db, id, &json)?;
    }
    // Keep the draft until SMTP succeeds (deleted in process_due_local).
    sink(SyncEvent::OutboxUpdated(OutboxUpdated {
        account_id: m.account_id,
    }));
    Ok(serde_json::json!({
        "ok": true,
        "scheduled": true,
        "outbox_id": id,
        "undo": undo,
    }))
}

async fn snooze_message(
    db: Arc<Db>,
    sink: EventSink,
    m: SnoozeMessage,
) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, m.message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;
    set_snooze(&db, m.message_id, m.until.as_deref())?;
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: coords.account_id,
        folder_id: Some(coords.folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "until": m.until }))
}

async fn pin_message(
    db: Arc<Db>,
    sink: EventSink,
    message_id: MessageId,
    pinned: bool,
) -> Result<serde_json::Value> {
    let coords = thread_imap_coords(&db, message_id)?;
    if coords.is_empty() {
        return Err(Error::NotFound("message".into()));
    }
    let account_id = coords[0].account_id;
    set_pinned(&db, message_id, pinned)?;
    let groups = flag_groups(&coords);
    let result = with_imap_session(&db, account_id, |mut session| async move {
        store_flagged(&mut session, &groups, pinned).await?;
        Ok((session, ()))
    })
    .await;
    let mut imap_synced = true;
    if let Err(e) = result {
        warn!(error = %e, "IMAP STORE \\Flagged failed; local pin kept");
        let payload = serde_json::json!({ "flagged": pinned }).to_string();
        let _ = upsert_flag_retry(&db, message_id, "imap_flagged", &payload);
        sink(SyncEvent::SyncError(SyncErrorEvent {
            account_id: Some(account_id),
            message: format!("Pin sync will retry ({e})"),
        }));
        imap_synced = false;
    } else {
        let _ = clear_flag_retry(&db, message_id, "imap_flagged");
    }
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(coords[0].folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "pinned": pinned, "imap_synced": imap_synced }))
}

async fn flush_flag_retries(db: Arc<Db>, _sink: &EventSink) {
    let Ok(pending) = list_flag_retries(&db) else {
        return;
    };
    for item in pending {
        let Ok(Some(coords)) = message_imap_coords(&db, item.message_id) else {
            continue;
        };
        let account_id = coords.account_id;
        let folder_path = coords.folder_path.clone();
        let uid = coords.uid as u32;
        let result = match item.kind.as_str() {
            "imap_seen" => {
                let seen = serde_json::from_str::<serde_json::Value>(&item.payload_json)
                    .ok()
                    .and_then(|v| v.get("seen").and_then(|b| b.as_bool()))
                    .unwrap_or(true);
                with_imap_session(&db, account_id, |mut session| async move {
                    uid_set_seen(&mut session, &folder_path, uid, seen).await?;
                    Ok((session, ()))
                })
                .await
            }
            "imap_flagged" => {
                let flagged = serde_json::from_str::<serde_json::Value>(&item.payload_json)
                    .ok()
                    .and_then(|v| v.get("flagged").and_then(|b| b.as_bool()))
                    .unwrap_or(true);
                with_imap_session(&db, account_id, |mut session| async move {
                    uid_set_flagged(&mut session, &folder_path, uid, flagged).await?;
                    Ok((session, ()))
                })
                .await
            }
            _ => continue,
        };
        if result.is_ok() {
            let _ = clear_flag_retry(&db, item.message_id, &item.kind);
        }
    }
}

fn flag_groups(coords: &[db::MessageImapCoords]) -> Vec<(String, String)> {
    let mut map: std::collections::BTreeMap<String, Vec<u32>> = std::collections::BTreeMap::new();
    for c in coords {
        map.entry(c.folder_path.clone()).or_default().push(c.uid as u32);
    }
    map.into_iter()
        .map(|(path, uids)| {
            let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            (path, set)
        })
        .collect()
}

async fn store_flagged(
    session: &mut three_mail_mail::ImapSession,
    groups: &[(String, String)],
    flagged: bool,
) -> Result<()> {
    for (path, set) in groups {
        uids_set_flagged(session, path, set, flagged).await?;
    }
    Ok(())
}

/// Pins that were stored only locally get `\Flagged`, which is what Spark shows as Pin.
async fn push_local_pins(
    db: &Db,
    account_id: AccountId,
    session: &mut three_mail_mail::ImapSession,
) -> Result<()> {
    let coords = local_only_pins(db, account_id)?;
    if coords.is_empty() {
        return Ok(());
    }
    let groups = flag_groups(&coords);
    store_flagged(session, &groups, true).await?;
    mark_local_pins_flagged(db, account_id)?;
    Ok(())
}

async fn set_category(
    db: Arc<Db>,
    sink: EventSink,
    message_id: MessageId,
    category: MessageCategory,
) -> Result<serde_json::Value> {
    let coords = message_imap_coords(&db, message_id)?
        .ok_or_else(|| Error::NotFound("message".into()))?;
    set_message_category(&db, message_id, category, true)?;
    if let Some(fields) = message_envelope_fields(&db, message_id)? {
        if let Some(from) = fields.1.as_deref() {
            upsert_sender_category(&db, coords.account_id, from, category)?;
        }
    }
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: coords.account_id,
        folder_id: Some(coords.folder_id),
    }));
    Ok(serde_json::json!({ "ok": true, "category": category.as_str() }))
}

async fn save_draft_intent(
    db: Arc<Db>,
    sink: EventSink,
    d: SaveDraft,
) -> Result<serde_json::Value> {
    let id = save_draft(
        &db,
        d.draft_id,
        d.account_id,
        &d.to_addrs,
        &d.cc_addrs,
        &d.bcc_addrs,
        &d.subject,
        &d.text_body,
        d.html_body.as_deref(),
        d.in_reply_to.as_deref(),
        d.references_header.as_deref(),
        d.source_message_id,
    )?;
    if let Err(e) = sync_draft_to_imap(db.clone(), sink.clone(), id).await {
        warn!(error = %e, draft_id = id, "IMAP Drafts upload failed; local draft kept");
    }
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: d.account_id,
        folder_id: None,
    }));
    Ok(serde_json::json!({ "ok": true, "draft_id": id }))
}

async fn remove_server_draft_message(
    db: Arc<Db>,
    sink: &EventSink,
    message_id: MessageId,
) -> Result<()> {
    let Some(coords) = message_imap_coords(&db, message_id)? else {
        delete_message_row(&db, message_id)?;
        return Ok(());
    };
    let path = coords.folder_path.clone();
    let uid = coords.uid as u32;
    let folder_id = coords.folder_id;
    let account_id = coords.account_id;
    with_imap_session(&db, account_id, |mut session| async move {
        uid_delete(&mut session, &path, uid).await?;
        Ok((session, ()))
    })
    .await?;
    delete_message_row(&db, message_id)?;
    refresh_folder_counts(&db, folder_id)?;
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id,
        folder_id: Some(folder_id),
    }));
    Ok(())
}

async fn sync_draft_to_imap(
    db: Arc<Db>,
    sink: EventSink,
    draft_id: i64,
) -> Result<()> {
    let Some(draft) = get_draft(&db, draft_id)? else {
        return Err(Error::NotFound("draft".into()));
    };
    let Some(account) = get_account(&db, draft.account_id)? else {
        return Err(Error::NotFound("account".into()));
    };
    let Some(drafts_folder) = find_folder_by_role(&db, draft.account_id, "drafts")? else {
        warn!(account_id = draft.account_id.0, "no Drafts folder; skip server upload");
        return Ok(());
    };
    let header = ensure_draft_message_id(&db, draft_id)?;

    let mut to_remove = Vec::new();
    if let Some(id) = draft.server_message_id {
        to_remove.push(id);
    }
    if let Some(id) = draft.source_message_id {
        if !to_remove.contains(&id) {
            to_remove.push(id);
        }
    }
    for mid in to_remove {
        if let Err(e) = remove_server_draft_message(db.clone(), &sink, mid).await {
            warn!(error = %e, message_id = mid.0, "old server draft removal failed");
        }
    }

    let to = split_addr_list(&draft.to_addrs);
    let cc = split_addr_list(&draft.cc_addrs);
    let bcc = split_addr_list(&draft.bcc_addrs);
    let raw = build_rfc822_bytes(
        &from_mailbox(&account),
        &to,
        &cc,
        &bcc,
        &draft.subject,
        &draft.text_body,
        draft.html_body.as_deref(),
        draft.in_reply_to.as_deref(),
        draft.references_header.as_deref(),
        Some(&header),
        &[],
    )
    .map_err(|e| Error::Mail(e.to_string()))?;

    let path = drafts_folder.imap_path.clone();
    let folder_id = drafts_folder.id;
    with_imap_session(&db, draft.account_id, |mut session| async move {
        append_draft(&mut session, &path, &raw).await?;
        Ok((session, ()))
    })
    .await?;

    start_sync(
        db.clone(),
        sink.clone(),
        StartSync {
            account_id: draft.account_id,
            folder_id: Some(folder_id),
        },
    )
    .await?;

    if let Some(message_id) = find_message_by_header(&db, draft.account_id, folder_id, &header)? {
        set_draft_server_link(&db, draft_id, message_id)?;
        sink(SyncEvent::MailUpdated(MailUpdated {
            account_id: draft.account_id,
            folder_id: Some(folder_id),
        }));
    }
    Ok(())
}

async fn delete_draft_intent(
    db: Arc<Db>,
    sink: EventSink,
    draft_id: i64,
) -> Result<serde_json::Value> {
    if let Some(draft) = get_draft(&db, draft_id)? {
        for mid in [draft.server_message_id, draft.source_message_id]
            .into_iter()
            .flatten()
            .collect::<std::collections::HashSet<_>>()
        {
            if let Err(e) = remove_server_draft_message(db.clone(), &sink, mid).await {
                warn!(error = %e, message_id = mid.0, "server draft delete failed");
            }
        }
    }
    delete_draft(&db, draft_id)?;
    Ok(serde_json::json!({ "ok": true }))
}

async fn upsert_signature_intent(
    db: Arc<Db>,
    sink: EventSink,
    s: UpsertSignature,
) -> Result<serde_json::Value> {
    let id = upsert_signature(
        &db,
        s.signature_id,
        s.account_id,
        &s.name,
        &s.body_text,
        s.body_html.as_deref(),
        s.is_default,
    )?;
    sink(SyncEvent::MailUpdated(MailUpdated {
        account_id: s.account_id,
        folder_id: None,
    }));
    Ok(serde_json::json!({ "ok": true, "signature_id": id }))
}

/// Stores the same RFC 822 bytes that SMTP sent into the account's Sent mailbox.
async fn store_sent_copy(
    db: &Db,
    account_id: AccountId,
    raw: &[u8],
) -> Result<Option<FolderId>> {
    let Some(folder) = find_folder_by_role(db, account_id, "sent")? else {
        warn!(account_id = account_id.0, "no Sent folder; sent copy was not stored");
        return Ok(None);
    };
    let path = folder.imap_path.clone();
    let folder_id = folder.id;
    let bytes = raw.to_vec();
    with_imap_session(db, account_id, |mut session| async move {
        append_message(&mut session, &path, &bytes, true, false).await?;
        Ok((session, ()))
    })
    .await?;
    Ok(Some(folder_id))
}

async fn process_due_local(
    db: Arc<Db>,
    data_dir: &Path,
    sink: EventSink,
) -> Result<serde_json::Value> {
    flush_flag_retries(db.clone(), &sink).await;
    let now = Utc::now().to_rfc3339();
    let unsnoozed = unsnooze_due(&db, &now)?;
    for (account_id, folder_id) in &unsnoozed {
        sink(SyncEvent::MailUpdated(MailUpdated {
            account_id: *account_id,
            folder_id: Some(*folder_id),
        }));
    }

    let due = list_due_outbox(&db, &now)?;
    let mut sent = 0u32;
    for item in due {
        set_outbox_status(&db, item.id, "sending", None)?;
        let account = match get_account(&db, item.account_id)? {
            Some(a) => a,
            None => {
                set_outbox_status(&db, item.id, "failed", Some("account missing"))?;
                continue;
            }
        };
        let keyring_user = match db::account_keyring_user(&db, item.account_id)? {
            Some(u) => u,
            None => {
                set_outbox_status(&db, item.id, "failed", Some("missing keyring"))?;
                continue;
            }
        };
        let secret = match load_secret(&keyring_user) {
            Ok(s) => s,
            Err(e) => {
                set_outbox_status(&db, item.id, "failed", Some(&e.to_string()))?;
                continue;
            }
        };
        let to = split_addr_list(&item.to_addrs);
        let cc = split_addr_list(item.cc_addrs.as_deref().unwrap_or(""));
        let bcc = split_addr_list(item.bcc_addrs.as_deref().unwrap_or(""));
        let mail_attachments: Vec<MailAttachment> = item
            .attachments
            .iter()
            .map(|a| MailAttachment {
                path: a.path.clone(),
                filename: a.filename.clone(),
                mime_type: a.mime_type.clone(),
            })
            .collect();
        match send_mail_with_headers(
            &account.smtp_host,
            account.smtp_port,
            account.smtp_security,
            &account.email,
            &secret,
            &from_mailbox(&account),
            &to,
            &cc,
            &bcc,
            &item.subject,
            &item.text_body,
            item.html_body.as_deref(),
            item.in_reply_to.as_deref(),
            item.references_header.as_deref(),
            &mail_attachments,
        )
        .await
        {
            Ok(raw) => {
                set_outbox_status(&db, item.id, "sent", None)?;
                remove_staging(data_dir, item.id);
                if let Some(draft_id) = item.draft_id {
                    let src = draft_source_message(&db, draft_id).ok().flatten();
                    if let Some(src) = src {
                        if let Err(e) = move_message(
                            db.clone(),
                            sink.clone(),
                            MoveMessage {
                                message_id: src,
                                target_role: Some("trash".into()),
                                target_imap_path: None,
                                target_folder_id: None,
                            },
                        )
                        .await
                        {
                            warn!(error = %e, "could not remove the server draft after send");
                        }
                    }
                    let _ = delete_draft(&db, draft_id);
                }
                sent += 1;
                sink(SyncEvent::OutboxUpdated(OutboxUpdated {
                    account_id: item.account_id,
                }));
                sink(SyncEvent::MailUpdated(MailUpdated {
                    account_id: item.account_id,
                    folder_id: None,
                }));
                match store_sent_copy(&db, item.account_id, &raw).await {
                    Ok(Some(folder_id)) => {
                        if let Err(e) = start_sync(
                            db.clone(),
                            sink.clone(),
                            StartSync {
                                account_id: item.account_id,
                                folder_id: Some(folder_id),
                            },
                        )
                        .await
                        {
                            warn!(error = %e, "sent folder sync failed");
                        }
                    }
                    Ok(None) => {}
                    Err(e) => warn!(error = %e, "append to Sent failed"),
                }
            }
            Err(e) => {
                warn!(error = %e, outbox_id = item.id, "scheduled send failed");
                set_outbox_status(&db, item.id, "failed", Some(&e.to_string()))?;
                sink(SyncEvent::OutboxUpdated(OutboxUpdated {
                    account_id: item.account_id,
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "ok": true,
        "unsnoozed": unsnoozed.len(),
        "sent": sent,
    }))
}

fn emit_progress(
    sink: &EventSink,
    account_id: AccountId,
    phase: SyncPhase,
    n: u64,
    total: Option<u64>,
    detail: Option<String>,
) {
    sink(SyncEvent::SyncProgress(SyncProgress {
        account_id,
        phase,
        n,
        total,
        detail,
    }));
}

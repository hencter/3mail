use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};

use three_mail_core::{
    AccountId, AccountSummary, AttachmentId, AttachmentSummary, Draft, FolderId, FolderSummary,
    CorrespondenceItem, MessageCategory, MessageDetail, MessageId, MessageListItem, OutboxItem,
    Signature,
    ThreadSummary, TlsMode,
};

use crate::store::{Db, DbError};

pub fn insert_account(
    db: &Db,
    email: &str,
    display_name: Option<&str>,
    imap_host: &str,
    imap_port: u16,
    imap_security: TlsMode,
    smtp_host: &str,
    smtp_port: u16,
    smtp_security: TlsMode,
    keyring_user: &str,
) -> Result<AccountId, DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO accounts (
            email, display_name, imap_host, imap_port, imap_security,
            smtp_host, smtp_port, smtp_security, keyring_user
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            email,
            display_name,
            imap_host,
            imap_port as i64,
            imap_security.as_str(),
            smtp_host,
            smtp_port as i64,
            smtp_security.as_str(),
            keyring_user
        ],
    )?;
    Ok(AccountId(conn.last_insert_rowid()))
}

pub fn find_account_by_email(db: &Db, email: &str) -> Result<Option<AccountSummary>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        &format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE lower(email) = lower(?1)"),
        params![email.trim()],
        map_account,
    )
    .optional()
    .map_err(Into::into)
}

/// Update server settings + keyring pointer for an existing account (re-add / fix config).
pub fn update_account(
    db: &Db,
    account_id: AccountId,
    display_name: Option<&str>,
    imap_host: &str,
    imap_port: u16,
    imap_security: TlsMode,
    smtp_host: &str,
    smtp_port: u16,
    smtp_security: TlsMode,
    keyring_user: &str,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE accounts SET
            display_name = ?1,
            imap_host = ?2,
            imap_port = ?3,
            imap_security = ?4,
            smtp_host = ?5,
            smtp_port = ?6,
            smtp_security = ?7,
            keyring_user = ?8,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?9",
        params![
            display_name,
            imap_host,
            imap_port as i64,
            imap_security.as_str(),
            smtp_host,
            smtp_port as i64,
            smtp_security.as_str(),
            keyring_user,
            account_id.0
        ],
    )?;
    Ok(())
}

fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountSummary> {
    Ok(AccountSummary {
        id: AccountId(row.get(0)?),
        email: row.get(1)?,
        display_name: row.get(2)?,
        imap_host: row.get(3)?,
        imap_port: row.get::<_, i64>(4)? as u16,
        imap_security: TlsMode::parse(&row.get::<_, String>(5)?),
        smtp_host: row.get(6)?,
        smtp_port: row.get::<_, i64>(7)? as u16,
        smtp_security: TlsMode::parse(&row.get::<_, String>(8)?),
    })
}

const ACCOUNT_COLS: &str = "id, email, display_name, imap_host, imap_port, imap_security,
        smtp_host, smtp_port, smtp_security";

pub fn list_accounts(db: &Db) -> Result<Vec<AccountSummary>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {ACCOUNT_COLS} FROM accounts ORDER BY id"
    ))?;
    let rows = stmt.query_map([], map_account)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn get_account(db: &Db, account_id: AccountId) -> Result<Option<AccountSummary>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        &format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE id = ?1"),
        params![account_id.0],
        map_account,
    )
    .optional()
    .map_err(Into::into)
}

pub fn upsert_folder(
    db: &Db,
    account_id: AccountId,
    name: &str,
    imap_path: &str,
    role: Option<&str>,
) -> Result<FolderId, DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO folders (account_id, name, imap_path, role)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(account_id, imap_path) DO UPDATE SET
           name = excluded.name,
           role = COALESCE(excluded.role, folders.role)",
        params![account_id.0, name, imap_path, role],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM folders WHERE account_id = ?1 AND imap_path = ?2",
        params![account_id.0, imap_path],
        |row| row.get(0),
    )?;
    Ok(FolderId(id))
}

fn map_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<FolderSummary> {
    Ok(FolderSummary {
        id: FolderId(row.get(0)?),
        account_id: AccountId(row.get(1)?),
        name: row.get(2)?,
        imap_path: row.get(3)?,
        role: row.get(4)?,
        unseen_count: row.get(5)?,
        total_count: row.get(6)?,
        synced: row.get::<_, i64>(7)? != 0,
    })
}

pub fn list_folders(db: &Db, account_id: AccountId) -> Result<Vec<FolderSummary>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT f.id, f.account_id, f.name, f.imap_path, f.role, f.unseen_count, f.total_count,
                CASE WHEN s.folder_id IS NULL THEN 0 ELSE 1 END
         FROM folders f
         LEFT JOIN sync_state s ON s.folder_id = f.id
         WHERE f.account_id = ?1
         ORDER BY CASE f.role WHEN 'inbox' THEN 0 ELSE 1 END, f.name",
    )?;
    let rows = stmt.query_map(params![account_id.0], map_folder)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn find_folder_by_role(
    db: &Db,
    account_id: AccountId,
    role: &str,
) -> Result<Option<FolderSummary>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT f.id, f.account_id, f.name, f.imap_path, f.role, f.unseen_count, f.total_count,
                CASE WHEN s.folder_id IS NULL THEN 0 ELSE 1 END
         FROM folders f
         LEFT JOIN sync_state s ON s.folder_id = f.id
         WHERE f.account_id = ?1 AND f.role = ?2 LIMIT 1",
        params![account_id.0, role],
        map_folder,
    )
    .optional()
    .map_err(Into::into)
}

pub fn get_folder(db: &Db, folder_id: FolderId) -> Result<Option<FolderSummary>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT f.id, f.account_id, f.name, f.imap_path, f.role, f.unseen_count, f.total_count,
                CASE WHEN s.folder_id IS NULL THEN 0 ELSE 1 END
         FROM folders f
         LEFT JOIN sync_state s ON s.folder_id = f.id
         WHERE f.id = ?1",
        params![folder_id.0],
        map_folder,
    )
    .optional()
    .map_err(Into::into)
}

fn parse_dt(s: Option<String>) -> Option<DateTime<Utc>> {
    s.and_then(|v| three_mail_core::parse_mail_date(&v))
}

/// Rows synced before P1.5-40 hold raw RFC 2822 dates; rewrite them so ORDER BY date_utc is right.
pub fn normalize_stored_dates(conn: &rusqlite::Connection) -> Result<usize, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, date_utc FROM messages
         WHERE date_utc IS NOT NULL AND date_utc NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-*'",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    let mut fixed = 0;
    for (id, raw) in rows {
        let next = three_mail_core::normalize_mail_date(&raw);
        conn.execute("UPDATE messages SET date_utc = ?1 WHERE id = ?2", params![next, id])?;
        fixed += 1;
    }
    Ok(fixed)
}

const LIST_COLS: &str = "id, account_id, folder_id, uid, subject, from_addr, date_utc,
                unseen, starred, has_attachments,
                COALESCE(snippet, (SELECT substr(replace(replace(COALESCE(text_body, ''), char(10), ' '), char(13), ' '), 1, 160) FROM bodies WHERE message_id = messages.id)),
                category, pinned, snoozed, snooze_until, thread_key";

fn map_list_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageListItem> {
    Ok(MessageListItem {
        id: MessageId(row.get(0)?),
        account_id: AccountId(row.get(1)?),
        folder_id: FolderId(row.get(2)?),
        uid: row.get(3)?,
        subject: row.get(4)?,
        from_addr: row.get(5)?,
        date: parse_dt(row.get(6)?),
        unseen: row.get::<_, i64>(7)? != 0,
        starred: row.get::<_, i64>(8)? != 0,
        has_attachments: row.get::<_, i64>(9)? != 0,
        snippet: row.get(10)?,
        category: row.get(11)?,
        pinned: row.get::<_, i64>(12)? != 0,
        snoozed: row.get::<_, i64>(13)? != 0,
        snooze_until: parse_dt(row.get(14)?),
        thread_key: row.get(15)?,
        thread_count: None,
    })
}

/// List messages in a folder. By default hides active snoozes.
/// `category` filters Smart Inbox buckets; `include_snoozed` / `snoozed_only` control snooze views.
pub fn list_messages(
    db: &Db,
    folder_id: FolderId,
    limit: i64,
    offset: i64,
    category: Option<&str>,
    include_snoozed: bool,
    snoozed_only: bool,
) -> Result<Vec<MessageListItem>, DbError> {
    let conn = db.conn()?;
    let mut sql = format!(
        "SELECT {LIST_COLS} FROM messages WHERE folder_id = ?1"
    );
    if snoozed_only {
        sql.push_str(" AND snoozed = 1");
    } else if !include_snoozed {
        sql.push_str(" AND snoozed = 0");
    }
    if category.is_some() {
        sql.push_str(" AND category = ?4");
    }
    sql.push_str(
        " ORDER BY pinned DESC, COALESCE(snooze_until, date_utc) DESC NULLS LAST, uid DESC LIMIT ?2 OFFSET ?3",
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(cat) = category {
        stmt.query_map(params![folder_id.0, limit, offset, cat], map_list_item)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![folder_id.0, limit, offset], map_list_item)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn list_pinned_messages(
    db: &Db,
    account_id: AccountId,
    limit: i64,
) -> Result<Vec<MessageListItem>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIST_COLS} FROM messages
         WHERE account_id = ?1 AND (pinned = 1 OR starred = 1)
         ORDER BY date_utc DESC NULLS LAST, uid DESC
         LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(params![account_id.0, limit], map_list_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_attachments(db: &Db, message_id: MessageId) -> Result<Vec<AttachmentSummary>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, message_id, filename, mime_type, size_bytes, local_path, content_id, part_id
         FROM attachments WHERE message_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![message_id.0], |row| {
        let local_path: Option<String> = row.get(5)?;
        Ok(AttachmentSummary {
            id: AttachmentId(row.get(0)?),
            message_id: MessageId(row.get(1)?),
            filename: row.get(2)?,
            mime_type: row.get(3)?,
            size_bytes: row.get(4)?,
            downloaded: local_path.as_ref().is_some_and(|p| !p.is_empty()),
            content_id: row.get(6)?,
            part_id: row.get(7)?,
            local_path: local_path.filter(|p| !p.is_empty()),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn get_message(db: &Db, message_id: MessageId) -> Result<Option<MessageDetail>, DbError> {
    let conn = db.conn()?;
    let list = conn
        .query_row(
            &format!("SELECT {LIST_COLS} FROM messages WHERE id = ?1"),
            params![message_id.0],
            map_list_item,
        )
        .optional()?;
    let Some(list) = list else {
        return Ok(None);
    };

    let (to_addrs, cc_addrs, message_id_header, in_reply_to, references_header): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn.query_row(
        "SELECT to_addrs, cc_addrs, message_id_header, in_reply_to, references_header
         FROM messages WHERE id = ?1",
        params![message_id.0],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )?;

    let body: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT text_body, html_body FROM bodies WHERE message_id = ?1",
            params![message_id.0],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let body_loaded = body.is_some();
    let (text_body, html_body) = body.unwrap_or((None, None));

    let thread_key = list
        .thread_key
        .clone()
        .unwrap_or_else(|| format!("singleton:{}", list.id.0));
    let thread_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages
         WHERE account_id = ?1 AND (thread_key = ?2 OR ('singleton:' || id) = ?2)",
        params![list.account_id.0, thread_key],
        |row| row.get(0),
    )?;

    let mut list = list;
    list.thread_count = Some(thread_count);
    drop(conn);

    let attachments = list_attachments(db, message_id)?;

    Ok(Some(MessageDetail {
        list,
        to_addrs,
        cc_addrs,
        message_id_header,
        in_reply_to,
        references_header,
        text_body,
        html_body,
        body_loaded,
        attachments,
    }))
}

pub struct EnvelopeUpsert {
    pub account_id: AccountId,
    pub folder_id: FolderId,
    pub uid: i64,
    pub message_id_header: Option<String>,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub subject: Option<String>,
    pub from_addr: Option<String>,
    pub to_addrs: Option<String>,
    pub cc_addrs: Option<String>,
    pub date_utc: Option<String>,
    pub unseen: bool,
    pub starred: bool,
    pub snippet: Option<String>,
    pub has_attachments: bool,
    pub category: Option<String>,
    pub list_unsubscribe: Option<String>,
    pub thread_key: Option<String>,
}

pub fn upsert_message_envelope(db: &Db, e: &EnvelopeUpsert) -> Result<MessageId, DbError> {
    let conn = db.conn()?;
    // Preserve refined fields from fetch_body / prior sync (never wipe with NULLs).
    conn.execute(
        "INSERT INTO messages (
            account_id, folder_id, uid, message_id_header, in_reply_to, references_header,
            subject, from_addr, to_addrs, cc_addrs, date_utc, unseen, starred, snippet,
            has_attachments, category, list_unsubscribe, thread_key
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
         ON CONFLICT(account_id, folder_id, uid) DO UPDATE SET
            message_id_header = COALESCE(excluded.message_id_header, messages.message_id_header),
            in_reply_to = COALESCE(excluded.in_reply_to, messages.in_reply_to),
            references_header = COALESCE(excluded.references_header, messages.references_header),
            subject = excluded.subject,
            from_addr = excluded.from_addr,
            to_addrs = excluded.to_addrs,
            cc_addrs = excluded.cc_addrs,
            date_utc = excluded.date_utc,
            unseen = excluded.unseen,
            starred = excluded.starred,
            pinned = excluded.starred,
            snippet = COALESCE(excluded.snippet, messages.snippet),
            has_attachments = CASE
                WHEN excluded.has_attachments = 1 THEN 1
                ELSE messages.has_attachments
            END,
            list_unsubscribe = COALESCE(excluded.list_unsubscribe, messages.list_unsubscribe),
            thread_key = CASE
                WHEN excluded.references_header IS NOT NULL THEN excluded.thread_key
                WHEN messages.references_header IS NOT NULL THEN messages.thread_key
                ELSE COALESCE(excluded.thread_key, messages.thread_key)
            END,
            category = CASE
                WHEN messages.category_manual = 1 THEN messages.category
                WHEN excluded.list_unsubscribe IS NOT NULL THEN excluded.category
                WHEN messages.list_unsubscribe IS NOT NULL THEN messages.category
                WHEN messages.category IN ('newsletter', 'notification')
                     AND excluded.category IN ('person', 'other') THEN messages.category
                ELSE COALESCE(excluded.category, messages.category)
            END",
        params![
            e.account_id.0,
            e.folder_id.0,
            e.uid,
            e.message_id_header,
            e.in_reply_to,
            e.references_header,
            e.subject,
            e.from_addr,
            e.to_addrs,
            e.cc_addrs,
            e.date_utc,
            e.unseen as i64,
            e.starred as i64,
            e.snippet,
            e.has_attachments as i64,
            e.category,
            e.list_unsubscribe,
            e.thread_key,
        ],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM messages WHERE account_id = ?1 AND folder_id = ?2 AND uid = ?3",
        params![e.account_id.0, e.folder_id.0, e.uid],
        |row| row.get(0),
    )?;
    Ok(MessageId(id))
}

pub fn set_message_seen(db: &Db, message_id: MessageId, seen: bool) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET unseen = ?1 WHERE id = ?2",
        params![(!seen) as i64, message_id.0],
    )?;
    Ok(())
}

pub fn set_message_snippet(db: &Db, message_id: MessageId, snippet: &str) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET snippet = ?1 WHERE id = ?2",
        params![snippet, message_id.0],
    )?;
    Ok(())
}

pub fn set_message_starred(db: &Db, message_id: MessageId, starred: bool) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET starred = ?1 WHERE id = ?2",
        params![starred as i64, message_id.0],
    )?;
    Ok(())
}

pub fn upsert_body(
    db: &Db,
    message_id: MessageId,
    text_body: Option<&str>,
    html_body: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO bodies (message_id, text_body, html_body, fetched_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(message_id) DO UPDATE SET
           text_body = excluded.text_body,
           html_body = excluded.html_body,
           fetched_at = excluded.fetched_at",
        params![message_id.0, text_body, html_body],
    )?;
    Ok(())
}

pub fn replace_attachments(
    db: &Db,
    message_id: MessageId,
    items: &[(
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
    )],
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "DELETE FROM attachments WHERE message_id = ?1 AND (local_path IS NULL OR local_path = '')",
        params![message_id.0],
    )?;
    for (i, (filename, mime_type, size_bytes, part_id, content_id)) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO attachments (message_id, part_id, filename, mime_type, size_bytes, content_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message_id.0,
                part_id.clone().unwrap_or_else(|| i.to_string()),
                filename,
                mime_type,
                size_bytes,
                content_id
            ],
        )?;
    }
    let has = !items.is_empty();
    conn.execute(
        "UPDATE messages SET has_attachments = ?1 WHERE id = ?2",
        params![has as i64, message_id.0],
    )?;
    Ok(())
}

pub struct MessageImapCoords {
    pub account_id: AccountId,
    pub folder_id: FolderId,
    pub folder_path: String,
    pub uid: i64,
}

/// Every message in the same conversation, so a pin can be stored as `\Flagged` on each one.
pub fn thread_imap_coords(
    db: &Db,
    message_id: MessageId,
) -> Result<Vec<MessageImapCoords>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT m.account_id, m.folder_id, f.imap_path, m.uid
         FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.account_id = (SELECT account_id FROM messages WHERE id = ?1)
           AND (
             m.id = ?1
             OR (
               m.thread_key IS NOT NULL AND m.thread_key != ''
               AND m.thread_key = (SELECT thread_key FROM messages WHERE id = ?1)
             )
           )",
    )?;
    let rows = stmt
        .query_map(params![message_id.0], map_imap_coords)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Pins made before pin was mirrored to `\Flagged`.
pub fn mark_local_pins_flagged(db: &Db, account_id: AccountId) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET starred = 1 WHERE account_id = ?1 AND pinned = 1 AND starred = 0",
        params![account_id.0],
    )?;
    Ok(())
}

pub fn local_only_pins(db: &Db, account_id: AccountId) -> Result<Vec<MessageImapCoords>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT m.account_id, m.folder_id, f.imap_path, m.uid
         FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.account_id = ?1 AND m.pinned = 1 AND m.starred = 0",
    )?;
    let rows = stmt
        .query_map(params![account_id.0], map_imap_coords)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn map_imap_coords(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageImapCoords> {
    Ok(MessageImapCoords {
        account_id: AccountId(row.get(0)?),
        folder_id: FolderId(row.get(1)?),
        folder_path: row.get(2)?,
        uid: row.get(3)?,
    })
}

pub fn message_imap_coords(
    db: &Db,
    message_id: MessageId,
) -> Result<Option<MessageImapCoords>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT m.account_id, m.folder_id, f.imap_path, m.uid
         FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.id = ?1",
        params![message_id.0],
        |row| {
            Ok(MessageImapCoords {
                account_id: AccountId(row.get(0)?),
                folder_id: FolderId(row.get(1)?),
                folder_path: row.get(2)?,
                uid: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub fn delete_message_row(db: &Db, message_id: MessageId) -> Result<(), DbError> {
    let conn = db.conn()?;
    let _ = conn.execute(
        "DELETE FROM messages_fts WHERE message_id = ?1",
        params![message_id.0.to_string()],
    );
    conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id.0])?;
    Ok(())
}

pub fn clear_folder_messages(db: &Db, folder_id: FolderId) -> Result<(), DbError> {
    let conn = db.conn()?;
    let _ = conn.execute(
        "DELETE FROM messages_fts WHERE message_id IN (
            SELECT CAST(id AS TEXT) FROM messages WHERE folder_id = ?1
         )",
        params![folder_id.0],
    );
    conn.execute(
        "DELETE FROM messages WHERE folder_id = ?1",
        params![folder_id.0],
    )?;
    Ok(())
}

pub fn refresh_folder_counts(db: &Db, folder_id: FolderId) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE folders SET
           total_count = (SELECT COUNT(*) FROM messages WHERE folder_id = ?1),
           unseen_count = (SELECT COUNT(*) FROM messages WHERE folder_id = ?1 AND unseen = 1)
         WHERE id = ?1",
        params![folder_id.0],
    )?;
    Ok(())
}

pub fn set_sync_state(
    db: &Db,
    folder_id: FolderId,
    uidvalidity: Option<i64>,
    uidnext: Option<i64>,
    highest_modseq: Option<i64>,
    last_error: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO sync_state (folder_id, uidvalidity, uidnext, highest_modseq, last_error, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(folder_id) DO UPDATE SET
           uidvalidity = excluded.uidvalidity,
           uidnext = excluded.uidnext,
           highest_modseq = COALESCE(excluded.highest_modseq, sync_state.highest_modseq),
           last_error = excluded.last_error,
           updated_at = excluded.updated_at",
        params![folder_id.0, uidvalidity, uidnext, highest_modseq, last_error],
    )?;
    conn.execute(
        "UPDATE folders SET uidvalidity = COALESCE(?1, uidvalidity),
                              uidnext = COALESCE(?2, uidnext),
                              highest_modseq = COALESCE(?3, highest_modseq),
                              last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?4",
        params![uidvalidity, uidnext, highest_modseq, folder_id.0],
    )?;
    Ok(())
}

pub fn get_sync_state(
    db: &Db,
    folder_id: FolderId,
) -> Result<Option<(Option<i64>, Option<i64>, Option<i64>)>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT uidvalidity, uidnext, highest_modseq FROM sync_state WHERE folder_id = ?1",
        params![folder_id.0],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(Into::into)
}

/// Local heuristic buckets for a sender (P1.5-11; not SmartBack).
pub fn bump_sender_category_stat(
    db: &Db,
    account_id: AccountId,
    from_addr: &str,
    parsed: MessageCategory,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    let key = from_addr.trim().to_ascii_lowercase();
    let col = match parsed {
        MessageCategory::Person => "person_count",
        MessageCategory::Notification => "notification_count",
        MessageCategory::Newsletter => "newsletter_count",
        MessageCategory::Other => "other_count",
    };
    let sql = format!(
        "INSERT INTO sender_category_stats (account_id, from_addr, {col}, last_parsed_category)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(account_id, from_addr) DO UPDATE SET
           {col} = sender_category_stats.{col} + 1,
           last_parsed_category = excluded.last_parsed_category,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    );
    conn.execute(
        &sql,
        params![account_id.0, key, parsed.as_str()],
    )?;
    Ok(())
}

/// Dominant bucket when enough samples exist (messageCategoryByStatistics-style).
pub fn get_sender_learned_category(
    db: &Db,
    account_id: AccountId,
    from_addr: &str,
) -> Result<Option<MessageCategory>, DbError> {
    let conn = db.conn()?;
    let key = from_addr.trim().to_ascii_lowercase();
    let row: (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT person_count, notification_count, newsletter_count, other_count
             FROM sender_category_stats
             WHERE account_id = ?1 AND from_addr = ?2",
            params![account_id.0, key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(DbError::from)?
        .unwrap_or((0, 0, 0, 0));
    let total = row.0 + row.1 + row.2 + row.3;
    if total < 3 {
        return Ok(None);
    }
    let mut best = (MessageCategory::Other, 0i64);
    let buckets = [
        (MessageCategory::Person, row.0),
        (MessageCategory::Notification, row.1),
        (MessageCategory::Newsletter, row.2),
        (MessageCategory::Other, row.3),
    ];
    for (cat, n) in buckets {
        if n > best.1 {
            best = (cat, n);
        }
    }
    if best.1 * 4 < total * 3 {
        return Ok(None);
    }
    Ok(Some(best.0))
}

pub fn account_keyring_user(db: &Db, account_id: AccountId) -> Result<Option<String>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT keyring_user FROM accounts WHERE id = ?1",
        params![account_id.0],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub fn delete_account(db: &Db, account_id: AccountId) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id.0])?;
    Ok(())
}

pub struct AttachmentRow {
    pub id: AttachmentId,
    pub message_id: MessageId,
    pub part_id: Option<String>,
    pub filename: Option<String>,
    pub local_path: Option<String>,
}

pub fn get_attachment(db: &Db, attachment_id: AttachmentId) -> Result<Option<AttachmentRow>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT id, message_id, part_id, filename, local_path FROM attachments WHERE id = ?1",
        params![attachment_id.0],
        |row| {
            Ok(AttachmentRow {
                id: AttachmentId(row.get(0)?),
                message_id: MessageId(row.get(1)?),
                part_id: row.get(2)?,
                filename: row.get(3)?,
                local_path: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub fn set_attachment_path(
    db: &Db,
    attachment_id: AttachmentId,
    local_path: &str,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE attachments SET local_path = ?1 WHERE id = ?2",
        params![local_path, attachment_id.0],
    )?;
    Ok(())
}

pub fn set_message_category(
    db: &Db,
    message_id: MessageId,
    category: MessageCategory,
    manual: bool,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET category = ?1, category_manual = ?2 WHERE id = ?3",
        params![category.as_str(), manual as i64, message_id.0],
    )?;
    Ok(())
}

pub fn set_message_list_unsubscribe(
    db: &Db,
    message_id: MessageId,
    list_unsubscribe: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET list_unsubscribe = ?1 WHERE id = ?2",
        params![list_unsubscribe, message_id.0],
    )?;
    Ok(())
}

pub fn set_message_thread_key(
    db: &Db,
    message_id: MessageId,
    thread_key: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET thread_key = ?1 WHERE id = ?2",
        params![thread_key, message_id.0],
    )?;
    Ok(())
}

pub fn set_message_headers_from_parse(
    db: &Db,
    message_id: MessageId,
    message_id_header: Option<&str>,
    in_reply_to: Option<&str>,
    references_header: Option<&str>,
    subject: Option<&str>,
    from_addr: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE messages SET
            message_id_header = COALESCE(?1, message_id_header),
            in_reply_to = COALESCE(?2, in_reply_to),
            references_header = COALESCE(?3, references_header),
            subject = COALESCE(?4, subject),
            from_addr = COALESCE(?5, from_addr)
         WHERE id = ?6",
        params![
            message_id_header,
            in_reply_to,
            references_header,
            subject,
            from_addr,
            message_id.0
        ],
    )?;
    Ok(())
}

/// Best-effort: decode leftover RFC 2047 subjects already stored in DB.
pub fn redecode_mime_subjects(
    db: &Db,
    decode: impl Fn(&str) -> String,
) -> Result<u32, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, subject FROM messages WHERE subject LIKE '%=?%?=%'",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    let mut n = 0u32;
    for (id, subject) in rows {
        let decoded = decode(&subject);
        if decoded != subject && !decoded.contains("=?") {
            conn.execute(
                "UPDATE messages SET subject = ?1 WHERE id = ?2",
                params![decoded, id],
            )?;
            n += 1;
        }
    }
    Ok(n)
}

pub fn is_category_manual(db: &Db, message_id: MessageId) -> Result<bool, DbError> {
    let conn = db.conn()?;
    let v: i64 = conn.query_row(
        "SELECT category_manual FROM messages WHERE id = ?1",
        params![message_id.0],
        |row| row.get(0),
    )?;
    Ok(v != 0)
}

pub fn get_sender_category_override(
    db: &Db,
    account_id: AccountId,
    from_addr: &str,
) -> Result<Option<String>, DbError> {
    let conn = db.conn()?;
    let key = from_addr.trim().to_ascii_lowercase();
    conn.query_row(
        "SELECT category FROM sender_category
         WHERE account_id = ?1 AND lower(from_addr) = ?2",
        params![account_id.0, key],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub fn upsert_sender_category(
    db: &Db,
    account_id: AccountId,
    from_addr: &str,
    category: MessageCategory,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO sender_category (account_id, from_addr, category)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(account_id, from_addr) DO UPDATE SET category = excluded.category",
        params![
            account_id.0,
            from_addr.trim().to_ascii_lowercase(),
            category.as_str()
        ],
    )?;
    Ok(())
}

/// Pin/unpin the whole local thread (Classic conversation pin).
pub fn set_pinned(db: &Db, message_id: MessageId, pinned: bool) -> Result<(), DbError> {
    let conn = db.conn()?;
    let (account_id, thread_key): (i64, Option<String>) = conn.query_row(
        "SELECT account_id, thread_key FROM messages WHERE id = ?1",
        params![message_id.0],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if let Some(tk) = thread_key.filter(|s| !s.is_empty()) {
        conn.execute(
            "UPDATE messages SET pinned = ?1, starred = ?1 WHERE account_id = ?2 AND thread_key = ?3",
            params![pinned as i64, account_id, tk],
        )?;
    } else {
        conn.execute(
            "UPDATE messages SET pinned = ?1, starred = ?1 WHERE id = ?2",
            params![pinned as i64, message_id.0],
        )?;
    }
    if pinned {
        conn.execute(
            "INSERT INTO local_actions (message_id, kind, payload_json)
             SELECT ?1, 'pin', '{}'
             WHERE NOT EXISTS (
               SELECT 1 FROM local_actions WHERE message_id = ?1 AND kind = 'pin'
             )",
            params![message_id.0],
        )?;
    } else {
        conn.execute(
            "DELETE FROM local_actions WHERE message_id = ?1 AND kind = 'pin'",
            params![message_id.0],
        )?;
    }
    Ok(())
}

/// Snooze/unsnooze the whole local thread.
pub fn set_snooze(
    db: &Db,
    message_id: MessageId,
    until: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    let (account_id, thread_key): (i64, Option<String>) = conn.query_row(
        "SELECT account_id, thread_key FROM messages WHERE id = ?1",
        params![message_id.0],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if let Some(until) = until {
        if let Some(tk) = thread_key.filter(|s| !s.is_empty()) {
            conn.execute(
                "UPDATE messages SET snoozed = 1, snooze_until = ?1
                 WHERE account_id = ?2 AND thread_key = ?3",
                params![until, account_id, tk],
            )?;
        } else {
            conn.execute(
                "UPDATE messages SET snoozed = 1, snooze_until = ?1 WHERE id = ?2",
                params![until, message_id.0],
            )?;
        }
        conn.execute(
            "DELETE FROM local_actions WHERE message_id = ?1 AND kind = 'snooze'",
            params![message_id.0],
        )?;
        conn.execute(
            "INSERT INTO local_actions (message_id, kind, payload_json, due_at)
             VALUES (?1, 'snooze', '{}', ?2)",
            params![message_id.0, until],
        )?;
    } else if let Some(tk) = thread_key.filter(|s| !s.is_empty()) {
        conn.execute(
            "UPDATE messages SET snoozed = 0, snooze_until = NULL
             WHERE account_id = ?1 AND thread_key = ?2",
            params![account_id, tk],
        )?;
        conn.execute(
            "DELETE FROM local_actions WHERE message_id = ?1 AND kind = 'snooze'",
            params![message_id.0],
        )?;
    } else {
        conn.execute(
            "UPDATE messages SET snoozed = 0, snooze_until = NULL WHERE id = ?1",
            params![message_id.0],
        )?;
        conn.execute(
            "DELETE FROM local_actions WHERE message_id = ?1 AND kind = 'snooze'",
            params![message_id.0],
        )?;
    }
    Ok(())
}

/// Clear snooze on messages whose snooze_until has passed. Returns affected account/folder pairs.
pub fn unsnooze_due(
    db: &Db,
    now_rfc3339: &str,
) -> Result<Vec<(AccountId, FolderId)>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT account_id, folder_id FROM messages
         WHERE snoozed = 1 AND snooze_until IS NOT NULL AND snooze_until <= ?1",
    )?;
    let pairs: Vec<(AccountId, FolderId)> = stmt
        .query_map(params![now_rfc3339], |row| {
            Ok((AccountId(row.get(0)?), FolderId(row.get(1)?)))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    conn.execute(
        "UPDATE messages SET snoozed = 0, snooze_until = NULL
         WHERE snoozed = 1 AND snooze_until IS NOT NULL AND snooze_until <= ?1",
        params![now_rfc3339],
    )?;
    conn.execute(
        "DELETE FROM local_actions WHERE kind = 'snooze' AND due_at IS NOT NULL AND due_at <= ?1",
        params![now_rfc3339],
    )?;
    Ok(pairs)
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch,
        '\u{3400}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{3040}'..='\u{30FF}'
            | '\u{AC00}'..='\u{D7AF}'
    )
}

/// One CJK character per FTS token, so a word in the middle of a subject can match.
fn segment_text(input: &str) -> String {
    let mut out = String::new();
    let mut prev_cjk = false;
    let mut prev_word = false;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
            prev_cjk = false;
            prev_word = false;
            continue;
        }
        let cjk = is_cjk(ch);
        let word = !cjk && (ch.is_alphanumeric() || ch == '_' || ch == '@' || ch == '.');
        if cjk && (prev_cjk || prev_word) || (word && prev_cjk) {
            out.push(' ');
        }
        out.push(ch);
        prev_cjk = cjk;
        prev_word = word;
    }
    out.trim().to_string()
}

fn join_addr(to: Option<&str>, cc: Option<&str>) -> String {
    match (
        to.filter(|s| !s.is_empty()),
        cc.filter(|s| !s.is_empty()),
    ) {
        (Some(to), Some(cc)) if to.contains(cc) => to.to_string(),
        (Some(to), Some(cc)) => format!("{to} {cc}"),
        (Some(to), None) => to.to_string(),
        (None, Some(cc)) => cc.to_string(),
        _ => String::new(),
    }
}

fn write_fts(
    conn: &rusqlite::Connection,
    message_id: &str,
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    additional: &str,
) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM messages_fts WHERE message_id = ?1",
        params![message_id],
    )?;
    conn.execute(
        "INSERT INTO messages_fts (message_id, message_from, message_to, subject, search_body, additional_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![message_id, from, to, subject, body, additional],
    )?;
    Ok(())
}

pub fn reindex_message_fts(
    db: &Db,
    message_id: MessageId,
    from: Option<&str>,
    to: Option<&str>,
    subject: Option<&str>,
    body: Option<&str>,
    additional: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    let mid = message_id.0.to_string();
    // cc_addrs is nullable. Reading it as String aborts the whole folder sync.
    let cc: Option<String> = conn
        .query_row(
            "SELECT cc_addrs FROM messages WHERE id = ?1",
            params![message_id.0],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    // Envelope reindex passes body=None — keep previously indexed body text.
    let prev: Option<(String, String)> = conn
        .query_row(
            "SELECT search_body, additional_text FROM messages_fts WHERE message_id = ?1",
            params![&mid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (prev_body, prev_add) = prev.unwrap_or_default();
    let search_body = body.unwrap_or(prev_body.as_str());
    let add_text = additional.unwrap_or(prev_add.as_str());
    write_fts(
        &conn,
        &mid,
        &segment_text(from.unwrap_or("")),
        &segment_text(&join_addr(to, cc.as_deref())),
        &segment_text(subject.unwrap_or("")),
        &segment_text(search_body),
        &segment_text(add_text),
    )
}

/// Rewrite the index once so existing mail is searchable by CJK substring, and Cc is included.
pub fn segment_search_index(conn: &rusqlite::Connection) -> Result<usize, DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    let ver: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'fts_segment'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if ver.as_deref() == Some("1") {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        "SELECT m.id, m.from_addr, m.to_addrs, m.cc_addrs, m.subject,
                f.search_body, f.additional_text
         FROM messages m
         LEFT JOIN messages_fts f ON CAST(f.message_id AS INTEGER) = m.id",
    )?;
    let rows: Vec<(
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    for (id, from, to, cc, subject, body, add) in &rows {
        write_fts(
            conn,
            &id.to_string(),
            &segment_text(from.as_deref().unwrap_or("")),
            &segment_text(&join_addr(to.as_deref(), cc.as_deref())),
            &segment_text(subject.as_deref().unwrap_or("")),
            &segment_text(body.as_deref().unwrap_or("")),
            &segment_text(add.as_deref().unwrap_or("")),
        )?;
    }
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('fts_segment', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )?;
    Ok(rows.len())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttachFilter {
    Any,
    Pdf,
    Image,
    Document,
}

struct ParsedSearch {
    fts: Option<String>,
    attachments: bool,
    kind: Option<AttachFilter>,
}

fn split_query(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in input.chars() {
        if ch == '"' {
            quoted = !quoted;
            continue;
        }
        if ch.is_whitespace() && !quoted {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn fts_term(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .filter(|ch| !matches!(ch, '"' | '(' | ')' | '{' | '}' | '^' | ':' | '*' | '\''))
        .collect();
    let seg = segment_text(&cleaned);
    if seg.is_empty() {
        return None;
    }
    if seg.chars().any(is_cjk) || seg.contains(' ') {
        return Some(format!("\"{seg}\""));
    }
    if matches!(seg.to_ascii_lowercase().as_str(), "and" | "or" | "not" | "near") {
        return Some(format!("\"{seg}\""));
    }
    Some(format!("{seg}*"))
}

fn parse_search(input: &str) -> ParsedSearch {
    let mut parts: Vec<String> = Vec::new();
    let mut attachments = false;
    let mut kind = None;
    for token in split_query(input) {
        let lower = token.to_ascii_lowercase();
        if lower == "attachments" || lower == "has:attachment" || lower == "has:attachments" {
            attachments = true;
            continue;
        }
        if let Some((op, value)) = token.split_once(':') {
            let op = op.to_ascii_lowercase();
            let value = value.trim().trim_matches('"');
            match op.as_str() {
                "from" => {
                    if let Some(term) = fts_term(value) {
                        parts.push(format!("message_from : {term}"));
                    }
                }
                "to" | "cc" => {
                    if let Some(term) = fts_term(value) {
                        parts.push(format!("message_to : {term}"));
                    }
                }
                "subject" => {
                    if let Some(term) = fts_term(value) {
                        parts.push(format!("subject : {term}"));
                    }
                }
                "type" => {
                    kind = Some(match value.to_ascii_lowercase().as_str() {
                        "pdf" => AttachFilter::Pdf,
                        "image" | "images" => AttachFilter::Image,
                        "document" | "documents" => AttachFilter::Document,
                        _ => AttachFilter::Any,
                    });
                }
                _ => {
                    if let Some(term) = fts_term(&token) {
                        parts.push(term);
                    }
                }
            }
            continue;
        }
        if let Some(term) = fts_term(&token) {
            parts.push(term);
        }
    }
    ParsedSearch {
        fts: if parts.is_empty() {
            None
        } else {
            Some(parts.join(" AND "))
        },
        attachments,
        kind,
    }
}

fn attach_sql(kind: AttachFilter) -> &'static str {
    match kind {
        AttachFilter::Any => {
            "(m.has_attachments = 1 OR EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id))"
        }
        AttachFilter::Pdf => {
            "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND (
                lower(COALESCE(a.filename, '')) LIKE '%.pdf'
                OR lower(COALESCE(a.mime_type, '')) LIKE '%pdf%'))"
        }
        AttachFilter::Image => {
            "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND (
                lower(COALESCE(a.mime_type, '')) LIKE 'image/%'
                OR lower(COALESCE(a.filename, '')) LIKE '%.jpg'
                OR lower(COALESCE(a.filename, '')) LIKE '%.jpeg'
                OR lower(COALESCE(a.filename, '')) LIKE '%.png'
                OR lower(COALESCE(a.filename, '')) LIKE '%.gif'
                OR lower(COALESCE(a.filename, '')) LIKE '%.webp'
                OR lower(COALESCE(a.filename, '')) LIKE '%.heic'))"
        }
        AttachFilter::Document => {
            "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND (
                lower(COALESCE(a.filename, '')) LIKE '%.doc'
                OR lower(COALESCE(a.filename, '')) LIKE '%.docx'
                OR lower(COALESCE(a.filename, '')) LIKE '%.xls'
                OR lower(COALESCE(a.filename, '')) LIKE '%.xlsx'
                OR lower(COALESCE(a.filename, '')) LIKE '%.ppt'
                OR lower(COALESCE(a.filename, '')) LIKE '%.pptx'
                OR lower(COALESCE(a.filename, '')) LIKE '%.txt'
                OR lower(COALESCE(a.filename, '')) LIKE '%.rtf'
                OR lower(COALESCE(a.filename, '')) LIKE '%.csv'
                OR lower(COALESCE(a.filename, '')) LIKE '%.pages'
                OR lower(COALESCE(a.filename, '')) LIKE '%.key'
                OR lower(COALESCE(a.filename, '')) LIKE '%.numbers'))"
        }
    }
}

const SEARCH_COLS: &str = "m.id, m.account_id, m.folder_id, m.uid, m.subject, m.from_addr, m.date_utc,
                m.unseen, m.starred, m.has_attachments, m.snippet, m.category,
                m.pinned, m.snoozed, m.snooze_until, m.thread_key";

pub fn search_messages(
    db: &Db,
    account_id: Option<AccountId>,
    query: &str,
    limit: i64,
) -> Result<Vec<MessageListItem>, DbError> {
    let parsed = parse_search(query);
    if parsed.fts.is_none() && !parsed.attachments && parsed.kind.is_none() {
        return Ok(Vec::new());
    }
    let mut sql = format!("SELECT {SEARCH_COLS} FROM messages m");
    let mut where_sql = String::new();
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(fts) = &parsed.fts {
        sql.push_str(" JOIN messages_fts f ON m.id = CAST(f.message_id AS INTEGER)");
        where_sql.push_str("f MATCH ?");
        binds.push(rusqlite::types::Value::Text(fts.clone()));
    }
    if let Some(account_id) = account_id {
        if !where_sql.is_empty() {
            where_sql.push_str(" AND ");
        }
        where_sql.push_str("m.account_id = ?");
        binds.push(rusqlite::types::Value::Integer(account_id.0));
    }
    if parsed.attachments {
        if !where_sql.is_empty() {
            where_sql.push_str(" AND ");
        }
        where_sql.push_str(attach_sql(AttachFilter::Any));
    }
    if let Some(kind) = parsed.kind {
        if !where_sql.is_empty() {
            where_sql.push_str(" AND ");
        }
        where_sql.push_str(attach_sql(kind));
    }
    sql.push_str(" WHERE ");
    sql.push_str(&where_sql);
    sql.push_str(" ORDER BY m.date_utc DESC NULLS LAST LIMIT ?");
    binds.push(rusqlite::types::Value::Integer(limit));

    let conn = db.conn()?;
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), map_list_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_threads(
    db: &Db,
    folder_id: FolderId,
    limit: i64,
    offset: i64,
    category: Option<&str>,
) -> Result<Vec<ThreadSummary>, DbError> {
    let conn = db.conn()?;
    // Latest message by date_utc (not MAX(id)); aggregates over the thread.
    let mut sql = String::from(
        "WITH base AS (
            SELECT *,
                   COALESCE(thread_key, 'singleton:' || id) AS tk,
                   ROW_NUMBER() OVER (
                     PARTITION BY COALESCE(thread_key, 'singleton:' || id)
                     ORDER BY date_utc DESC NULLS LAST, uid DESC
                   ) AS rn
            FROM messages
            WHERE folder_id = ?1 AND snoozed = 0",
    );
    if category.is_some() {
        sql.push_str(" AND category = ?4");
    }
    sql.push_str(
        "
         ),
         agg AS (
            SELECT tk,
                   account_id,
                   folder_id,
                   COUNT(*) AS cnt,
                   MAX(CASE WHEN unseen = 1 THEN 1 ELSE 0 END) AS any_unseen,
                   MAX(CASE WHEN starred = 1 THEN 1 ELSE 0 END) AS any_starred,
                   MAX(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) AS any_pinned,
                   MAX(date_utc) AS latest
            FROM base
            GROUP BY tk, account_id, folder_id
         )
         SELECT a.tk, a.account_id, a.folder_id, a.latest, a.cnt,
                a.any_unseen, a.any_starred, a.any_pinned,
                b.id, b.subject, b.from_addr, b.date_utc, b.category,
                COALESCE(b.snippet, (SELECT substr(replace(replace(COALESCE(text_body, ''), char(10), ' '), char(13), ' '), 1, 160) FROM bodies WHERE message_id = b.id)),
                b.has_attachments
         FROM agg a
         JOIN base b ON b.tk = a.tk AND b.rn = 1
         ORDER BY a.any_pinned DESC, a.latest DESC NULLS LAST
         LIMIT ?2 OFFSET ?3",
    );

    let mut stmt = conn.prepare(&sql)?;
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<ThreadSummary> {
        Ok(ThreadSummary {
            thread_key: row.get(0)?,
            account_id: AccountId(row.get(1)?),
            folder_id: FolderId(row.get(2)?),
            date: parse_dt(row.get(3)?),
            message_count: row.get(4)?,
            unseen: row.get::<_, i64>(5)? != 0,
            starred: row.get::<_, i64>(6)? != 0,
            pinned: row.get::<_, i64>(7)? != 0,
            latest_message_id: MessageId(row.get(8)?),
            subject: row.get(9)?,
            from_addr: row.get(10)?,
            // date_utc from latest row (col 11) — prefer agg latest already in `date`
            category: row.get(12)?,
            snippet: row.get(13)?,
            has_attachments: row.get::<_, i64>(14)? != 0,
        })
    };

    let rows = if let Some(cat) = category {
        stmt.query_map(params![folder_id.0, limit, offset, cat], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![folder_id.0, limit, offset], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn list_thread_messages(
    db: &Db,
    account_id: AccountId,
    thread_key: &str,
) -> Result<Vec<MessageListItem>, DbError> {
    let conn = db.conn()?;
    let root_token = thread_root_token(&conn, account_id, thread_key)?;
    let like = format!("%{root_token}%");
    let mut stmt = conn.prepare(&format!(
        "WITH related AS (
            SELECT DISTINCT COALESCE(thread_key, 'singleton:' || id) AS tk
            FROM messages
            WHERE account_id = ?1 AND (
                thread_key = ?2
                OR ('singleton:' || id) = ?2
                OR lower(coalesce(references_header, '')) LIKE ?3
                OR lower(coalesce(in_reply_to, '')) LIKE ?3
                OR lower(trim(coalesce(message_id_header, ''))) = ?4
            )
         )
         SELECT {LIST_COLS} FROM messages
         WHERE account_id = ?1
           AND COALESCE(thread_key, 'singleton:' || id) IN (SELECT tk FROM related)
         ORDER BY date_utc ASC NULLS LAST, uid ASC"
    ))?;
    let rows = stmt
        .query_map(
            params![account_id.0, thread_key, like, root_token],
            map_list_item,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn thread_root_token(
    conn: &rusqlite::Connection,
    account_id: AccountId,
    thread_key: &str,
) -> Result<String, DbError> {
    if let Some(id_str) = thread_key.strip_prefix("singleton:") {
        if let Ok(mid) = id_str.parse::<i64>() {
            if let Some(h) = conn
                .query_row(
                    "SELECT message_id_header FROM messages WHERE id = ?1 AND account_id = ?2",
                    params![mid, account_id.0],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten()
            {
                if !h.trim().is_empty() {
                    return Ok(h.trim().to_ascii_lowercase());
                }
            }
        }
    }
    Ok(thread_key.trim().to_ascii_lowercase())
}

fn addr_list_contains(addr_field: Option<&str>, needle: &str) -> bool {
    let Some(raw) = addr_field else {
        return false;
    };
    let needle = needle.trim().to_ascii_lowercase();
    if needle.is_empty() {
        return false;
    }
    three_mail_core::split_addr_list(raw).iter().any(|a| {
        let lower = a.to_ascii_lowercase();
        if lower == needle {
            return true;
        }
        if let Some(start) = lower.find('<') {
            if let Some(end) = lower[start..].find('>') {
                let email = &lower[start + 1..start + end];
                return email == needle;
            }
        }
        lower.contains(&needle)
    })
}

fn extract_addr_email(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    let lower = s.to_ascii_lowercase();
    if let Some(start) = lower.find('<') {
        if let Some(end) = lower[start..].find('>') {
            let email = lower[start + 1..start + end].trim();
            if !email.is_empty() {
                return Some(email.to_string());
            }
        }
    }
    Some(lower.to_string())
}

pub fn list_correspondence(
    db: &Db,
    account_id: AccountId,
    account_email: &str,
    contact_email: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<CorrespondenceItem>, DbError> {
    let conn = db.conn()?;
    let me = account_email.trim().to_ascii_lowercase();
    let contact = contact_email.trim().to_ascii_lowercase();
    let like = format!("%{contact}%");
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIST_COLS}, to_addrs, cc_addrs FROM messages
         WHERE account_id = ?1
           AND (
             lower(coalesce(from_addr, '')) LIKE ?2
             OR lower(coalesce(to_addrs, '')) LIKE ?2
             OR lower(coalesce(cc_addrs, '')) LIKE ?2
           )
         ORDER BY date_utc DESC NULLS LAST, id DESC
         LIMIT ?3 OFFSET ?4"
    ))?;
    let mut out = Vec::new();
    let rows = stmt.query_map(params![account_id.0, like, limit, offset], |row| {
        let list = map_list_item(row)?;
        let to: Option<String> = row.get(16)?;
        let cc: Option<String> = row.get(17)?;
        Ok((list, to, cc))
    })?;
    for row in rows {
        let (list, to_addrs, cc_addrs) = row?;
        let from = extract_addr_email(list.from_addr.as_deref());
        let inbound = from.as_deref() == Some(contact.as_str());
        let outbound = from.as_deref() == Some(me.as_str())
            && (addr_list_contains(to_addrs.as_deref(), &contact)
                || addr_list_contains(cc_addrs.as_deref(), &contact));
        if !inbound && !outbound {
            continue;
        }
        out.push(CorrespondenceItem {
            list,
            direction: if inbound {
                "inbound".to_string()
            } else {
                "outbound".to_string()
            },
        });
    }
    Ok(out)
}

fn map_signature(row: &rusqlite::Row<'_>) -> rusqlite::Result<Signature> {
    Ok(Signature {
        id: row.get(0)?,
        account_id: AccountId(row.get(1)?),
        name: row.get(2)?,
        body_text: row.get(3)?,
        is_default: row.get::<_, i64>(4)? != 0,
        body_html: row.get(5)?,
    })
}

pub fn list_signatures(db: &Db, account_id: AccountId) -> Result<Vec<Signature>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, name, body_text, is_default, body_html FROM signatures
         WHERE account_id = ?1 ORDER BY is_default DESC, id",
    )?;
    let rows = stmt
        .query_map(params![account_id.0], map_signature)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_signature(db: &Db, signature_id: i64) -> Result<Option<Signature>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT id, account_id, name, body_text, is_default, body_html FROM signatures WHERE id = ?1",
        params![signature_id],
        map_signature,
    )
    .optional()
    .map_err(Into::into)
}

pub fn upsert_signature(
    db: &Db,
    signature_id: Option<i64>,
    account_id: AccountId,
    name: &str,
    body_text: &str,
    body_html: Option<&str>,
    is_default: bool,
) -> Result<i64, DbError> {
    let conn = db.conn()?;
    if is_default {
        conn.execute(
            "UPDATE signatures SET is_default = 0 WHERE account_id = ?1",
            params![account_id.0],
        )?;
    }
    if let Some(id) = signature_id {
        conn.execute(
            "UPDATE signatures SET name = ?1, body_text = ?2, body_html = ?3, is_default = ?4
             WHERE id = ?5",
            params![name, body_text, body_html, is_default as i64, id],
        )?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO signatures (account_id, name, body_text, body_html, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account_id.0, name, body_text, body_html, is_default as i64],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete_signature(db: &Db, signature_id: i64) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "DELETE FROM signatures WHERE id = ?1",
        params![signature_id],
    )?;
    Ok(())
}

pub fn list_drafts(db: &Db, account_id: AccountId) -> Result<Vec<Draft>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body,
                in_reply_to, references_header, updated_at, html_body, source_message_id,
                message_id_header, server_message_id
         FROM drafts WHERE account_id = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt
        .query_map(params![account_id.0], |row| {
            Ok(Draft {
                id: row.get(0)?,
                account_id: AccountId(row.get(1)?),
                to_addrs: row.get(2)?,
                cc_addrs: row.get(3)?,
                bcc_addrs: row.get(4)?,
                subject: row.get(5)?,
                text_body: row.get(6)?,
                in_reply_to: row.get(7)?,
                references_header: row.get(8)?,
                updated_at: parse_dt(row.get(9)?),
                html_body: row.get(10)?,
                source_message_id: row.get::<_, Option<i64>>(11)?.map(MessageId),
                message_id_header: row.get(12)?,
                server_message_id: row.get::<_, Option<i64>>(13)?.map(MessageId),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_draft(db: &Db, draft_id: i64) -> Result<Option<Draft>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body,
                in_reply_to, references_header, updated_at, html_body, source_message_id,
                message_id_header, server_message_id
         FROM drafts WHERE id = ?1",
    )?;
    let row = stmt
        .query_row(params![draft_id], |row| {
            Ok(Draft {
                id: row.get(0)?,
                account_id: AccountId(row.get(1)?),
                to_addrs: row.get(2)?,
                cc_addrs: row.get(3)?,
                bcc_addrs: row.get(4)?,
                subject: row.get(5)?,
                text_body: row.get(6)?,
                in_reply_to: row.get(7)?,
                references_header: row.get(8)?,
                updated_at: parse_dt(row.get(9)?),
                html_body: row.get(10)?,
                source_message_id: row.get::<_, Option<i64>>(11)?.map(MessageId),
                message_id_header: row.get(12)?,
                server_message_id: row.get::<_, Option<i64>>(13)?.map(MessageId),
            })
        })
        .optional()?;
    Ok(row)
}

pub fn ensure_draft_message_id(db: &Db, draft_id: i64) -> Result<String, DbError> {
    let conn = db.conn()?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT message_id_header FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if let Some(h) = existing.filter(|s| !s.is_empty()) {
        return Ok(h);
    }
    let header = format!("<3mail-draft-{}@local>", uuid::Uuid::new_v4());
    conn.execute(
        "UPDATE drafts SET message_id_header = ?1 WHERE id = ?2",
        params![header, draft_id],
    )?;
    Ok(header)
}

pub fn set_draft_server_link(
    db: &Db,
    draft_id: i64,
    message_id: MessageId,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE drafts SET server_message_id = ?1, source_message_id = ?1 WHERE id = ?2",
        params![message_id.0, draft_id],
    )?;
    Ok(())
}

pub fn find_message_by_header(
    db: &Db,
    account_id: AccountId,
    folder_id: FolderId,
    message_id_header: &str,
) -> Result<Option<MessageId>, DbError> {
    let conn = db.conn()?;
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM messages
             WHERE account_id = ?1 AND folder_id = ?2 AND message_id_header = ?3
             LIMIT 1",
            params![account_id.0, folder_id.0, message_id_header],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(id.map(MessageId))
}

pub fn save_draft(
    db: &Db,
    draft_id: Option<i64>,
    account_id: AccountId,
    to_addrs: &str,
    cc_addrs: &str,
    bcc_addrs: &str,
    subject: &str,
    text_body: &str,
    html_body: Option<&str>,
    in_reply_to: Option<&str>,
    references_header: Option<&str>,
    source_message_id: Option<MessageId>,
) -> Result<i64, DbError> {
    let conn = db.conn()?;
    if let Some(id) = draft_id {
        conn.execute(
            "UPDATE drafts SET to_addrs = ?1, cc_addrs = ?2, bcc_addrs = ?3, subject = ?4, text_body = ?5,
                html_body = ?6, in_reply_to = ?7, references_header = ?8,
                source_message_id = COALESCE(?9, source_message_id),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?10",
            params![
                to_addrs,
                cc_addrs,
                bcc_addrs,
                subject,
                text_body,
                html_body,
                in_reply_to,
                references_header,
                source_message_id.map(|id| id.0),
                id
            ],
        )?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO drafts (
                account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body, html_body,
                in_reply_to, references_header, source_message_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                account_id.0,
                to_addrs,
                cc_addrs,
                bcc_addrs,
                subject,
                text_body,
                html_body,
                in_reply_to,
                references_header,
                source_message_id.map(|id| id.0)
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn draft_source_message(db: &Db, draft_id: i64) -> Result<Option<MessageId>, DbError> {
    let conn = db.conn()?;
    let id: Option<i64> = conn
        .query_row(
            "SELECT source_message_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(id.map(MessageId))
}

#[derive(Debug, Clone)]
pub struct FlagRetry {
    pub message_id: MessageId,
    pub kind: String,
    pub payload_json: String,
}

pub fn upsert_flag_retry(
    db: &Db,
    message_id: MessageId,
    kind: &str,
    payload_json: &str,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "DELETE FROM local_actions WHERE message_id = ?1 AND kind = ?2",
        params![message_id.0, kind],
    )?;
    conn.execute(
        "INSERT INTO local_actions (message_id, kind, payload_json)
         VALUES (?1, ?2, ?3)",
        params![message_id.0, kind, payload_json],
    )?;
    Ok(())
}

pub fn clear_flag_retry(db: &Db, message_id: MessageId, kind: &str) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "DELETE FROM local_actions WHERE message_id = ?1 AND kind = ?2",
        params![message_id.0, kind],
    )?;
    Ok(())
}

pub fn list_flag_retries(db: &Db) -> Result<Vec<FlagRetry>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT message_id, kind, payload_json FROM local_actions
         WHERE kind IN ('imap_seen', 'imap_flagged')
         ORDER BY id ASC
         LIMIT 200",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FlagRetry {
                message_id: MessageId(row.get(0)?),
                kind: row.get(1)?,
                payload_json: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn count_flag_retries(db: &Db) -> Result<i64, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT COUNT(*) FROM local_actions WHERE kind IN ('imap_seen', 'imap_flagged')",
        [],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

pub fn attachment_id_by_part(
    db: &Db,
    message_id: MessageId,
    part_id: &str,
) -> Result<Option<AttachmentId>, DbError> {
    let conn = db.conn()?;
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM attachments WHERE message_id = ?1 AND part_id = ?2 LIMIT 1",
            params![message_id.0, part_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(id.map(AttachmentId))
}

pub fn delete_draft(db: &Db, draft_id: i64) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute("DELETE FROM drafts WHERE id = ?1", params![draft_id])?;
    Ok(())
}

pub fn enqueue_outbox(
    db: &Db,
    account_id: AccountId,
    to_addrs: &str,
    cc_addrs: Option<&str>,
    bcc_addrs: Option<&str>,
    subject: &str,
    text_body: &str,
    html_body: Option<&str>,
    send_at: Option<&str>,
    draft_id: Option<i64>,
    in_reply_to: Option<&str>,
    references_header: Option<&str>,
    attachments_json: Option<&str>,
) -> Result<i64, DbError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO outbox (
            account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body, html_body, status,
            send_at, draft_id, in_reply_to, references_header, attachments_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11, ?12)",
        params![
            account_id.0,
            to_addrs,
            cc_addrs,
            bcc_addrs,
            subject,
            text_body,
            html_body,
            send_at,
            draft_id,
            in_reply_to,
            references_header,
            attachments_json
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn set_outbox_attachments_json(
    db: &Db,
    outbox_id: i64,
    attachments_json: &str,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE outbox SET attachments_json = ?1 WHERE id = ?2",
        params![attachments_json, outbox_id],
    )?;
    Ok(())
}

fn map_outbox_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
    let attachments_raw: Option<String> = row.get(14)?;
    let attachments = attachments_raw
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|json| {
            serde_json::from_str(json).unwrap_or_else(|_| {
                tracing::warn!("invalid outbox attachments_json");
                Vec::new()
            })
        })
        .unwrap_or_default();
    Ok(OutboxItem {
        id: row.get(0)?,
        account_id: AccountId(row.get(1)?),
        to_addrs: row.get(2)?,
        cc_addrs: row.get(3)?,
        bcc_addrs: row.get(4)?,
        subject: row.get(5)?,
        text_body: row.get(6)?,
        status: row.get(7)?,
        send_at: parse_dt(row.get(8)?),
        last_error: row.get(9)?,
        in_reply_to: row.get(10)?,
        references_header: row.get(11)?,
        draft_id: row.get(12)?,
        html_body: row.get(13)?,
        attachments,
    })
}

pub fn list_due_outbox(db: &Db, now_rfc3339: &str) -> Result<Vec<OutboxItem>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body, status, send_at, last_error,
                in_reply_to, references_header, draft_id, html_body, attachments_json
         FROM outbox
         WHERE status = 'pending'
           AND (send_at IS NULL OR send_at <= ?1)
         ORDER BY COALESCE(send_at, created_at) ASC
         LIMIT 20",
    )?;
    let rows = stmt
        .query_map(params![now_rfc3339], map_outbox_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_outbox_status(
    db: &Db,
    outbox_id: i64,
    status: &str,
    last_error: Option<&str>,
) -> Result<(), DbError> {
    let conn = db.conn()?;
    if status == "sent" {
        conn.execute(
            "UPDATE outbox SET status = ?1, last_error = NULL,
                sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2",
            params![status, outbox_id],
        )?;
    } else {
        conn.execute(
            "UPDATE outbox SET status = ?1, last_error = ?2 WHERE id = ?3",
            params![status, last_error, outbox_id],
        )?;
    }
    Ok(())
}

pub fn delete_outbox(db: &Db, outbox_id: i64) -> Result<Option<AccountId>, DbError> {
    let conn = db.conn()?;
    let account_id: Option<i64> = conn
        .query_row(
            "SELECT account_id FROM outbox WHERE id = ?1",
            params![outbox_id],
            |row| row.get(0),
        )
        .optional()?;
    conn.execute("DELETE FROM outbox WHERE id = ?1", params![outbox_id])?;
    Ok(account_id.map(AccountId))
}

pub fn get_outbox_account(db: &Db, outbox_id: i64) -> Result<Option<AccountId>, DbError> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT account_id FROM outbox WHERE id = ?1",
        params![outbox_id],
        |row| Ok(AccountId(row.get(0)?)),
    )
    .optional()
    .map_err(Into::into)
}

pub fn list_outbox(db: &Db, account_id: AccountId) -> Result<Vec<OutboxItem>, DbError> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, to_addrs, cc_addrs, bcc_addrs, subject, text_body, status, send_at, last_error,
                in_reply_to, references_header, draft_id, html_body, attachments_json
         FROM outbox WHERE account_id = ?1 AND status IN ('pending', 'sending', 'failed')
         ORDER BY COALESCE(send_at, created_at) ASC",
    )?;
    let rows = stmt
        .query_map(params![account_id.0], map_outbox_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn message_envelope_fields(
    db: &Db,
    message_id: MessageId,
) -> Result<Option<(AccountId, Option<String>, Option<String>, Option<String>, Option<String>)>, DbError>
{
    let conn = db.conn()?;
    conn.query_row(
        "SELECT account_id, from_addr, to_addrs, subject, list_unsubscribe
         FROM messages WHERE id = ?1",
        params![message_id.0],
        |row| {
            Ok((
                AccountId(row.get(0)?),
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .optional()
    .map_err(Into::into)
}

#[cfg(test)]
mod search_tests {
    use super::*;

    #[test]
    fn cjk_characters_become_separate_tokens() {
        assert_eq!(segment_text("国内差旅费"), "国 内 差 旅 费");
        assert_eq!(segment_text("差 旅"), "差 旅");
        assert_eq!(segment_text("Amber Yan"), "Amber Yan");
        assert_eq!(segment_text("A差旅"), "A 差 旅");
    }

    #[test]
    fn plain_cjk_is_a_phrase() {
        let parsed = parse_search("差旅");
        assert_eq!(parsed.fts.as_deref(), Some("\"差 旅\""));
        assert!(!parsed.attachments);
        assert!(parsed.kind.is_none());
    }

    #[test]
    fn operators_limit_the_field_and_attachment_type() {
        let parsed = parse_search("from:\"诸丽萍\" type:pdf");
        assert_eq!(parsed.fts.as_deref(), Some("message_from : \"诸 丽 萍\""));
        assert_eq!(parsed.kind, Some(AttachFilter::Pdf));
    }

    #[test]
    fn english_prefix_and_attachment_flag() {
        let parsed = parse_search("archive attachments");
        assert_eq!(parsed.fts.as_deref(), Some("archive*"));
        assert!(parsed.attachments);
    }
}

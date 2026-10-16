use async_imap::types::{Fetch, Flag, Name, NameAttribute};
use async_imap::Client;
use async_imap::Session;
use async_native_tls::TlsConnector;
use async_std::net::TcpStream;
use futures_util::TryStreamExt;
use thiserror::Error;

use three_mail_core::{Error as CoreError, TlsMode};

use crate::decode::{decode_imap_utf7, decode_mime_header};

pub type ImapSession = Session<async_native_tls::TlsStream<TcpStream>>;

#[derive(Debug, Error)]
pub enum MailError {
    #[error("imap: {0}")]
    Imap(String),
    #[error("tls/connect: {0}")]
    Connect(String),
    #[error("auth: {0}")]
    Auth(String),
}

impl From<MailError> for CoreError {
    fn from(value: MailError) -> Self {
        match value {
            MailError::Auth(m) => CoreError::Auth(m),
            other => CoreError::Mail(other.to_string()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct MailboxMeta {
    /// Human-readable name (IMAP UTF-7 decoded).
    pub name: String,
    /// Wire name for SELECT/LIST (may be Modified UTF-7).
    pub imap_path: String,
    pub role: Option<&'static str>,
}

fn guess_role(name: &str, attrs: &[NameAttribute<'_>]) -> Option<&'static str> {
    for a in attrs {
        match a {
            NameAttribute::Archive => return Some("archive"),
            NameAttribute::Drafts => return Some("drafts"),
            NameAttribute::Sent => return Some("sent"),
            NameAttribute::Trash => return Some("trash"),
            NameAttribute::Junk => return Some("junk"),
            NameAttribute::All | NameAttribute::Flagged => {}
            NameAttribute::NoSelect
            | NameAttribute::NoInferiors
            | NameAttribute::Marked
            | NameAttribute::Unmarked => {}
            NameAttribute::Extension(ext) => {
                let lower = ext.to_ascii_lowercase();
                if lower.contains("inbox") {
                    return Some("inbox");
                }
            }
            _ => {}
        }
    }
    let lower = name.to_ascii_lowercase();
    if lower == "inbox" {
        Some("inbox")
    } else if lower.contains("sent") {
        Some("sent")
    } else if lower.contains("draft") {
        Some("drafts")
    } else if lower.contains("trash") || lower.contains("deleted") {
        Some("trash")
    } else if lower.contains("archive") {
        Some("archive")
    } else {
        None
    }
}

async fn login_tls_stream(
    tls_stream: async_native_tls::TlsStream<TcpStream>,
    email: &str,
    secret: &str,
    read_greeting: bool,
) -> Result<ImapSession, MailError> {
    let mut client = Client::new(tls_stream);
    if read_greeting {
        let _greeting = client
            .read_response()
            .await
            .map_err(|e| MailError::Imap(e.to_string()))?
            .ok_or_else(|| MailError::Imap("missing IMAP greeting".into()))?;
    }
    client
        .login(email, secret)
        .await
        .map_err(|(e, _)| MailError::Auth(e.to_string()))
}

pub async fn connect(
    host: &str,
    port: u16,
    security: TlsMode,
    email: &str,
    secret: &str,
) -> Result<ImapSession, MailError> {
    let addr = (host, port);
    let tcp = TcpStream::connect(addr)
        .await
        .map_err(|e| MailError::Connect(format!("{host}:{port}: {e}")))?;
    let tls = TlsConnector::new();

    match security {
        TlsMode::Ssl => {
            let tls_stream = tls
                .connect(host, tcp)
                .await
                .map_err(|e| MailError::Connect(e.to_string()))?;
            login_tls_stream(tls_stream, email, secret, true).await
        }
        TlsMode::StartTls => {
            let mut client = Client::new(tcp);
            let _greeting = client
                .read_response()
                .await
                .map_err(|e| MailError::Imap(e.to_string()))?
                .ok_or_else(|| MailError::Imap("missing IMAP greeting".into()))?;
            client
                .run_command_and_check_ok("STARTTLS", None)
                .await
                .map_err(|e| MailError::Connect(e.to_string()))?;
            let tcp = client.into_inner();
            let tls_stream = tls
                .connect(host, tcp)
                .await
                .map_err(|e| MailError::Connect(e.to_string()))?;
            // No second greeting after STARTTLS.
            login_tls_stream(tls_stream, email, secret, false).await
        }
    }
}

/// Verify IMAP login works, then logout.
pub async fn test_imap(
    host: &str,
    port: u16,
    security: TlsMode,
    email: &str,
    secret: &str,
) -> Result<(), MailError> {
    let mut session = connect(host, port, security, email, secret).await?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn list_mailbox_names(session: &mut ImapSession) -> Result<Vec<MailboxMeta>, MailError> {
    let list = session
        .list(Some(""), Some("*"))
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let names: Vec<Name> = list
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;

    Ok(names
        .into_iter()
        .filter(|n| {
            !n.attributes()
                .iter()
                .any(|a| matches!(a, NameAttribute::NoSelect))
        })
        .map(|n| {
            let imap_path = n.name().to_string();
            let name = decode_imap_utf7(&imap_path);
            let role = guess_role(&name, n.attributes())
                .or_else(|| guess_role(&imap_path, n.attributes()));
            MailboxMeta {
                name,
                imap_path,
                role,
            }
        })
        .collect())
}

#[derive(Debug, Clone)]
pub struct EnvelopeFetch {
    pub uid: u32,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub list_unsubscribe: Option<String>,
    pub list_id: Option<String>,
    pub precedence: Option<String>,
    pub auto_submitted: Option<String>,
    pub x_mailer: Option<String>,
    pub date: Option<String>,
    pub unseen: bool,
    pub starred: bool,
    pub snippet: Option<String>,
}

/// Pull a single header value from raw RFC822 header bytes (case-insensitive name).
fn header_field(raw: &[u8], name: &str) -> Option<String> {
    let text = String::from_utf8_lossy(raw);
    let want = name.to_ascii_lowercase();
    let mut current_name: Option<String> = None;
    let mut current_val = String::new();
    let mut found: Option<String> = None;

    for line in text.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            if current_name.is_some() {
                current_val.push(' ');
                current_val.push_str(line.trim());
            }
            continue;
        }
        if let Some(n) = current_name.take() {
            if n == want {
                let v = current_val.trim().to_string();
                if !v.is_empty() {
                    found = Some(v);
                }
            }
        }
        current_val.clear();
        if let Some((n, v)) = line.split_once(':') {
            current_name = Some(n.trim().to_ascii_lowercase());
            current_val.push_str(v.trim());
        }
    }
    if let Some(n) = current_name {
        if n == want {
            let v = current_val.trim().to_string();
            if !v.is_empty() {
                found = Some(v);
            }
        }
    }
    found
}

fn addr_list_to_string(
    addrs: &Option<Vec<async_imap::imap_proto::types::Address<'_>>>,
) -> Option<String> {
    let list = addrs.as_ref()?;
    let joined = list
        .iter()
        .map(|a| {
            let mailbox = a
                .mailbox
                .as_ref()
                .map(|m| String::from_utf8_lossy(m).into_owned())
                .unwrap_or_default();
            let host = a
                .host
                .as_ref()
                .map(|h| String::from_utf8_lossy(h).into_owned())
                .unwrap_or_default();
            let email = if mailbox.is_empty() {
                host
            } else if host.is_empty() {
                mailbox
            } else {
                format!("{mailbox}@{host}")
            };
            let name = a
                .name
                .as_ref()
                .map(|n| decode_mime_header(&String::from_utf8_lossy(n)))
                .map(|n| n.trim().replace('"', "'"))
                .unwrap_or_default();
            if name.is_empty() || name.eq_ignore_ascii_case(&email) {
                email
            } else {
                format!("\"{name}\" <{email}>")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

pub async fn fetch_envelopes(
    session: &mut ImapSession,
    mailbox: &str,
    uid_set: &str,
) -> Result<(u32, Option<u32>, Vec<EnvelopeFetch>), MailError> {
    let mailbox_status = session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;

    let uidvalidity = mailbox_status.uid_validity.unwrap_or(0);
    let uidnext = mailbox_status.uid_next;

    // ENVELOPE + select headers for threading / Smart Inbox (no full body).
    let fetches = session
        .uid_fetch(
            uid_set,
            "(UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES LIST-UNSUBSCRIBE LIST-ID PRECEDENCE AUTO-SUBMITTED X-MAILER)] BODY.PEEK[TEXT]<0.512>)",
        )
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let items: Vec<Fetch> = fetches
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;

    let mut out = Vec::with_capacity(items.len());
    for f in items {
        let Some(uid) = f.uid else { continue };
        let unseen = !f.flags().any(|fl| matches!(fl, Flag::Seen));
        let starred = f.flags().any(|fl| matches!(fl, Flag::Flagged));

        let (subject, from, to, cc, message_id, in_reply_to, date) =
            if let Some(env) = f.envelope() {
                let subject = env.subject.as_ref().map(|b| {
                    decode_mime_header(&String::from_utf8_lossy(b))
                });
                let from = addr_list_to_string(&env.from).map(|s| decode_mime_header(&s));
                let to = addr_list_to_string(&env.to).map(|s| decode_mime_header(&s));
                let cc = addr_list_to_string(&env.cc).map(|s| decode_mime_header(&s));
                let message_id = env
                    .message_id
                    .as_ref()
                    .map(|b| String::from_utf8_lossy(b).into_owned());
                let in_reply_to = env
                    .in_reply_to
                    .as_ref()
                    .map(|b| String::from_utf8_lossy(b).into_owned());
                let date = env
                    .date
                    .as_ref()
                    .and_then(|b| {
                        three_mail_core::normalize_mail_date(&String::from_utf8_lossy(b))
                    });
                (subject, from, to, cc, message_id, in_reply_to, date)
            } else {
                (None, None, None, None, None, None, None)
            };

        let hdr = f.header().unwrap_or(&[]);
        out.push(EnvelopeFetch {
            uid,
            subject,
            from,
            to,
            cc,
            message_id,
            in_reply_to,
            references: header_field(hdr, "References"),
            list_unsubscribe: header_field(hdr, "List-Unsubscribe"),
            list_id: header_field(hdr, "List-Id"),
            precedence: header_field(hdr, "Precedence"),
            auto_submitted: header_field(hdr, "Auto-Submitted"),
            x_mailer: header_field(hdr, "X-Mailer"),
            date: date.or_else(|| {
                f.internal_date()
                    .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339())
            }),
            unseen,
            starred,
            snippet: f.text().and_then(|bytes| {
                let raw = String::from_utf8_lossy(bytes);
                crate::snippet_text(Some(raw.as_ref()), None)
            }),
        });
    }

    Ok((uidvalidity, uidnext, out))
}

/// SELECT mailbox and return (uidvalidity, uidnext) without fetching.
pub async fn select_mailbox(
    session: &mut ImapSession,
    mailbox: &str,
) -> Result<(u32, Option<u32>), MailError> {
    let status = session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok((
        status.uid_validity.unwrap_or(0),
        status.uid_next,
    ))
}

pub async fn fetch_raw_message(
    session: &mut ImapSession,
    mailbox: &str,
    uid: u32,
) -> Result<Vec<u8>, MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;

    let fetches = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let items: Vec<Fetch> = fetches
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;

    let item = items
        .into_iter()
        .next()
        .ok_or_else(|| MailError::Imap(format!("UID {uid} not found")))?;

    let body = item
        .body()
        .ok_or_else(|| MailError::Imap("message had no BODY[]".into()))?;
    Ok(body.to_vec())
}

pub async fn uid_set_seen(
    session: &mut ImapSession,
    mailbox: &str,
    uid: u32,
    seen: bool,
) -> Result<(), MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let query = if seen {
        "+FLAGS.SILENT (\\Seen)"
    } else {
        "-FLAGS.SILENT (\\Seen)"
    };
    let updates = session
        .uid_store(uid.to_string(), query)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _: Vec<_> = updates
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok(())
}

pub async fn uid_set_flagged(
    session: &mut ImapSession,
    mailbox: &str,
    uid: u32,
    flagged: bool,
) -> Result<(), MailError> {
    uids_set_flagged(session, mailbox, &uid.to_string(), flagged).await
}

pub async fn uids_set_flagged(
    session: &mut ImapSession,
    mailbox: &str,
    uid_set: &str,
    flagged: bool,
) -> Result<(), MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let query = if flagged {
        "+FLAGS.SILENT (\\Flagged)"
    } else {
        "-FLAGS.SILENT (\\Flagged)"
    };
    let updates = session
        .uid_store(uid_set, query)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _: Vec<_> = updates
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok(())
}

pub async fn uid_move_to(
    session: &mut ImapSession,
    mailbox: &str,
    uid: u32,
    target: &str,
) -> Result<(), MailError> {
    uids_move_to(session, mailbox, &uid.to_string(), target).await
}

/// MOVE a UID set (`1,2,5`) in one command. Falls back to COPY + expunge.
pub async fn uids_move_to(
    session: &mut ImapSession,
    mailbox: &str,
    uid_set: &str,
    target: &str,
) -> Result<(), MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    match session.uid_mv(uid_set, target).await {
        Ok(()) => Ok(()),
        Err(_) => {
            session
                .uid_copy(uid_set, target)
                .await
                .map_err(|e| MailError::Imap(e.to_string()))?;
            expunge_uid(session, uid_set).await
        }
    }
}

/// STORE \\Seen on a UID set in one command.
pub async fn uids_set_seen(
    session: &mut ImapSession,
    mailbox: &str,
    uid_set: &str,
    seen: bool,
) -> Result<(), MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let query = if seen {
        "+FLAGS.SILENT (\\Seen)"
    } else {
        "-FLAGS.SILENT (\\Seen)"
    };
    let updates = session
        .uid_store(uid_set, query)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _: Vec<_> = updates
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok(())
}

/// Flag a UID set in the currently selected mailbox as deleted and expunge.
async fn expunge_uid(session: &mut ImapSession, uid_set: &str) -> Result<(), MailError> {
    let updates = session
        .uid_store(uid_set, "+FLAGS.SILENT (\\Deleted)")
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _: Vec<_> = updates
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let expunge = session
        .expunge()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _: Vec<_> = expunge
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok(())
}

/// Permanently remove one message (used after it was appended to another account).
pub async fn uid_delete(session: &mut ImapSession, mailbox: &str, uid: u32) -> Result<(), MailError> {
    session
        .select(mailbox)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    expunge_uid(session, &uid.to_string()).await
}

/// Store a raw RFC 822 message in `mailbox`, keeping its read / starred state.
pub async fn append_message(
    session: &mut ImapSession,
    mailbox: &str,
    raw: &[u8],
    seen: bool,
    flagged: bool,
) -> Result<(), MailError> {
    let flags: Vec<&str> = [(seen, "\\Seen"), (flagged, "\\Flagged")]
        .into_iter()
        .filter_map(|(on, f)| on.then_some(f))
        .collect();
    let flags = (!flags.is_empty()).then(|| format!("({})", flags.join(" ")));
    session
        .append(mailbox, flags.as_deref(), None, raw)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))
}

/// Server hierarchy delimiter (`/` or `.` on most servers).
pub async fn mailbox_delimiter(session: &mut ImapSession) -> Result<Option<String>, MailError> {
    let list = session
        .list(Some(""), Some(""))
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let names: Vec<Name> = list
        .try_collect()
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    Ok(names.first().and_then(|n| n.delimiter()).map(str::to_string))
}

/// CREATE (and best-effort SUBSCRIBE) a mailbox by its wire name.
pub async fn create_mailbox(session: &mut ImapSession, imap_path: &str) -> Result<(), MailError> {
    session
        .create(imap_path)
        .await
        .map_err(|e| MailError::Imap(e.to_string()))?;
    let _ = session.subscribe(imap_path).await;
    Ok(())
}

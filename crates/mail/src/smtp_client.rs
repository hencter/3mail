use lettre::message::header::{InReplyTo, References};
use lettre::message::{Mailbox, MessageBuilder, MultiPart, SinglePart};

use crate::attachments::{attach_files, MailAttachment};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use thiserror::Error;

use three_mail_core::{Error as CoreError, TlsMode};

#[derive(Debug, Error)]
pub enum SmtpError {
    #[error("smtp: {0}")]
    Smtp(String),
    #[error("message build: {0}")]
    Build(String),
}

impl From<SmtpError> for CoreError {
    fn from(value: SmtpError) -> Self {
        CoreError::Mail(value.to_string())
    }
}

fn build_transport(
    host: &str,
    port: u16,
    security: TlsMode,
    username: &str,
    secret: &str,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, SmtpError> {
    let creds = Credentials::new(username.to_string(), secret.to_string());
    let builder = match security {
        TlsMode::Ssl => AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .map_err(|e| SmtpError::Smtp(e.to_string()))?,
        TlsMode::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .map_err(|e| SmtpError::Smtp(e.to_string()))?,
    };
    Ok(builder.port(port).credentials(creds).build())
}

pub async fn test_smtp(
    host: &str,
    port: u16,
    security: TlsMode,
    username: &str,
    secret: &str,
) -> Result<(), SmtpError> {
    let mailer = build_transport(host, port, security, username, secret)?;
    let ok = mailer
        .test_connection()
        .await
        .map_err(|e| SmtpError::Smtp(e.to_string()))?;
    if !ok {
        return Err(SmtpError::Smtp("NOOP failed".into()));
    }
    Ok(())
}

pub async fn send_text_mail(
    host: &str,
    port: u16,
    security: TlsMode,
    username: &str,
    secret: &str,
    from: &str,
    to: &[String],
    cc: &[String],
    subject: &str,
    body: &str,
) -> Result<(), SmtpError> {
    send_mail_with_headers(
        host,
        port,
        security,
        username,
        secret,
        from,
        to,
        cc,
        &[],
        subject,
        body,
        None,
        None,
        None,
        &[],
    )
    .await
    .map(|_| ())
}

pub async fn send_mail_with_headers(
    host: &str,
    port: u16,
    security: TlsMode,
    username: &str,
    secret: &str,
    from: &str,
    to: &[String],
    cc: &[String],
    bcc: &[String],
    subject: &str,
    body: &str,
    html: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
    attachments: &[MailAttachment],
) -> Result<Vec<u8>, SmtpError> {
    let email = build_message(
        from,
        to,
        cc,
        bcc,
        subject,
        body,
        html,
        in_reply_to,
        references,
        None,
        attachments,
    )?;
    let raw = email.formatted();
    let mailer = build_transport(host, port, security, username, secret)?;
    mailer
        .send(email)
        .await
        .map_err(|e| SmtpError::Smtp(e.to_string()))?;
    Ok(raw)
}

/// Build RFC 822 bytes for IMAP APPEND (drafts / sent copy) without sending.
#[allow(clippy::too_many_arguments)]
pub fn build_rfc822_bytes(
    from: &str,
    to: &[String],
    cc: &[String],
    bcc: &[String],
    subject: &str,
    body: &str,
    html: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
    message_id: Option<&str>,
    attachments: &[MailAttachment],
) -> Result<Vec<u8>, SmtpError> {
    build_message(
        from,
        to,
        cc,
        bcc,
        subject,
        body,
        html,
        in_reply_to,
        references,
        message_id,
        attachments,
    )
    .map(|m| m.formatted())
}

#[allow(clippy::too_many_arguments)]
fn build_message(
    from: &str,
    to: &[String],
    cc: &[String],
    bcc: &[String],
    subject: &str,
    body: &str,
    html: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
    message_id: Option<&str>,
    attachments: &[MailAttachment],
) -> Result<Message, SmtpError> {
    let from_mb: Mailbox = from
        .parse()
        .map_err(|e: lettre::address::AddressError| SmtpError::Build(e.to_string()))?;

    let mut builder = MessageBuilder::new().from(from_mb).subject(subject);
    if let Some(irt) = in_reply_to.filter(|s| !s.is_empty()) {
        builder = builder.header(InReplyTo::from(irt.to_string()));
    }
    if let Some(refs) = references.filter(|s| !s.is_empty()) {
        builder = builder.header(References::from(refs.to_string()));
    }
    if let Some(mid) = message_id.filter(|s| !s.is_empty()) {
        builder = builder.message_id(Some(mid.to_string()));
    }

    for addr in to {
        let mb: Mailbox = addr
            .parse()
            .map_err(|e: lettre::address::AddressError| SmtpError::Build(e.to_string()))?;
        builder = builder.to(mb);
    }
    for addr in cc {
        let mb: Mailbox = addr
            .parse()
            .map_err(|e: lettre::address::AddressError| SmtpError::Build(e.to_string()))?;
        builder = builder.cc(mb);
    }
    for addr in bcc {
        let mb: Mailbox = addr
            .parse()
            .map_err(|e: lettre::address::AddressError| SmtpError::Build(e.to_string()))?;
        builder = builder.bcc(mb);
    }

    if attachments.is_empty() {
        return match html.filter(|h| !h.trim().is_empty()) {
            Some(html) => builder.multipart(MultiPart::alternative_plain_html(
                body.to_string(),
                html.to_string(),
            )),
            None => builder.body(body.to_string()),
        }
        .map_err(|e| SmtpError::Build(e.to_string()));
    }

    let mixed = match html.filter(|h| !h.trim().is_empty()) {
        Some(html) => MultiPart::mixed().multipart(MultiPart::alternative_plain_html(
            body.to_string(),
            html.to_string(),
        )),
        None => MultiPart::mixed().singlepart(SinglePart::plain(body.to_string())),
    };
    let mixed = attach_files(mixed, attachments).map_err(SmtpError::Build)?;
    builder
        .multipart(mixed)
        .map_err(|e| SmtpError::Build(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_names_with_commas_and_html_alternative() {
        let msg = build_message(
            "\"Lawrence Huang\" <lawrence@bioeast.com>",
            &["\"Zhu, Izzy\" <izzy@informa.com>".to_string()],
            &[],
            &[],
            "Re: 运输通知",
            "hello",
            Some("<p>hello</p>"),
            Some("<a@b>"),
            None,
            None,
            &[],
        )
        .expect("message builds");
        let raw = String::from_utf8(msg.formatted()).unwrap();
        assert!(raw.contains("multipart/alternative"), "{raw}");
        assert!(raw.contains("izzy@informa.com"));
        assert!(raw.contains("text/html"));
    }

    #[test]
    fn multipart_mixed_with_attachment() {
        let dir = std::env::temp_dir().join(format!("3mail-att-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("note.txt");
        std::fs::write(&file, b"attached bytes").expect("write temp");

        let msg = build_message(
            "\"Lawrence Huang\" <lawrence@bioeast.com>",
            &["to@example.com".to_string()],
            &[],
            &[],
            "Files",
            "see attachment",
            None,
            None,
            None,
            Some("<draft-test@3mail>"),
            &[MailAttachment {
                path: file.to_string_lossy().into_owned(),
                filename: "note.txt".to_string(),
                mime_type: "text/plain".to_string(),
            }],
        )
        .expect("message builds");
        let raw = String::from_utf8(msg.formatted()).unwrap();
        assert!(raw.contains("multipart/mixed"), "{raw}");
        assert!(raw.contains("attached bytes"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

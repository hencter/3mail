use lettre::message::header::{InReplyTo, References};
use lettre::message::{Mailbox, MessageBuilder, MultiPart};
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
        host, port, security, username, secret, from, to, cc, &[], subject, body, None, None, None,
    )
    .await
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
) -> Result<(), SmtpError> {
    let email = build_message(from, to, cc, bcc, subject, body, html, in_reply_to, references)?;
    let mailer = build_transport(host, port, security, username, secret)?;
    mailer
        .send(email)
        .await
        .map_err(|e| SmtpError::Smtp(e.to_string()))?;
    Ok(())
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

    match html.filter(|h| !h.trim().is_empty()) {
        Some(html) => builder.multipart(MultiPart::alternative_plain_html(
            body.to_string(),
            html.to_string(),
        )),
        None => builder.body(body.to_string()),
    }
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
        )
        .expect("message builds");
        let raw = String::from_utf8(msg.formatted()).unwrap();
        assert!(raw.contains("multipart/alternative"), "{raw}");
        assert!(raw.contains("izzy@informa.com"));
        assert!(raw.contains("text/html"));
    }
}

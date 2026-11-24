//! Parse RFC822 bytes into text/html + attachment metadata (no network).

use mail_parser::{MessageParser, MimeHeaders, PartType};

#[derive(Debug, Clone, Default)]
pub struct ParsedHeaders {
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub list_unsubscribe: Option<String>,
    pub list_id: Option<String>,
    pub precedence: Option<String>,
    pub auto_submitted: Option<String>,
    pub x_mailer: Option<String>,
    pub from: Option<String>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedMail {
    pub text_body: Option<String>,
    pub html_body: Option<String>,
    pub attachments: Vec<ParsedAttachment>,
    pub headers: ParsedHeaders,
}

#[derive(Debug, Clone)]
pub struct ParsedAttachment {
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub part_id: String,
    /// Normalized Content-ID (no angle brackets), for matching `cid:` in HTML.
    pub content_id: Option<String>,
    pub bytes: Vec<u8>,
}

pub fn normalize_content_id(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '<' || c == '>')
        .to_lowercase()
}

fn header_text(msg: &mail_parser::Message<'_>, name: &str) -> Option<String> {
    let hv = msg.header(name)?;
    if let Some(t) = hv.as_text() {
        return Some(t.to_string());
    }
    if let Some(list) = hv.as_text_list() {
        return Some(list.join(" "));
    }
    msg.header_raw(name).map(|s| s.to_string())
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            out.push(' ');
            continue;
        }
        if !in_tag {
            out.push(ch);
        }
    }
    out
}

/// One-line list preview, aligned with Classic `shortBody`.
pub fn snippet_text(text: Option<&str>, html: Option<&str>) -> Option<String> {
    let source = text
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| html.map(strip_tags))?;
    let flat = source.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return None;
    }
    let mut short: String = flat.chars().take(160).collect();
    if flat.chars().count() > 160 {
        short.push('…');
    }
    Some(short)
}

pub fn parse_rfc822(raw: &[u8]) -> ParsedMail {
    let Some(msg) = MessageParser::default().parse(raw) else {
        return ParsedMail {
            text_body: Some(String::from_utf8_lossy(raw).into_owned()),
            html_body: None,
            attachments: Vec::new(),
            headers: ParsedHeaders::default(),
        };
    };

    let text_body = msg.body_text(0).map(|s| s.to_string());
    let html_body = msg.body_html(0).map(|s| s.to_string());

    let headers = ParsedHeaders {
        message_id: msg.message_id().map(|s| s.to_string()),
        in_reply_to: msg.in_reply_to().as_text().map(|s| s.to_string()),
        references: msg.references().as_text_list().map(|v| v.join(" ")),
        list_unsubscribe: header_text(&msg, "List-Unsubscribe"),
        list_id: header_text(&msg, "List-Id"),
        precedence: header_text(&msg, "Precedence"),
        auto_submitted: header_text(&msg, "Auto-Submitted"),
        x_mailer: header_text(&msg, "X-Mailer").or_else(|| header_text(&msg, "User-Agent")),
        from: msg.from().and_then(|a| {
            a.first().and_then(|addr| {
                let email = addr.address()?.to_string();
                let name = addr.name().map(|n| n.trim().replace('"', "'")).unwrap_or_default();
                Some(if name.is_empty() || name.eq_ignore_ascii_case(&email) {
                    email
                } else {
                    format!("\"{name}\" <{email}>")
                })
            })
        }),
        subject: msg.subject().map(|s| s.to_string()),
    };

    let mut attachments = Vec::new();
    for (idx, part) in msg.attachments().enumerate() {
        let filename = part.attachment_name().map(|s| s.to_string()).or_else(|| {
            part.content_type().and_then(|c| {
                c.attributes.as_ref().and_then(|attrs| {
                    attrs
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("name"))
                        .map(|(_, v)| v.to_string())
                })
            })
        });
        let mime_type = part.content_type().map(|ct| match &ct.c_subtype {
            Some(st) => format!("{}/{}", ct.c_type, st),
            None => ct.c_type.to_string(),
        });
        let bytes = match &part.body {
            PartType::Text(t) => t.as_bytes().to_vec(),
            PartType::Binary(b) | PartType::InlineBinary(b) => b.to_vec(),
            PartType::Html(h) => h.as_bytes().to_vec(),
            _ => continue,
        };
        let size_bytes = Some(bytes.len() as i64);
        let content_id = part.content_id().map(normalize_content_id);
        attachments.push(ParsedAttachment {
            filename,
            mime_type,
            size_bytes,
            part_id: idx.to_string(),
            content_id,
            bytes,
        });
    }

    ParsedMail {
        text_body,
        html_body,
        attachments,
        headers,
    }
}

//! Local Smart Inbox heuristics (header / address rules).
//! No cloud ML — person / notification / newsletter / other.

use three_mail_core::MessageCategory;

#[derive(Debug, Clone, Default)]
pub struct ClassifyInput<'a> {
    pub from_addr: Option<&'a str>,
    pub subject: Option<&'a str>,
    pub list_unsubscribe: Option<&'a str>,
    pub precedence: Option<&'a str>,
    pub auto_submitted: Option<&'a str>,
    pub list_id: Option<&'a str>,
    pub x_mailer: Option<&'a str>,
}

/// Classify a message into a Smart Inbox bucket.
pub fn classify_message(input: &ClassifyInput<'_>) -> MessageCategory {
    if input.list_unsubscribe.map(str::trim).is_some_and(|s| !s.is_empty())
        || input.list_id.map(str::trim).is_some_and(|s| !s.is_empty())
    {
        return MessageCategory::Newsletter;
    }

    let precedence = input.precedence.unwrap_or("").to_ascii_lowercase();
    if precedence.contains("bulk") || precedence.contains("list") || precedence.contains("junk") {
        return MessageCategory::Newsletter;
    }

    let auto = input.auto_submitted.unwrap_or("").to_ascii_lowercase();
    if !auto.is_empty() && auto != "no" {
        return MessageCategory::Notification;
    }

    let from = input.from_addr.unwrap_or("").to_ascii_lowercase();
    let subject = input.subject.unwrap_or("").to_ascii_lowercase();

    if looks_like_noreply(&from) || looks_like_notification_subject(&subject) {
        return MessageCategory::Notification;
    }

    if looks_like_automated_mailer(input.x_mailer) {
        return MessageCategory::Notification;
    }

    if from.contains('@') && !looks_like_noreply(&from) {
        return MessageCategory::Person;
    }

    MessageCategory::Other
}

fn looks_like_noreply(from: &str) -> bool {
    const MARKERS: &[&str] = &[
        "noreply@",
        "no-reply@",
        "no_reply@",
        "donotreply@",
        "do-not-reply@",
        "notifications@",
        "notification@",
        "alert@",
        "alerts@",
        "mailer-daemon@",
        "postmaster@",
        "newsletter@",
        "news@",
        "digest@",
        "updates@",
        "billing@",
        "receipts@",
        "invoice@",
        "support@",
        "help@",
        "info@",
        "marketing@",
        "promo@",
        "campaign@",
    ];
    MARKERS.iter().any(|m| from.contains(m))
}

fn looks_like_notification_subject(subject: &str) -> bool {
    const MARKERS: &[&str] = &[
        "verification code",
        "verify your",
        "security alert",
        "password reset",
        "your order",
        "shipment",
        "receipt",
        "invoice #",
        "payment received",
        "signed in",
        "new login",
        "two-factor",
        "2fa",
        "[alert]",
        "unsubscribe",
    ];
    MARKERS.iter().any(|m| subject.contains(m))
}

fn looks_like_automated_mailer(x_mailer: Option<&str>) -> bool {
    let Some(m) = x_mailer.map(|s| s.to_ascii_lowercase()) else {
        return false;
    };
    m.contains("mailchimp")
        || m.contains("sendgrid")
        || m.contains("postmark")
        || m.contains("mandrill")
        || m.contains("amazon ses")
}

/// Extract a stable thread key from Message-ID / In-Reply-To / References.
pub fn thread_key(
    message_id: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
) -> Option<String> {
    if let Some(refs) = references {
        if let Some(first) = first_message_id(refs) {
            return Some(normalize_msgid(&first));
        }
    }
    if let Some(irt) = in_reply_to {
        if let Some(id) = first_message_id(irt) {
            return Some(normalize_msgid(&id));
        }
    }
    message_id
        .and_then(|s| first_message_id(s))
        .map(|s| normalize_msgid(&s))
}

fn first_message_id(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Prefer `<id@host>` token.
    if let Some(start) = s.find('<') {
        if let Some(end) = s[start..].find('>') {
            let id = &s[start..start + end + 1];
            return Some(id.to_string());
        }
    }
    s.split_whitespace().next().map(|t| t.to_string())
}

fn normalize_msgid(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newsletter_via_list_unsub() {
        let c = classify_message(&ClassifyInput {
            from_addr: Some("editor@news.example"),
            list_unsubscribe: Some("<mailto:unsub@news.example>"),
            ..Default::default()
        });
        assert_eq!(c, MessageCategory::Newsletter);
    }

    #[test]
    fn notification_noreply() {
        let c = classify_message(&ClassifyInput {
            from_addr: Some("noreply@github.com"),
            subject: Some("You have a new mention"),
            ..Default::default()
        });
        assert_eq!(c, MessageCategory::Notification);
    }

    #[test]
    fn person_normal() {
        let c = classify_message(&ClassifyInput {
            from_addr: Some("alice@example.com"),
            subject: Some("Lunch tomorrow?"),
            ..Default::default()
        });
        assert_eq!(c, MessageCategory::Person);
    }

    #[test]
    fn thread_key_from_references() {
        let k = thread_key(
            Some("<c@x>"),
            Some("<b@x>"),
            Some("<a@x> <b@x>"),
        );
        assert_eq!(k.as_deref(), Some("<a@x>"));
    }
}

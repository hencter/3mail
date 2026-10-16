//! Small, protocol-agnostic helpers for header values that every crate needs to agree on.

use chrono::{DateTime, Utc};

/// Message `Date:` values are RFC 2822 in the wild (often with a trailing `(CST)` comment,
/// doubled spaces, or a missing weekday). Returns UTC RFC 3339, or `None` if unparseable.
pub fn normalize_mail_date(raw: &str) -> Option<String> {
    parse_mail_date(raw).map(|d| d.to_rfc3339())
}

pub fn parse_mail_date(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(d.with_timezone(&Utc));
    }
    let no_comment = match trimmed.find('(') {
        Some(i) => trimmed[..i].trim(),
        None => trimmed,
    };
    let collapsed = no_comment.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Ok(d) = DateTime::parse_from_rfc2822(&collapsed) {
        return Some(d.with_timezone(&Utc));
    }
    for fmt in [
        "%a, %d %b %Y %H:%M:%S %z",
        "%d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M %z",
        "%d %b %Y %H:%M %z",
    ] {
        if let Ok(d) = DateTime::parse_from_str(&collapsed, fmt) {
            return Some(d.with_timezone(&Utc));
        }
    }
    None
}

/// Split `a@x, "Zhu, Izzy" <b@y>; c@z` on commas/semicolons that are outside quotes and `<>`.
pub fn split_addr_list(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    let mut in_angle = false;
    let mut prev_backslash = false;
    for ch in raw.chars() {
        match ch {
            '"' if !prev_backslash => in_quote = !in_quote,
            '<' if !in_quote => in_angle = true,
            '>' if !in_quote => in_angle = false,
            ',' | ';' if !in_quote && !in_angle => {
                let item = cur.trim();
                if !item.is_empty() {
                    out.push(item.to_string());
                }
                cur.clear();
                prev_backslash = false;
                continue;
            }
            _ => {}
        }
        prev_backslash = ch == '\\' && !prev_backslash;
        cur.push(ch);
    }
    let item = cur.trim();
    if !item.is_empty() {
        out.push(item.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(
            normalize_mail_date("Tue, 22 Sep 2026 17:16:00 +0800").as_deref(),
            Some("2026-09-22T09:16:00+00:00")
        );
        assert_eq!(
            normalize_mail_date("22 Sep 2026 17:16:00 +0800 (CST)").as_deref(),
            Some("2026-09-22T09:16:00+00:00")
        );
        assert_eq!(
            normalize_mail_date("Tue,  1 Sep 2026 07:05:09 -0700").as_deref(),
            Some("2026-09-01T14:05:09+00:00")
        );
        assert_eq!(
            normalize_mail_date("2026-09-22T09:16:00Z").as_deref(),
            Some("2026-09-22T09:16:00+00:00")
        );
        assert_eq!(normalize_mail_date("garbage"), None);
    }

    #[test]
    fn addrs() {
        assert_eq!(
            split_addr_list(r#""Zhu, Izzy" <izzy@x.com>, b@y.com; "A \"q\", B" <c@z>"#),
            vec![
                r#""Zhu, Izzy" <izzy@x.com>"#.to_string(),
                "b@y.com".to_string(),
                r#""A \"q\", B" <c@z>"#.to_string(),
            ]
        );
    }
}

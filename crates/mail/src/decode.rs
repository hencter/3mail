//! Decode IMAP Modified UTF-7 mailbox names and RFC 2047 encoded-words (Subject etc.).

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use mail_parser::MessageParser;

/// Decode IMAP mailbox name from Modified UTF-7 (RFC 3501) to Unicode.
/// Leaves already-decoded UTF-8 strings unchanged when no `&…-` segments exist.
pub fn decode_imap_utf7(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }

    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            // Copy one UTF-8 char.
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        i += 1; // skip '&'
        if i < bytes.len() && bytes[i] == b'-' {
            out.push('&');
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i] != b'-' {
            i += 1;
        }
        let encoded = &input[start..i];
        if i < bytes.len() && bytes[i] == b'-' {
            i += 1;
        }
        // Modified Base64: ',' → '/'
        let mut b64: String = encoded.chars().map(|c| if c == ',' { '/' } else { c }).collect();
        while b64.len() % 4 != 0 {
            b64.push('=');
        }
        match B64.decode(b64.as_bytes()) {
            Ok(raw) if raw.len() >= 2 && raw.len() % 2 == 0 => {
                let u16s: Vec<u16> = raw
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                out.push_str(&String::from_utf16_lossy(&u16s));
            }
            _ => {
                // Keep original segment if decode fails.
                out.push('&');
                out.push_str(encoded);
                out.push('-');
            }
        }
    }
    out
}

/// Encode a Unicode mailbox name as IMAP Modified UTF-7 (RFC 3501 §5.1.3).
pub fn encode_imap_utf7(input: &str) -> String {
    fn flush(out: &mut String, pending: &mut Vec<u16>) {
        if pending.is_empty() {
            return;
        }
        let bytes: Vec<u8> = pending.iter().flat_map(|u| u.to_be_bytes()).collect();
        let b64 = B64.encode(bytes);
        out.push('&');
        out.extend(b64.trim_end_matches('=').chars().map(|c| if c == '/' { ',' } else { c }));
        out.push('-');
        pending.clear();
    }

    let mut out = String::with_capacity(input.len());
    let mut pending: Vec<u16> = Vec::new();
    for ch in input.chars() {
        if ('\x20'..='\x7e').contains(&ch) {
            flush(&mut out, &mut pending);
            if ch == '&' {
                out.push_str("&-");
            } else {
                out.push(ch);
            }
        } else {
            let mut buf = [0u16; 2];
            pending.extend_from_slice(ch.encode_utf16(&mut buf));
        }
    }
    flush(&mut out, &mut pending);
    out
}

/// Decode RFC 2047 encoded-words in unstructured header text (Subject, etc.).
/// Supports GBK / GB2312 / UTF-8 via mail-parser charset tables.
pub fn decode_mime_header(s: &str) -> String {
    let s = s.trim();
    if s.is_empty() || !s.contains("=?") {
        return s.to_string();
    }
    // mail-parser's Subject path applies RFC 2047 decoding.
    let raw = format!("Subject: {s}\r\n\r\n");
    if let Some(msg) = MessageParser::default().parse(raw.as_bytes()) {
        if let Some(decoded) = msg.subject() {
            let t = decoded.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    s.to_string()
}

/// Convenience: decode Option subject/from display blobs.
pub fn decode_mime_header_opt(s: Option<&str>) -> Option<String> {
    s.map(|v| {
        let d = decode_mime_header(v);
        if d.is_empty() {
            v.to_string()
        } else {
            d
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf7_literal_amp() {
        assert_eq!(decode_imap_utf7("a&-b"), "a&b");
    }

    #[test]
    fn utf7_ascii_passthrough() {
        assert_eq!(decode_imap_utf7("INBOX"), "INBOX");
    }

    #[test]
    fn utf7_chinese_sample() {
        // "测试" in IMAP UTF-7
        let decoded = decode_imap_utf7("&bUuL1Q-");
        assert_eq!(decoded, "测试");
    }

    #[test]
    fn utf7_encode_roundtrip() {
        assert_eq!(encode_imap_utf7("测试"), "&bUuL1Q-");
        assert_eq!(encode_imap_utf7("R&D"), "R&-D");
        for name in ["国际展会/2027 迪拜", "Misc.", "公司通知", "a&b 发票"] {
            assert_eq!(decode_imap_utf7(&encode_imap_utf7(name)), name);
        }
    }

    #[test]
    fn rfc2047_utf8() {
        let s = "=?UTF-8?B?5Lit5paH?= ";
        assert_eq!(decode_mime_header(s), "中文");
    }

    #[test]
    fn rfc2047_gbk_base64() {
        // "通知" in GBK (0xCD A8 D6 AA) base64
        let s = "=?GBK?B?zajWqg==?=";
        let d = decode_mime_header(s);
        assert_eq!(d, "通知");
    }

    #[test]
    fn plain_passthrough() {
        assert_eq!(decode_mime_header("Hello"), "Hello");
    }
}

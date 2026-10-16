//! IMAP/SMTP adapters using mature libraries only (async-imap, lettre).
//! No hand-written protocol framing.

pub mod classify;
pub mod decode;
pub mod imap_client;
pub mod parse;
mod smtp_client;

pub use classify::{classify_message, thread_key, ClassifyInput};
pub use decode::{decode_imap_utf7, decode_mime_header, decode_mime_header_opt, encode_imap_utf7};
pub use imap_client::{
    append_message, connect, create_mailbox, fetch_envelopes, fetch_raw_message,
    list_mailbox_names, mailbox_delimiter, select_mailbox, test_imap, uid_delete, uid_move_to,
    uid_set_flagged, uid_set_seen, uids_move_to, uids_set_flagged, uids_set_seen, EnvelopeFetch,
    ImapSession,
    MailboxMeta,
};
pub use parse::{parse_rfc822, snippet_text, ParsedAttachment, ParsedMail};
pub use smtp_client::{send_mail_with_headers, send_text_mail, test_smtp};

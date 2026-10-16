//! SQLite access: migrations and read/write helpers.
//! Network IO must never happen while holding a write transaction.

mod migrations;
mod queries;
mod store;

pub use queries::{
    account_keyring_user, clear_folder_messages, delete_account, delete_draft, delete_message_row,
    delete_outbox, delete_signature, enqueue_outbox, find_account_by_email, find_folder_by_role, get_folder,
    get_account, get_attachment, get_message, get_outbox_account, get_sender_category_override,
    get_signature, get_sync_state, insert_account, is_category_manual, list_accounts,
    list_attachments, list_drafts, list_due_outbox, list_folders, list_messages, list_outbox,
    list_pinned_messages, local_only_pins, mark_local_pins_flagged,
    list_signatures, list_thread_messages, list_threads, message_envelope_fields,
    message_imap_coords, refresh_folder_counts, reindex_message_fts, replace_attachments,
    redecode_mime_subjects, save_draft, search_messages, set_attachment_path,
    set_message_category, set_message_headers_from_parse, set_message_list_unsubscribe,
    set_message_seen, set_message_snippet, set_message_starred, set_message_thread_key, set_outbox_status, set_pinned,
    set_snooze, set_sync_state, thread_imap_coords, unsnooze_due, update_account, upsert_body, upsert_folder,
    upsert_message_envelope, upsert_sender_category, upsert_signature, AttachmentRow,
    EnvelopeUpsert, MessageImapCoords,
};
pub use store::{Db, DbError};

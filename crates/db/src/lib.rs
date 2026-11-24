//! SQLite access: migrations and read/write helpers.
//! Network IO must never happen while holding a write transaction.

mod migrations;
mod queries;
mod store;

pub use queries::{
    account_keyring_user, attachment_id_by_part, clear_folder_messages, clear_flag_retry,
    count_flag_retries, delete_account, delete_draft, delete_message_row,
    draft_source_message, ensure_draft_message_id, find_message_by_header, get_draft,
    set_draft_server_link,
    delete_outbox, delete_signature, enqueue_outbox, find_account_by_email, find_folder_by_role, get_folder,
    bump_sender_category_stat, get_account, get_attachment, get_message, get_outbox_account,
    get_sender_category_override, get_sender_learned_category,
    get_signature, get_sync_state, insert_account, is_category_manual, list_accounts,
    list_attachments, list_drafts, list_due_outbox, list_flag_retries, list_folders, list_messages,
    list_outbox,
    list_pinned_messages, local_only_pins, mark_local_pins_flagged,
    list_correspondence, list_signatures, list_thread_messages, list_threads, message_envelope_fields,
    message_imap_coords, refresh_folder_counts, reindex_message_fts, replace_attachments,
    redecode_mime_subjects, save_draft, search_messages, set_attachment_path,
    set_message_category, set_message_headers_from_parse, set_message_list_unsubscribe,
    set_message_seen, set_message_snippet, set_message_starred, set_message_thread_key,     set_outbox_attachments_json,
    set_outbox_status, set_pinned, upsert_flag_retry,
    set_snooze, set_sync_state, thread_imap_coords, unsnooze_due, update_account, upsert_body, upsert_folder,
    upsert_message_envelope, upsert_sender_category, upsert_signature, AttachmentRow,
    EnvelopeUpsert, MessageImapCoords,
};
pub use store::{Db, DbError};

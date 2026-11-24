export type TlsMode = "ssl" | "starttls";

export type Account = {
  id: number;
  email: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_security: TlsMode;
  smtp_host: string;
  smtp_port: number;
  smtp_security: TlsMode;
};

export type Folder = {
  id: number;
  account_id: number;
  name: string;
  imap_path: string;
  role: string | null;
  unseen_count: number;
  total_count: number;
  synced: boolean;
};

export type MessageListItem = {
  id: number;
  account_id: number;
  folder_id: number;
  uid: number;
  subject: string | null;
  from_addr: string | null;
  date: string | null;
  unseen: boolean;
  starred: boolean;
  has_attachments: boolean;
  snippet: string | null;
  category: string;
  pinned: boolean;
  snoozed: boolean;
  snooze_until: string | null;
  thread_key: string | null;
  thread_count: number | null;
};

export type ThreadSummary = {
  thread_key: string;
  account_id: number;
  folder_id: number;
  subject: string | null;
  from_addr: string | null;
  date: string | null;
  unseen: boolean;
  starred: boolean;
  pinned: boolean;
  category: string;
  snippet: string | null;
  has_attachments: boolean;
  message_count: number;
  latest_message_id: number;
};

export type Signature = {
  id: number;
  account_id: number;
  name: string;
  body_text: string;
  body_html: string | null;
  is_default: boolean;
};

export type Draft = {
  id: number;
  account_id: number;
  to_addrs: string;
  cc_addrs: string;
  bcc_addrs: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  updated_at: string | null;
  source_message_id: number | null;
};

export type OutboxItem = {
  id: number;
  account_id: number;
  to_addrs: string;
  cc_addrs: string | null;
  bcc_addrs: string | null;
  subject: string;
  text_body: string;
  status: string;
  send_at: string | null;
  last_error: string | null;
};

export type Attachment = {
  id: number;
  message_id: number;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  downloaded: boolean;
  content_id?: string | null;
  part_id?: string | null;
  local_path?: string | null;
};

export type MessageDetail = {
  list: MessageListItem;
  text_body: string | null;
  html_body: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  message_id_header?: string | null;
  in_reply_to?: string | null;
  references_header?: string | null;
  body_loaded: boolean;
  attachments: Attachment[];
};

export type AccountForm = {
  email: string;
  secret: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  imap_security: TlsMode;
  smtp_host: string;
  smtp_port: number;
  smtp_security: TlsMode;
};

export type CategoryFilter = "all" | "person" | "notification" | "newsletter" | "other" | "snoozed";

export type MailPane = "mail" | "pins" | "drafts" | "outbox";

export type SettingsPage = "accounts" | "signatures" | "shortcuts" | "appearance";

export type SmartFolderId = "attachments" | "today-unread";

export type Nav =
  | { kind: "role"; role: string; accountId: number | null }
  | { kind: "snoozed"; accountId: number | null }
  | { kind: "pins"; accountId: number | null }
  | { kind: "drafts"; accountId: number | null }
  | { kind: "outbox"; accountId: number | null }
  | { kind: "folder"; folderId: number }
  | { kind: "smart"; id: SmartFolderId; accountId: number | null };

export const CATEGORIES = [
  ["person", "People"],
  ["notification", "Notifications"],
  ["newsletter", "Newsletters"],
  ["other", "Other"],
] as const;

export type Category = (typeof CATEGORIES)[number][0];

export function categoryLabel(category: string): string {
  return CATEGORIES.find(([id]) => id === category)?.[1] ?? "Other";
}

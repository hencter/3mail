import { addrEmail, splitAddrs } from "./mail-format";
import type { MessageDetail } from "./types";

/** Primary correspondent for Foxmail-style history (not necessarily the whole thread). */
export function primaryContactEmail(
  detail: MessageDetail,
  accountEmail: string | null | undefined,
): string | null {
  const me = accountEmail ? addrEmail(accountEmail) : "";
  const from = addrEmail(detail.list.from_addr ?? "");
  if (from && (!me || from !== me)) return from;
  for (const raw of splitAddrs(detail.to_addrs)) {
    const e = addrEmail(raw);
    if (e && (!me || e !== me)) return e;
  }
  for (const raw of splitAddrs(detail.cc_addrs)) {
    const e = addrEmail(raw);
    if (e && (!me || e !== me)) return e;
  }
  return null;
}

export type CorrespondenceItem = {
  direction: "inbound" | "outbound";
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
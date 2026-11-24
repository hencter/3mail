import type { Attachment, MessageDetail } from "./types";

/** Word/Outlook embedded signature images — not shown as download chips. */
export function isLikelySignatureFile(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return false;
  if (/^~wrd\d*\.(jpg|jpeg|png|gif)$/i.test(n)) return true;
  if (/^image\d{3,4}\.(png|jpg|jpeg|gif)$/i.test(n)) return true;
  if (/^picture\d*\.(png|jpg|jpeg|gif)$/i.test(n)) return true;
  return false;
}

function referencedInHtml(html: string, att: Attachment): boolean {
  const lower = html.toLowerCase();
  if (att.content_id) {
    const cid = att.content_id.replace(/^<|>$/g, "").toLowerCase();
    if (lower.includes(cid) || lower.includes(`cid:${cid}`)) return true;
  }
  const name = (att.filename ?? "").toLowerCase();
  return name.length > 0 && lower.includes(name);
}

/** Attachments to show in the reader footer (real files only). */
export function readerAttachmentList(detail: MessageDetail): Attachment[] {
  const html = detail.html_body ?? "";
  const hasCid = /cid:/i.test(html);
  return detail.attachments.filter((a) => {
    if (isLikelySignatureFile(a.filename)) return false;
    if (hasCid && referencedInHtml(html, a)) return false;
    if (!hasCid && a.size_bytes != null && a.size_bytes < 120_000 && isLikelySignatureFile(a.filename)) {
      return false;
    }
    return true;
  });
}
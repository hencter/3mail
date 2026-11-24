import { convertFileSrc } from "@tauri-apps/api/core";
import type { Attachment } from "./types";

export function normalizeCidRef(src: string): string {
  return src
    .replace(/^cid:/i, "")
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

/** Rewrite `cid:` image sources to local asset URLs when attachments are on disk. */
export function rewriteCidHtml(html: string, attachments: Attachment[]): string {
  if (!/cid:/i.test(html)) return html;
  const byCid = new Map<string, string>();
  for (const att of attachments) {
    const cid = att.content_id ? normalizeCidRef(att.content_id) : null;
    const byName =
      att.filename && att.filename.length > 0
        ? normalizeCidRef(att.filename)
        : null;
    if (!att.local_path) continue;
    const url = convertFileSrc(att.local_path);
    if (cid) byCid.set(cid, url);
    if (byName) byCid.set(byName, url);
  }
  if (!byCid.size) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("[src]").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    if (!/^cid:/i.test(src)) return;
    const key = normalizeCidRef(src);
    const url = byCid.get(key);
    if (url) el.setAttribute("src", url);
  });
  const styles = [...doc.head.querySelectorAll("style")].map((s) => s.outerHTML).join("");
  return styles + (doc.body?.innerHTML ?? html);
}
import { useEffect, useState } from "react";
import { addrName } from "./mail-format";

/** Mailbox role colors stay the same in light and dark so an action is recognizable everywhere. */
export const ROLE_COLORS: Record<string, string> = {
  inbox: "#3b82f6",
  sent: "#0ea5e9",
  snoozed: "#f59e0b",
  drafts: "#8b93a7",
  pins: "#f97316",
  archive: "#22a06b",
  junk: "#d97706",
  trash: "#ef4444",
  outbox: "#06b6d4",
  attachments: "#a855f7",
  today: "#3b82f6",
  more: "#8b93a7",
  folder: "#8b93a7",
};

export const ACCOUNT_SWATCHES = [
  "#ec4899",
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
  "#64748b",
];

const ACCOUNT_KEY = "3mail.accountColors";
const listeners = new Set<() => void>();

function readAccountColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function setAccountColor(accountId: number, color: string) {
  const next = { ...readAccountColors(), [accountId]: color };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

/** Returns a lookup: saved color, otherwise a swatch picked by the account's position. */
export function useAccountColors(accountIds: number[]): (accountId: number) => string {
  const [saved, setSaved] = useState(readAccountColors);
  useEffect(() => {
    const fn = () => setSaved(readAccountColors());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return (accountId: number) => {
    const own = saved[accountId];
    if (own) return own;
    const index = accountIds.indexOf(accountId);
    return ACCOUNT_SWATCHES[(index < 0 ? accountId : index) % ACCOUNT_SWATCHES.length];
  };
}

const AVATAR_COLORS = ["#5B8DEF", "#E06C75", "#E5A54B", "#3DBA8B", "#A78BFA", "#F07A3A", "#4C9A9A"];

export function avatarColor(from: string | null): string {
  let hash = 0;
  for (const ch of from ?? "?") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function senderLabel(from: string | null): string {
  if (!from) return "(unknown)";
  return addrName(from);
}

export function initials(from: string | null): string {
  const raw = (from ?? "").split("<")[0].replace(/["']/g, "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? parts[1][0] : "";
  return (a + b).toUpperCase();
}

export function cleanSnippet(snippet: string | null): string | null {
  if (!snippet) return snippet;
  const cleaned = snippet.replace(/\[?cid:[^\s\]]+\]?/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export { readerWhen } from "./mail-format";

export function fileSize(bytes: number | null): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKind(name: string | null, mime: string | null): { label: string; color: string } {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  const type = (mime ?? "").toLowerCase();
  if (ext === "pdf" || type.includes("pdf")) return { label: "PDF", color: "#e5484d" };
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) {
    return { label: "IMG", color: "#8b5cf6" };
  }
  if (["doc", "docx", "pages"].includes(ext)) return { label: "DOC", color: "#3b82f6" };
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return { label: "XLS", color: "#22a06b" };
  if (["ppt", "pptx", "key"].includes(ext)) return { label: "PPT", color: "#f97316" };
  if (["zip", "rar", "7z", "gz"].includes(ext)) return { label: "ZIP", color: "#64748b" };
  return { label: ext ? ext.slice(0, 3).toUpperCase() : "FILE", color: "#64748b" };
}

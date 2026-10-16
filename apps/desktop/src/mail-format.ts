import { readAppearance, type DateFormat } from "./appearance";

/** IMAP path depth for sidebar indent. INBOX is the root. */
export function mailboxDepth(imapPath: string): number {
  const path = imapPath.trim();
  if (!path || path.toUpperCase() === "INBOX") return 0;
  const delim = path.includes("/") ? "/" : path.includes(".") ? "." : null;
  if (!delim) return 0;
  const parts = path.split(delim).filter(Boolean);
  return Math.max(0, parts.length - 1);
}

const pad = (n: number) => String(n).padStart(2, "0");

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeOf(date: Date, hour24: boolean): string {
  if (hour24) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function dayOf(date: Date, now: Date, format: DateFormat): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  switch (format) {
    case "ymd":
      return ymd;
    case "md":
      return sameYear ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : ymd;
    case "system":
      return date.toLocaleDateString(undefined, { dateStyle: "short" });
    default:
      return sameYear
        ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : ymd;
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** List rows: time for today, otherwise the date in the user's chosen format. */
export function formatListDate(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return "";
  const { dateFormat, hour24 } = readAppearance();
  const now = new Date();
  if (isSameDay(date, now)) return timeOf(date, hour24);
  return dayOf(date, now, dateFormat);
}

/** Reader card header: always shows both date and time. */
export function readerWhen(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return "";
  const { dateFormat, hour24 } = readAppearance();
  const now = new Date();
  const time = timeOf(date, hour24);
  if (isSameDay(date, now)) return `Today at ${time}`;
  return dateFormat === "relative" ? `${dayOf(date, now, dateFormat)} at ${time}` : `${dayOf(date, now, dateFormat)} ${time}`;
}

/** Reply attribution, e.g. `2026 Sep 22 at 17:16 +0800`, in local time. */
export function quoteWhen(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return "";
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${date.getFullYear()} ${month} ${date.getDate()} at ${pad(date.getHours())}:${pad(date.getMinutes())} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** Split on `,`/`;` outside quotes and `<>`, so `"Zhu, Izzy" <a@b>` stays one address. */
export function splitAddrs(raw: string | null | undefined): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  let escaped = false;
  for (const ch of raw ?? "") {
    if (ch === '"' && !escaped) inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    else if ((ch === "," || ch === ";") && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      escaped = false;
      continue;
    }
    escaped = ch === "\\" && !escaped;
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `"Zhu, Izzy" <a@b>` → `Zhu, Izzy`; a bare address is returned unchanged. */
export function addrName(raw: string): string {
  const named = raw.match(/^\s*"?((?:[^"\\]|\\.)*?)"?\s*<[^>]+>\s*$/);
  const name = named?.[1]?.replace(/\\"/g, '"').trim();
  return name || raw.trim();
}

export function addrEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

export function snoozeUntil(
  kind: "3h" | "tonight" | "tomorrow" | "weekend" | "1d" | "someday",
): string {
  const date = new Date();
  if (kind === "3h") return new Date(Date.now() + 3 * 3600_000).toISOString();
  if (kind === "1d") return new Date(Date.now() + 24 * 3600_000).toISOString();
  if (kind === "tonight") {
    date.setHours(18, 0, 0, 0);
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  if (kind === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(8, 0, 0, 0);
    return date.toISOString();
  }
  if (kind === "weekend") {
    const day = date.getDay();
    const add = (6 - day + 7) % 7 || 7;
    date.setDate(date.getDate() + add);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }
  date.setFullYear(date.getFullYear() + 10);
  return date.toISOString();
}

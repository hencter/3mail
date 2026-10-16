import { sanitizeEmailHtml } from "./MailBody";
import { addrName, quoteWhen, splitAddrs } from "./mail-format";
import type { MessageDetail, Signature } from "./types";

/** The original message carried into a reply/forward; rendered as-is, never re-parsed by the editor. */
export type Quote = {
  kind: "reply" | "forward";
  /** Plain-text header line(s) shown above the original. */
  attribution: string;
  html: string;
  text: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

/** `Zhu, Izzy <izzy@x.com>` (or just the address). */
function displayAddr(raw: string): string {
  const name = addrName(raw);
  const email = raw.match(/<([^>]+)>/)?.[1]?.trim();
  return email && name !== raw.trim() ? `${name} <${email}>` : raw.trim();
}

export function buildQuote(detail: MessageDetail, kind: Quote["kind"]): Quote {
  const from = displayAddr(detail.list.from_addr ?? "");
  const when = quoteWhen(detail.list.date);
  const attribution =
    kind === "forward"
      ? [
          "---------- Forwarded message ----------",
          `From: ${from}`,
          when && `Date: ${when}`,
          `Subject: ${detail.list.subject ?? ""}`,
          detail.to_addrs && `To: ${splitAddrs(detail.to_addrs).map(displayAddr).join(", ")}`,
          detail.cc_addrs && `Cc: ${splitAddrs(detail.cc_addrs).map(displayAddr).join(", ")}`,
        ]
          .filter(Boolean)
          .join("\n")
      : `On ${when || "an earlier date"}, ${from}, wrote:`;
  const html = detail.html_body?.trim()
    ? sanitizeEmailHtml(detail.html_body)
    : textToHtml(detail.text_body ?? "");
  return { kind, attribution, html, text: detail.text_body ?? "" };
}

export function signatureHtml(sig: Signature | undefined): string {
  if (!sig) return "";
  if (sig.body_html?.trim()) return sanitizeEmailHtml(sig.body_html);
  return sig.body_text.trim() ? textToHtml(sig.body_text) : "";
}

const QUOTE_STYLE = "margin:0 0 0 .8ex;padding-left:1ex;border-left:2px solid #4fb3a9;";

/** Final bodies for SMTP. Marked wrappers let a saved draft be split back into its parts. */
export function composeBodies(
  editorHtml: string,
  editorText: string,
  sig: Signature | undefined,
  quote: Quote | null,
): { html: string; text: string } {
  const sigHtml = signatureHtml(sig);
  const parts = [`<div data-3mail-body>${editorHtml}</div>`];
  if (sigHtml) parts.push(`<br><div data-3mail-sig>${sigHtml}</div>`);
  if (quote) {
    const head = `<div data-3mail-attribution="${escapeHtml(quote.attribution)}">${escapeHtml(quote.attribution).replace(/\n/g, "<br>")}</div>`;
    const body =
      quote.kind === "reply"
        ? `<blockquote type="cite" style="${QUOTE_STYLE}">${quote.html}</blockquote>`
        : `<div>${quote.html}</div>`;
    parts.push(`<br><div data-3mail-quote data-kind="${quote.kind}">${head}${body}</div>`);
  }
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;">${parts.join("")}</div>`;

  const textParts = [editorText.trimEnd()];
  const sigText = sig?.body_text.trim();
  if (sigText) textParts.push(`-- \n${sigText}`);
  if (quote) {
    const quoted =
      quote.kind === "reply"
        ? quote.text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        : quote.text;
    textParts.push(`${quote.attribution}\n${quoted}`);
  }
  return { html, text: textParts.join("\n\n") };
}

/** Undo `composeBodies` for a saved draft: editor part, whether a signature was in, and the quote. */
export function splitDraftHtml(
  html: string,
  text: string,
): { editorHtml: string; hadSignature: boolean; quote: Quote | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.querySelector("[data-3mail-body]");
  if (!body) return { editorHtml: html, hadSignature: false, quote: null };
  const quoteEl = doc.querySelector("[data-3mail-quote]");
  let quote: Quote | null = null;
  if (quoteEl) {
    const kind = quoteEl.getAttribute("data-kind") === "forward" ? "forward" : "reply";
    const attribution =
      quoteEl.querySelector("[data-3mail-attribution]")?.getAttribute("data-3mail-attribution") ?? "";
    const original = kind === "reply" ? quoteEl.querySelector("blockquote") : quoteEl.lastElementChild;
    const marker = attribution ? text.indexOf(attribution) : -1;
    const quotedText = marker >= 0 ? text.slice(marker + attribution.length).replace(/^\n/, "") : "";
    quote = {
      kind,
      attribution,
      html: original?.innerHTML ?? "",
      text: kind === "reply" ? quotedText.replace(/^> ?/gm, "") : quotedText,
    };
  }
  return {
    editorHtml: body.innerHTML,
    hadSignature: Boolean(doc.querySelector("[data-3mail-sig]")),
    quote,
  };
}

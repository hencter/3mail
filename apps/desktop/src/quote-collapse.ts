/** Split message bodies into “new content” vs embedded reply history (Spark Show History). */

export type SplitBody = {
  visibleHtml: string | null;
  quotedHtml: string | null;
  signatureHtml: string | null;
  visibleText: string | null;
  quotedText: string | null;
  hasQuote: boolean;
  hasSignature: boolean;
};

const QUOTE_SELECTORS = [
  "#divRplyFwdMsg",
  ".gmail_quote",
  ".gmail_attr",
  "blockquote[type='cite']",
  "#appendonsend",
  ".yahoo_quoted",
  ".moz-cite-prefix",
  ".gmail_extra",
  "div[name='quote']",
];

const SIGNATURE_SELECTORS = [
  ".gmail_signature",
  "#Signature",
  "div[name='signature']",
  "[data-smartmail='gmail_signature']",
];

const HTML_SPLIT_PATTERNS: RegExp[] = [
  /<div[^>]*\bid\s*=\s*["']?divRplyFwdMsg["']?/i,
  /<blockquote\b/i,
  /<div[^>]*class\s*=\s*["'][^"']*gmail_quote/i,
  /<div[^>]*class\s*=\s*["'][^"']*gmail_attr/i,
  /-{3,}\s*Original Message\s*-{3,}/i,
  /\bOriginal Message\b/i,
  /(?:<br\s*\/?>|\r?\n|>)\s*On .{8,200}? wrote:\s*(?:<br\s*\/?>|\r?\n|<)/i,
  /(?:<br\s*\/?>|\r?\n)\s*_{3,}\s*(?:<br\s*\/?>|\r?\n)/i,
];

function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function outlookHeaderText(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 12 || compact.length > 4000) return false;
  if (/Original Message/i.test(compact) && /From:/i.test(compact)) return true;
  if (/From:\s*\S/.test(compact) && /Sent:\s*\S/.test(compact) && /Subject:/i.test(compact)) return true;
  if (/^\s*From:\s/i.test(compact) && compact.includes("Sent:")) return true;
  return false;
}

/** Smallest element in tree that looks like a forwarded header block (Outlook tables). */
function findOutlookHeaderElement(body: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLen = Infinity;
  const all = body.querySelectorAll("div, p, table, td, span, section");
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    const text = el.textContent ?? "";
    if (!outlookHeaderText(text)) continue;
    const len = text.length;
    if (len < bestLen) {
      bestLen = len;
      best = el;
    }
  }
  return best;
}

/** `On … wrote:` line above blockquotes (Apple Mail / mixed clients). */
function findWroteAttributionElement(body: HTMLElement): HTMLElement | null {
  for (const el of body.querySelectorAll("div, p, span, font")) {
    if (!(el instanceof HTMLElement)) continue;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t.length > 400) continue;
    if (/^On .{8,200} wrote:\s*$/i.test(t)) return el;
  }
  return null;
}

/** First quote anchor in reading order (not the deepest/last block). */
function findFirstQuoteAnchor(body: HTMLElement): Node | null {
  const candidates: Node[] = [];

  const wrote = findWroteAttributionElement(body);
  if (wrote) candidates.push(wrote);

  for (const sel of QUOTE_SELECTORS) {
    body.querySelectorAll(sel).forEach((el) => candidates.push(el));
  }
  body.querySelectorAll("blockquote").forEach((el) => candidates.push(el));

  const outlook = findOutlookHeaderElement(body);
  if (outlook) candidates.push(outlook);

  if (candidates.length === 0) return null;

  candidates.sort(documentOrder);
  const first = candidates[0]!;

  const bodyText = (body.textContent ?? "").replace(/\s+/g, " ");
  const anchorText = (first.textContent ?? "").replace(/\s+/g, " ");
  if (bodyText === anchorText && outlookHeaderText(bodyText)) {
    return null;
  }

  const before = bodyText.slice(0, bodyText.indexOf(anchorText)).trim();
  if (before.length < 8 && outlookHeaderText(anchorText)) {
    return null;
  }

  return first;
}

function splitBodyAtAnchor(body: HTMLElement, anchor: Node): { visible: string; quoted: string | null } {
  const doc = body.ownerDocument;
  if (!doc) return { visible: body.innerHTML, quoted: null };

  const range = doc.createRange();
  try {
    range.setStart(anchor, 0);
    range.setEnd(body, body.childNodes.length);
  } catch {
    return { visible: body.innerHTML, quoted: null };
  }

  const quotedWrap = doc.createElement("div");
  quotedWrap.appendChild(range.cloneContents());
  const quoted = quotedWrap.innerHTML.trim();
  if (!quoted) return { visible: body.innerHTML, quoted: null };

  range.deleteContents();
  const visible = body.innerHTML.trim();
  if (!visible) return { visible: body.innerHTML, quoted: null };
  return { visible, quoted };
}

function findHtmlSplitIndex(html: string): number {
  const candidates: number[] = [];
  const minAt = 16;
  for (const re of HTML_SPLIT_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(html);
    if (m && m.index >= minAt) candidates.push(m.index);
  }

  const fromSent = /From:\s*[^<\n]{1,120}[\s\S]{0,600}?Sent:\s*[^<\n]{1,80}/gi;
  let m: RegExpExecArray | null;
  while ((m = fromSent.exec(html))) {
    if (m.index >= minAt) candidates.push(m.index);
  }

  return candidates.length ? Math.min(...candidates) : -1;
}

function splitHtmlByRawPatterns(html: string): { visible: string; quoted: string | null } {
  const idx = findHtmlSplitIndex(html);
  if (idx < 0) return { visible: html, quoted: null };
  const visible = html.slice(0, idx).trim();
  const quoted = html.slice(idx).trim();
  if (!visible || !quoted || visible.length < 4) return { visible: html, quoted: null };
  return { visible, quoted };
}

function findSignatureAnchor(body: HTMLElement): Node | null {
  for (const sel of SIGNATURE_SELECTORS) {
    const el = body.querySelector(sel);
    if (el) return el;
  }
  for (const table of body.querySelectorAll("table")) {
    const imgs = table.querySelectorAll("img");
    if (imgs.length < 2) continue;
    const text = (table.textContent ?? "").replace(/\s+/g, " ");
    if (
      text.length > 24 &&
      /(tel|phone|mobile|fax|@|manager|director|有限公司|co\.|ltd|inc\.)/i.test(text)
    ) {
      return table;
    }
  }
  return null;
}

function splitSignatureFromVisible(html: string): { visible: string; signature: string | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  const anchor = findSignatureAnchor(body);
  if (!anchor) return { visible: html, signature: null };
  const sig = splitBodyAtAnchor(body, anchor);
  if (!sig.quoted) return { visible: html, signature: null };
  const visible = sig.visible.trim();
  if (visible.length < 8) return { visible: html, signature: null };
  return { visible, signature: sig.quoted };
}

function splitHtmlParts(html: string): { visible: string; quoted: string | null; signature: string | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  const anchor = findFirstQuoteAnchor(body);
  let visible = html;
  let quoted: string | null = null;
  if (anchor) {
    const dom = splitBodyAtAnchor(body, anchor);
    if (dom.quoted) {
      visible = dom.visible;
      quoted = dom.quoted;
    }
  }
  if (!quoted) {
    const raw = splitHtmlByRawPatterns(html);
    if (raw.quoted) {
      visible = raw.visible;
      quoted = raw.quoted;
    }
  }
  if (!quoted) {
    const plain = (body.textContent ?? "").trim();
    if (plain) {
      const textSplit = splitTextParts(plain);
      if (textSplit.quoted && textSplit.visible.length >= 4) {
        return {
          visible: `<pre class="msg-plain-fallback">${escapeHtml(textSplit.visible)}</pre>`,
          quoted: `<pre class="msg-plain-fallback">${escapeHtml(textSplit.quoted)}</pre>`,
          signature: null,
        };
      }
    }
  }

  const sigSplit = splitSignatureFromVisible(visible);
  return {
    visible: sigSplit.visible,
    quoted,
    signature: sigSplit.signature,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitTextParts(text: string): { visible: string; quoted: string | null } {
  const lines = text.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^On .+ wrote:\s*$/i.test(line)) {
      cut = i;
      break;
    }
    if (/^-{3,}\s*Original Message/i.test(line)) {
      cut = i;
      break;
    }
    if (/^_{3,}\s*$/i.test(line) && i + 1 < lines.length && /^From:\s/i.test(lines[i + 1].trim())) {
      cut = i;
      break;
    }
    if (/^From:\s.+$/i.test(line) && i + 1 < lines.length && /^Sent:\s/i.test(lines[i + 1].trim())) {
      cut = i;
      break;
    }
    if (/^From:\s.+$/i.test(line)) {
      const rest = lines.slice(i, i + 4).join(" ");
      if (/Sent:\s/i.test(rest) && /Subject:/i.test(rest)) {
        cut = i;
        break;
      }
    }
    if (line.startsWith(">") && i > 0 && lines[i - 1].trim() === "") {
      cut = i;
      break;
    }
  }
  if (cut < 0) {
    return { visible: text, quoted: null };
  }
  const visible = lines.slice(0, cut).join("\n").trimEnd();
  const quoted = lines.slice(cut).join("\n").trim();
  if (!visible || !quoted) {
    return { visible: text, quoted: null };
  }
  return { visible, quoted };
}

export function splitMessageBody(htmlBody: string | null, textBody: string | null): SplitBody {
  if (htmlBody?.trim()) {
    const { visible, quoted, signature } = splitHtmlParts(htmlBody);
    return {
      visibleHtml: visible,
      quotedHtml: quoted,
      signatureHtml: signature,
      visibleText: null,
      quotedText: null,
      hasQuote: Boolean(quoted),
      hasSignature: Boolean(signature),
    };
  }
  const raw = textBody?.trim() ?? "";
  if (!raw) {
    return {
      visibleHtml: null,
      quotedHtml: null,
      signatureHtml: null,
      visibleText: null,
      quotedText: null,
      hasQuote: false,
      hasSignature: false,
    };
  }
  const { visible, quoted } = splitTextParts(raw);
  return {
    visibleHtml: null,
    quotedHtml: null,
    signatureHtml: null,
    visibleText: visible,
    quotedText: quoted,
    hasQuote: Boolean(quoted),
    hasSignature: false,
  };
}
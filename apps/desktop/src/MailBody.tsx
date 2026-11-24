import { useEffect, useMemo, useRef, useState } from "react";
import { rewriteCidHtml } from "./mail-cid";
import { splitMessageBody } from "./quote-collapse";
import type { Attachment } from "./types";

const MIN_FIT_SCALE = 0.6;

function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/url\(\s*['"]?\s*javascript:[^)]*\)/gi, "none")
    .replace(/position\s*:\s*fixed/gi, "position:static");
}

/** Strip scriptable / active content; keeps the message's own `<style>` blocks (sanitized). */
export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script, iframe, object, embed, form, link, meta, base, title")
    .forEach((el) => el.remove());

  doc.querySelectorAll("img, source").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    if (/^cid:/i.test(src)) el.remove();
  });

  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href" || name === "action") &&
        /^\s*(javascript|vbscript|data:text\/html)/i.test(value)
      ) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") el.setAttribute("style", sanitizeCss(attr.value));
    }
  });

  const styles = [...doc.querySelectorAll("style")]
    .map((s) => {
      const css = sanitizeCss(s.textContent ?? "");
      s.remove();
      return css;
    })
    .filter((css) => css.trim());
  const styleTag = styles.length ? `<style>${styles.join("\n")}</style>` : "";
  return styleTag + (doc.body?.innerHTML ?? "");
}

/** `themed` inverts lightness (keeping hue) so a white message sits on a dark card; media is flipped back. */
function wrapSrcDoc(bodyHtml: string, themed: boolean): string {
  const invert = themed
    ? `html{filter:invert(1) hue-rotate(180deg);background:#e7e7e8;}
  body{background:transparent;}
  img,video,picture,svg,[style*="background-image"]{filter:invert(1) hue-rotate(180deg);}`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="referrer" content="no-referrer"/>
<base target="_blank" rel="noopener noreferrer"/>
<style>
  html{margin:0;padding:0;background:#fff;color:#1a1a1a;overflow-y:hidden;overflow-x:auto;}
  body{margin:0;padding:4px 0 8px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",Helvetica,Arial,sans-serif;overflow-wrap:break-word;}
  img,video{max-width:100%;height:auto;max-height:min(280px,42vh);}
  table img{max-height:72px;max-width:260px;object-fit:contain;}
  a{color:#1d4ed8;}
  pre{white-space:pre-wrap;}
  pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;}
  blockquote{margin:0.6em 0;padding-left:0.8em;border-left:3px solid #e5e5e5;color:#666;}
  ${invert}
</style></head><body>${bodyHtml}</body></html>`;
}

function AutoHeightFrame({ srcDoc, themed }: { srcDoc: string; themed: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let bodyObserver: ResizeObserver | null = null;
    let lastWidth = -1;
    let scale = 1;
    let raf = 0;

    const measureHeight = () => {
      const doc = frame.contentDocument;
      const body = doc?.body;
      if (!doc || !body) return;
      const html = doc.documentElement;
      const scrollbar = html.scrollWidth > html.clientWidth + 1 ? 14 : 0;
      const next = Math.ceil(body.scrollHeight * scale) + scrollbar;
      if (next > 0) setHeight(next);
    };

    /** Shrink wide newsletters/tables to the card width instead of clipping them. */
    const fit = () => {
      const doc = frame.contentDocument;
      const body = doc?.body;
      if (!doc || !body) return;
      const available = frame.clientWidth;
      if (available <= 0) return;
      lastWidth = available;
      body.style.transform = "";
      body.style.width = "";
      const natural = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
      scale = natural > available + 1 ? Math.max(MIN_FIT_SCALE, available / natural) : 1;
      if (scale < 1) {
        body.style.width = `${natural}px`;
        body.style.transformOrigin = "0 0";
        body.style.transform = `scale(${scale})`;
      }
      measureHeight();
    };

    const schedule = (fn: () => void) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fn);
    };

    /** Keys pressed inside the iframe never reach the app window; re-dispatch them there. */
    const forwardKey = (event: KeyboardEvent) => {
      const copy = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
        bubbles: true,
        cancelable: true,
      });
      if (!window.dispatchEvent(copy)) event.preventDefault();
    };

    const onLoad = () => {
      const doc = frame.contentDocument;
      fit();
      bodyObserver?.disconnect();
      if (doc?.body) {
        bodyObserver = new ResizeObserver(() => schedule(measureHeight));
        bodyObserver.observe(doc.body);
      }
      doc?.querySelectorAll("img").forEach((img) =>
        img.addEventListener("load", () => schedule(fit)),
      );
      doc?.addEventListener("keydown", forwardKey);
    };

    const frameObserver = new ResizeObserver(() => {
      if (frame.clientWidth !== lastWidth) schedule(fit);
    });
    frameObserver.observe(frame);

    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return () => {
      cancelAnimationFrame(raf);
      frame.removeEventListener("load", onLoad);
      frame.contentDocument?.removeEventListener("keydown", forwardKey);
      bodyObserver?.disconnect();
      frameObserver.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      className={"msg-frame" + (themed ? " themed" : "")}
      style={{ height }}
      title="Message body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
}

export function blockRemoteImages(html: string): { html: string; blocked: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let blocked = false;
  doc.querySelectorAll("img, video, source").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    if (/^https?:/i.test(src)) {
      el.removeAttribute("src");
      blocked = true;
    }
    const srcset = el.getAttribute("srcset");
    if (srcset && /https?:/i.test(srcset)) {
      el.removeAttribute("srcset");
      blocked = true;
    }
  });
  const stripUrls = (css: string) => {
    if (!/url\(\s*['"]?https?:/i.test(css)) return css;
    blocked = true;
    return css.replace(/url\(\s*['"]?https?:[^)]+\)/gi, "none");
  };
  doc.querySelectorAll("[style]").forEach((el) => {
    el.setAttribute("style", stripUrls(el.getAttribute("style") ?? ""));
  });
  doc.querySelectorAll("[background]").forEach((el) => {
    if (/^https?:/i.test(el.getAttribute("background") ?? "")) {
      el.removeAttribute("background");
      blocked = true;
    }
  });
  doc.querySelectorAll("style").forEach((el) => {
    el.textContent = stripUrls(el.textContent ?? "");
  });
  const styles = [...doc.head.querySelectorAll("style")].map((s) => s.outerHTML).join("");
  return { html: styles + (doc.body?.innerHTML ?? html), blocked };
}

type Props = {
  textBody: string | null;
  htmlBody: string | null;
  attachments?: Attachment[];
  loadRemote?: boolean;
  onLoadRemote?: () => void;
  /** Dark UI with "follow theme" message colors. */
  themed?: boolean;
  /** When set, inline reply quotes (Show history) follow this flag; footer lives on the card. */
  quoteOpen?: boolean;
  signatureOpen?: boolean;
};

export function MailBody({
  textBody,
  htmlBody,
  attachments = [],
  loadRemote = false,
  onLoadRemote,
  themed = false,
  quoteOpen = false,
  signatureOpen = false,
}: Props) {
  const split = useMemo(() => splitMessageBody(htmlBody, textBody), [htmlBody, textBody]);

  const prepareHtml = (raw: string) => {
    const withCid = attachments.length ? rewriteCidHtml(raw, attachments) : raw;
    const safe = sanitizeEmailHtml(withCid);
    if (loadRemote) return { html: safe, blocked: false };
    return blockRemoteImages(safe);
  };

  const visiblePrepared = useMemo(() => {
    const source = split.visibleHtml ?? htmlBody;
    if (!source?.trim()) return null;
    return prepareHtml(source);
  }, [split.visibleHtml, htmlBody, loadRemote, attachments]);

  const quotedPrepared = useMemo(() => {
    if (!quoteOpen || !split.quotedHtml?.trim()) return null;
    return prepareHtml(split.quotedHtml);
  }, [quoteOpen, split.quotedHtml, loadRemote, attachments]);

  const signaturePrepared = useMemo(() => {
    if (!signatureOpen || !split.signatureHtml?.trim()) return null;
    return prepareHtml(split.signatureHtml);
  }, [signatureOpen, split.signatureHtml, loadRemote, attachments]);

  const visibleSrcDoc = useMemo(
    () => (visiblePrepared ? wrapSrcDoc(visiblePrepared.html, themed) : null),
    [visiblePrepared, themed],
  );
  const quotedSrcDoc = useMemo(
    () => (quotedPrepared ? wrapSrcDoc(quotedPrepared.html, themed) : null),
    [quotedPrepared, themed],
  );
  const signatureSrcDoc = useMemo(
    () => (signaturePrepared ? wrapSrcDoc(signaturePrepared.html, themed) : null),
    [signaturePrepared, themed],
  );

  const blocked =
    visiblePrepared?.blocked || quotedPrepared?.blocked || signaturePrepared?.blocked;

  if (visibleSrcDoc) {
    return (
      <div className="flex flex-col">
        {blocked && (
          <div className="remote-banner">
            <span>Remote images are hidden.</span>
            <button type="button" className="text-btn" onClick={onLoadRemote}>
              Load images
            </button>
          </div>
        )}
        <AutoHeightFrame srcDoc={visibleSrcDoc} themed={themed} />
        {signatureSrcDoc && (
          <div className="msg-signature">
            <AutoHeightFrame srcDoc={signatureSrcDoc} themed={themed} />
          </div>
        )}
        {quotedSrcDoc && (
          <div className="msg-quoted">
            <AutoHeightFrame srcDoc={quotedSrcDoc} themed={themed} />
          </div>
        )}
      </div>
    );
  }

  const visibleText = split.visibleText ?? textBody;
  const quotedText = quoteOpen ? split.quotedText : null;
  const main = visibleText?.trim() ? visibleText : "(empty body)";
  return (
    <div className="msg-text-wrap">
      <pre className="msg-text">{main}</pre>
      {quotedText?.trim() ? <pre className="msg-text msg-quoted">{quotedText}</pre> : null}
    </div>
  );
}

export { splitMessageBody } from "./quote-collapse";

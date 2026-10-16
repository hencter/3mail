import { useEffect, useRef, useState } from "react";
import { Clock, ExternalLink, FileText, Trash2, X } from "lucide-react";
import type { Quote } from "./compose-html";
import { MailBody } from "./MailBody";
import { addrEmail, addrName, splitAddrs } from "./mail-format";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import type { Account, Signature } from "./types";

export type ComposeState = {
  /** Remounts the editor when a different message is loaded into the same window. */
  session: number;
  /** Popup for a new message; the third column for a reply, forward or draft. */
  placement: "popup" | "pane";
  draftId: number | null;
  /** Server draft this was opened from, so the list does not show it twice. */
  sourceMessageId: number | null;
  accountId: number;
  to: string;
  cc: string;
  bcc: string;
  showCc: boolean;
  subject: string;
  /** Editor content only (no signature / quote). */
  html: string;
  text: string;
  quote: Quote | null;
  sendAt: string;
  inReplyTo: string | null;
  references: string | null;
  signatureId: number | null;
};

let sessionSeq = 0;

export function blankCompose(accountId: number, signatureId: number | null): ComposeState {
  return {
    session: ++sessionSeq,
    placement: "popup",
    draftId: null,
    sourceMessageId: null,
    accountId,
    to: "",
    cc: "",
    bcc: "",
    showCc: false,
    subject: "",
    html: "",
    text: "",
    quote: null,
    sendAt: "",
    inReplyTo: null,
    references: null,
    signatureId,
  };
}

export function composeHasContent(c: ComposeState): boolean {
  return Boolean(
    c.to.trim() || c.cc.trim() || c.bcc.trim() || c.subject.trim() || c.text.trim() || c.quote,
  );
}

function initialBox() {
  const width = Math.min(760, window.innerWidth - 48);
  const height = Math.max(380, window.innerHeight - 72);
  return { left: window.innerWidth - width - 24, top: 48, width, height };
}

/** Recipient chips (`Zhu, Izzy`) over a plain comma-separated value. */
function AddressField({
  label,
  value,
  onChange,
  inputRef,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  trailing?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const addrs = splitAddrs(value);

  function commit(raw = draft) {
    const added = splitAddrs(raw);
    if (!added.length) return;
    const known = new Set(addrs.map(addrEmail));
    const next = [...addrs, ...added.filter((a) => !known.has(addrEmail(a)))];
    onChange(next.join(", "));
    setDraft("");
  }

  return (
    <div className="compose-line">
      <span>{label}</span>
      <div className="addr-field">
        {addrs.map((addr, i) => (
          <span key={addr + i} className="addr-chip" title={addrEmail(addr)}>
            {addrName(addr)}
            <button
              type="button"
              aria-label={`Remove ${addrName(addr)}`}
              onClick={() => onChange(addrs.filter((_, j) => j !== i).join(", "))}
            >
              <X />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          aria-label={label.replace(":", "")}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && addrs.length) {
              onChange(addrs.slice(0, -1).join(", "));
            }
          }}
          onBlur={() => commit()}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,;\n]/.test(text)) {
              e.preventDefault();
              commit(draft + text.replace(/\n/g, ","));
            }
          }}
        />
      </div>
      {trailing}
    </div>
  );
}

function accountLabel(a: Account) {
  return a.display_name ? `${a.display_name} (${a.email})` : a.email;
}

export function ComposeWindow({
  value,
  accounts,
  signatures,
  loadRemote,
  onChange,
  onSend,
  onSaveDraft,
  onClose,
  onDelete,
  onPopOut,
}: {
  value: ComposeState;
  accounts: Account[];
  signatures: Signature[];
  loadRemote: boolean;
  onChange: (patch: Partial<ComposeState>) => void;
  onSend: () => void;
  onSaveDraft: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onPopOut?: () => void;
}) {
  const [box, setBox] = useState(initialBox);
  const [showSendAt, setShowSendAt] = useState(Boolean(value.sendAt));
  const toRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichEditorHandle | null>(null);

  useEffect(() => {
    if (value.to) editorRef.current?.focus();
    else toRef.current?.focus();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fit = () =>
      setBox((b) => ({
        ...b,
        left: Math.min(Math.max(0, b.left), Math.max(0, window.innerWidth - b.width)),
        top: Math.min(Math.max(0, b.top), Math.max(0, window.innerHeight - 120)),
      }));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  function startDrag(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const startX = event.clientX - box.left;
    const startY = event.clientY - box.top;
    const move = (ev: PointerEvent) =>
      setBox((b) => ({
        ...b,
        left: Math.min(Math.max(0, ev.clientX - startX), window.innerWidth - 120),
        top: Math.min(Math.max(0, ev.clientY - startY), window.innerHeight - 60),
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const signature = signatures.find((s) => s.id === value.signatureId);
  const account = accounts.find((a) => a.id === value.accountId);
  const ready = splitAddrs(value.to).length > 0;
  const pane = value.placement === "pane";

  return (
    <div
      className={pane ? "reader compose-pane" : "compose-card"}
      style={pane ? undefined : { left: box.left, top: box.top, width: box.width, height: box.height }}
      role={pane ? "region" : "dialog"}
      aria-label={pane ? "Edit message" : "New message"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
          e.preventDefault();
          onSend();
        }
      }}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSend();
        }}
      >
        {pane ? (
          <div className="pane-head reader-head" data-tauri-drag-region>
            <button type="button" className="tool" onClick={onClose} aria-label="Close" title="Close (Esc) — keeps a draft">
              <X />
            </button>
            {onDelete && (
              <button type="button" className="tool" onClick={onDelete} aria-label="Delete draft" title="Delete draft">
                <Trash2 />
              </button>
            )}
            {onPopOut && (
              <button type="button" className="tool" onClick={onPopOut} aria-label="Open in window" title="Open in window">
                <ExternalLink />
              </button>
            )}
            <div className="drag" data-tauri-drag-region />
          </div>
        ) : (
          <div className="compose-title" onPointerDown={startDrag}>
            {value.subject.trim() || "New Message"}
            <button type="button" className="tool" onClick={onClose} aria-label="Close" title="Close (Esc) — keeps a draft">
              <X />
            </button>
          </div>
        )}
        <AddressField
          label="To:"
          value={value.to}
          onChange={(to) => onChange({ to })}
          inputRef={toRef}
          trailing={
            !value.showCc && (
              <button type="button" className="text-btn" onClick={() => onChange({ showCc: true })}>
                Cc/Bcc
              </button>
            )
          }
        />
        {value.showCc && (
          <>
            <AddressField label="Cc:" value={value.cc} onChange={(cc) => onChange({ cc })} />
            <AddressField label="Bcc:" value={value.bcc} onChange={(bcc) => onChange({ bcc })} />
          </>
        )}
        <div className="compose-line">
          <span>From:</span>
          {accounts.length > 1 ? (
            <select
              aria-label="From account"
              className="from"
              value={value.accountId}
              onChange={(e) => onChange({ accountId: Number(e.target.value) })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          ) : (
            <span className="from">{account ? accountLabel(account) : ""}</span>
          )}
        </div>
        <div className="compose-line">
          <span>Subject:</span>
          <input value={value.subject} onChange={(e) => onChange({ subject: e.target.value })} />
        </div>
        <RichEditor
          key={value.session}
          className="compose-editor"
          initialHtml={value.html}
          placeholder="Say something"
          handleRef={editorRef}
          onChange={(html, text) => onChange({ html, text })}
        >
          {signature && (
            <div className="compose-extra compose-sign" aria-label="Signature">
              <MailBody
                htmlBody={signature.body_html?.trim() ? signature.body_html : null}
                textBody={signature.body_text}
                loadRemote
              />
            </div>
          )}
          {value.quote && (
            <div className="compose-extra compose-quote" aria-label="Quoted message">
              <div className="compose-attribution">{value.quote.attribution}</div>
              <div className={value.quote.kind === "reply" ? "compose-cite" : undefined}>
                <MailBody htmlBody={value.quote.html} textBody={value.quote.text} loadRemote={loadRemote} />
              </div>
            </div>
          )}
        </RichEditor>
        <div className="compose-bottom">
          <button type="submit" className={"send" + (ready ? " ready" : "")} disabled={!ready}>
            {value.sendAt ? "Schedule" : "Send"}
          </button>
          <button type="button" className="tool" aria-label="Save draft" title="Save draft" onClick={onSaveDraft}>
            <FileText />
          </button>
          {showSendAt ? (
            <span className="send-at">
              <Clock className="size-3.5" />
              <input
                type="datetime-local"
                aria-label="Send at"
                value={value.sendAt}
                onChange={(e) => onChange({ sendAt: e.target.value })}
              />
              <button
                type="button"
                className="tool"
                style={{ width: 20, height: 20 }}
                aria-label="Send now instead"
                onClick={() => {
                  onChange({ sendAt: "" });
                  setShowSendAt(false);
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <button type="button" className="tool" aria-label="Send later" title="Send later" onClick={() => setShowSendAt(true)}>
              <Clock />
            </button>
          )}
          <span className="flex-1" />
          <select
            aria-label="Signature"
            value={value.signatureId?.toString() ?? "none"}
            onChange={(e) =>
              onChange({ signatureId: e.target.value === "none" ? null : Number(e.target.value) })
            }
          >
            <option value="none">No signature</option>
            {signatures.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  Ellipsis,
  FolderInput,
  Forward,
  History,
  Mail,
  Pin,
  Reply,
  ReplyAll,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { snoozeUntil, splitAddrs } from "./mail-format";
import { MailBody, splitMessageBody } from "./MailBody";
import {
  avatarColor,
  cleanSnippet,
  fileKind,
  fileSize,
  initials,
  readerWhen,
  senderLabel,
} from "./palette";
import { CorrespondenceRail } from "./CorrespondenceRail";
import { readerAttachmentList } from "./inline-attachments";
import {
  CATEGORIES,
  categoryLabel,
  type MessageDetail,
  type MessageListItem,
} from "./types";

export type ReaderActions = {
  onClose: () => void;
  onTogglePin: () => void;
  onToggleRead: () => void;
  onSnooze: (until: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSetCategory: (category: string) => void;
  onReply: (messageId?: number) => void;
  onReplyAll: (messageId?: number) => void;
  onForward: (messageId?: number) => void;
  onOpenMessage: (id: number) => void;
  onOpenAttachment: (id: number) => void;
  onSaveAll: (ids: number[]) => void;
  onLoadRemote: () => void;
};

const SNOOZE_PRESETS = [
  ["tonight", "Later Today"],
  ["tomorrow", "Tomorrow"],
  ["weekend", "This Weekend"],
  ["3h", "In 3 Hours"],
  ["1d", "In 1 Day"],
  ["someday", "Someday"],
] as const;

function MessageMenu({
  detail,
  actions,
}: {
  detail: MessageDetail;
  actions: Pick<ReaderActions, "onReply" | "onReplyAll" | "onForward" | "onToggleRead" | "onTogglePin">;
}) {
  const id = detail.list.id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button type="button" className="tool" aria-label="More actions">
          <Ellipsis />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => actions.onReply(id)} shortcut="R">
          Reply
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onReplyAll(id)} shortcut="⇧R">
          Reply All
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onForward(id)} shortcut="F">
          Forward
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={actions.onToggleRead} shortcut="U">
          {detail.list.unseen ? "Mark as Read" : "Mark as Unread"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onTogglePin}>
          {detail.list.pinned || detail.list.starred ? "Unpin" : "Pin"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MessageCard({
  detail,
  loadingBody,
  loadRemote,
  themed,
  actions,
  quoteOpen,
  onToggleQuote,
  signatureOpen,
  onToggleSignature,
  toolbarPinRead,
}: {
  detail: MessageDetail;
  loadingBody: boolean;
  loadRemote: boolean;
  themed: boolean;
  actions: ReaderActions;
  quoteOpen: boolean;
  onToggleQuote: () => void;
  signatureOpen: boolean;
  onToggleSignature: () => void;
  /** Top reader toolbar targets the list-selected message only. */
  toolbarPinRead: boolean;
}) {
  const messageId = detail.list.id;
  const from = detail.list.from_addr;
  const to = splitAddrs(detail.to_addrs).map(senderLabel);
  const cc = splitAddrs(detail.cc_addrs).map(senderLabel);
  const files = readerAttachmentList(detail);
  const recipients = splitAddrs(detail.to_addrs).length + splitAddrs(detail.cc_addrs).length;
  const splitMeta = useMemo(
    () => splitMessageBody(detail.html_body, detail.text_body),
    [detail.html_body, detail.text_body],
  );
  const hasQuote = splitMeta.hasQuote;
  const hasSignature = splitMeta.hasSignature;

  const cardActions = {
    onReply: () => actions.onReply(messageId),
    onReplyAll: () => actions.onReplyAll(messageId),
    onForward: () => actions.onForward(messageId),
  };

  return (
    <article className="msg-card">
      <header className="msg-head">
        <span className="avatar" style={{ background: avatarColor(from) }}>
          {initials(from)}
        </span>
        <div className="msg-who">
          <div className="name">{senderLabel(from)}</div>
          {to.length > 0 && (
            <div className="to" title={[...to, ...cc].join(", ")}>
              To: {to.join(", ")}
              {cc.length > 0 ? `  Cc: ${cc.join(", ")}` : ""}
            </div>
          )}
        </div>
        <div className="msg-side">
          <span className="when">{readerWhen(detail.list.date)}</span>
          <button
            type="button"
            className="tool"
            aria-label="Reply"
            title="Reply (R)"
            onClick={(e) => {
              e.preventDefault();
              cardActions.onReply();
            }}
          >
            <Reply />
          </button>
          <MessageMenu
            detail={detail}
            actions={{
              onReply: actions.onReply,
              onReplyAll: actions.onReplyAll,
              onForward: actions.onForward,
              onToggleRead: toolbarPinRead ? actions.onToggleRead : () => actions.onOpenMessage(messageId),
              onTogglePin: toolbarPinRead ? actions.onTogglePin : () => actions.onOpenMessage(messageId),
            }}
          />
        </div>
      </header>
      <div className="msg-body">
        {loadingBody ? (
          <p className="msg-loading">Loading message…</p>
        ) : (
          <MailBody
            textBody={detail.text_body}
            htmlBody={detail.html_body}
            attachments={detail.attachments}
            loadRemote={loadRemote}
            onLoadRemote={actions.onLoadRemote}
            themed={themed}
            quoteOpen={quoteOpen}
            signatureOpen={signatureOpen}
          />
        )}
        {hasSignature && !loadingBody && (
          <button type="button" className="show-history in-body text-btn" onClick={onToggleSignature}>
            {signatureOpen ? "Hide signature" : "Show signature"}
          </button>
        )}
        {hasQuote && !loadingBody && (
          <button type="button" className="show-history in-body text-btn" onClick={onToggleQuote}>
            <History />
            {quoteOpen ? "Hide history" : "Show history"}
          </button>
        )}
      </div>
      {files.length > 0 && (
        <footer className="attach-section">
          {files.length} Attachment{files.length > 1 ? "s" : ""} ·{" "}
          <button type="button" className="text-btn" onClick={() => actions.onSaveAll(files.map((a) => a.id))}>
            Save All
          </button>
          <div className="attach-list">
            {files.map((a) => {
              const kind = fileKind(a.filename, a.mime_type);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="attach-card"
                  onClick={() => actions.onOpenAttachment(a.id)}
                  title={a.filename ?? undefined}
                >
                  <span className="file-badge" style={{ background: kind.color }}>
                    {kind.label}
                  </span>
                  <span className="min-w-0">
                    <span className="name">{a.filename ?? `attachment-${a.id}`}</span>
                    <small>{fileSize(a.size_bytes)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </footer>
      )}
      <footer className="msg-card-foot">
        <div className="card-actions">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              cardActions.onReply();
            }}
          >
            <Reply /> Reply
          </button>
          {recipients > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                cardActions.onReplyAll();
              }}
            >
              <ReplyAll /> Reply All
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              cardActions.onForward();
            }}
          >
            <Forward /> Forward
          </button>
        </div>
      </footer>
    </article>
  );
}

function MessageCardPlaceholder({ item }: { item: MessageListItem }) {
  return (
    <article className="msg-card">
      <header className="msg-head">
        <span className="avatar" style={{ background: avatarColor(item.from_addr) }}>
          {initials(item.from_addr)}
        </span>
        <div className="msg-who">
          <div className="name">{senderLabel(item.from_addr)}</div>
          <div className="peek">{cleanSnippet(item.snippet) ?? item.subject ?? ""}</div>
        </div>
        <div className="msg-side">
          <span className="when">{readerWhen(item.date)}</span>
        </div>
      </header>
      <div className="msg-body">
        <p className="msg-loading">Loading message…</p>
      </div>
    </article>
  );
}

export function ReaderPane({
  detail,
  thread,
  threadDetails,
  loadingBodies,
  loadingBody,
  folderLabel,
  accountColor,
  accountName,
  loadRemote,
  themed,
  actions,
  renderMove,
  contactEmail,
  correspondenceAccountId,
}: {
  detail: MessageDetail | null;
  thread: MessageListItem[];
  threadDetails: Record<number, MessageDetail>;
  loadingBodies: Record<number, boolean>;
  loadingBody: boolean;
  folderLabel: string;
  accountColor: string | null;
  accountName: string;
  loadRemote: boolean;
  themed: boolean;
  actions: ReaderActions;
  renderMove: (trigger: React.ReactElement) => React.ReactNode;
  contactEmail: string | null;
  correspondenceAccountId: number | null;
}) {
  const [quoteOpenById, setQuoteOpenById] = useState<Record<number, boolean>>({});
  const [signatureOpenById, setSignatureOpenById] = useState<Record<number, boolean>>({});
  const [correspondenceOpen, setCorrespondenceOpen] = useState(
    () => localStorage.getItem("3mail.correspondenceRail") !== "0",
  );
  useEffect(() => {
    setQuoteOpenById({});
    setSignatureOpenById({});
  }, [detail?.list.id]);

  function toggleCorrespondenceRail() {
    setCorrespondenceOpen((open) => {
      const next = !open;
      localStorage.setItem("3mail.correspondenceRail", next ? "1" : "0");
      return next;
    });
  }

  const ordered = useMemo(
    () => thread.slice().sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [thread],
  );

  const cards =
    detail && ordered.length > 1
      ? ordered
      : detail
        ? [detail.list]
        : [];

  return (
    <section className="reader">
      <div className="pane-head reader-head" data-tauri-drag-region>
        {detail && (
          <>
            <button type="button" className="tool" aria-label="Close" title="Close" onClick={actions.onClose}>
              <X />
            </button>
            <span className="gap" />
            <button
              type="button"
              className={"tool" + (detail.list.pinned || detail.list.starred ? " on" : "")}
              style={{ "--tool-on": "#f97316" } as React.CSSProperties}
              aria-label={detail.list.pinned || detail.list.starred ? "Unpin" : "Pin"}
              title={detail.list.pinned || detail.list.starred ? "Unpin" : "Pin"}
              onClick={actions.onTogglePin}
            >
              <Pin className={detail.list.pinned || detail.list.starred ? "fill-current" : undefined} />
            </button>
            <button
              type="button"
              className="tool"
              aria-label={detail.list.unseen ? "Mark as read" : "Mark as unread"}
              title={detail.list.unseen ? "Mark as read" : "Mark as unread (U)"}
              onClick={actions.onToggleRead}
            >
              {detail.list.unseen ? <CircleDot /> : <Circle />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button type="button" className={"tool" + (detail.list.snoozed ? " on" : "")} aria-label="Snooze" title="Snooze">
                  <Clock />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SNOOZE_PRESETS.map(([id, label]) => (
                  <DropdownMenuItem key={id} onClick={() => actions.onSnooze(snoozeUntil(id))}>
                    {label}
                  </DropdownMenuItem>
                ))}
                {detail.list.snoozed && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => actions.onSnooze(null)}>Unsnooze</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" className="tool" aria-label="Archive" title="Archive (E)" onClick={actions.onArchive}>
              <Archive />
            </button>
            <button type="button" className="tool" aria-label="Delete" title="Delete (⌫)" onClick={actions.onDelete}>
              <Trash2 />
            </button>
            {renderMove(
              <button type="button" className="tool" aria-label="Move to" title="Move to (⌘⇧M)">
                <FolderInput />
              </button>,
            )}
            <MessageMenu
              detail={detail}
              actions={{
                onReply: actions.onReply,
                onReplyAll: actions.onReplyAll,
                onForward: actions.onForward,
                onToggleRead: actions.onToggleRead,
                onTogglePin: actions.onTogglePin,
              }}
            />
          </>
        )}
        <div className="drag" data-tauri-drag-region />
        {detail && accountColor && (
          <span className="avatar sm" style={{ background: accountColor }} title={accountName}>
            {initials(accountName)}
          </span>
        )}
      </div>

      {detail ? (
        <div className="reader-body">
        <div className="reader-scroll">
          <div className="reader-title">
            <h2>{detail.list.subject || "(no subject)"}</h2>
            <div className="chips">
              {folderLabel && <span className="chip">{folderLabel}</span>}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button type="button" className="chip cat" aria-label="Change category">
                    {categoryLabel(detail.list.category)}
                    <ChevronDown />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {CATEGORIES.map(([id, label]) => (
                    <DropdownMenuItem key={id} onClick={() => actions.onSetCategory(id)}>
                      {label}
                      {detail.list.category === id ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {cards.map((item) => {
            const cardDetail = threadDetails[item.id] ?? (item.id === detail.list.id ? detail : null);
            if (!cardDetail) {
              return <MessageCardPlaceholder key={item.id} item={item} />;
            }
            const cardLoading =
              item.id === detail.list.id
                ? loadingBody
                : Boolean(loadingBodies[item.id]) || !cardDetail.body_loaded;
            return (
              <MessageCard
                key={item.id}
                detail={cardDetail}
                loadingBody={cardLoading}
                loadRemote={loadRemote}
                themed={themed}
                actions={actions}
                quoteOpen={Boolean(quoteOpenById[item.id])}
                onToggleQuote={() =>
                  setQuoteOpenById((prev) => ({
                    ...prev,
                    [item.id]: !prev[item.id],
                  }))
                }
                signatureOpen={Boolean(signatureOpenById[item.id])}
                onToggleSignature={() =>
                  setSignatureOpenById((prev) => ({
                    ...prev,
                    [item.id]: !prev[item.id],
                  }))
                }
                toolbarPinRead={item.id === detail.list.id}
              />
            );
          })}
        </div>
        {contactEmail && correspondenceAccountId != null && (
          <>
            {!correspondenceOpen && (
              <button
                type="button"
                className="correspondence-toggle"
                aria-label="Show correspondence"
                title="Show correspondence"
                onClick={toggleCorrespondenceRail}
              />
            )}
            {correspondenceOpen && (
              <CorrespondenceRail
                accountId={correspondenceAccountId}
                contactEmail={contactEmail}
                selectedId={detail.list.id}
                onOpen={(id) => actions.onOpenMessage(id)}
                onClose={toggleCorrespondenceRail}
              />
            )}
          </>
        )}
        </div>
      ) : (
        <div className="reader-empty">
          <Mail />
          <span>No message selected</span>
        </div>
      )}
    </section>
  );
}
import {
  Archive,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  Ellipsis,
  FolderInput,
  Forward,
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
import { MailBody } from "./MailBody";
import {
  avatarColor,
  cleanSnippet,
  fileKind,
  fileSize,
  initials,
  readerWhen,
  senderLabel,
} from "./palette";
import {
  CATEGORIES,
  categoryLabel,
  type Attachment,
  type MessageDetail,
  type MessageListItem,
} from "./types";

function listedAttachments(detail: MessageDetail): Attachment[] {
  const html = (detail.html_body ?? "").toLowerCase();
  if (!html.includes("cid:")) return detail.attachments;
  const inline = detail.attachments.filter((a) => {
    const name = (a.filename ?? "").toLowerCase();
    return name.length > 0 && html.includes(name);
  });
  if (inline.length === 0 || inline.length === detail.attachments.length) return detail.attachments;
  const hidden = new Set(inline.map((a) => a.id));
  return detail.attachments.filter((a) => !hidden.has(a.id));
}

export type ReaderActions = {
  onClose: () => void;
  onTogglePin: () => void;
  onToggleRead: () => void;
  onSnooze: (until: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSetCategory: (category: string) => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
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
  actions: ReaderActions;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button type="button" className="tool" aria-label="More actions">
          <Ellipsis />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={actions.onReply} shortcut="R">Reply</DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onReplyAll} shortcut="⇧R">Reply All</DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onForward} shortcut="F">Forward</DropdownMenuItem>
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

function FullCard({
  detail,
  loadingBody,
  loadRemote,
  themed,
  actions,
}: {
  detail: MessageDetail;
  loadingBody: boolean;
  loadRemote: boolean;
  themed: boolean;
  actions: ReaderActions;
}) {
  const from = detail.list.from_addr;
  const to = splitAddrs(detail.to_addrs).map(senderLabel);
  const cc = splitAddrs(detail.cc_addrs).map(senderLabel);
  const files = listedAttachments(detail);
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
          <button type="button" className="tool" aria-label="Reply" title="Reply (R)" onClick={actions.onReply}>
            <Reply />
          </button>
          <MessageMenu detail={detail} actions={actions} />
        </div>
      </header>
      <div className="msg-body">
        {loadingBody ? (
          <p className="msg-loading">Loading message…</p>
        ) : (
          <MailBody
            textBody={detail.text_body}
            htmlBody={detail.html_body}
            loadRemote={loadRemote}
            onLoadRemote={actions.onLoadRemote}
            themed={themed}
          />
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
    </article>
  );
}

function FoldedCard({ item, onOpen }: { item: MessageListItem; onOpen: () => void }) {
  return (
    <article
      className="msg-card folded"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <header className="msg-head">
        <span className="avatar sm" style={{ background: avatarColor(item.from_addr) }}>
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
    </article>
  );
}

export function ReaderPane({
  detail,
  thread,
  loadingBody,
  folderLabel,
  accountColor,
  accountName,
  loadRemote,
  themed,
  actions,
  renderMove,
}: {
  detail: MessageDetail | null;
  thread: MessageListItem[];
  loadingBody: boolean;
  folderLabel: string;
  accountColor: string | null;
  accountName: string;
  loadRemote: boolean;
  themed: boolean;
  actions: ReaderActions;
  renderMove: (trigger: React.ReactElement) => React.ReactNode;
}) {
  const ordered = thread
    .slice()
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const stack = detail && ordered.some((m) => m.id === detail.list.id) && ordered.length > 1 ? ordered : null;
  const recipients = detail
    ? splitAddrs(detail.to_addrs).length + splitAddrs(detail.cc_addrs).length
    : 0;

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
            <MessageMenu detail={detail} actions={actions} />
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
        <>
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
            {stack ? (
              stack.map((item) =>
                item.id === detail.list.id ? (
                  <FullCard
                    key={item.id}
                    detail={detail}
                    loadingBody={loadingBody}
                    loadRemote={loadRemote}
                    themed={themed}
                    actions={actions}
                  />
                ) : (
                  <FoldedCard key={item.id} item={item} onOpen={() => actions.onOpenMessage(item.id)} />
                ),
              )
            ) : (
              <FullCard
                detail={detail}
                loadingBody={loadingBody}
                loadRemote={loadRemote}
                themed={themed}
                actions={actions}
              />
            )}
          </div>
          <div className="action-pill">
            <button type="button" onClick={actions.onReply}>
              <Reply /> Reply
            </button>
            {recipients > 1 && (
              <button type="button" onClick={actions.onReplyAll}>
                <ReplyAll /> Reply All
              </button>
            )}
            <button type="button" onClick={actions.onForward}>
              <Forward /> Forward
            </button>
          </div>
        </>
      ) : (
        <div className="reader-empty">
          <Mail />
          <span>No message selected</span>
        </div>
      )}
    </section>
  );
}

import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Archive,
  FolderInput,
  Inbox,
  MailOpen,
  Paperclip,
  PenLine,
  Pin,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { formatListDate } from "./mail-format";
import { SearchBox } from "./SearchBox";
import { avatarColor, cleanSnippet, initials, senderLabel } from "./palette";
import { CATEGORIES, type OutboxItem } from "./types";

export type ListRow = {
  key: string;
  id: number;
  accountId: number;
  folderId: number;
  unseen: boolean;
  from: string | null;
  subject: string | null;
  snippet: string | null;
  date: string | null;
  pinned: boolean;
  starred: boolean;
  attachments: boolean;
  count?: number;
  category: string;
  /** Set for a local draft row. */
  draftId?: number;
};

export type RowAction = "reply" | "replyAll" | "forward" | "archive" | "delete" | "move" | "pin" | "unread";

const CARD_PREVIEW = 5;

function MailRow({
  row,
  active,
  barColor,
  onClick,
  onContextMenu,
}: {
  row: ListRow;
  active: boolean;
  barColor?: string;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const snippet = cleanSnippet(row.snippet);
  const pinned = row.pinned || row.starred;
  return (
    <li
      data-row={row.key}
      className={"mail-item" + (active ? " active" : "")}
      onMouseDown={(event) => {
        if (event.button === 2) event.preventDefault();
      }}
      onContextMenu={(event) => {
        window.getSelection()?.removeAllRanges();
        onContextMenu(event);
      }}
    >
      <button
        type="button"
        className={"mail-row" + (row.unseen ? " unseen" : "") + (active ? " active" : "")}
        onMouseDown={(event) => {
          if (event.button === 2) event.preventDefault();
        }}
        onClick={onClick}
      >
        {row.unseen && <span className="dot" aria-label="Unread" />}
        <span className="avatar" style={{ background: avatarColor(row.from) }}>
          {initials(row.from)}
        </span>
        <span className="min-w-0">
          <span className="line">
            {barColor && <span className="acct-bar" style={{ background: barColor }} />}
            <span className="sender">{senderLabel(row.from)}</span>
            {pinned && <Pin className="pin fill-current" />}
            {row.count != null && row.count > 1 && <span className="count">{row.count}</span>}
            <span className="when">{formatListDate(row.date)}</span>
          </span>
          <span className="line">
            <span className="subject">{row.subject || "(no subject)"}</span>
            {row.attachments && (
              <span className="meta">
                <Paperclip />
              </span>
            )}
          </span>
          {snippet && <span className="snippet">{snippet}</span>}
        </span>
      </button>
    </li>
  );
}

function Group({
  icon,
  label,
  action,
  children,
}: {
  icon?: ReactNode;
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="group-block">
      <div className="group-label">
        {icon}
        {label}
        {action}
      </div>
      <ul>{children}</ul>
    </li>
  );
}

function dateGroup(iso: string | null, now: Date): string {
  if (!iso) return "Earlier";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This Week";
  return date.toLocaleDateString([], {
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} className="skeleton-row" aria-hidden>
          <span className="b round" />
          <span className="flex flex-col gap-2 pt-1">
            <span className="b" style={{ width: "45%", height: 11 }} />
            <span className="b" style={{ width: "80%", height: 10 }} />
            <span className="b" style={{ width: "65%", height: 10 }} />
          </span>
        </li>
      ))}
    </>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="empty-state">
      {icon}
      {children}
    </li>
  );
}

export function BulkPane({
  count,
  onClear,
  onArchive,
  onDelete,
  onPin,
  onUnread,
  move,
}: {
  count: number;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnread: () => void;
  move: (trigger: React.ReactElement) => React.ReactNode;
}) {
  return (
    <section className="reader">
      <div className="pane-head reader-head" data-tauri-drag-region>
        <button type="button" className="tool" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
          <X />
        </button>
        <span className="bulk-count">{count} selected</span>
        <span className="gap" />
        <button type="button" className="tool" aria-label="Archive" title="Archive" onClick={onArchive}>
          <Archive />
        </button>
        <button type="button" className="tool" aria-label="Delete" title="Delete" onClick={onDelete}>
          <Trash2 />
        </button>
        {move(
          <button type="button" className="tool" aria-label="Move to" title="Move to">
            <FolderInput />
          </button>,
        )}
        <button type="button" className="tool" aria-label="Pin" title="Pin" onClick={onPin}>
          <Pin />
        </button>
        <button type="button" className="tool" aria-label="Mark as unread" title="Mark as unread" onClick={onUnread}>
          <MailOpen />
        </button>
        <div className="drag" data-tauri-drag-region />
      </div>
      <div className="bulk-body">
        <span className="bulk-n">{count}</span>
        {count === 1 ? "conversation selected" : "conversations selected"}
      </div>
    </section>
  );
}

export function MailListPane({
  width,
  caption,
  searchRef,
  searchQuery,
  searching,
  onSearchQuery,
  onSearch,
  onClearSearch,
  onCompose,
  listMode,
  onListMode,
  showModeTabs,
  kind,
  rows,
  grouping,
  hiddenCards,
  selectedId,
  pickedKeys,
  orderRef,
  barColor,
  loading,
  canLoadMore,
  onLoadMore,
  onOpen,
  onPick,
  onRowAction,
  outbox,
  onRetryOutbox,
  onCancelOutbox,
}: {
  width: number;
  caption: string;
  searchRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  searching: boolean;
  onSearchQuery: (q: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onCompose: () => void;
  listMode: "smart" | "classic";
  onListMode: (mode: "smart" | "classic") => void;
  showModeTabs: boolean;
  kind: "mail" | "outbox";
  rows: ListRow[];
  /** `inbox` = Smart Inbox cards, `date` = by day, `flat` = no headers. */
  grouping: "inbox" | "date" | "flat";
  hiddenCards: string[];
  selectedId: number | null;
  pickedKeys: string[];
  /** Visual order of the rows currently painted, for keyboard movement. */
  orderRef: RefObject<string[]>;
  barColor?: (accountId: number) => string;
  loading: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onOpen: (row: ListRow) => void;
  onPick: (keys: string[]) => void;
  /** `bulk` is set when the row belongs to a multi-selection. */
  onRowAction: (row: ListRow, action: RowAction, bulk: boolean) => void;
  outbox: OutboxItem[];
  onRetryOutbox: (id: number) => void;
  onCancelOutbox: (id: number) => void;
}) {
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; row: ListRow } | null>(null);
  const anchor = useRef<string | null>(null);
  const order: string[] = [];

  function paint(list: ListRow[]) {
    return list.map((row) => {
      order.push(row.key);
      return (
        <MailRow
          key={row.key}
          row={row}
          active={pickedKeys.includes(row.key) || (pickedKeys.length === 0 && selectedId === row.id && row.draftId == null)}
          barColor={barColor?.(row.accountId)}
          onClick={(event) => {
            const keys = orderRef.current;
            if (event.shiftKey && anchor.current) {
              const a = keys.indexOf(anchor.current);
              const b = keys.indexOf(row.key);
              if (a >= 0 && b >= 0) {
                const [lo, hi] = a < b ? [a, b] : [b, a];
                onPick(keys.slice(lo, hi + 1));
                return;
              }
            }
            if (event.metaKey || event.ctrlKey) {
              anchor.current = row.key;
              onPick(
                pickedKeys.includes(row.key)
                  ? pickedKeys.filter((k) => k !== row.key)
                  : [...pickedKeys, row.key],
              );
              return;
            }
            anchor.current = row.key;
            onPick([row.key]);
            onOpen(row);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!pickedKeys.includes(row.key)) {
              anchor.current = row.key;
              onPick([row.key]);
            }
            setMenu({ x: event.clientX, y: event.clientY, row });
          }}
        />
      );
    });
  }

  function body(): ReactNode {
    if (kind === "outbox") {
      if (!outbox.length) {
        return <Empty icon={<Inbox />}>Outbox is empty</Empty>;
      }
      return outbox.map((o) => (
        <li key={o.id} className="plain-row">
          <div className="min-w-0 flex-1">
            <div className="sub">
              {o.status === "sending" ? "Sending" : o.status === "failed" ? "Failed" : "Queued"}
              {o.send_at ? ` · ${new Date(o.send_at).toLocaleString()}` : ""}
            </div>
            <div className="title">{o.subject || "(no subject)"}</div>
            <div className="sub">{o.to_addrs}</div>
            {o.last_error && <div className="err">{o.last_error}</div>}
            <div className="mt-1 flex gap-1">
              {o.status === "failed" && (
                <button type="button" className="text-btn" onClick={() => onRetryOutbox(o.id)}>
                  Retry
                </button>
              )}
              {o.status !== "sending" && (
                <button type="button" className="text-btn" onClick={() => onCancelOutbox(o.id)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </li>
      ));
    }
    if (!rows.length) {
      if (loading) return <Skeleton />;
      return (
        <Empty icon={searching ? <Search /> : <MailOpen />}>
          {searching ? "No results" : "Nothing here"}
        </Empty>
      );
    }
    if (grouping === "flat") return paint(rows);
    if (grouping === "date") {
      const now = new Date();
      const groups: { label: string; rows: ListRow[] }[] = [];
      for (const row of rows) {
        const label = dateGroup(row.date, now);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.rows.push(row);
        else groups.push({ label, rows: [row] });
      }
      return groups.map((g) => (
        <Group key={g.label} label={g.label}>
          {paint(g.rows)}
        </Group>
      ));
    }

    const pinRows = rows.filter((r) => r.pinned || r.starred);
    const rest = rows.filter((r) => !r.pinned && !r.starred);
    const unread = rest.filter((r) => r.unseen);
    const seen = rest.filter((r) => !r.unseen);
    const known = new Set<string>(CATEGORIES.map(([id]) => id));
    const cards =
      grouping === "inbox"
        ? CATEGORIES.filter(([id]) => !hiddenCards.includes(id)).map(([id, label]) => ({
            id,
            label,
            rows: unread.filter((r) => (known.has(r.category) ? r.category : "other") === id),
          }))
        : [];
    const carded = new Set(cards.flatMap((c) => c.rows.map((r) => r.key)));
    const loose = unread.filter((r) => !carded.has(r.key));

    return (
      <>
        {pinRows.length > 0 && (
          <Group icon={<Pin style={{ color: "#f97316" }} />} label="Pins">
            {paint(pinRows)}
          </Group>
        )}
        {cards
          .filter((c) => c.rows.length > 0)
          .map((card) => {
            const all = expandedCards.includes(card.id);
            const shown = all ? card.rows : card.rows.slice(0, CARD_PREVIEW);
            return (
              <Group
                key={card.id}
                label={card.label}
                action={
                  card.rows.length > CARD_PREVIEW ? (
                    <button
                      type="button"
                      className="more"
                      onClick={() =>
                        setExpandedCards((prev) =>
                          all ? prev.filter((id) => id !== card.id) : [...prev, card.id],
                        )
                      }
                    >
                      {all ? "Show less" : `See all ${card.rows.length}`}
                    </button>
                  ) : undefined
                }
              >
                {paint(shown)}
              </Group>
            );
          })}
        {loose.length > 0 && (
          <Group icon={<Sparkles />} label="New">
            {paint(loose)}
          </Group>
        )}
        {seen.length > 0 && (
          <Group icon={<MailOpen />} label="Seen">
            {paint(seen)}
          </Group>
        )}
      </>
    );
  }

  return (
    <section style={{ width }} className="list-pane">
      <div className="pane-head" data-tauri-drag-region>
        <SearchBox
          inputRef={searchRef}
          query={searchQuery}
          searching={searching}
          onQuery={onSearchQuery}
          onSearch={onSearch}
          onClear={onClearSearch}
        />
        <button type="button" className="compose-btn" aria-label="New message" title="New message (⌘N)" onClick={onCompose}>
          <PenLine className="size-3.5" />
        </button>
      </div>
      {showModeTabs && (
        <div className="list-tabs" role="tablist" aria-label="Inbox style">
          {(["smart", "classic"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={listMode === mode}
              className={listMode === mode ? "on" : ""}
              onClick={() => onListMode(mode)}
            >
              {mode === "smart" ? "Smart" : "Classic"}
            </button>
          ))}
        </div>
      )}
      {caption && <div className="list-caption">{caption}</div>}
      <div className="list-scroll">
        <ul>
          {body()}
          {void (orderRef.current = order)}
          {kind === "mail" && canLoadMore && rows.length > 0 && (
            <li className="load-more">
              <button type="button" className="text-btn" onClick={onLoadMore} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </button>
            </li>
          )}
        </ul>
      </div>
      {menu && (
        <>
          <div
            className="menu-backdrop"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="row-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {(menu.row.draftId != null
              ? ([["delete", "Delete"]] as [RowAction, string][])
              : ([
                  ["reply", "Reply"],
                  ["replyAll", "Reply All"],
                  ["forward", "Forward"],
                  ["sep", ""],
                  ["archive", "Archive"],
                  ["delete", "Delete"],
                  ["move", "Move to…"],
                  ["sep2", ""],
                  ["pin", menu.row.pinned || menu.row.starred ? "Unpin" : "Pin"],
                  ["unread", menu.row.unseen ? "Mark as Read" : "Mark as Unread"],
                ] as [RowAction | "sep" | "sep2", string][])
            ).map(([action, label]) =>
              action === "sep" || action === "sep2" ? (
                <div key={action} className="sep" />
              ) : (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  className={action === "delete" ? "danger" : ""}
                  onClick={() => {
                    const bulk = pickedKeys.length > 1 && pickedKeys.includes(menu.row.key);
                    setMenu(null);
                    onRowAction(menu.row, action, bulk);
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </section>
  );
}

import { Popover } from "@radix-ui/themes";
import {
  Archive,
  Check,
  ChevronRight,
  Folder as FolderIcon,
  Inbox,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { addrEmail } from "./mail-format";
import type { Account, Folder, MessageListItem } from "./types";

const HISTORY_KEY = "3mail.moveHistory";
const MAX_RECENT = 8;
const MAX_SUGGESTIONS = 4;
const ROLE_ORDER = ["inbox", "archive", "junk", "trash", "sent"];

type History = { senders: Record<string, Record<string, number>>; recent: number[] };

function readHistory(): History {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as Partial<History>;
    return { senders: raw.senders ?? {}, recent: Array.isArray(raw.recent) ? raw.recent : [] };
  } catch {
    return { senders: {}, recent: [] };
  }
}

export function recordMove(fromAddr: string | null, folderId: number) {
  const history = readHistory();
  const sender = fromAddr ? addrEmail(fromAddr) : "";
  if (sender) {
    const counts = (history.senders[sender] ??= {});
    counts[folderId] = (counts[folderId] ?? 0) + 1;
  }
  history.recent = [folderId, ...history.recent.filter((id) => id !== folderId)].slice(0, MAX_RECENT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

/** Hierarchy delimiter, inferred from which split yields parents that exist as folders. */
function guessDelimiter(paths: string[]): string | null {
  const set = new Set(paths);
  for (const d of ["/", "."]) {
    if (paths.some((p) => p.lastIndexOf(d) > 0 && set.has(p.slice(0, p.lastIndexOf(d))))) return d;
  }
  return paths.some((p) => p.includes("/")) ? "/" : null;
}

function splitPath(name: string, delim: string | null): string[] {
  if (!delim) return [name];
  const parts = name.split(delim).filter(Boolean);
  return parts.length ? parts : [name];
}

type TreeNode = {
  key: string;
  label: string;
  folder?: Folder;
  children: TreeNode[];
};

function rank(folder: Folder | undefined): number {
  const i = folder?.role ? ROLE_ORDER.indexOf(folder.role) : -1;
  return i < 0 ? ROLE_ORDER.length : i;
}

function buildTree(folders: Folder[], delim: string | null): TreeNode[] {
  const root: TreeNode = { key: "", label: "", children: [] };
  for (const folder of folders) {
    let node = root;
    const parts = splitPath(folder.name, delim);
    parts.forEach((part, i) => {
      const key = `${folder.account_id}:${parts.slice(0, i + 1).join("\u0000")}`;
      let child = node.children.find((c) => c.key === key);
      if (!child) {
        child = { key, label: part, children: [] };
        node.children.push(child);
      }
      if (i === parts.length - 1) child.folder = folder;
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) =>
        rank(a.folder) - rank(b.folder) ||
        a.label.localeCompare(b.label, "zh-Hans-CN", { sensitivity: "base" }),
    );
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

type Delims = Map<number, string | null>;

function leafOf(folder: Folder, delims: Delims): string {
  return splitPath(folder.name, delims.get(folder.account_id) ?? null).pop() ?? folder.name;
}

function parentOf(folder: Folder, delims: Delims): string {
  const leaf = leafOf(folder, delims);
  return folder.name.length > leaf.length ? folder.name.slice(0, -leaf.length - 1) : "";
}

type Match = { score: number; hits: number[] };

function subsequence(q: string, text: string): number[] | null {
  const hits: number[] = [];
  let from = 0;
  for (const ch of q) {
    const i = text.indexOf(ch, from);
    if (i < 0) return null;
    hits.push(i);
    from = i + 1;
  }
  return hits;
}

function matchFolder(query: string, folder: Folder, delims: Delims): Match | null {
  const q = query.toLowerCase();
  const leaf = leafOf(folder, delims).toLowerCase();
  const path = folder.name.toLowerCase();
  const range = (start: number) => Array.from({ length: q.length }, (_, i) => start + i);
  if (leaf === q) return { score: 1000, hits: range(0) };
  if (leaf.startsWith(q)) return { score: 800 - (leaf.length - q.length), hits: range(0) };
  const at = leaf.indexOf(q);
  if (at > 0) {
    const boundary = /[\s_\-.()[\]【】]/.test(leaf[at - 1]);
    return { score: (boundary ? 600 : 500) - at, hits: range(at) };
  }
  if (path.includes(q)) return { score: 300, hits: [] };
  const seq = subsequence(q, leaf);
  if (seq) return { score: 150 - (seq[seq.length - 1] - seq[0]), hits: seq };
  if (subsequence(q, path)) return { score: 60, hits: [] };
  return null;
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>,
      )}
    </>
  );
}

function RoleIcon({ folder }: { folder?: Folder }) {
  switch (folder?.role) {
    case "inbox":
      return <Inbox />;
    case "archive":
      return <Archive />;
    case "trash":
      return <Trash2 />;
    case "junk":
      return <ShieldAlert />;
    case "sent":
      return <Send />;
    default:
      return <FolderIcon />;
  }
}

type Row =
  | { kind: "folder"; key: string; folder: Folder; depth: number; node?: TreeNode; hits?: number[]; hint?: string }
  | { kind: "branch"; key: string; node: TreeNode; depth: number }
  | { kind: "create"; key: string; accountId: number; name?: string };

export function MovePicker({
  open,
  onOpenChange,
  accounts,
  folders,
  message,
  accountColor,
  showAccounts,
  onMove,
  onCreate,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  folders: Folder[];
  message: MessageListItem;
  accountColor: (accountId: number) => string;
  showAccounts: boolean;
  onMove: (folder: Folder) => void;
  onCreate: (accountId: number, name: string) => void;
  children: ReactElement;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const targets = useMemo(() => folders.filter((f) => f.role !== "drafts"), [folders]);
  const accountName = (id: number) => {
    const a = accounts.find((x) => x.id === id);
    return a?.display_name || a?.email || "";
  };
  const orderedAccounts = useMemo(
    () =>
      accounts
        .slice()
        .sort((a, b) => Number(b.id === message.account_id) - Number(a.id === message.account_id)),
    [accounts, message.account_id],
  );
  const delims: Delims = useMemo(
    () =>
      new Map(
        accounts.map((a) => [
          a.id,
          guessDelimiter(targets.filter((f) => f.account_id === a.id).map((f) => f.name)),
        ]),
      ),
    [accounts, targets],
  );
  const leaf = (f: Folder) => leafOf(f, delims);
  const trees = useMemo(
    () =>
      orderedAccounts.map((a) => ({
        account: a,
        nodes: buildTree(
          targets.filter((f) => f.account_id === a.id),
          delims.get(a.id) ?? null,
        ),
      })),
    [orderedAccounts, targets, delims],
  );

  const history = useMemo(() => (open ? readHistory() : { senders: {}, recent: [] }), [open]);
  const senderCounts = history.senders[addrEmail(message.from_addr ?? "")] ?? {};
  const affinity = (id: number) => {
    const recent = history.recent.indexOf(id);
    return (senderCounts[id] ?? 0) * 40 + (recent < 0 ? 0 : 30 - recent * 3);
  };

  const suggestions = useMemo(() => {
    const ids = [
      ...Object.entries(senderCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => Number(id)),
      ...history.recent,
    ];
    const seen = new Set<number>();
    const out: Folder[] = [];
    for (const id of ids) {
      if (seen.has(id) || id === message.folder_id) continue;
      seen.add(id);
      const folder = targets.find((f) => f.id === id);
      if (folder) out.push(folder);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }, [history, senderCounts, targets, message.folder_id]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return targets
      .map((folder) => ({ folder, match: matchFolder(q, folder, delims) }))
      .filter((r): r is { folder: Folder; match: Match } => r.match != null)
      .map((r) => ({
        ...r,
        score:
          r.match.score +
          affinity(r.folder.id) +
          (r.folder.account_id === message.account_id ? 10 : 0) -
          (r.folder.id === message.folder_id ? 500 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, targets, history, message.account_id, message.folder_id]);

  const q = query.trim();
  const top = results[0];
  const ghost =
    top && q && leaf(top.folder).toLowerCase().startsWith(q.toLowerCase())
      ? leaf(top.folder).slice(q.length)
      : "";

  const rows: Row[] = useMemo(() => {
    if (q) {
      const out: Row[] = results.map(({ folder, match }) => ({
        kind: "folder",
        key: `r${folder.id}`,
        folder,
        depth: 0,
        hits: match.hits,
        hint: [parentOf(folder, delims), showAccounts ? accountName(folder.account_id) : ""]
          .filter(Boolean)
          .join(" · "),
      }));
      const exact = results.some(
        (r) => r.folder.account_id === message.account_id && leaf(r.folder).toLowerCase() === q.toLowerCase(),
      );
      if (!exact) out.push({ kind: "create", key: "create-q", accountId: message.account_id, name: q });
      return out;
    }
    const out: Row[] = suggestions.map((folder) => ({
      kind: "folder",
      key: `s${folder.id}`,
      folder,
      depth: 0,
      hint: showAccounts ? accountName(folder.account_id) : parentOf(folder, delims),
    }));
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        out.push(
          node.folder
            ? { kind: "folder", key: node.key, folder: node.folder, depth, node }
            : { kind: "branch", key: node.key, node, depth },
        );
        if (node.children.length && expanded.has(node.key)) walk(node.children, depth + 1);
      }
    };
    for (const { account, nodes } of trees) {
      walk(nodes, 0);
      out.push({ kind: "create", key: `create-${account.id}`, accountId: account.id });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, results, suggestions, trees, expanded, showAccounts, message.account_id]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCreating(null);
    setNewName("");
    setActive(0);
    // Reveal the folder the message is in.
    const current = targets.find((f) => f.id === message.folder_id);
    if (current) {
      const delim = delims.get(current.account_id) ?? null;
      const parts = splitPath(current.name, delim);
      setExpanded(
        new Set(parts.slice(0, -1).map((_, i) => `${current.account_id}:${parts.slice(0, i + 1).join("\u0000")}`)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function toggle(key: string, on?: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "branch") return toggle(row.key);
    if (row.kind === "create") {
      if (row.name) return onCreate(row.accountId, row.name);
      setCreating(row.accountId);
      setNewName("");
      return;
    }
    if (row.folder.id !== message.folder_id) onMove(row.folder);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const row = rows[active];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(row);
    } else if (e.key === "Tab" && ghost) {
      e.preventDefault();
      setQuery(q + ghost);
    } else if (!q && e.key === "ArrowRight" && row && row.kind !== "create" && row.node?.children.length) {
      e.preventDefault();
      toggle(row.key, true);
    } else if (!q && e.key === "ArrowLeft" && row && row.kind !== "create" && row.node?.children.length) {
      e.preventDefault();
      toggle(row.key, false);
    }
  }

  let lastAccount: number | null = null;
  let suggestionHeader = !q && suggestions.length > 0;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>{children}</Popover.Trigger>
      <Popover.Content size="1" align="start" className="mv" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="mv-search">
          <Search />
          <div className="mv-input">
            {ghost && (
              <span className="mv-ghost" aria-hidden>
                <span>{q}</span>
                {ghost}
              </span>
            )}
            <input
              autoFocus
              value={query}
              placeholder="Move to folder…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
            />
          </div>
          {ghost && <kbd>Tab</kbd>}
        </div>
        <div className="mv-list" ref={listRef} role="listbox">
          {rows.map((row, idx) => {
            const header: ReactElement[] = [];
            if (suggestionHeader && idx === 0) {
              header.push(<div key="h-s" className="mv-section">Suggestions</div>);
            }
            const rowAccount =
              row.kind === "create" ? row.accountId : row.kind === "folder" ? row.folder.account_id : Number(row.key.split(":")[0]);
            const inTree = !q && !(row.kind === "folder" && row.key.startsWith("s"));
            if (inTree && rowAccount !== lastAccount) {
              lastAccount = rowAccount;
              suggestionHeader = false;
              if (showAccounts || suggestions.length > 0) {
                header.push(
                  <div key={`h-${rowAccount}`} className="mv-section">
                    {showAccounts && <i style={{ background: accountColor(rowAccount) }} />}
                    {showAccounts ? accountName(rowAccount) : "Folders"}
                  </div>,
                );
              }
            }
            if (q && idx === 0 && results.length > 0) {
              header.push(<div key="h-r" className="mv-section">Matches</div>);
            }

            const activeCls = idx === active ? " on" : "";
            if (row.kind === "create") {
              if (creating === row.accountId && !row.name) {
                return (
                  <div key={row.key}>
                    {header}
                    <form
                      className="mv-row mv-new"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (newName.trim()) onCreate(row.accountId, newName.trim());
                      }}
                    >
                      <Plus />
                      <input
                        autoFocus
                        value={newName}
                        placeholder="Folder name"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setCreating(null);
                          }
                        }}
                      />
                    </form>
                  </div>
                );
              }
              return (
                <div key={row.key}>
                  {header}
                  <button
                    type="button"
                    data-idx={idx}
                    className={"mv-row mv-create" + activeCls}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(row)}
                  >
                    <Plus />
                    <span className="mv-label">
                      {row.name ? <>Create “{row.name}”{showAccounts && ` in ${accountName(row.accountId)}`}</> : "Create New Folder"}
                    </span>
                  </button>
                </div>
              );
            }

            const node = row.node;
            const hasKids = Boolean(node?.children.length);
            const open_ = hasKids && expanded.has(row.key);
            const folder = row.kind === "folder" ? row.folder : undefined;
            const current = folder?.id === message.folder_id;
            const label = row.kind === "branch" ? row.node.label : node ? node.label : leaf(row.folder);
            return (
              <div key={row.key}>
                {header}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  data-idx={idx}
                  className={"mv-row" + activeCls + (current ? " current" : "") + (row.kind === "branch" ? " branch" : "")}
                  style={{ paddingLeft: 10 + row.depth * 16 }}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(row)}
                >
                  <RoleIcon folder={folder} />
                  <span className="mv-label">
                    {row.kind === "folder" && row.hits ? <Highlight text={label} hits={row.hits} /> : label}
                    {row.kind === "folder" && row.hint && <small>{row.hint}</small>}
                  </span>
                  {current && <Check className="mv-check" />}
                  {hasKids && (
                    <span
                      className={"mv-chevron" + (open_ ? " open" : "")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(row.key);
                      }}
                    >
                      <ChevronRight />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          {q && results.length === 0 && <div className="mv-empty">No folder matches “{q}”</div>}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

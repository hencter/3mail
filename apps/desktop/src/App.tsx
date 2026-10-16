import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AccountSetupForm, accountToForm } from "./AccountSetupForm";
import { useAppearance, useResolvedMode } from "./appearance";
import { blankCompose, ComposeWindow, composeHasContent, type ComposeState } from "./Compose";
import { buildQuote, composeBodies, escapeHtml, splitDraftHtml } from "./compose-html";
import { addrEmail, splitAddrs } from "./mail-format";
import { BulkPane, MailListPane, type ListRow, type RowAction } from "./MailList";
import { useAccountColors } from "./palette";
import { MovePicker, recordMove } from "./MovePicker";
import { ReaderPane, type ReaderActions } from "./Reader";
import { SettingsDialog, SignatureEditor } from "./SettingsDialog";
import {
  eventToBinding,
  findAction,
  hasModifier,
  menuAccelerator,
  readKeymap,
  useKeymap,
  type ShortcutAction,
} from "./shortcuts";
import { MailSidebar } from "./sidebar";
import type {
  Account,
  AccountForm,
  CategoryFilter,
  Draft,
  Folder,
  MailPane,
  MessageDetail,
  MessageListItem,
  Nav,
  OutboxItem,
  SettingsPage,
  Signature,
  SmartFolderId,
  ThreadSummary,
} from "./types";

const PAGE = 80;

const ROLE_NAMES: Record<string, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  trash: "Trash",
  junk: "Spam",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readNav(): Nav {
  const parsed = readJson<Nav | null>("3mail.nav", null);
  if (parsed && typeof parsed.kind === "string") return parsed;
  return { kind: "role", role: "inbox", accountId: null };
}

function navActive(nav: Nav, many: boolean): string {
  if (nav.kind === "folder") return `folder:${nav.folderId}`;
  if (nav.kind === "smart") return `smart:${nav.id}`;
  const key =
    nav.kind === "role" ? nav.role : nav.kind;
  if (!many || nav.accountId == null) return key;
  return `${key}:${nav.accountId}`;
}

function byDate<T extends { date: string | null }>(items: T[]): T[] {
  return items.slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function foldersForNav(current: Nav, all: Folder[]): Folder[] {
  if (current.kind === "folder") {
    return all.filter((f) => f.id === current.folderId);
  }
  if (current.kind === "role" || current.kind === "snoozed" || current.kind === "smart") {
    const role = current.kind === "role" ? current.role : "inbox";
    return all.filter(
      (f) => f.role === role && (current.accountId == null || f.account_id === current.accountId),
    );
  }
  return [];
}

function readCols(): { side: number; list: number } {
  const parsed = readJson<{ side?: number; list?: number }>("3mail.cols", {});
  if (parsed.side && parsed.list && parsed.side >= 180 && parsed.list >= 260) {
    return { side: parsed.side, list: parsed.list };
  }
  return { side: 230, list: 340 };
}

const actionGate = { name: "", at: 0 };

function gateAction(name: string, fn: () => void) {
  const now = Date.now();
  if (actionGate.name === name && now - actionGate.at < 250) return;
  actionGate.name = name;
  actionGate.at = now;
  fn();
}

function startColumnDrag(
  event: React.PointerEvent,
  start: number,
  apply: (width: number) => void,
) {
  event.preventDefault();
  const startX = event.clientX;
  const move = (ev: PointerEvent) => apply(start + ev.clientX - startX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageListItem[]>([]);
  const [loadingBody, setLoadingBody] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState("Get new mail");
  const syncTimer = useRef<number | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountInitial, setAccountInitial] = useState<AccountForm | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("accounts");
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [sigPick, setSigPick] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [listMode, setListMode] = useState<"smart" | "classic">(() =>
    localStorage.getItem("3mail.listMode") === "classic" ? "classic" : "smart",
  );
  const [limit, setLimit] = useState(PAGE);
  const [listLoading, setListLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageListItem[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [pane, setPane] = useState<MailPane>("mail");
  const [nav, setNav] = useState<Nav>(readNav);
  const [pins, setPins] = useState<MessageListItem[]>([]);
  const [recents, setRecents] = useState<number[]>(() => readJson<number[]>("3mail.recents", []));
  const appearance = useAppearance();
  const colorMode = useResolvedMode(appearance.mode);
  const keymap = useKeymap();
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [loadRemote, setLoadRemote] = useState(
    () => localStorage.getItem("3mail.remoteImages") === "1",
  );
  const [hiddenCards, setHiddenCards] = useState<string[]>(() =>
    readJson<string[]>("3mail.inboxCards", []),
  );
  const [cols, setCols] = useState(readCols);
  const searchRef = useRef<HTMLInputElement>(null);
  const syncTried = useRef(new Set<number>());
  const actionsRef = useRef<Record<ShortcutAction, () => void>>({
    compose: () => {},
    reply: () => {},
    replyAll: () => {},
    forward: () => {},
    archive: () => {},
    move: () => {},
    delete: () => {},
    unread: () => {},
    sync: () => {},
    settings: () => {},
    search: () => {},
    next: () => {},
    prev: () => {},
    close: () => {},
  });
  const [sigEditorOpen, setSigEditorOpen] = useState(false);
  const [sigEditId, setSigEditId] = useState<number | null>(null);
  const [sigName, setSigName] = useState("");
  const [sigBody, setSigBody] = useState("");
  const [sigHtml, setSigHtml] = useState("");
  const [sigDefault, setSigDefault] = useState(true);
  const [moveOpen, setMoveOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [serverDrafts, setServerDrafts] = useState<MessageListItem[]>([]);
  const composeRef = useRef<ComposeState | null>(null);
  const skipSave = useRef(false);
  composeRef.current = compose;

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const accountColor = useAccountColors(accountIds);
  const many = accounts.length > 1;
  const needsOnboarding = accounts.length === 0;
  const sigAccountId = compose?.accountId ?? sigPick ?? selectedAccount;

  function notify(message: string) {
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  }

  function markSyncing() {
    setSyncing(true);
    if (syncTimer.current != null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => setSyncing(false), 2000);
  }

  const refreshAccounts = useCallback(async () => {
    const list = await invoke<Account[]>("list_accounts");
    setAccounts(list);
    setSelectedAccount((prev) => {
      if (prev != null && list.some((a) => a.id === prev)) return prev;
      const saved = Number(localStorage.getItem("3mail.account"));
      if (list.some((a) => a.id === saved)) return saved;
      return list[0]?.id ?? null;
    });
    if (!list.length) {
      setFolders([]);
      setMessages([]);
    }
  }, []);

  const refreshFolders = useCallback(async (ids: number[]) => {
    if (!ids.length) {
      setFolders([]);
      return;
    }
    const lists = await Promise.all(
      ids.map((accountId) => invoke<Folder[]>("list_folders", { accountId })),
    );
    setFolders(lists.flat());
  }, []);

  const refreshLocals = useCallback(async (ids: number[]) => {
    if (!ids.length) {
      setDrafts([]);
      setOutbox([]);
      setPins([]);
      return;
    }
    const [draftLists, outboxLists, pinLists] = await Promise.all([
      Promise.all(ids.map((accountId) => invoke<Draft[]>("list_drafts", { accountId }))),
      Promise.all(ids.map((accountId) => invoke<OutboxItem[]>("list_outbox", { accountId }))),
      Promise.all(
        ids.map((accountId) => invoke<MessageListItem[]>("list_pinned", { accountId, limit: PAGE })),
      ),
    ]);
    setDrafts(draftLists.flat());
    setOutbox(outboxLists.flat());
    setPins(pinLists.flat());
  }, []);

  const loadMail = useCallback(
    async (ids: number[], filter: CategoryFilter, threaded: boolean, max: number) => {
      if (!ids.length) {
        setMessages([]);
        setThreads([]);
        return;
      }
      setListLoading(true);
      try {
        if (filter === "snoozed") {
          const lists = await Promise.all(
            ids.map((folderId) =>
              invoke<MessageListItem[]>("list_messages", {
                folderId,
                limit: max,
                offset: 0,
                snoozedOnly: true,
                includeSnoozed: true,
              }),
            ),
          );
          setMessages(byDate(lists.flat()).slice(0, max));
          setThreads([]);
          return;
        }
        const category = filter === "all" ? null : filter;
        if (threaded) {
          const lists = await Promise.all(
            ids.map((folderId) =>
              invoke<ThreadSummary[]>("list_threads", { folderId, limit: max, offset: 0, category }),
            ),
          );
          setThreads(byDate(lists.flat()).slice(0, max));
          setMessages([]);
        } else {
          const lists = await Promise.all(
            ids.map((folderId) =>
              invoke<MessageListItem[]>("list_messages", { folderId, limit: max, offset: 0, category }),
            ),
          );
          setMessages(byDate(lists.flat()).slice(0, max));
          setThreads([]);
        }
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  const refreshSignatures = useCallback(async (accountId: number) => {
    const list = await invoke<Signature[]>("list_signatures", { accountId });
    setSignatures(list);
    return list;
  }, []);

  const loadThreadTimeline = useCallback(async (accountId: number, detail: MessageDetail) => {
    const key = detail.list.thread_key ?? `singleton:${detail.list.id}`;
    try {
      const list = await invoke<MessageListItem[]>("list_thread_messages", {
        accountId,
        threadKey: key,
      });
      setThreadMessages(list);
    } catch {
      setThreadMessages([]);
    }
  }, []);

  useEffect(() => {
    refreshAccounts().catch((e) => setError(String(e)));
  }, [refreshAccounts]);

  useEffect(() => {
    if (selectedAccount != null) {
      localStorage.setItem("3mail.account", String(selectedAccount));
    }
  }, [selectedAccount]);

  useEffect(() => {
    refreshFolders(accountIds).catch((e) => setError(String(e)));
    refreshLocals(accountIds).catch((e) => setError(String(e)));
  }, [accountIds, refreshFolders, refreshLocals]);

  useEffect(() => {
    localStorage.setItem("3mail.cols", JSON.stringify(cols));
  }, [cols]);

  useEffect(() => {
    localStorage.setItem("3mail.nav", JSON.stringify(nav));
    setLimit(PAGE);
  }, [nav]);

  useEffect(() => {
    localStorage.setItem("3mail.recents", JSON.stringify(recents));
  }, [recents]);

  useEffect(() => {
    localStorage.setItem("3mail.inboxCards", JSON.stringify(hiddenCards));
  }, [hiddenCards]);

  const mailFolders = foldersForNav(nav, folders);
  const mailKey = mailFolders.map((f) => f.id).join(",");
  const threaded = categoryFilter !== "snoozed" && nav.kind !== "smart";

  useEffect(() => {
    if (pane !== "mail") return;
    const ids = mailKey ? mailKey.split(",").map(Number) : [];
    loadMail(ids, categoryFilter, threaded, limit).catch((e) => setError(String(e)));
  }, [pane, mailKey, categoryFilter, threaded, limit, loadMail]);

  useEffect(() => {
    if (nav.kind !== "drafts") {
      setServerDrafts([]);
      return;
    }
    const draftFolders = folders.filter(
      (f) => f.role === "drafts" && (nav.accountId == null || f.account_id === nav.accountId),
    );
    let cancelled = false;
    Promise.all(
      draftFolders.map((f) =>
        invoke<MessageListItem[]>("list_messages", { folderId: f.id, limit: 200 }),
      ),
    )
      .then((lists) => {
        if (!cancelled) setServerDrafts(lists.flat());
      })
      .catch(() => {});
    for (const folder of draftFolders) {
      if (folder.synced || syncTried.current.has(folder.id)) continue;
      syncTried.current.add(folder.id);
      invoke("start_sync", { accountId: folder.account_id, folderId: folder.id }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [nav, folders]);

  useEffect(() => {
    if (pane !== "mail") return;
    for (const folder of foldersForNav(nav, folders)) {
      if (folder.synced || syncTried.current.has(folder.id)) continue;
      syncTried.current.add(folder.id);
      markSyncing();
      invoke("start_sync", { accountId: folder.account_id, folderId: folder.id }).catch((e) =>
        setError(String(e)),
      );
    }
  }, [pane, nav, folders]);

  useEffect(() => {
    if (sigAccountId != null) {
      refreshSignatures(sigAccountId).catch(() => {});
    }
  }, [sigAccountId, refreshSignatures]);

  useEffect(() => {
    const unsubs = [
      listen("mail_updated", () => {
        if (pane === "mail") {
          const folderIds = foldersForNav(nav, folders).map((f) => f.id);
          loadMail(folderIds, categoryFilter, threaded, limit).catch(() => {});
        }
        refreshFolders(accountIds).catch(() => {});
        refreshLocals(accountIds).catch(() => {});
        if (sigAccountId != null) refreshSignatures(sigAccountId).catch(() => {});
        refreshAccounts().catch(() => {});
        if (selectedMessage) {
          invoke<MessageDetail | null>("get_message", { messageId: selectedMessage.list.id })
            .then((d) => {
              if (d) {
                setSelectedMessage(d);
                loadThreadTimeline(d.list.account_id, d).catch(() => {});
              } else {
                setSelectedMessage(null);
                setThreadMessages([]);
              }
            })
            .catch(() => {});
        }
      }),
      listen<{ phase: string; detail?: string }>("sync_progress", (ev) => {
        markSyncing();
        setSyncLabel(
          `Sync: ${ev.payload.phase}${ev.payload.detail ? ` — ${ev.payload.detail}` : ""}`,
        );
      }),
      listen<{ message: string }>("sync_error", (ev) => {
        setError(ev.payload.message);
      }),
      listen("outbox_updated", () => {
        refreshLocals(accountIds).catch(() => {});
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
  }, [
    selectedMessage,
    categoryFilter,
    threaded,
    limit,
    pane,
    nav,
    folders,
    accountIds,
    sigAccountId,
    loadMail,
    refreshFolders,
    refreshLocals,
    refreshAccounts,
    refreshSignatures,
    loadThreadTimeline,
  ]);

  async function onSync() {
    const targets = foldersForNav(nav, folders);
    const fallback =
      targets.length > 0
        ? targets
        : folders.filter(
            (f) => f.role === "inbox" && (selectedAccount == null || f.account_id === selectedAccount),
          );
    if (!fallback.length) return;
    setError(null);
    setSyncing(true);
    setSyncLabel("Syncing…");
    try {
      for (const folder of fallback) {
        await invoke("start_sync", { accountId: folder.account_id, folderId: folder.id });
      }
      setSyncLabel("Up to date");
    } catch (err) {
      setError(String(err));
      setSyncLabel("Sync failed");
    } finally {
      markSyncing();
    }
  }

  function patchSelected(patch: Partial<MessageListItem>) {
    setSelectedMessage((current) =>
      current ? { ...current, list: { ...current.list, ...patch } } : current,
    );
  }

  async function onOpenMessage(id: number): Promise<MessageDetail | null> {
    const editing = composeRef.current;
    if (editing?.placement === "pane") {
      composeRef.current = null;
      setCompose(null);
      if (!skipSave.current && composeHasContent(editing)) {
        saveDraft(editing).catch((err) => setError(String(err)));
      }
      skipSave.current = false;
    }
    setError(null);
    setLoadingBody(false);
    try {
      let detail = await invoke<MessageDetail | null>("get_message", { messageId: id });
      setSelectedMessage(detail);
      if (detail) {
        setSelectedAccount(detail.list.account_id);
        await loadThreadTimeline(detail.list.account_id, detail);
      } else {
        setThreadMessages([]);
      }
      if (detail && !detail.body_loaded) {
        setLoadingBody(true);
        await invoke("fetch_body", { messageId: id });
        detail = await invoke<MessageDetail | null>("get_message", { messageId: id });
        setSelectedMessage(detail);
        if (detail) {
          setSelectedAccount(detail.list.account_id);
          await loadThreadTimeline(detail.list.account_id, detail);
        }
        setLoadingBody(false);
      }
      if (detail?.list.unseen) {
        await invoke("mark_read", { messageId: id, seen: true });
        patchSelected({ unseen: false });
      }
      return detail;
    } catch (err) {
      setLoadingBody(false);
      setError(String(err));
      return null;
    }
  }

  function closeMessage() {
    setSelectedMessage(null);
    setThreadMessages([]);
  }

  function offerUndo(label: string, run: () => Promise<void>) {
    if (undoTimer.current != null) window.clearTimeout(undoTimer.current);
    setUndo({ label, run });
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  }

  async function onArchive() {
    if (!selectedMessage) return;
    const id = selectedMessage.list.id;
    try {
      await invoke("archive_message", { messageId: id });
      closeMessage();
      offerUndo("Archived", async () => {
        await invoke("move_message", { messageId: id, targetRole: "inbox" });
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDelete() {
    if (!selectedMessage) return;
    const id = selectedMessage.list.id;
    try {
      await invoke("delete_message", { messageId: id });
      closeMessage();
      offerUndo("Moved to Trash", async () => {
        await invoke("move_message", { messageId: id, targetRole: "inbox" });
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshSelected() {
    if (!selectedMessage) return;
    const detail = await invoke<MessageDetail | null>("get_message", {
      messageId: selectedMessage.list.id,
    });
    if (detail) setSelectedMessage(detail);
  }

  async function onOpenAttachment(attId: number) {
    try {
      await invoke<{ path: string }>("open_attachment", { attachmentId: attId });
      await refreshSelected();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onSaveAll(ids: number[]) {
    try {
      for (const attachmentId of ids) {
        await invoke("download_attachment", { attachmentId });
      }
      notify(`Saved ${ids.length} attachment${ids.length > 1 ? "s" : ""}`);
      await refreshSelected();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onTogglePin() {
    if (!selectedMessage) return;
    const next = !(selectedMessage.list.pinned || selectedMessage.list.starred);
    const id = selectedMessage.list.id;
    try {
      await invoke("pin_message", { messageId: id, pinned: next });
      patchSelected({ pinned: next, starred: next });
      if (next) {
        offerUndo("Pinned", async () => {
          await invoke("pin_message", { messageId: id, pinned: false });
          patchSelected({ pinned: false, starred: false });
        });
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function onSnooze(until: string | null) {
    if (!selectedMessage) return;
    try {
      await invoke("snooze_message", { messageId: selectedMessage.list.id, until });
      closeMessage();
      notify(until == null ? "Unsnoozed" : `Snoozed until ${new Date(until).toLocaleString()}`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onToggleRead() {
    if (!selectedMessage) return;
    const seen = selectedMessage.list.unseen;
    try {
      await invoke("mark_read", { messageId: selectedMessage.list.id, seen });
      patchSelected({ unseen: !seen });
    } catch (err) {
      setError(String(err));
    }
  }

  async function onMarkUnread() {
    if (!selectedMessage || selectedMessage.list.unseen) return;
    await onToggleRead();
  }

  function pickedRows(): ListRow[] {
    const keys = new Set(picked);
    return shownRows.filter((row) => keys.has(row.key));
  }

  async function onMoveTo(folder: Folder) {
    const ids = pickedRows()
      .filter((row) => row.draftId == null)
      .map((row) => row.id);
    const messageIds = ids.length ? ids : selectedMessage ? [selectedMessage.list.id] : [];
    if (!messageIds.length) return;
    const from = selectedMessage?.list.from_addr ?? pickedRows()[0]?.from ?? null;
    setMoveOpen(false);
    try {
      await invoke("move_messages", { messageIds, folderId: folder.id });
      recordMove(from, folder.id);
      if (selectedMessage && messageIds.includes(selectedMessage.list.id)) closeMessage();
      setPicked([]);
      const where = (folder.role && ROLE_NAMES[folder.role]) || folder.name;
      notify(
        messageIds.length > 1
          ? `Moved ${messageIds.length} to ${where}`
          : folder.account_id === (selectedMessage?.list.account_id ?? folder.account_id)
            ? `Moved to ${where}`
            : `Moved to ${where} · ${accountLabel(folder.account_id)}`,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  async function onCreateFolderAndMove(accountId: number, name: string) {
    setMoveOpen(false);
    try {
      const res = await invoke<{ folder_id: number; imap_path: string }>("create_folder", {
        accountId,
        name,
        parentImapPath: null,
      });
      const fresh = await invoke<Folder[]>("list_folders", { accountId });
      setFolders((prev) => [...prev.filter((f) => f.account_id !== accountId), ...fresh]);
      const folder = fresh.find((f) => f.id === res.folder_id);
      if (folder) await onMoveTo(folder);
      else notify(`Created ${name}`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onSetCategory(category: string) {
    if (!selectedMessage) return;
    try {
      await invoke("set_category", { messageId: selectedMessage.list.id, category });
      patchSelected({ category });
    } catch (err) {
      setError(String(err));
    }
  }

  async function onSearch(q: string) {
    const query = q.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    try {
      const list = await invoke<MessageListItem[]>("search_messages", {
        query,
        accountId: many ? null : selectedAccount,
        limit: PAGE,
      });
      setSearchResults(list);
    } catch (err) {
      setError(String(err));
    }
  }

  function clearSearch() {
    setSearchResults(null);
    setSearchQuery("");
  }

  // ---------- compose ----------

  function defaultSignatureId(list: Signature[]): number | null {
    return (list.find((s) => s.is_default) ?? list[0])?.id ?? null;
  }

  async function showCompose(patch: Partial<ComposeState> = {}) {
    const current = composeRef.current;
    if (current && !skipSave.current && composeHasContent(current)) {
      try {
        await saveDraft(current);
      } catch (err) {
        setError(String(err));
      }
    }
    skipSave.current = false;
    const accountId = patch.accountId ?? selectedAccount ?? accounts[0]?.id;
    if (accountId == null) return;
    const sigs = signatures.filter((s) => s.account_id === accountId);
    const next = {
      ...blankCompose(accountId, defaultSignatureId(sigs)),
      ...patch,
      accountId,
    };
    composeRef.current = next;
    setCompose(next);
    setPicked([]);
  }

  async function onComposeChange(patch: Partial<ComposeState>) {
    setCompose((c) => (c ? { ...c, ...patch } : c));
    if (patch.accountId != null) {
      try {
        const list = await refreshSignatures(patch.accountId);
        setCompose((c) => (c ? { ...c, signatureId: defaultSignatureId(list) } : c));
      } catch {
        /* keep the previous signature choice */
      }
    }
  }

  function bodiesOf(c: ComposeState) {
    const sig = signatures.find((s) => s.id === c.signatureId);
    return composeBodies(c.html, c.text, sig, c.quote);
  }

  async function saveDraft(c: ComposeState): Promise<number | null> {
    const bodies = bodiesOf(c);
    const res = await invoke<{ draft_id: number }>("save_draft", {
      payload: {
        draft_id: c.draftId,
        account_id: c.accountId,
        to_addrs: c.to,
        cc_addrs: c.cc,
        bcc_addrs: c.bcc,
        subject: c.subject,
        text_body: bodies.text,
        html_body: bodies.html,
        in_reply_to: c.inReplyTo,
        references_header: c.references,
        source_message_id: c.sourceMessageId,
      },
    });
    await refreshLocals(accountIds);
    return res.draft_id;
  }

  async function onSaveDraft() {
    if (!compose) return;
    try {
      const draftId = await saveDraft(compose);
      setCompose((c) => (c ? { ...c, draftId } : c));
      notify("Draft saved");
    } catch (err) {
      setError(String(err));
    }
  }

  async function closeCompose() {
    const current = composeRef.current;
    const discard = skipSave.current;
    skipSave.current = false;
    composeRef.current = null;
    setCompose(null);
    if (!discard && current && composeHasContent(current)) {
      try {
        await saveDraft(current);
        notify("Saved to Drafts");
      } catch (err) {
        setError(String(err));
      }
    }
  }

  async function onSend() {
    if (!compose) return;
    setError(null);
    const c = compose;
    try {
      const sendAt = c.sendAt.trim() ? new Date(c.sendAt).toISOString() : null;
      const bodies = bodiesOf(c);
      const res = await invoke<{ scheduled?: boolean }>("send_message", {
        payload: {
          account_id: c.accountId,
          to: splitAddrs(c.to),
          cc: splitAddrs(c.cc),
          bcc: splitAddrs(c.bcc),
          subject: c.subject,
          text_body: bodies.text,
          html_body: bodies.html,
          send_at: sendAt,
          signature_id: null,
          draft_id: c.draftId,
          in_reply_to: c.inReplyTo,
          references_header: c.references,
        },
      });
      setCompose(null);
      composeRef.current = null;
      if (c.sourceMessageId) {
        invoke("delete_message", { messageId: c.sourceMessageId }).catch(() => {});
      }
      await refreshLocals(accountIds);
      notify(res.scheduled ? "Scheduled" : "Sent");
    } catch (err) {
      setError(String(err));
    }
  }

  function replyHeaders(detail: MessageDetail): Partial<ComposeState> {
    const refs = [detail.references_header, detail.message_id_header].filter(Boolean).join(" ");
    return {
      inReplyTo: detail.message_id_header ?? null,
      references: refs || null,
    };
  }

  function prefixed(prefix: "Re" | "Fwd", subject: string | null): string {
    const subj = subject ?? "";
    return new RegExp(`^${prefix}:\\s*`, "i").test(subj) ? subj : `${prefix}: ${subj}`;
  }

  function onReply(explicit?: MessageDetail | null) {
    const detail = explicit === undefined ? selectedMessage : explicit;
    if (!detail) return;
    const from = detail.list.from_addr ?? "";
    void showCompose({
      placement: "pane",
      accountId: detail.list.account_id,
      to: from,
      subject: prefixed("Re", detail.list.subject),
      quote: buildQuote(detail, "reply"),
      ...replyHeaders(detail),
    });
  }

  function onReplyAll(explicit?: MessageDetail | null) {
    const detail = explicit === undefined ? selectedMessage : explicit;
    if (!detail) return;
    const me = (accounts.find((a) => a.id === detail.list.account_id)?.email ?? "").toLowerCase();
    const from = detail.list.from_addr ?? "";
    const tos = [from, ...splitAddrs(detail.to_addrs)].filter(
      (addr, index, all) =>
        addrEmail(addr) !== me &&
        all.findIndex((other) => addrEmail(other) === addrEmail(addr)) === index,
    );
    const toEmails = new Set(tos.map(addrEmail));
    const ccs = splitAddrs(detail.cc_addrs).filter(
      (addr) => addrEmail(addr) !== me && !toEmails.has(addrEmail(addr)),
    );
    void showCompose({
      placement: "pane",
      accountId: detail.list.account_id,
      to: tos.join(", "),
      cc: ccs.join(", "),
      showCc: ccs.length > 0,
      subject: prefixed("Re", detail.list.subject),
      quote: buildQuote(detail, "reply"),
      ...replyHeaders(detail),
    });
  }

  function onForward(explicit?: MessageDetail | null) {
    const detail = explicit === undefined ? selectedMessage : explicit;
    if (!detail) return;
    void showCompose({
      placement: "pane",
      accountId: detail.list.account_id,
      subject: prefixed("Fwd", detail.list.subject),
      quote: buildQuote(detail, "forward"),
    });
  }

  function draftPatch(d: Draft): Partial<ComposeState> {
    const parts = d.html_body
      ? splitDraftHtml(d.html_body, d.text_body)
      : { editorHtml: escapeHtml(d.text_body).replace(/\n/g, "<br>"), hadSignature: false, quote: null };
    const sigs = signatures.filter((s) => s.account_id === d.account_id);
    return {
      placement: "pane",
      draftId: d.id,
      sourceMessageId: d.source_message_id,
      accountId: d.account_id,
      to: d.to_addrs,
      cc: d.cc_addrs,
      bcc: d.bcc_addrs,
      showCc: Boolean(d.cc_addrs || d.bcc_addrs),
      subject: d.subject,
      html: parts.editorHtml,
      text: d.text_body,
      quote: parts.quote,
      signatureId: parts.hadSignature ? defaultSignatureId(sigs) : null,
      inReplyTo: d.in_reply_to,
      references: d.references_header,
    };
  }

  async function onOpenServerDraft(id: number) {
    const existing = drafts.find((d) => d.source_message_id === id);
    if (existing) {
      await showCompose(draftPatch(existing));
      setPicked([`draft:${existing.id}`]);
      return;
    }
    try {
      let detail = await invoke<MessageDetail | null>("get_message", { messageId: id });
      if (detail && !detail.body_loaded) {
        await invoke("fetch_body", { messageId: id });
        detail = await invoke<MessageDetail | null>("get_message", { messageId: id });
      }
      if (!detail) return;
      const html = detail.html_body?.trim()
        ? detail.html_body
        : escapeHtml(detail.text_body ?? "").replace(/\n/g, "<br>");
      const next: ComposeState = {
        ...blankCompose(detail.list.account_id, null),
        placement: "pane",
        sourceMessageId: id,
        to: detail.to_addrs ?? "",
        cc: detail.cc_addrs ?? "",
        showCc: Boolean(detail.cc_addrs),
        subject: detail.list.subject ?? "",
        html,
        text: detail.text_body ?? "",
        signatureId: null,
      };
      const draftId = await saveDraft(next);
      await showCompose({ ...next, draftId });
      if (draftId != null) setPicked([`draft:${draftId}`]);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDeleteDrafts(ids: number[]) {
    const snapshots = ids
      .map((id) => drafts.find((d) => d.id === id))
      .filter((d): d is Draft => d != null);
    if (!snapshots.length) return;
    if (compose && compose.draftId != null && ids.includes(compose.draftId)) {
      skipSave.current = true;
      composeRef.current = null;
      setCompose(null);
    }
    try {
      for (const d of snapshots) {
        await invoke("delete_draft", { draftId: d.id });
        if (d.source_message_id) {
          await invoke("delete_message", { messageId: d.source_message_id });
        }
      }
      setPicked((prev) => prev.filter((key) => !ids.some((id) => key === `draft:${id}`)));
      await refreshLocals(accountIds);
      offerUndo(snapshots.length > 1 ? `${snapshots.length} drafts deleted` : "Draft deleted", async () => {
        for (const d of snapshots) {
          await invoke("save_draft", {
            payload: {
              draft_id: null,
              account_id: d.account_id,
              to_addrs: d.to_addrs,
              cc_addrs: d.cc_addrs,
              bcc_addrs: d.bcc_addrs,
              subject: d.subject,
              text_body: d.text_body,
              html_body: d.html_body,
              in_reply_to: d.in_reply_to,
              references_header: d.references_header,
              source_message_id: null,
            },
          });
        }
        await refreshLocals(accountIds);
      });
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- signatures ----------

  function openSigEditor(sig?: Signature) {
    setSigEditId(sig?.id ?? null);
    setSigName(sig?.name ?? "Default");
    setSigBody(sig?.body_text ?? "");
    setSigHtml(
      sig?.body_html?.trim()
        ? sig.body_html
        : escapeHtml(sig?.body_text ?? "").replace(/\n/g, "<br>"),
    );
    setSigDefault(sig ? sig.is_default : signatures.length === 0);
    setSigEditorOpen(true);
  }

  async function onSaveSignatureForm(e: React.FormEvent) {
    e.preventDefault();
    if (sigAccountId == null) return;
    try {
      await invoke("upsert_signature", {
        payload: {
          signature_id: sigEditId,
          account_id: sigAccountId,
          name: sigName.trim() || "Signature",
          body_text: sigBody,
          body_html: sigHtml.trim() ? sigHtml : null,
          is_default: sigDefault,
        },
      });
      await refreshSignatures(sigAccountId);
      setSigEditorOpen(false);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDeleteSignature(id: number) {
    try {
      await invoke("delete_signature", { signatureId: id });
      if (sigAccountId != null) await refreshSignatures(sigAccountId);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onCancelOutbox(id: number) {
    try {
      await invoke("cancel_outbox", { outboxId: id });
      await refreshLocals(accountIds);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onRetryOutbox(id: number) {
    try {
      await invoke("retry_outbox", { outboxId: id });
      await refreshLocals(accountIds);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onRemoveAccount(id: number) {
    try {
      await invoke("remove_account", { accountId: id });
      setSelectedAccount(null);
      await refreshAccounts();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- navigation ----------

  function go(next: Nav, nextPane: MailPane, filter: CategoryFilter = "all") {
    const current = composeRef.current;
    if (current?.placement === "pane") {
      composeRef.current = null;
      setCompose(null);
      if (!skipSave.current && composeHasContent(current)) {
        saveDraft(current)
          .then(() => notify("Saved to Drafts"))
          .catch((err) => setError(String(err)));
      }
      skipSave.current = false;
    }
    setPicked([]);
    setPane(nextPane);
    setSearchResults(null);
    setCategoryFilter(filter);
    setNav(next);
    if ("accountId" in next && next.accountId != null) setSelectedAccount(next.accountId);
  }

  const openRole = (role: string, accountId: number | null) =>
    go({ kind: "role", role, accountId }, "mail");
  const openSnoozed = (accountId: number | null) =>
    go({ kind: "snoozed", accountId }, "mail", "snoozed");
  const openSmart = (id: SmartFolderId) => go({ kind: "smart", id, accountId: null }, "mail");
  const openPins = (accountId: number | null) => go({ kind: "pins", accountId }, "pins");
  const openLocalDrafts = (accountId: number | null) => go({ kind: "drafts", accountId }, "drafts");
  const openOutboxNav = (accountId: number | null) => go({ kind: "outbox", accountId }, "outbox");

  function openFolderNav(folder: { id: number; account_id: number }) {
    go({ kind: "folder", folderId: folder.id }, "mail");
    setSelectedAccount(folder.account_id);
    setRecents((prev) => [folder.id, ...prev.filter((id) => id !== folder.id)].slice(0, 8));
  }

  // ---------- list rows ----------

  const listAccount = nav.kind === "folder" ? null : nav.accountId;

  function itemRow(m: MessageListItem): ListRow {
    return {
      key: String(m.id),
      id: m.id,
      accountId: m.account_id,
      folderId: m.folder_id,
      unseen: m.unseen,
      from: m.from_addr,
      subject:
        m.snoozed && m.snooze_until
          ? `${m.subject ?? "(no subject)"} · until ${new Date(m.snooze_until).toLocaleString()}`
          : m.subject,
      snippet: m.snippet,
      date: m.date,
      pinned: m.pinned,
      starred: m.starred,
      attachments: m.has_attachments,
      category: m.category,
    };
  }

  let listRows: ListRow[];
  if (searchResults) {
    listRows = searchResults.map(itemRow);
  } else if (pane === "pins") {
    listRows = pins.filter((m) => listAccount == null || m.account_id === listAccount).map(itemRow);
  } else if (threaded) {
    listRows = threads.map((t) => ({
      key: `${t.account_id}:${t.thread_key}`,
      id: t.latest_message_id,
      accountId: t.account_id,
      folderId: t.folder_id,
      unseen: t.unseen,
      from: t.from_addr,
      subject: t.subject,
      snippet: t.snippet,
      date: t.date,
      pinned: t.pinned,
      starred: t.starred,
      attachments: t.has_attachments,
      count: t.message_count,
      category: t.category,
    }));
  } else {
    listRows = messages.map(itemRow);
  }
  if (!searchResults && nav.kind === "smart") {
    const today = new Date().toDateString();
    listRows = listRows.filter((row) =>
      nav.id === "attachments"
        ? row.attachments
        : row.unseen && row.date != null && new Date(row.date).toDateString() === today,
    );
  }

  const viewingDrafts = nav.kind === "drafts";
  const inboxSmart =
    !searchResults && !viewingDrafts && nav.kind === "role" && nav.role === "inbox" && listMode === "smart";
  const grouping: "inbox" | "date" | "flat" =
    searchResults || pane === "pins" || categoryFilter === "snoozed"
      ? "flat"
      : inboxSmart
        ? "inbox"
        : "date";

  const linkedDrafts = new Set(
    drafts.map((d) => d.source_message_id).filter((id): id is number => id != null),
  );
  const draftRows: ListRow[] = viewingDrafts
    ? [
        ...drafts
          .filter((d) => listAccount == null || d.account_id === listAccount)
          .map((d) => ({
            key: `draft:${d.id}`,
            id: d.id,
            draftId: d.id,
            accountId: d.account_id,
            folderId: 0,
            unseen: false,
            from: "Me",
            subject: d.subject,
            snippet: d.text_body,
            date: d.updated_at,
            pinned: false,
            starred: false,
            attachments: false,
            category: "other",
          })),
        ...serverDrafts
          .filter((m) => !linkedDrafts.has(m.id))
          .map((m) => ({ ...itemRow(m), from: m.from_addr || "Me" })),
      ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    : [];
  const shownRows = viewingDrafts ? draftRows : listRows;
  const shownRowsRef = useRef<ListRow[]>([]);
  shownRowsRef.current = shownRows;
  const orderRef = useRef<string[]>([]);

  function accountLabel(accountId: number): string {
    const account = accounts.find((a) => a.id === accountId);
    return account?.display_name || account?.email || "";
  }

  const listTitle = searchResults
    ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"} for “${searchQuery.trim()}”`
    : nav.kind === "pins"
      ? "Pins"
      : nav.kind === "drafts"
        ? "Drafts"
        : nav.kind === "outbox"
          ? "Outbox"
          : nav.kind === "snoozed"
            ? "Snoozed"
            : nav.kind === "smart"
              ? nav.id === "attachments"
                ? "Attachments"
                : "Today's Unread"
              : nav.kind === "folder"
                ? (folders.find((f) => f.id === nav.folderId)?.name ?? "Folder")
                : nav.accountId == null || !many
                  ? (ROLE_NAMES[nav.role] ?? "Inbox")
                  : `${ROLE_NAMES[nav.role] ?? nav.role} · ${accountLabel(nav.accountId)}`;

  const shownOutbox = outbox.filter((o) => listAccount == null || o.account_id === listAccount);
  const loadedCount = threaded ? threads.length : messages.length;

  function selectRelative(delta: number) {
    const keys = orderRef.current;
    const rows = shownRowsRef.current;
    if (!keys.length) return;
    const selectedKey = rows.find(
      (row) => row.draftId == null && row.id === selectedMessage?.list.id,
    )?.key;
    const currentKey = picked.length === 1 && keys.includes(picked[0]) ? picked[0] : selectedKey;
    const index = currentKey ? keys.indexOf(currentKey) : -1;
    const nextIndex =
      index < 0
        ? delta > 0
          ? 0
          : keys.length - 1
        : Math.min(keys.length - 1, Math.max(0, index + delta));
    if (nextIndex === index) return;
    const next = rows.find((row) => row.key === keys[nextIndex]);
    if (!next) return;
    setPicked([next.key]);
    document.querySelector(`[data-row="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" });
    if (next.draftId != null) {
      const draft = drafts.find((item) => item.id === next.draftId);
      if (draft) void showCompose(draftPatch(draft));
      return;
    }
    void onOpenMessage(next.id);
  }

  async function rowsToFolder(rows: ListRow[], role: "archive" | "trash") {
    const byAccount = new Map<number, number[]>();
    for (const row of rows) {
      if (row.draftId != null) continue;
      const list = byAccount.get(row.accountId) ?? [];
      list.push(row.id);
      byAccount.set(row.accountId, list);
    }
    for (const [accountId, ids] of byAccount) {
      const target = folders.find((f) => f.account_id === accountId && f.role === role);
      if (!target) throw new Error(`This account has no ${ROLE_NAMES[role]} folder`);
      await invoke("move_messages", { messageIds: ids, folderId: target.id });
    }
  }

  async function onRowAction(row: ListRow, action: RowAction, bulk: boolean) {
    const rows = bulk ? pickedRows() : [row];
    try {
      if (action === "delete") {
        const draftIds = rows.flatMap((r) => (r.draftId != null ? [r.draftId] : []));
        if (draftIds.length) await onDeleteDrafts(draftIds);
        await rowsToFolder(rows, "trash");
        setPicked([]);
        if (selectedMessage && rows.some((r) => r.draftId == null && r.id === selectedMessage.list.id)) {
          closeMessage();
        }
        if (!draftIds.length) notify(rows.length > 1 ? `${rows.length} moved to Trash` : "Moved to Trash");
        return;
      }
      if (action === "archive") {
        await rowsToFolder(rows, "archive");
        setPicked([]);
        closeMessage();
        notify("Archived");
        return;
      }
      if (action === "pin") {
        const pin = rows.some((r) => !(r.pinned || r.starred));
        for (const r of rows) {
          if (r.draftId != null) continue;
          await invoke("pin_message", { messageId: r.id, pinned: pin });
        }
        return;
      }
      if (action === "unread") {
        const ids = rows.filter((r) => r.draftId == null).map((r) => r.id);
        const seen = rows.every((r) => r.unseen);
        if (ids.length) await invoke("mark_messages", { messageIds: ids, seen });
        return;
      }
      if (action === "move") {
        if (!bulk) setPicked([row.key]);
        if (row.draftId == null && !bulk) await onOpenMessage(row.id);
        setMoveOpen(true);
        return;
      }
      if (action === "reply" || action === "replyAll" || action === "forward") {
        const detail =
          selectedMessage?.list.id === row.id ? selectedMessage : await onOpenMessage(row.id);
        if (!detail) return;
        if (action === "forward") onForward(detail);
        else if (action === "replyAll") onReplyAll(detail);
        else onReply(detail);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  actionsRef.current = {
    compose: () => void showCompose(),
    reply: onReply,
    replyAll: onReplyAll,
    forward: onForward,
    archive: () => {
      const rows = pickedRows();
      if (rows.length > 1) void onRowAction(rows[0], "archive", true);
      else void onArchive();
    },
    move: () => {
      if (pickedRows().length > 1 || selectedMessage) setMoveOpen(true);
    },
    delete: () => {
      const rows = pickedRows();
      const oneOpen =
        rows.length === 1 && rows[0].draftId == null && rows[0].id === selectedMessage?.list.id;
      if (rows.length && !oneOpen) void onRowAction(rows[0], "delete", rows.length > 1);
      else void onDelete();
    },
    unread: () => {
      const rows = pickedRows();
      if (rows.length > 1) void onRowAction(rows[0], "unread", true);
      else void onMarkUnread();
    },
    sync: () => void onSync(),
    settings: () => setSettingsOpen(true),
    search: () => searchRef.current?.focus(),
    next: () => selectRelative(1),
    prev: () => selectRelative(-1),
    close: closeMessage,
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (document.body.dataset.recordingShortcut) return;
      const binding = eventToBinding(event);
      if (!binding) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        Boolean(target?.isContentEditable);
      const overlays = ".compose-card, [role='dialog'], [role='menu'], [role='listbox']";
      const inOverlay = Boolean(
        target?.closest(overlays) || document.activeElement?.closest(overlays),
      );
      if (binding === "Mod+A" && !typing && !inOverlay) {
        event.preventDefault();
        setPicked(shownRowsRef.current.map((row) => row.key));
        return;
      }
      const action = findAction(readKeymap(), binding);
      if (!action) return;
      if (!hasModifier(binding) && (typing || inOverlay)) return;
      event.preventDefault();
      gateAction(action, () => actionsRef.current[action]());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const item = (text: string, name: ShortcutAction) =>
        MenuItem.new({
          text,
          accelerator: menuAccelerator(keymap, name),
          action: () => gateAction(name, () => actionsRef.current[name]()),
        });
      const appMenu = await Submenu.new({
        text: "3mail",
        items: [
          await PredefinedMenuItem.new({ item: { About: null } }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await item("Settings…", "settings"),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "HideOthers" }),
          await PredefinedMenuItem.new({ item: "ShowAll" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Quit", text: "Quit 3mail" }),
        ],
      });
      const fileMenu = await Submenu.new({
        text: "File",
        items: [
          await item("New Email", "compose"),
          await item("Get New Mail", "sync"),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "CloseWindow" }),
        ],
      });
      const messageMenu = await Submenu.new({
        text: "Message",
        items: [
          await item("Reply", "reply"),
          await item("Reply All", "replyAll"),
          await item("Forward", "forward"),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await item("Archive", "archive"),
          await item("Move to Folder…", "move"),
          await item("Delete", "delete"),
          await item("Mark as Unread", "unread"),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await item("Next Message", "next"),
          await item("Previous Message", "prev"),
        ],
      });
      const editMenu = await Submenu.new({
        text: "Edit",
        items: [
          await PredefinedMenuItem.new({ item: "Undo" }),
          await PredefinedMenuItem.new({ item: "Redo" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await item("Search Mailbox…", "search"),
        ],
      });
      const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, messageMenu] });
      if (!disposed) await menu.setAsAppMenu();
    })().catch(() => {});
    return () => {
      disposed = true;
    };
  }, [keymap]);

  if (needsOnboarding) {
    return (
      <TooltipProvider>
        <div className="h-full bg-background">
          <Dialog open>
            <DialogContent
              className="flex flex-col gap-0 overflow-hidden p-0"
              style={{
                width: "min(32rem, calc(100% - 2rem))",
                maxWidth: "32rem",
                maxHeight: "min(40rem, calc(100vh - 2rem))",
              }}
              showCloseButton={false}
            >
              <AccountSetupForm
                title="Add your first account"
                onDone={async () => {
                  await refreshAccounts();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </TooltipProvider>
    );
  }

  const readerFolder = selectedMessage
    ? folders.find((f) => f.id === selectedMessage.list.folder_id)
    : undefined;
  const readerFolderLabel = readerFolder
    ? (readerFolder.role && ROLE_NAMES[readerFolder.role]) || readerFolder.name
    : "";
  const readerAccount = selectedMessage?.list.account_id ?? null;

  const readerActions: ReaderActions = {
    onClose: closeMessage,
    onTogglePin: () => void onTogglePin(),
    onToggleRead: () => void onToggleRead(),
    onSnooze: (until) => void onSnooze(until),
    onArchive: () => void onArchive(),
    onDelete: () => void onDelete(),
    onSetCategory: (category) => void onSetCategory(category),
    onReply,
    onReplyAll,
    onForward,
    onOpenMessage: (id) => void onOpenMessage(id),
    onOpenAttachment: (id) => void onOpenAttachment(id),
    onSaveAll: (ids) => void onSaveAll(ids),
    onLoadRemote: () => {
      localStorage.setItem("3mail.remoteImages", "1");
      setLoadRemote(true);
    },
  };

  return (
    <TooltipProvider>
      <div className={cn("classic", colorMode === "dark" && "dark")}>
        <aside className="side" style={{ width: cols.side }}>
          <MailSidebar
            accounts={accounts}
            folders={folders}
            drafts={drafts}
            outbox={outbox}
            active={searchResults ? "" : navActive(nav, many)}
            indentGuides={appearance.indentGuides}
            accountColor={accountColor}
            recentFolderIds={recents}
            syncing={syncing}
            syncLabel={syncLabel}
            onSync={() => void onSync()}
            onOpenRole={openRole}
            onOpenSnoozed={openSnoozed}
            onOpenFolder={openFolderNav}
            onOpenPins={openPins}
            onOpenDrafts={openLocalDrafts}
            onOpenOutbox={openOutboxNav}
            onOpenSmart={openSmart}
            onOpenSettings={() => setSettingsOpen(true)}
            onAddAccount={() => {
              setAccountInitial(undefined);
              setAccountOpen(true);
            }}
          />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="col-split side-edge"
          onPointerDown={(e) =>
            startColumnDrag(e, cols.side, (w) =>
              setCols((c) => ({ ...c, side: Math.min(420, Math.max(180, w)) })),
            )
          }
        />
        <MailListPane
          width={cols.list}
          caption={listTitle}
          searchRef={searchRef}
          searchQuery={searchQuery}
          searching={searchResults != null}
          onSearchQuery={setSearchQuery}
          onSearch={onSearch}
          onClearSearch={clearSearch}
          onCompose={() => void showCompose()}
          listMode={listMode}
          onListMode={(mode) => {
            setListMode(mode);
            localStorage.setItem("3mail.listMode", mode);
          }}
          showModeTabs={
            !searchResults && !viewingDrafts && nav.kind === "role" && nav.role === "inbox"
          }
          kind={!searchResults && pane === "outbox" ? "outbox" : "mail"}
          rows={shownRows}
          grouping={grouping}
          hiddenCards={hiddenCards}
          selectedId={selectedMessage?.list.id ?? null}
          pickedKeys={picked}
          orderRef={orderRef}
          barColor={many ? accountColor : undefined}
          loading={listLoading}
          canLoadMore={!searchResults && pane === "mail" && loadedCount >= limit}
          onLoadMore={() => setLimit((n) => n + PAGE)}
          onOpen={(row) => {
            if (row.draftId != null) {
              const draft = drafts.find((d) => d.id === row.draftId);
              if (draft) {
                void showCompose(draftPatch(draft)).then(() => setPicked([row.key]));
              }
            } else if (viewingDrafts) {
              void onOpenServerDraft(row.id);
            } else {
              void onOpenMessage(row.id);
            }
          }}
          onPick={(keys) => {
            setPicked(keys);
            const editing = composeRef.current;
            if (keys.length > 1 && editing?.placement === "pane") {
              composeRef.current = null;
              setCompose(null);
              if (composeHasContent(editing)) {
                saveDraft(editing).catch((err) => setError(String(err)));
              }
            }
          }}
          onRowAction={(row, action, bulk) => void onRowAction(row, action, bulk)}
          outbox={shownOutbox}
          onRetryOutbox={(id) => void onRetryOutbox(id)}
          onCancelOutbox={(id) => void onCancelOutbox(id)}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize message list"
          className="col-split"
          onPointerDown={(e) =>
            startColumnDrag(e, cols.list, (w) =>
              setCols((c) => ({ ...c, list: Math.min(600, Math.max(260, w)) })),
            )
          }
        />
        {compose?.placement === "pane" ? (
          <ComposeWindow
            value={compose}
            accounts={accounts}
            signatures={signatures.filter((s) => s.account_id === compose.accountId)}
            loadRemote={loadRemote}
            onChange={(patch) => void onComposeChange(patch)}
            onSend={() => void onSend()}
            onSaveDraft={() => void onSaveDraft()}
            onClose={() => void closeCompose()}
            onDelete={() => {
              if (compose.draftId != null) void onDeleteDrafts([compose.draftId]);
              else {
                skipSave.current = true;
                void closeCompose();
              }
            }}
            onPopOut={() => setCompose((c) => (c ? { ...c, placement: "popup" } : c))}
          />
        ) : picked.length > 1 && pickedRows()[0] ? (
          <BulkPane
            count={picked.length}
            onClear={() => setPicked([])}
            onArchive={() => void onRowAction(pickedRows()[0], "archive", true)}
            onDelete={() => void onRowAction(pickedRows()[0], "delete", true)}
            onPin={() => void onRowAction(pickedRows()[0], "pin", true)}
            onUnread={() => void onRowAction(pickedRows()[0], "unread", true)}
            move={(trigger) => {
              const row = pickedRows().find((r) => r.draftId == null);
              if (!row) return trigger;
              const message: MessageListItem = {
                id: row.id,
                account_id: row.accountId,
                folder_id: row.folderId,
                uid: 0,
                subject: row.subject,
                from_addr: row.from,
                date: row.date,
                unseen: row.unseen,
                starred: row.starred,
                has_attachments: row.attachments,
                snippet: row.snippet,
                category: row.category,
                pinned: row.pinned,
                snoozed: false,
                snooze_until: null,
                thread_key: null,
                thread_count: null,
              };
              return (
                <MovePicker
                  open={moveOpen}
                  onOpenChange={setMoveOpen}
                  accounts={accounts}
                  folders={folders}
                  message={message}
                  accountColor={accountColor}
                  showAccounts={many}
                  onMove={(folder) => void onMoveTo(folder)}
                  onCreate={(accountId, name) => void onCreateFolderAndMove(accountId, name)}
                >
                  {trigger}
                </MovePicker>
              );
            }}
          />
        ) : (
        <ReaderPane
          detail={selectedMessage}
          thread={threadMessages}
          loadingBody={loadingBody}
          folderLabel={readerFolderLabel}
          accountColor={readerAccount != null && many ? accountColor(readerAccount) : null}
          accountName={readerAccount != null ? accountLabel(readerAccount) : ""}
          loadRemote={loadRemote}
          themed={colorMode === "dark" && appearance.messageColors === "theme"}
          actions={readerActions}
          renderMove={(trigger) =>
            selectedMessage && (
              <MovePicker
                open={moveOpen}
                onOpenChange={setMoveOpen}
                accounts={accounts}
                folders={folders}
                message={selectedMessage.list}
                accountColor={accountColor}
                showAccounts={many}
                onMove={(folder) => void onMoveTo(folder)}
                onCreate={(accountId, name) => void onCreateFolderAndMove(accountId, name)}
              >
                {trigger}
              </MovePicker>
            )
          }
        />
        )}

        <div className="toasts" aria-live="polite">
          {error && (
            <div className="toast error" role="alert">
              <span title={error}>{error}</span>
              <button type="button" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {undo && (
            <div className="toast">
              <span>{undo.label}</span>
              <button
                type="button"
                onClick={() => {
                  const run = undo.run;
                  setUndo(null);
                  run().catch((err) => setError(String(err)));
                }}
              >
                Undo
              </button>
            </div>
          )}
          {notice && !undo && (
            <div className="toast">
              <span>{notice}</span>
            </div>
          )}
        </div>

        {compose?.placement !== "pane" && compose && (
          <ComposeWindow
            value={compose}
            accounts={accounts}
            signatures={signatures.filter((s) => s.account_id === compose.accountId)}
            loadRemote={loadRemote}
            onChange={(patch) => void onComposeChange(patch)}
            onSend={() => void onSend()}
            onSaveDraft={() => void onSaveDraft()}
            onClose={() => void closeCompose()}
          />
        )}

        <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
          <DialogContent
            className="flex flex-col gap-0 overflow-hidden p-0"
            style={{
              width: "min(32rem, calc(100% - 2rem))",
              maxWidth: "32rem",
              maxHeight: "min(40rem, calc(100vh - 2rem))",
            }}
          >
            {accountOpen && (
              <AccountSetupForm
                key={accountInitial?.email ?? "new"}
                title={accountInitial ? "Account settings" : "Add account"}
                initial={accountInitial}
                allowEmptySecret={Boolean(accountInitial)}
                onDone={async () => {
                  setAccountOpen(false);
                  await refreshAccounts();
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          page={settingsPage}
          onPage={setSettingsPage}
          accounts={accounts}
          accountColor={accountColor}
          onEditAccount={(a) => {
            setAccountInitial(accountToForm(a));
            setAccountOpen(true);
          }}
          onAddAccount={() => {
            setAccountInitial(undefined);
            setAccountOpen(true);
          }}
          onRemoveAccount={(id) => void onRemoveAccount(id)}
          loadRemote={loadRemote}
          onLoadRemote={(on) => {
            localStorage.setItem("3mail.remoteImages", on ? "1" : "0");
            setLoadRemote(on);
          }}
          hiddenCards={hiddenCards}
          onHiddenCards={setHiddenCards}
          signatures={signatures.filter((s) => s.account_id === sigAccountId)}
          sigAccountId={sigAccountId}
          onSigAccount={setSigPick}
          onEditSignature={openSigEditor}
          onDeleteSignature={(id) => void onDeleteSignature(id)}
        />

        <SignatureEditor
          open={sigEditorOpen}
          onOpenChange={setSigEditorOpen}
          editing={sigEditId != null}
          name={sigName}
          html={sigHtml}
          isDefault={sigDefault}
          onName={setSigName}
          onBody={(html, text) => {
            setSigHtml(html);
            setSigBody(text);
          }}
          onDefault={setSigDefault}
          onSave={onSaveSignatureForm}
        />
      </div>
    </TooltipProvider>
  );
}

export default App;

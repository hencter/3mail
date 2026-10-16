import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  ChevronRight,
  Clock,
  Ellipsis,
  FileText,
  Folder as FolderIcon,
  Inbox,
  Paperclip,
  Pin,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  Upload,
  CalendarClock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mailboxDepth } from "./mail-format";
import { initials, ROLE_COLORS } from "./palette";
import type { SmartFolderId } from "./types";

export type SidebarAccount = {
  id: number;
  email: string;
  display_name: string | null;
};

export type SidebarFolder = {
  id: number;
  account_id: number;
  name: string;
  imap_path: string;
  role: string | null;
  unseen_count: number;
};

export type FavoriteRef = { accountId: number; folderId: number };

const FAV_KEY = "3mail.favorites";
const OPEN_KEY = "3mail.navOpen";
const SYSTEM_ROLES = ["inbox", "sent", "drafts", "archive", "trash", "junk"];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function accountName(account: SidebarAccount): string {
  return account.display_name || account.email;
}

function Row({
  active,
  depth = 0,
  guides = false,
  icon,
  label,
  count,
  quietCount,
  caps,
  expandable,
  open,
  onToggle,
  onOpen,
  starred,
  onStar,
}: {
  active?: boolean;
  depth?: number;
  guides?: boolean;
  icon?: ReactNode;
  label: string;
  count?: number;
  quietCount?: boolean;
  caps?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  starred?: boolean;
  onStar?: () => void;
}) {
  return (
    <div className="side-line" style={{ paddingLeft: depth * 14 }}>
      {guides &&
        Array.from({ length: depth }).map((_, i) => (
          <span key={i} className="side-guide" style={{ left: 8 + i * 14 }} />
        ))}
      {expandable ? (
        <button
          type="button"
          className={"side-chevron" + (open ? " open" : "")}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronRight className="size-3" />
        </button>
      ) : (
        <span className="side-chevron" aria-hidden />
      )}
      <button
        type="button"
        onClick={onOpen}
        className={"side-row" + (active ? " active" : "") + (caps ? " caps" : "")}
      >
        {icon}
        <span className="label">{label}</span>
        {count != null && count > 0 && (
          <span className={"count" + (quietCount ? " quiet" : "")}>
            {count > 999 ? "999+" : count}
          </span>
        )}
      </button>
      {onStar && (
        <button
          type="button"
          className={"side-star" + (starred ? " on" : "")}
          aria-label={starred ? "Remove from Favorites" : "Add to Favorites"}
          onClick={onStar}
        >
          <Star className={"size-3 " + (starred ? "fill-current" : "")} />
        </button>
      )}
    </div>
  );
}

function AccountBar({ color }: { color: string }) {
  return <span className="acct-bar" style={{ background: color, height: 14 }} />;
}

function SectionLabel({ children }: { children: string }) {
  return <div className="side-section">{children}</div>;
}

export function MailSidebar({
  accounts,
  folders,
  drafts,
  outbox,
  active,
  indentGuides,
  accountColor,
  recentFolderIds,
  syncing,
  syncLabel,
  onSync,
  onOpenRole,
  onOpenSnoozed,
  onOpenFolder,
  onOpenPins,
  onOpenDrafts,
  onOpenOutbox,
  onOpenSmart,
  onAddAccount,
  onOpenSettings,
}: {
  accounts: SidebarAccount[];
  folders: SidebarFolder[];
  drafts: { account_id: number; source_message_id?: number | null }[];
  outbox: { account_id: number }[];
  active: string;
  indentGuides: boolean;
  accountColor: (accountId: number) => string;
  recentFolderIds: number[];
  syncing: boolean;
  syncLabel: string;
  onSync: () => void;
  onOpenRole: (role: string, accountId: number | null) => void;
  onOpenSnoozed: (accountId: number | null) => void;
  onOpenFolder: (folder: SidebarFolder) => void;
  onOpenPins: (accountId: number | null) => void;
  onOpenDrafts: (accountId: number | null) => void;
  onOpenOutbox: (accountId: number | null) => void;
  onOpenSmart: (id: SmartFolderId) => void;
  onAddAccount: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState<string[]>(() =>
    readJson<string[]>(OPEN_KEY, ["inbox"]),
  );
  const [favorites, setFavorites] = useState<FavoriteRef[]>(() =>
    readJson<FavoriteRef[]>(FAV_KEY, []),
  );
  const many = accounts.length > 1;
  const solo = many ? null : (accounts[0]?.id ?? null);

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);
  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  }, [favorites]);

  function toggle(key: string) {
    setOpen((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function foldersFor(role: string, accountId?: number) {
    return folders.filter(
      (f) => f.role === role && (accountId == null || f.account_id === accountId),
    );
  }

  function unseen(role: string, accountId?: number) {
    return foldersFor(role, accountId).reduce((n, f) => n + f.unseen_count, 0);
  }

  function isFav(folderId: number) {
    return favorites.some((f) => f.folderId === folderId);
  }

  function toggleFav(folder: SidebarFolder) {
    setFavorites((prev) =>
      prev.some((f) => f.folderId === folder.id)
        ? prev.filter((f) => f.folderId !== folder.id)
        : [...prev, { accountId: folder.account_id, folderId: folder.id }],
    );
  }

  function roleIcon(Icon: typeof Inbox, color: string) {
    return <Icon style={{ color }} />;
  }

  type Child = {
    id: number;
    label: string;
    count?: number;
    onOpen: () => void;
    folder?: SidebarFolder;
  };

  function roleGroup(
    key: string,
    label: string,
    icon: ReactNode,
    count: number | undefined,
    onAll: () => void,
    children: Child[],
    quietCount = false,
  ) {
    const expanded = open.includes(key);
    const single = !many ? children[0]?.folder : undefined;
    return (
      <li key={key}>
        <Row
          active={active === key}
          icon={icon}
          label={label}
          count={count}
          quietCount={quietCount}
          expandable={many && children.length > 0}
          open={expanded}
          onToggle={() => toggle(key)}
          onOpen={onAll}
          starred={single ? isFav(single.id) : undefined}
          onStar={single ? () => toggleFav(single) : undefined}
        />
        {many &&
          expanded &&
          children.map((child) => (
            <Row
              key={child.id}
              depth={1}
              guides={indentGuides}
              active={active === `${key}:${child.id}`}
              icon={<AccountBar color={accountColor(child.id)} />}
              label={child.label}
              count={child.count}
              quietCount={quietCount}
              onOpen={child.onOpen}
              starred={child.folder ? isFav(child.folder.id) : undefined}
              onStar={child.folder ? () => toggleFav(child.folder!) : undefined}
            />
          ))}
      </li>
    );
  }

  function perAccount(
    role: string | null,
    go: (accountId: number) => void,
    count?: (accountId: number) => number | undefined,
  ): Child[] {
    return accounts.map((account) => ({
      id: account.id,
      label: accountName(account),
      count: count?.(account.id),
      onOpen: () => go(account.id),
      folder: role ? foldersFor(role, account.id)[0] : undefined,
    }));
  }

  const favoriteFolders = favorites
    .map((fav) => folders.find((f) => f.id === fav.folderId))
    .filter((f): f is SidebarFolder => Boolean(f));

  const recentFolders = recentFolderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is SidebarFolder => Boolean(f) && !isFav(f!.id))
    .slice(0, 5);

  const customByAccount = accounts.map((account) => ({
    account,
    folders: folders
      .filter(
        (f) =>
          f.account_id === account.id &&
          (!f.role || !SYSTEM_ROLES.includes(f.role)),
      )
      .slice()
      .sort((a, b) => a.imap_path.localeCompare(b.imap_path)),
  }));

  function folderLabel(folder: SidebarFolder) {
    const account = accounts.find((a) => a.id === folder.account_id);
    return account && many ? `${folder.name} · ${accountName(account)}` : folder.name;
  }

  const moreOpen = open.includes("more");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pane-head" data-tauri-drag-region>
        <div className="drag" data-tauri-drag-region />
        <button
          type="button"
          className={"tool" + (syncing ? " spin" : "")}
          aria-label="Get new mail"
          title={syncLabel}
          onClick={onSync}
          disabled={!accounts.length}
        >
          <RefreshCw />
        </button>
      </div>
      <div className="side-scroll">
        <ul>
          <li>
            <Row
              caps
              active={active === "inbox"}
              icon={roleIcon(Inbox, ROLE_COLORS.inbox)}
              label="Inbox"
              count={unseen("inbox") || undefined}
              expandable={many}
              open={open.includes("inbox")}
              onToggle={() => toggle("inbox")}
              onOpen={() => onOpenRole("inbox", solo)}
              starred={!many && foldersFor("inbox")[0] ? isFav(foldersFor("inbox")[0].id) : undefined}
              onStar={!many && foldersFor("inbox")[0] ? () => toggleFav(foldersFor("inbox")[0]) : undefined}
            />
            {many &&
              open.includes("inbox") &&
              accounts.map((account) => {
                const folder = foldersFor("inbox", account.id)[0];
                return (
                  <Row
                    key={account.id}
                    depth={1}
                    guides={indentGuides}
                    active={active === `inbox:${account.id}`}
                    icon={<AccountBar color={accountColor(account.id)} />}
                    label={accountName(account)}
                    count={unseen("inbox", account.id) || undefined}
                    onOpen={() => onOpenRole("inbox", account.id)}
                    starred={folder ? isFav(folder.id) : undefined}
                    onStar={folder ? () => toggleFav(folder) : undefined}
                  />
                );
              })}
          </li>
        </ul>

        <SectionLabel>Folders</SectionLabel>
        <ul>
          {roleGroup(
            "sent",
            "Sent",
            roleIcon(Send, ROLE_COLORS.sent),
            undefined,
            () => onOpenRole("sent", solo),
            perAccount("sent", (id) => onOpenRole("sent", id)),
          )}
          {roleGroup(
            "snoozed",
            "Snoozed",
            roleIcon(Clock, ROLE_COLORS.snoozed),
            undefined,
            () => onOpenSnoozed(solo),
            perAccount(null, (id) => onOpenSnoozed(id)),
          )}
          {roleGroup(
            "drafts",
            "Drafts",
            roleIcon(FileText, ROLE_COLORS.drafts),
            (unseen("drafts") + drafts.filter((d) => !d.source_message_id).length) || undefined,
            () => onOpenDrafts(solo),
            perAccount(
              "drafts",
              (id) => onOpenDrafts(id),
              (id) =>
                unseen("drafts", id) +
                  drafts.filter((d) => d.account_id === id && !d.source_message_id).length ||
                undefined,
            ),
            true,
          )}
          {roleGroup(
            "pins",
            "Pins",
            roleIcon(Pin, ROLE_COLORS.pins),
            undefined,
            () => onOpenPins(solo),
            perAccount(null, (id) => onOpenPins(id)),
          )}
          {roleGroup(
            "archive",
            "Archive",
            roleIcon(Archive, ROLE_COLORS.archive),
            undefined,
            () => onOpenRole("archive", solo),
            perAccount("archive", (id) => onOpenRole("archive", id)),
          )}
          {roleGroup(
            "junk",
            "Spam",
            roleIcon(ShieldAlert, ROLE_COLORS.junk),
            unseen("junk") || undefined,
            () => onOpenRole("junk", solo),
            perAccount("junk", (id) => onOpenRole("junk", id), (id) => unseen("junk", id) || undefined),
            true,
          )}
          {roleGroup(
            "trash",
            "Trash",
            roleIcon(Trash2, ROLE_COLORS.trash),
            undefined,
            () => onOpenRole("trash", solo),
            perAccount("trash", (id) => onOpenRole("trash", id)),
          )}
          <li>
            <Row
              icon={roleIcon(Ellipsis, ROLE_COLORS.more)}
              label="More"
              expandable
              open={moreOpen}
              onToggle={() => toggle("more")}
              onOpen={() => toggle("more")}
            />
            {moreOpen && (
              <ul>
                <li>
                  <Row
                    depth={1}
                    guides={indentGuides}
                    active={active === "outbox" || active.startsWith("outbox:")}
                    icon={roleIcon(Upload, ROLE_COLORS.outbox)}
                    label="Outbox"
                    count={outbox.length || undefined}
                    quietCount
                    onOpen={() => onOpenOutbox(solo)}
                  />
                </li>
                <li>
                  <Row
                    depth={1}
                    guides={indentGuides}
                    active={active === "smart:attachments"}
                    icon={roleIcon(Paperclip, ROLE_COLORS.attachments)}
                    label="Attachments"
                    onOpen={() => onOpenSmart("attachments")}
                  />
                </li>
                <li>
                  <Row
                    depth={1}
                    guides={indentGuides}
                    active={active === "smart:today-unread"}
                    icon={roleIcon(CalendarClock, ROLE_COLORS.today)}
                    label="Today's Unread"
                    onOpen={() => onOpenSmart("today-unread")}
                  />
                </li>
                {customByAccount.map(({ account, folders: custom }) => (
                  <li key={account.id}>
                    {many && custom.length > 0 && (
                      <div className="side-section" style={{ marginLeft: 30 }}>
                        {accountName(account)}
                      </div>
                    )}
                    {custom.map((folder) => (
                      <Row
                        key={folder.id}
                        depth={1 + mailboxDepth(folder.imap_path)}
                        guides={indentGuides}
                        active={active === `folder:${folder.id}`}
                        icon={roleIcon(FolderIcon, many ? accountColor(account.id) : ROLE_COLORS.folder)}
                        label={folder.name}
                        count={folder.unseen_count || undefined}
                        onOpen={() => onOpenFolder(folder)}
                        starred={isFav(folder.id)}
                        onStar={() => toggleFav(folder)}
                      />
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>

        <SectionLabel>Favorites</SectionLabel>
        {favoriteFolders.length === 0 ? (
          <p className="side-hint">Star a folder to keep it here.</p>
        ) : (
          <ul>
            {favoriteFolders.map((folder) => (
              <li key={folder.id}>
                <Row
                  active={active === `folder:${folder.id}`}
                  icon={roleIcon(FolderIcon, accountColor(folder.account_id))}
                  label={folderLabel(folder)}
                  count={folder.unseen_count || undefined}
                  onOpen={() => onOpenFolder(folder)}
                  starred
                  onStar={() => toggleFav(folder)}
                />
              </li>
            ))}
          </ul>
        )}

        {recentFolders.length > 0 && (
          <>
            <SectionLabel>Recents</SectionLabel>
            <ul>
              {recentFolders.map((folder) => (
                <li key={folder.id}>
                  <Row
                    active={active === `folder:${folder.id}`}
                    icon={roleIcon(FolderIcon, ROLE_COLORS.folder)}
                    label={folderLabel(folder)}
                    count={folder.unseen_count || undefined}
                    quietCount
                    onOpen={() => onOpenFolder(folder)}
                    starred={false}
                    onStar={() => toggleFav(folder)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="side-foot">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <button type="button" className="side-me" aria-label="Accounts and settings">
              {accounts.slice(0, 3).map((account) => (
                <span
                  key={account.id}
                  className="avatar sm"
                  style={{ background: accountColor(account.id) }}
                >
                  {initials(accountName(account))}
                </span>
              ))}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuLabel>Accounts</DropdownMenuLabel>
            {accounts.map((account) => (
              <DropdownMenuItem key={account.id} onClick={() => onOpenRole("inbox", account.id)}>
                <AccountBar color={accountColor(account.id)} />
                {accountName(account)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAddAccount}>Add account…</DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings} shortcut="⌘,">
              Settings…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

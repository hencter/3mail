import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Palette, PenLine, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AppearanceSettings } from "./appearance";
import { ACCOUNT_SWATCHES, setAccountColor } from "./palette";
import { RichEditor } from "./RichEditor";
import { ShortcutSettings } from "./ShortcutSettings";
import { CATEGORIES, type Account, type SettingsPage, type Signature } from "./types";
import { WindowControls } from "./WindowControls";

function accountName(a: Account) {
  return a.display_name || a.email;
}

function SettingsFrame({
  standalone,
  open,
  onOpenChange,
  children,
}: {
  standalone: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  if (standalone) return <div className="settings-standalone">{children}</div>;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(34rem,calc(100%-2rem))] max-h-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0"
        style={{ width: "min(48rem, calc(100% - 2rem))", maxWidth: "48rem" }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Accounts, appearance, signatures, and shortcuts</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  page,
  onPage,
  accounts,
  accountColor,
  onEditAccount,
  onAddAccount,
  onRemoveAccount,
  loadRemote,
  onLoadRemote,
  hiddenCards,
  onHiddenCards,
  signatures,
  sigAccountId,
  onSigAccount,
  onEditSignature,
  onDeleteSignature,
  standalone = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  accounts: Account[];
  accountColor: (accountId: number) => string;
  onEditAccount: (a: Account) => void;
  onAddAccount: () => void;
  onRemoveAccount: (id: number) => void;
  loadRemote: boolean;
  onLoadRemote: (on: boolean) => void;
  hiddenCards: string[];
  onHiddenCards: (cards: string[]) => void;
  signatures: Signature[];
  sigAccountId: number | null;
  onSigAccount: (id: number) => void;
  onEditSignature: (sig?: Signature) => void;
  onDeleteSignature: (id: number) => void;
  standalone?: boolean;
}) {
  const [removing, setRemoving] = useState<Account | null>(null);

  return (
    <>
      <SettingsFrame standalone={standalone} open={open} onOpenChange={onOpenChange}>
          {standalone && (
            <div className="settings-chrome" data-tauri-drag-region>
              <div className="drag" data-tauri-drag-region />
              <span className="settings-chrome-title">Settings</span>
              <div className="drag" data-tauri-drag-region />
              <WindowControls />
            </div>
          )}
          <div className="settings-tabs">
            {(
              [
                ["accounts", "Accounts", UserRound],
                ["appearance", "Appearance", Palette],
                ["signatures", "Signatures", PenLine],
                ["shortcuts", "Shortcuts", Keyboard],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={page === id ? "on" : ""}
                onClick={() => onPage(id)}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
          <div className="settings-panel">
            {page === "accounts" && (
              <div className="flex flex-col gap-2">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <span
                      className="inline-block h-6 w-1 shrink-0 rounded"
                      style={{ background: accountColor(a.id) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{accountName(a)}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                    </div>
                    <div className="swatches" role="radiogroup" aria-label="Account color">
                      {ACCOUNT_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={accountColor(a.id) === color}
                          aria-label={color}
                          className={accountColor(a.id) === color ? "on" : ""}
                          style={{ background: color }}
                          onClick={() => setAccountColor(a.id, color)}
                        />
                      ))}
                    </div>
                    <Button type="button" size="xs" variant="outline" onClick={() => onEditAccount(a)}>
                      Edit
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving(a)}>
                      Remove
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={onAddAccount}>
                  Add account
                </Button>
              </div>
            )}
            {page === "appearance" && (
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={loadRemote} onCheckedChange={(v) => onLoadRemote(v === true)} />
                  Load remote images
                </label>
                <AppearanceSettings />
                <div>
                  <div className="pb-1 text-sm font-medium">Smart Inbox cards</div>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Turned-off cards are not hidden — their new mail moves to the “New” group.
                  </p>
                  {CATEGORIES.map(([id, label]) => (
                    <label key={id} className="flex items-center justify-between gap-4 border-b py-2 text-sm">
                      <span>{label}</span>
                      <Switch
                        checked={!hiddenCards.includes(id)}
                        onCheckedChange={(on) =>
                          onHiddenCards(on ? hiddenCards.filter((c) => c !== id) : [...hiddenCards, id])
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            {page === "signatures" && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  {accounts.length > 1 && (
                    <select
                      aria-label="Account"
                      className="rounded-md border bg-transparent px-2 py-1 text-sm"
                      value={sigAccountId ?? ""}
                      onChange={(e) => onSigAccount(Number(e.target.value))}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {accountName(a)}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => onEditSignature()}>
                    New signature
                  </Button>
                </div>
                {signatures.length === 0 && (
                  <p className="text-sm text-muted-foreground">No signatures for this account.</p>
                )}
                <ul className="flex flex-col gap-2">
                  {signatures.map((s) => (
                    <li key={s.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEditSignature(s)}>
                        <div className="text-sm">
                          {s.name}
                          {s.is_default ? " · default" : ""}
                        </div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{s.body_text}</div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Delete signature"
                        onClick={() => onDeleteSignature(s.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {page === "shortcuts" && <ShortcutSettings />}
          </div>
      </SettingsFrame>

      <Dialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="grid gap-4" style={{ maxWidth: "26rem" }}>
          <DialogHeader>
            <DialogTitle>Remove {removing ? accountName(removing) : ""}?</DialogTitle>
            <DialogDescription>
              Local mail, drafts and outbox items for this account are deleted from this computer.
              Nothing is deleted on the server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (removing) onRemoveAccount(removing.id);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "$&\n"),
    "text/html",
  );
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function SignatureEditor({
  open,
  onOpenChange,
  editing,
  name,
  html,
  isDefault,
  onName,
  onBody,
  onDefault,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  name: string;
  html: string;
  isDefault: boolean;
  onName: (v: string) => void;
  onBody: (html: string, text: string) => void;
  onDefault: (v: boolean) => void;
  onSave: (e: React.FormEvent) => void;
}) {
  const [source, setSource] = useState(false);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSource(/<(table|img)\b|style\s*=/i.test(html));
    setSession((s) => s + 1);
    // Mode is chosen once per open from the signature being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "40rem", width: "min(40rem, calc(100% - 2rem))" }}>
        <form onSubmit={onSave} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit signature" : "New signature"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="sig-name">Name</Label>
            <Input id="sig-name" value={name} onChange={(e) => onName(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setSource((s) => !s);
                  setSession((s) => s + 1);
                }}
              >
                {source ? "Rich text" : "Edit HTML"}
              </button>
            </div>
            {source ? (
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={html}
                onChange={(e) => onBody(e.target.value, htmlToText(e.target.value))}
                placeholder="Paste signature HTML (images need https:// links)"
              />
            ) : (
              <RichEditor
                key={session}
                className="sig-editor"
                initialHtml={html}
                placeholder="Your name, title, phone…"
                onChange={(next, text) => onBody(next, text)}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(v) => onDefault(v === true)} />
            Default for this account
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

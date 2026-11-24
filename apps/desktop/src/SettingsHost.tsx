import { useCallback, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AccountSetupForm, accountToForm } from "./AccountSetupForm";
import { escapeHtml } from "./compose-html";
import { useAccountColors } from "./palette";
import { SettingsDialog, SignatureEditor } from "./SettingsDialog";
import type { Account, AccountForm, SettingsPage, Signature } from "./types";

function readCards(): string[] {
  try {
    const raw = localStorage.getItem("3mail.inboxCards");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Settings in its own resizable window. Account add from the sidebar stays in the main window. */
export function SettingsHost() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [page, setPage] = useState<SettingsPage>("accounts");
  const [loadRemote, setLoadRemote] = useState(
    () => localStorage.getItem("3mail.remoteImages") === "1",
  );
  const [hiddenCards, setHiddenCards] = useState<string[]>(readCards);
  const [sigAccountId, setSigAccountId] = useState<number | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountInitial, setAccountInitial] = useState<AccountForm | undefined>();
  const [sigEditorOpen, setSigEditorOpen] = useState(false);
  const [sigEditId, setSigEditId] = useState<number | null>(null);
  const [sigName, setSigName] = useState("");
  const [sigBody, setSigBody] = useState("");
  const [sigHtml, setSigHtml] = useState("");
  const [sigDefault, setSigDefault] = useState(true);
  const accountColor = useAccountColors(accounts.map((a) => a.id));

  const refreshAccounts = useCallback(async () => {
    const list = await invoke<Account[]>("list_accounts");
    setAccounts(list);
    setSigAccountId((id) => (id != null && list.some((a) => a.id === id) ? id : (list[0]?.id ?? null)));
    await emit("accounts-changed");
  }, []);

  useEffect(() => {
    invoke<Account[]>("list_accounts")
      .then((list) => {
        setAccounts(list);
        setSigAccountId(list[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sigAccountId == null) {
      setSignatures([]);
      return;
    }
    invoke<Signature[]>("list_signatures", { accountId: sigAccountId })
      .then(setSignatures)
      .catch(() => {});
  }, [sigAccountId]);

  useEffect(() => {
    const raw = JSON.stringify(hiddenCards);
    if (localStorage.getItem("3mail.inboxCards") !== raw) {
      localStorage.setItem("3mail.inboxCards", raw);
      void emit("inbox-cards", hiddenCards);
    }
  }, [hiddenCards]);

  useEffect(() => {
    const un = listen("mail_updated", () => {
      if (sigAccountId != null) {
        invoke<Signature[]>("list_signatures", { accountId: sigAccountId })
          .then(setSignatures)
          .catch(() => {});
      }
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [sigAccountId]);

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

  async function onSaveSignature(e: FormEvent) {
    e.preventDefault();
    if (sigAccountId == null) return;
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
    const list = await invoke<Signature[]>("list_signatures", { accountId: sigAccountId });
    setSignatures(list);
    setSigEditorOpen(false);
  }

  return (
    <>
      <SettingsDialog
        standalone
        open
        onOpenChange={() => {}}
        page={page}
        onPage={setPage}
        accounts={accounts}
        accountColor={accountColor}
        onEditAccount={(account) => {
          setAccountInitial(accountToForm(account));
          setAccountOpen(true);
        }}
        onAddAccount={() => {
          setAccountInitial(undefined);
          setAccountOpen(true);
        }}
        onRemoveAccount={(id) => {
          void invoke("remove_account", { accountId: id })
            .then(() => refreshAccounts())
            .catch(() => {});
        }}
        loadRemote={loadRemote}
        onLoadRemote={(on) => {
          localStorage.setItem("3mail.remoteImages", on ? "1" : "0");
          setLoadRemote(on);
          void emit("remote-images", on);
        }}
        hiddenCards={hiddenCards}
        onHiddenCards={setHiddenCards}
        signatures={signatures.filter((s) => s.account_id === sigAccountId)}
        sigAccountId={sigAccountId}
        onSigAccount={setSigAccountId}
        onEditSignature={openSigEditor}
        onDeleteSignature={(id) => {
          void invoke("delete_signature", { signatureId: id }).then(async () => {
            if (sigAccountId == null) return;
            setSignatures(await invoke<Signature[]>("list_signatures", { accountId: sigAccountId }));
          });
        }}
      />
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
        onSave={(e) => void onSaveSignature(e)}
      />
    </>
  );
}

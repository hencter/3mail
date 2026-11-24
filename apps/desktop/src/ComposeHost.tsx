import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ComposeWindow, composeHasContent, type ComposeState } from "./Compose";
import { composeBodies } from "./compose-html";
import { splitAddrs } from "./mail-format";
import type { Account, Signature } from "./types";

export async function openComposeWindow(state: ComposeState) {
  await invoke("stage_compose_payload", { payload: JSON.stringify(state) });
  await invoke("open_compose_window");
  await emit("compose-load");
}

function defaultSignatureId(list: Signature[]): number | null {
  return (list.find((s) => s.is_default) ?? list[0])?.id ?? null;
}

/** Compose popup window (new mail, reply, forward). Drafts stay in the main window's third column. */
export function ComposeHost() {
  const [value, setValue] = useState<ComposeState | null>(null);
  const valueRef = useRef<ComposeState | null>(null);
  valueRef.current = value;
  const signaturesRef = useRef<Signature[]>([]);
  const skipSave = useRef(false);
  const loaded = useRef(false);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [loadRemote, setLoadRemote] = useState(
    () => localStorage.getItem("3mail.remoteImages") === "1",
  );
  signaturesRef.current = signatures;

  useEffect(() => {
    invoke<Account[]>("list_accounts")
      .then(setAccounts)
      .catch(() => {});
    const un = listen<boolean>("remote-images", (event) => setLoadRemote(event.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (!value) return;
    invoke<Signature[]>("list_signatures", { accountId: value.accountId })
      .then(setSignatures)
      .catch(() => {});
    getCurrentWindow()
      .setTitle(value.subject.trim() || "New Message")
      .catch(() => {});
  }, [value?.accountId, value?.subject]);

  async function saveDraft(current: ComposeState): Promise<number> {
    const sig = signaturesRef.current.find((s) => s.id === current.signatureId);
    const bodies = composeBodies(current.html, current.text, sig, current.quote);
    const res = await invoke<{ draft_id: number }>("save_draft", {
      payload: {
        draft_id: current.draftId,
        account_id: current.accountId,
        to_addrs: current.to,
        cc_addrs: current.cc,
        bcc_addrs: current.bcc,
        subject: current.subject,
        text_body: bodies.text,
        html_body: bodies.html,
        in_reply_to: current.inReplyTo,
        references_header: current.references,
        source_message_id: current.sourceMessageId,
      },
    });
    const next = { ...current, draftId: res.draft_id };
    valueRef.current = next;
    setValue(next);
    return res.draft_id;
  }

  async function reload() {
    if (loaded.current && !skipSave.current) {
      const current = valueRef.current;
      if (current && composeHasContent(current)) {
        try {
          await saveDraft(current);
        } catch {
          /* the new payload still replaces this one */
        }
      }
    }
    const raw = await invoke<string | null>("take_compose_payload");
    if (!raw) return;
    const parsed = JSON.parse(raw) as ComposeState;
    const next: ComposeState = { ...parsed, attachments: parsed.attachments ?? [] };
    valueRef.current = next;
    setValue(next);
    loaded.current = true;
    skipSave.current = false;
  }

  useEffect(() => {
    const un = listen("compose-load", () => {
      reload().catch((err) => setError(String(err)));
    });
    reload().catch((err) => setError(String(err)));
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async () => {
      if (skipSave.current) return;
      skipSave.current = true;
      const current = valueRef.current;
      if (current && composeHasContent(current)) {
        try {
          await saveDraft(current);
        } catch {
          /* closing still proceeds */
        }
      }
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  async function onChange(patch: Partial<ComposeState>) {
    setValue((current) => {
      const next = current ? { ...current, ...patch } : current;
      valueRef.current = next;
      return next;
    });
    if (patch.accountId == null) return;
    try {
      const list = await invoke<Signature[]>("list_signatures", { accountId: patch.accountId });
      setSignatures(list);
      const signatureId = defaultSignatureId(list);
      setValue((current) => {
        const next = current ? { ...current, signatureId } : current;
        valueRef.current = next;
        return next;
      });
    } catch {
      /* keep the previous signature */
    }
  }

  async function onSaveDraft() {
    const current = valueRef.current;
    if (!current) return;
    try {
      await saveDraft(current);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onSend() {
    const current = valueRef.current;
    if (!current || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      let draftId = current.draftId;
      if (draftId == null) draftId = await saveDraft({ ...current, draftId });
      const userScheduled = current.sendAt.trim().length > 0;
      const sig = signaturesRef.current.find((s) => s.id === current.signatureId);
      const bodies = composeBodies(current.html, current.text, sig, current.quote);
      const res = await invoke<{ outbox_id: number; undo?: boolean }>("send_message", {
        payload: {
          account_id: current.accountId,
          to: splitAddrs(current.to),
          cc: splitAddrs(current.cc),
          bcc: splitAddrs(current.bcc),
          subject: current.subject,
          text_body: bodies.text,
          html_body: bodies.html,
          send_at: userScheduled ? new Date(current.sendAt).toISOString() : null,
          signature_id: null,
          draft_id: draftId,
          in_reply_to: current.inReplyTo,
          references_header: current.references,
          attachments: current.attachments.map((a) => ({
            path: a.path,
            filename: a.filename,
          })),
        },
      });
      skipSave.current = true;
      await emit("send-queued", { outbox_id: res.outbox_id, undo: Boolean(res.undo) });
      await getCurrentWindow().destroy();
    } catch (err) {
      sending.current = false;
      setBusy(false);
      setError(String(err));
    }
  }

  async function onDelete() {
    const current = valueRef.current;
    if (!current) return;
    skipSave.current = true;
    try {
      if (current.draftId != null) {
        await invoke("delete_draft", { draftId: current.draftId });
      }
      if (current.sourceMessageId != null) {
        await invoke("delete_message", { messageId: current.sourceMessageId });
      }
    } catch (err) {
      setError(String(err));
      skipSave.current = false;
      return;
    }
    await getCurrentWindow().destroy();
  }

  if (!value) {
    return <div className="compose-window" />;
  }

  return (
    <>
      <ComposeWindow
        fill
        busy={busy}
        value={value}
        accounts={accounts}
        signatures={signatures.filter((s) => s.account_id === value.accountId)}
        loadRemote={loadRemote}
        onChange={(patch) => void onChange(patch)}
        onSend={() => void onSend()}
        onSaveDraft={() => void onSaveDraft()}
        onClose={() => void getCurrentWindow().close()}
        onDelete={() => void onDelete()}
      />
      {error && (
        <div className="toasts">
          <div className="toast error" role="alert">
            <span title={error}>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

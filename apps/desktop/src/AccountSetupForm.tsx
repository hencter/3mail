import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account, AccountForm, TlsMode } from "./types";

export const EMPTY_FORM: AccountForm = {
  email: "",
  secret: "",
  display_name: "",
  imap_host: "",
  imap_port: 993,
  imap_security: "ssl",
  smtp_host: "",
  smtp_port: 465,
  smtp_security: "ssl",
};

type ProviderPreset = {
  label: string;
  match: (email: string) => boolean;
  fill: Partial<AccountForm>;
};

const PRESETS: ProviderPreset[] = [
  {
    label: "QQ / Foxmail",
    match: (e) => /@(qq|foxmail)\.com$/i.test(e),
    fill: {
      imap_host: "imap.qq.com",
      imap_port: 993,
      imap_security: "ssl",
      smtp_host: "smtp.qq.com",
      smtp_port: 465,
      smtp_security: "ssl",
    },
  },
  {
    label: "Tencent Exmail",
    match: () => false,
    fill: {
      imap_host: "imap.exmail.qq.com",
      imap_port: 993,
      imap_security: "ssl",
      smtp_host: "smtp.exmail.qq.com",
      smtp_port: 465,
      smtp_security: "ssl",
    },
  },
  {
    label: "163",
    match: (e) => /@163\.com$/i.test(e),
    fill: {
      imap_host: "imap.163.com",
      imap_port: 993,
      imap_security: "ssl",
      smtp_host: "smtp.163.com",
      smtp_port: 465,
      smtp_security: "ssl",
    },
  },
  {
    label: "Gmail",
    match: (e) => /@gmail\.com$/i.test(e),
    fill: {
      imap_host: "imap.gmail.com",
      imap_port: 993,
      imap_security: "ssl",
      smtp_host: "smtp.gmail.com",
      smtp_port: 587,
      smtp_security: "starttls",
    },
  },
  {
    label: "Outlook",
    match: (e) => /@(outlook|hotmail|live)\.com$/i.test(e),
    fill: {
      imap_host: "outlook.office365.com",
      imap_port: 993,
      imap_security: "ssl",
      smtp_host: "smtp.office365.com",
      smtp_port: 587,
      smtp_security: "starttls",
    },
  },
];

function applyPreset(form: AccountForm, preset: ProviderPreset): AccountForm {
  return { ...form, ...preset.fill };
}

function guessPreset(email: string): ProviderPreset | null {
  return PRESETS.find((p) => p.match(email)) ?? null;
}

export function accountToForm(account: Account): AccountForm {
  return {
    email: account.email,
    secret: "",
    display_name: account.display_name ?? "",
    imap_host: account.imap_host,
    imap_port: account.imap_port,
    imap_security: account.imap_security,
    smtp_host: account.smtp_host,
    smtp_port: account.smtp_port,
    smtp_security: account.smtp_security,
  };
}

function SecuritySelect({
  value,
  onChange,
}: {
  value: TlsMode;
  onChange: (v: TlsMode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TlsMode)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ssl">SSL/TLS</SelectItem>
        <SelectItem value="starttls">STARTTLS</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function AccountSetupForm({
  title,
  initial,
  allowEmptySecret = false,
  onDone,
}: {
  title: string;
  initial?: AccountForm;
  allowEmptySecret?: boolean;
  onDone: () => Promise<void>;
}) {
  const [form, setForm] = useState<AccountForm>(initial ?? EMPTY_FORM);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  function patch(p: Partial<AccountForm>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function payload() {
    return {
      email: form.email.trim(),
      display_name: form.display_name.trim() || null,
      imap_host: form.imap_host.trim(),
      imap_port: Number(form.imap_port),
      imap_security: form.imap_security,
      smtp_host: form.smtp_host.trim(),
      smtp_port: Number(form.smtp_port),
      smtp_security: form.smtp_security,
      secret: form.secret,
    };
  }

  function onEmailBlur() {
    const preset = guessPreset(form.email.trim());
    if (preset) {
      setForm((f) => applyPreset(f, preset));
      setHint(`Filled ${preset.label} defaults — adjust if your provider differs.`);
    }
  }

  async function onTest() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      await invoke("test_account", { payload: payload() });
      setHint("IMAP + SMTP OK");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.imap_host.trim() || !form.smtp_host.trim()) {
      setAdvanced(true);
      setError("This address needs server settings. Fill IMAP and SMTP, then save.");
      return;
    }
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await invoke<{ account_id: number; updated?: boolean }>("add_account", {
        payload: payload(),
      });
      setForm(EMPTY_FORM);
      setHint(
        res.updated ? "Account already existed — settings & password updated" : "Account saved",
      );
      await onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex min-h-0 flex-col" onSubmit={onSave}>
      <div className="max-h-[min(32rem,calc(100vh-8rem))] space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure IMAP/SMTP, test the connection, then save. Use an app password when the
            provider requires it.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setForm((f) => applyPreset(f, p));
                setHint(`${p.label} defaults applied`);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="setup-email">Email</Label>
            <Input
              id="setup-email"
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
              onBlur={onEmailBlur}
              required
              autoComplete="username"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-name">Display name</Label>
            <Input
              id="setup-name"
              value={form.display_name}
              onChange={(e) => patch({ display_name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-secret">Password / app password</Label>
            <Input
              id="setup-secret"
              type="password"
              value={form.secret}
              onChange={(e) => patch({ secret: e.target.value })}
              required={!allowEmptySecret}
              placeholder={allowEmptySecret ? "Leave blank to keep the saved password" : undefined}
              autoComplete="current-password"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit px-0"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide server settings" : "Server settings"}
        </Button>

        {advanced && (
          <>
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">IMAP (incoming)</legend>
              <div className="grid gap-1.5">
                <Label>Host</Label>
                <Input
                  value={form.imap_host}
                  onChange={(e) => patch({ imap_host: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={form.imap_port}
                    onChange={(e) => patch({ imap_port: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Security</Label>
                  <SecuritySelect
                    value={form.imap_security}
                    onChange={(v) => patch({ imap_security: v })}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">SMTP (outgoing)</legend>
              <div className="grid gap-1.5">
                <Label>Host</Label>
                <Input
                  value={form.smtp_host}
                  onChange={(e) => patch({ smtp_host: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={form.smtp_port}
                    onChange={(e) => patch({ smtp_port: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Security</Label>
                  <SecuritySelect
                    value={form.smtp_security}
                    onChange={(v) => patch({ smtp_security: v })}
                  />
                </div>
              </div>
            </fieldset>
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t bg-popover px-4 py-3">
        <Button type="button" variant="outline" onClick={onTest} disabled={busy}>
          Test connection
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export type ColorMode = "light" | "dark" | "system";

export type Appearance = {
  mode: ColorMode;
  accent: string;
  gray: string;
  radius: "none" | "small" | "medium" | "large";
  scaling: "90%" | "95%" | "100%" | "105%" | "110%";
  font: "system" | "serif" | "mono";
  indentGuides: boolean;
  messageColors: "original" | "theme";
  dateFormat: DateFormat;
  hour24: boolean;
};

export type DateFormat = "relative" | "md" | "ymd" | "system";

const KEY = "3mail.appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  accent: "indigo",
  gray: "gray",
  radius: "small",
  scaling: "100%",
  font: "system",
  indentGuides: true,
  messageColors: "original",
  dateFormat: "relative",
  hour24: true,
};

const ACCENTS = [
  "indigo",
  "iris",
  "violet",
  "cyan",
  "teal",
  "grass",
  "amber",
  "orange",
  "crimson",
  "gray",
];

const GRAYS = ["gray", "mauve", "slate", "sage", "sand"];

const listeners = new Set<() => void>();
let cached: Appearance | null = null;

export function readAppearance(): Appearance {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) } : DEFAULT_APPEARANCE;
  } catch {
    cached = DEFAULT_APPEARANCE;
  }
  return cached!;
}

function applyAppearance(next: Appearance, notify: boolean) {
  const raw = JSON.stringify(next);
  if (localStorage.getItem(KEY) !== raw) localStorage.setItem(KEY, raw);
  if (cached && JSON.stringify(cached) === raw) return;
  cached = next;
  if (notify) listeners.forEach((fn) => fn());
}

export function writeAppearance(next: Appearance) {
  applyAppearance(next, true);
  void emit("appearance-changed", next).catch(() => {});
}

export function useAppearance(): Appearance {
  const [value, setValue] = useState(readAppearance);
  useEffect(() => {
    const fn = () => setValue(readAppearance());
    listeners.add(fn);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      cached = null;
      setValue(readAppearance());
    };
    window.addEventListener("storage", onStorage);
    const unlisten = listen<Appearance>("appearance-changed", (event) => {
      applyAppearance({ ...DEFAULT_APPEARANCE, ...event.payload }, true);
    });
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
      unlisten.then((off) => off());
    };
  }, []);
  return value;
}

export function useResolvedMode(mode: ColorMode): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => setSystemDark(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export const FONT_STACK: Record<Appearance["font"], string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
  serif: '"Iowan Old Style", Palatino, "Palatino Linotype", "Songti SC", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b py-2.5 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AppearanceSettings() {
  const appearance = useAppearance();

  function patch(partial: Partial<Appearance>) {
    writeAppearance({ ...appearance, ...partial });
  }

  return (
    <div className="flex flex-col">
      <p className="pb-2 text-xs text-muted-foreground">
        Interface look. Changes apply immediately and stay on this computer.
      </p>
      <Field label="Color scheme">
        <Select
          value={appearance.mode}
          onValueChange={(mode) => patch({ mode: mode as ColorMode })}
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Accent">
        <Select
          value={appearance.accent}
          onValueChange={(accent) => patch({ accent })}
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            {ACCENTS.map((color) => (
              <SelectItem key={color} value={color}>
                {color}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Neutral">
        <Select value={appearance.gray} onValueChange={(gray) => patch({ gray })}>
          <SelectTrigger className="w-36" />
          <SelectContent>
            {GRAYS.map((color) => (
              <SelectItem key={color} value={color}>
                {color}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Corner radius">
        <Select
          value={appearance.radius}
          onValueChange={(radius) =>
            patch({ radius: radius as Appearance["radius"] })
          }
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="small">Small</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Interface scale">
        <Select
          value={appearance.scaling}
          onValueChange={(scaling) =>
            patch({ scaling: scaling as Appearance["scaling"] })
          }
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            <SelectItem value="90%">90%</SelectItem>
            <SelectItem value="95%">95%</SelectItem>
            <SelectItem value="100%">100%</SelectItem>
            <SelectItem value="105%">105%</SelectItem>
            <SelectItem value="110%">110%</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Interface font">
        <Select
          value={appearance.font}
          onValueChange={(font) => patch({ font: font as Appearance["font"] })}
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="serif">Serif</SelectItem>
            <SelectItem value="mono">Monospace</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Message colors in dark mode">
        <Select
          value={appearance.messageColors}
          onValueChange={(messageColors) =>
            patch({ messageColors: messageColors as Appearance["messageColors"] })
          }
        >
          <SelectTrigger className="w-36" />
          <SelectContent>
            <SelectItem value="original">Original (white)</SelectItem>
            <SelectItem value="theme">Follow theme</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Date format">
        <Select
          value={appearance.dateFormat}
          onValueChange={(dateFormat) => patch({ dateFormat: dateFormat as DateFormat })}
        >
          <SelectTrigger className="w-44" />
          <SelectContent>
            <SelectItem value="relative">Relative (Sep 22)</SelectItem>
            <SelectItem value="md">Month-day (09-22)</SelectItem>
            <SelectItem value="ymd">Full (2026-09-22)</SelectItem>
            <SelectItem value="system">System locale</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-4 border-b py-2.5 text-sm">
        <span>24-hour time</span>
        <Switch checked={appearance.hour24} onCheckedChange={(hour24) => patch({ hour24 })} />
      </label>
      <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
        <span>
          Sidebar indent guides
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Vertical lines on nested mailboxes
          </span>
        </span>
        <Switch
          checked={appearance.indentGuides}
          onCheckedChange={(indentGuides) => patch({ indentGuides })}
        />
      </label>
    </div>
  );
}

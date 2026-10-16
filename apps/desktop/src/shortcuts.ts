import { useEffect, useState } from "react";

export type ShortcutAction =
  | "compose"
  | "sync"
  | "settings"
  | "search"
  | "reply"
  | "replyAll"
  | "forward"
  | "archive"
  | "move"
  | "delete"
  | "unread"
  | "next"
  | "prev"
  | "close";

/** A binding is `Mod+Shift+Alt+Key`; `Mod` is ⌘ on macOS (Ctrl elsewhere). */
export type Keymap = Record<ShortcutAction, string[]>;

export const SHORTCUT_LABELS: { action: ShortcutAction; label: string }[] = [
  { action: "compose", label: "New email" },
  { action: "sync", label: "Get new mail" },
  { action: "settings", label: "Settings" },
  { action: "search", label: "Search" },
  { action: "reply", label: "Reply" },
  { action: "replyAll", label: "Reply all" },
  { action: "forward", label: "Forward" },
  { action: "archive", label: "Archive" },
  { action: "move", label: "Move to folder" },
  { action: "delete", label: "Delete" },
  { action: "unread", label: "Mark unread" },
  { action: "next", label: "Next message" },
  { action: "prev", label: "Previous message" },
  { action: "close", label: "Close message" },
];

export const DEFAULT_KEYMAP: Keymap = {
  compose: ["Mod+N"],
  sync: ["Mod+Shift+N"],
  settings: ["Mod+,"],
  search: ["Mod+F", "/"],
  reply: ["R"],
  replyAll: ["Shift+R"],
  forward: ["F"],
  archive: ["E"],
  move: ["Mod+Shift+M"],
  delete: ["Backspace", "Delete"],
  unread: ["U"],
  next: ["J", "ArrowDown"],
  prev: ["K", "ArrowUp"],
  close: ["Escape"],
};

const KEY = "3mail.shortcuts";
const listeners = new Set<() => void>();
let cached: Keymap | null = null;

export function readKeymap(): Keymap {
  if (cached) return cached;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Keymap>;
    const merged = { ...DEFAULT_KEYMAP };
    for (const { action } of SHORTCUT_LABELS) {
      const list = saved[action];
      if (Array.isArray(list)) merged[action] = list.filter((b) => typeof b === "string");
    }
    cached = merged;
  } catch {
    cached = DEFAULT_KEYMAP;
  }
  return cached;
}

export function writeKeymap(next: Keymap) {
  cached = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

export function useKeymap(): Keymap {
  const [value, setValue] = useState(readKeymap);
  useEffect(() => {
    const fn = () => setValue(readKeymap());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return value;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "CapsLock", "Fn"]);

/** Canonical binding for a key event, or `null` for a bare modifier press. */
export function eventToBinding(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  let key = event.key;
  // With ⌥ held, macOS turns letters into symbols; fall back to the physical key.
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (event.altKey && /^Digit\d$/.test(event.code)) key = event.code.slice(5);
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  const letterOrNamed = /^[A-Z0-9]$/.test(key) || key.length > 1;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.shiftKey && letterOrNamed) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

export function hasModifier(binding: string): boolean {
  return binding.startsWith("Mod+");
}

export function findAction(keymap: Keymap, binding: string): ShortcutAction | null {
  for (const { action } of SHORTCUT_LABELS) {
    if (keymap[action].includes(binding)) return action;
  }
  return null;
}

/** Which other action already uses `binding`, if any. */
export function conflictFor(
  keymap: Keymap,
  binding: string,
  except: ShortcutAction,
): ShortcutAction | null {
  for (const { action } of SHORTCUT_LABELS) {
    if (action !== except && keymap[action].includes(binding)) return action;
  }
  return null;
}

const KEY_GLYPHS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
  Enter: "↩",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Tab: "⇥",
};

export function formatBinding(binding: string): string {
  return binding
    .split("+")
    .map((part) => KEY_GLYPHS[part] ?? part)
    .join("");
}

/** Tauri menu accelerator for the first modifier binding (single keys stay out of the menu). */
export function menuAccelerator(keymap: Keymap, action: ShortcutAction): string | undefined {
  const binding = keymap[action].find(hasModifier);
  if (!binding) return undefined;
  return binding
    .split("+")
    .map((part) => (part === "Mod" ? "CmdOrCtrl" : part === "Alt" ? "Alt" : part))
    .join("+");
}

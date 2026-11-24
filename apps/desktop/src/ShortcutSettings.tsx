import { useEffect, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  conflictFor,
  DEFAULT_KEYMAP,
  eventToBinding,
  formatBinding,
  SHORTCUT_LABELS,
  useKeymap,
  writeKeymap,
  type ShortcutAction,
} from "./shortcuts";

const labelOf = (action: ShortcutAction) =>
  SHORTCUT_LABELS.find((row) => row.action === action)?.label ?? action;

export function ShortcutSettings() {
  const keymap = useKeymap();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    document.body.dataset.recordingShortcut = "1";
    function onKey(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Escape" && !event.metaKey && !event.ctrlKey) {
        setRecording(null);
        return;
      }
      const binding = eventToBinding(event);
      if (!binding || !recording) return;
      const next = { ...keymap };
      const other = conflictFor(keymap, binding, recording);
      if (other) {
        next[other] = next[other].filter((b) => b !== binding);
        setNote(`${formatBinding(binding)} was moved from “${labelOf(other)}”.`);
      } else {
        setNote(null);
      }
      if (!next[recording].includes(binding)) next[recording] = [...next[recording], binding];
      writeKeymap(next);
      setRecording(null);
    }
    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("keydown", onKey, opts);
    document.addEventListener("keydown", onKey, opts);
    return () => {
      window.removeEventListener("keydown", onKey, opts);
      document.removeEventListener("keydown", onKey, opts);
      delete document.body.dataset.recordingShortcut;
    };
  }, [recording, keymap]);

  function remove(action: ShortcutAction, binding: string) {
    writeKeymap({ ...keymap, [action]: keymap[action].filter((b) => b !== binding) });
  }

  return (
    <div className="flex flex-col text-sm">
      <p className="pb-2 text-xs text-muted-foreground">
        Click + and press a key combination. Esc cancels. Single keys don’t fire while you type.
      </p>
      {note && <p className="pb-2 text-xs text-amber-600">{note}</p>}
      <ul className="flex flex-col">
        {SHORTCUT_LABELS.map(({ action, label }) => (
          <li key={action} className="flex items-center justify-between gap-4 border-b py-1.5">
            <span>{label}</span>
            <span className="flex flex-wrap items-center justify-end gap-1">
              {keymap[action].map((binding) => (
                <span key={binding} className="kbd-chip">
                  {formatBinding(binding)}
                  <button
                    type="button"
                    aria-label={`Remove ${formatBinding(binding)}`}
                    onClick={() => remove(action, binding)}
                  >
                    <X />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className={"kbd-add" + (recording === action ? " on" : "")}
                aria-label={`Add shortcut for ${label}`}
                onClick={() => setRecording(recording === action ? null : action)}
              >
                {recording === action ? "Press keys…" : <Plus />}
              </button>
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 border-b py-1.5 text-muted-foreground">
          <span>Send (in compose)</span>
          <span className="kbd-chip">⌘↩</span>
        </li>
      </ul>
      <div className="pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            writeKeymap(DEFAULT_KEYMAP);
            setNote(null);
          }}
        >
          <RotateCcw className="size-3.5" />
          Restore defaults
        </Button>
      </div>
    </div>
  );
}

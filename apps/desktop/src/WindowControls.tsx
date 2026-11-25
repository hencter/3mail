import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native traffic lights stay on macOS (Overlay). Custom chrome is for Windows/Linux. */
export function needsCustomWindowControls(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Windows|Linux|X11/i.test(ua) && !/Android/i.test(ua);
}

export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!needsCustomWindowControls()) return;
    const win = getCurrentWindow();
    let disposed = false;
    void win.isMaximized().then((v) => {
      if (!disposed) setMaximized(v);
    });
    const un = win.onResized(async () => {
      try {
        setMaximized(await win.isMaximized());
      } catch {
        /* window may be closing */
      }
    });
    return () => {
      disposed = true;
      void un.then((f) => f());
    };
  }, []);

  if (!needsCustomWindowControls()) return null;

  const win = () => getCurrentWindow();

  return (
    <div className={cn("win-controls", className)} role="group" aria-label="Window">
      <button
        type="button"
        className="win-btn"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void win().minimize()}
      >
        <Minus strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="win-btn"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win().toggleMaximize()}
      >
        {maximized ? (
          <span className="win-restore" aria-hidden />
        ) : (
          <Square strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        className="win-btn win-close"
        aria-label="Close"
        title="Close"
        onClick={() => void win().close()}
      >
        <X strokeWidth={1.75} />
      </button>
    </div>
  );
}

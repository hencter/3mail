import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Axis = "height" | "width";

/**
 * Smooth open/close without measuring scroll size.
 * Uses CSS grid 0fr↔1fr (height) or max-width (width).
 * Keeps children mounted while closing so the exit animation can finish.
 */
export function Collapse({
  open,
  children,
  className,
  axis = "height",
  durationMs = 200,
  unmountOnExit = true,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  axis?: Axis;
  durationMs?: number;
  /** When false, children stay mounted (cheaper for tiny trees). */
  unmountOnExit?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    if (!unmountOnExit) return;
    const t = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(t);
  }, [open, durationMs, unmountOnExit]);

  if (!mounted && unmountOnExit) return null;

  const style = {
    "--collapse-ms": `${durationMs}ms`,
  } as CSSProperties;

  return (
    <div
      className={cn(
        axis === "width" ? "collapse-x" : "collapse-y",
        shown && "open",
        className,
      )}
      style={style}
      aria-hidden={!shown}
    >
      <div className="collapse-inner">{children}</div>
    </div>
  );
}

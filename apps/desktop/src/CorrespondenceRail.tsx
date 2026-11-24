import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDownLeft, ArrowUpRight, PanelRightClose } from "lucide-react";
import { formatListDate } from "./mail-format";
import { cleanSnippet, senderLabel } from "./palette";
import type { CorrespondenceItem } from "./correspondence";

const PREVIEW_MS = 320;
const LIMIT = 100;

export function CorrespondenceRail({
  accountId,
  contactEmail,
  selectedId,
  onOpen,
  onClose,
}: {
  accountId: number;
  contactEmail: string;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CorrespondenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const previewGen = useRef(0);

  useEffect(() => {
    setLoading(true);
    void invoke<CorrespondenceItem[]>("list_correspondence", {
      accountId,
      contactEmail,
      limit: LIMIT,
      offset: 0,
    })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [accountId, contactEmail]);

  useEffect(() => {
    if (hoverId == null) {
      setPreview(null);
      return;
    }
    const row = items.find((i) => i.id === hoverId);
    if (!row?.snippet) {
      setPreview(row?.subject ?? null);
      return;
    }
    const gen = ++previewGen.current;
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      void invoke<{ text_body: string | null; snippet?: string | null } | null>("get_message", {
        messageId: hoverId,
      }).then((detail) => {
        if (gen !== previewGen.current || !detail) return;
        const text = detail.text_body?.trim() || row.snippet || row.subject || "";
        setPreview(text.slice(0, 420));
      });
    }, PREVIEW_MS);
    return () => {
      if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    };
  }, [hoverId, items]);

  const label = senderLabel(contactEmail);

  return (
    <aside className="correspondence-rail" aria-label="Correspondence with sender">
      <header className="correspondence-head">
        <h3>With {label}</h3>
        <span className="hint">{items.length} message{items.length === 1 ? "" : "s"}</span>
        <button type="button" className="tool" aria-label="Hide correspondence" title="Hide" onClick={onClose}>
          <PanelRightClose />
        </button>
      </header>
      {loading ? (
        <p className="correspondence-loading">Loading…</p>
      ) : items.length === 0 ? (
        <p className="correspondence-empty">No other mail with this contact.</p>
      ) : (
        <ul className="correspondence-list">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={"correspondence-row" + (selectedId === row.id ? " on" : "")}
                onClick={() => onOpen(row.id)}
                onMouseEnter={() => setHoverId(row.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <span className={"dir" + (row.direction === "outbound" ? " out" : "")} aria-hidden>
                  {row.direction === "outbound" ? <ArrowUpRight /> : <ArrowDownLeft />}
                </span>
                <span className="meta">
                  <span className="subj">{row.subject || "(no subject)"}</span>
                  <span className="line">
                    <time>{formatListDate(row.date)}</time>
                    {row.snippet && <span className="snip">{cleanSnippet(row.snippet)}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && hoverId != null && (
        <div className="correspondence-preview" role="tooltip">
          {preview}
        </div>
      )}
    </aside>
  );
}
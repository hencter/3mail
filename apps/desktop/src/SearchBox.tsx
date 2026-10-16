import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

const HISTORY_KEY = "3mail.searchHistory";
const MAX_RECENTS = 8;

type Keyword = {
  id: string;
  label: string;
  hint: string;
  color: string;
  apply: (query: string) => string;
};

function wrapField(op: string, query: string): string {
  const text = query.trim();
  if (!text) return `${op}:`;
  if (/^(from|to|cc|subject|type):/i.test(text)) return text;
  return `${op}:"${text.replace(/"/g, "")}"`;
}

function addToken(token: string, query: string): string {
  const text = query.trim();
  if (!text) return token;
  if (text.toLowerCase().includes(token.toLowerCase())) return text;
  return `${text} ${token}`;
}

const KEYWORDS: Keyword[] = [
  { id: "from", label: "from", hint: "from / to / cc / any", color: "#22a06b", apply: (q) => wrapField("from", q) },
  { id: "to", label: "to", hint: "to / from / cc / any", color: "#3b82f6", apply: (q) => wrapField("to", q) },
  {
    id: "attachments",
    label: "attachments",
    hint: "attachments / images / documents / pdf files",
    color: "#8b5cf6",
    apply: (q) => addToken("attachments", q),
  },
  {
    id: "pdf",
    label: "pdf",
    hint: "pdf / all types / images / documents / pdf files",
    color: "#ef4444",
    apply: (q) => addToken("type:pdf", q),
  },
  {
    id: "documents",
    label: "documents",
    hint: "documents / all types / images / pdf files",
    color: "#0ea5e9",
    apply: (q) => addToken("type:document", q),
  },
];

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function remember(query: string) {
  const text = query.trim();
  if (!text) return;
  const next = [text, ...readRecents().filter((item) => item !== text)].slice(0, MAX_RECENTS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

/** A trailing operator with no value is not ready to search. */
function searchable(query: string): boolean {
  const text = query.trim();
  if (!text) return false;
  return !/^(from|to|cc|subject|type):\s*$/i.test(text);
}

export function SearchBox({
  inputRef,
  query,
  searching,
  onQuery,
  onSearch,
  onClear,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  searching: boolean;
  onQuery: (query: string) => void;
  onSearch: (query: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [active, setActive] = useState(-1);
  const skip = useRef(true);
  const searchFn = useRef(onSearch);
  searchFn.current = onSearch;

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (!query.trim()) {
      searchFn.current("");
      return;
    }
    if (!searchable(query)) return;
    const timer = window.setTimeout(() => searchFn.current(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const items: { key: string; run: () => void }[] = [
    ...KEYWORDS.map((keyword) => ({
      key: keyword.id,
      run: () => {
        const next = keyword.apply(query);
        onQuery(next);
        if (searchable(next)) {
          remember(next);
          setRecents(readRecents());
          onSearch(next);
        }
        inputRef.current?.focus();
      },
    })),
    ...recents.map((recent) => ({
      key: `r:${recent}`,
      run: () => {
        onQuery(recent);
        onSearch(recent);
        setOpen(false);
      },
    })),
  ];

  function commitTyped() {
    if (!searchable(query)) return;
    remember(query);
    setRecents(readRecents());
    onSearch(query);
    setOpen(false);
  }

  return (
    <div className="search-wrap">
      <div className="search-box">
        <Search className="size-3.5 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            setRecents(readRecents());
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClear();
              setOpen(false);
              e.currentTarget.blur();
              return;
            }
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(-1, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && items[active]) items[active].run();
              else commitTyped();
            }
          }}
          placeholder="Search"
          aria-label="Search"
          aria-expanded={open}
          role="combobox"
        />
        {(searching || query) && (
          <button
            type="button"
            className="tool"
            style={{ width: 18, height: 18 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            aria-label="Clear search"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="search-suggest" role="listbox">
          <div className="search-section">Keywords</div>
          {KEYWORDS.map((keyword, index) => (
            <button
              key={keyword.id}
              type="button"
              className={"search-option" + (index === active ? " on" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => items[index]?.run()}
            >
              <i style={{ background: keyword.color }} />
              <span>{keyword.label}</span>
              <small>{keyword.hint}</small>
            </button>
          ))}
          {recents.length > 0 && (
            <>
              <div className="search-section">Recents</div>
              {recents.map((recent, index) => {
                const itemIndex = KEYWORDS.length + index;
                return (
                  <div key={recent} className={"search-option" + (itemIndex === active ? " on" : "")}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(itemIndex)}
                      onClick={() => items[itemIndex]?.run()}
                    >
                      <Search />
                      <span>{recent}</span>
                    </button>
                    <button
                      type="button"
                      className="search-drop"
                      aria-label={`Remove ${recent}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const next = recents.filter((item) => item !== recent);
                        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
                        setRecents(next);
                      }}
                    >
                      <X />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from "lucide-react";

const FONTS: [string, string][] = [
  ["", "Default"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["Helvetica, Arial, sans-serif", "Helvetica"],
  ["'PingFang SC', sans-serif", "PingFang SC"],
  ["Georgia, serif", "Georgia"],
  ["'Times New Roman', Times, serif", "Times"],
  ["'Courier New', Courier, monospace", "Courier"],
];

const SIZES = ["", "12px", "13px", "14px", "16px", "18px", "24px"];

export type RichEditorHandle = { focus: () => void };

function ToolButton({
  on,
  label,
  onClick,
  children,
}: {
  on?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"rt-btn" + (on ? " on" : "")}
      aria-label={label}
      aria-pressed={on}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "#1a1a1a",
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const chain = () => editor.chain().focus();

  function applyLink() {
    const url = href.trim();
    if (!url) chain().extendMarkRange("link").unsetLink().run();
    else {
      const full = /^(https?:|mailto:)/i.test(url) ? url : url.includes("@") ? `mailto:${url}` : `https://${url}`;
      chain().extendMarkRange("link").setLink({ href: full }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div className="rt-toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label="Bold (⌘B)" on={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic (⌘I)" on={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Underline (⌘U)" on={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label="Strikethrough" on={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <span className="rt-sep" />
      <select
        className="rt-select"
        aria-label="Font"
        value={state.font}
        onChange={(e) =>
          e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run()
        }
      >
        {FONTS.map(([value, label]) => (
          <option key={label} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="rt-select narrow"
        aria-label="Size"
        value={state.size}
        onChange={(e) =>
          e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run()
        }
      >
        {SIZES.map((size) => (
          <option key={size || "default"} value={size}>
            {size ? size.replace("px", "") : "Size"}
          </option>
        ))}
      </select>
      <label className="rt-btn rt-color" title="Text color">
        <span style={{ color: state.color }}>A</span>
        <i style={{ background: state.color }} />
        <input
          type="color"
          aria-label="Text color"
          value={/^#[0-9a-f]{6}$/i.test(state.color) ? state.color : "#1a1a1a"}
          onChange={(e) => chain().setColor(e.target.value).run()}
        />
      </label>
      <label className="rt-btn rt-color" title="Highlight">
        <Highlighter />
        <input
          type="color"
          aria-label="Highlight color"
          defaultValue="#fff59d"
          onChange={(e) => chain().setBackgroundColor(e.target.value).run()}
        />
      </label>
      <span className="rt-sep" />
      <ToolButton label="Bulleted list" on={state.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label="Numbered list" on={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Decrease indent" onClick={() => chain().liftListItem("listItem").run()}>
        <IndentDecrease />
      </ToolButton>
      <ToolButton
        label="Increase indent"
        onClick={() => {
          if (!editor.can().sinkListItem("listItem")) chain().toggleBulletList().run();
          else chain().sinkListItem("listItem").run();
        }}
      >
        <IndentIncrease />
      </ToolButton>
      <span className="rt-sep" />
      <span className="relative">
        <ToolButton
          label="Link"
          on={state.link || linkOpen}
          onClick={() => {
            setHref(state.href);
            setLinkOpen((o) => !o);
          }}
        >
          <Link2 />
        </ToolButton>
        {linkOpen && (
          <span className="rt-link">
            <input
              autoFocus
              placeholder="https://… or name@mail.com"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setLinkOpen(false);
                }
              }}
            />
            <button type="button" className="text-btn" onClick={applyLink}>
              {href.trim() ? "Apply" : "Remove"}
            </button>
          </span>
        )}
      </span>
      <ToolButton
        label="Clear formatting"
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting />
      </ToolButton>
    </div>
  );
}

export function RichEditor({
  initialHtml,
  placeholder,
  autoFocus,
  handleRef,
  onChange,
  className,
  children,
}: {
  initialHtml: string;
  placeholder?: string;
  autoFocus?: boolean;
  handleRef?: React.Ref<RichEditorHandle>;
  onChange: (html: string, text: string) => void;
  className?: string;
  /** Read-only blocks (signature, quoted original) that scroll with the text. */
  children?: React.ReactNode;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextStyleKit.configure({ lineHeight: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: initialHtml,
    autofocus: autoFocus ? "start" : false,
    editorProps: { attributes: { class: "rt-content", spellcheck: "true" } },
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML(), e.getText({ blockSeparator: "\n" })),
  });

  useEffect(() => {
    if (!handleRef || !editor) return;
    const handle: RichEditorHandle = { focus: () => editor.commands.focus("start") };
    if (typeof handleRef === "function") handleRef(handle);
    else (handleRef as React.MutableRefObject<RichEditorHandle | null>).current = handle;
  }, [editor, handleRef]);

  if (!editor) return null;
  return (
    <div className={"rt " + (className ?? "")}>
      <Toolbar editor={editor} />
      <div className="rt-scroll" onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          editor.commands.focus("end");
        }
      }}>
        <EditorContent editor={editor} />
        {children}
      </div>
    </div>
  );
}

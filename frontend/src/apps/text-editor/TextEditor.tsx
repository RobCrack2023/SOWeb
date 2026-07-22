import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import {
  createTextFile,
  getDesktopId,
  getFileContent,
  renameFile,
  updateFileContent,
} from "../../lib/filesApi";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import styles from "./TextEditor.module.css";

export interface TextEditorProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
}

function ensureDocExt(name: string): string {
  const trimmed = name.trim() || "Documento sin título";
  return trimmed.toLowerCase().endsWith(".doc") ? trimmed : `${trimmed}.doc`;
}

export function TextEditor({ windowId, fileId: initialFileId, folderId }: TextEditorProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [name, setName] = useState("Documento sin título");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);
  const savedNameRef = useRef<string | null>(null);
  const desktopIdRef = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, TextAlign.configure({ types: ["heading", "paragraph"] })],
    content: "",
    onUpdate: () => {
      setDirty(true);
      force((n) => n + 1);
    },
    onSelectionUpdate: () => force((n) => n + 1),
  });

  // Load existing document content once the editor is ready.
  useEffect(() => {
    if (!editor || initialFileId == null) return;
    getFileContent(initialFileId).then((doc) => {
      editor.commands.setContent(doc.content || "");
      setName(doc.name);
      savedNameRef.current = doc.name;
      setDirty(false);
    });
  }, [editor, initialFileId]);

  // Preload the desktop id so new documents have a default destination.
  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  // Reflect the document name in the window title bar / taskbar.
  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — writeSO`);
  }, [windowId, name, dirty, setTitle]);

  const save = async () => {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const html = editor.getHTML();
      if (fileId == null) {
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const finalName = ensureDocExt(name);
        const created = await createTextFile(finalName, target, html);
        setFileId(created.id);
        setName(created.name);
        savedNameRef.current = created.name;
      } else {
        await updateFileContent(fileId, html);
        const finalName = ensureDocExt(name);
        if (savedNameRef.current !== finalName) {
          await renameFile(fileId, finalName);
          setName(finalName);
          savedNameRef.current = finalName;
        }
      }
      setDirty(false);
      notifyChange();
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  if (!editor) {
    return <div className={styles.loading}>Cargando editor…</div>;
  }

  const btn = (active: boolean) => `${styles.tbtn} ${active ? styles.tbtnActive : ""}`;

  return (
    <div className={styles.editor} onKeyDown={onKeyDown}>
      <div className={styles.docBar}>
        <input
          className={styles.nameInput}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
        <button className={styles.saveBtn} onClick={save} disabled={saving || (!dirty && fileId != null)}>
          {saving ? "Guardando…" : dirty || fileId == null ? "💾 Guardar" : "✓ Guardado"}
        </button>
      </div>

      <div className={styles.toolbar}>
        <button className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita">
          <b>N</b>
        </button>
        <button className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva">
          <i>C</i>
        </button>
        <button className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado">
          <s>S</s>
        </button>
        <span className={styles.tsep} />
        <button className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1">
          H1
        </button>
        <button className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2">
          H2
        </button>
        <button className={btn(editor.isActive("paragraph"))} onClick={() => editor.chain().focus().setParagraph().run()} title="Párrafo">
          ¶
        </button>
        <span className={styles.tsep} />
        <button className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista con viñetas">
          • Lista
        </button>
        <button className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
          1. Lista
        </button>
        <span className={styles.tsep} />
        <button className={btn(editor.isActive({ textAlign: "left" }))} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Alinear izquierda">
          ⯇
        </button>
        <button className={btn(editor.isActive({ textAlign: "center" }))} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centrar">
          ≡
        </button>
        <button className={btn(editor.isActive({ textAlign: "right" }))} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Alinear derecha">
          ⯈
        </button>
      </div>

      <div className={styles.page}>
        <EditorContent editor={editor} className={styles.content} />
      </div>
    </div>
  );
}

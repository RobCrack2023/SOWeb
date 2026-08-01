import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import {
  DOC_EXT,
  createTextFile,
  fetchFileBytes,
  getDesktopId,
  getFileContent,
  renameFile,
  updateFileContent,
  uploadBlob,
  type ImportRequest,
} from "../../lib/filesApi";
import { ensureExt, withExt } from "../../lib/names";
import { pickLocalFile } from "../../lib/office/pick";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import styles from "./TextEditor.module.css";

const FALLBACK_NAME = "Documento sin título";
const TEXT_COLORS = ["#1a1a1a", "#c2272d", "#1f4e79", "#1a7f43", "#b06000"];

export interface TextEditorProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  importFrom?: ImportRequest;
}

const ensureDocExt = (name: string) => ensureExt(name, DOC_EXT, FALLBACK_NAME);

export function TextEditor({
  windowId,
  fileId: initialFileId,
  folderId: initialFolderId,
  importFrom,
}: TextEditorProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [folderId, setFolderId] = useState<number | undefined>(initialFolderId);
  const [name, setName] = useState(FALLBACK_NAME);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, force] = useState(0);
  const savedNameRef = useRef<string | null>(null);
  const desktopIdRef = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // Without table nodes ProseMirror silently drops <table> and flattens
      // every cell into a loose paragraph, which is how Word tables were
      // getting lost on import.
      TableKit.configure({ table: { resizable: true } }),
      TextStyle,
      Color,
    ],
    content: "",
    onUpdate: () => {
      setDirty(true);
      force((n) => n + 1);
    },
    onSelectionUpdate: () => force((n) => n + 1),
  });

  // Load an existing native document once the editor is ready.
  useEffect(() => {
    if (!editor || initialFileId == null) return;
    getFileContent(initialFileId).then((doc) => {
      editor.commands.setContent(doc.content || "");
      setName(doc.name);
      setFolderId(doc.folder_id);
      savedNameRef.current = doc.name;
      setDirty(false);
    });
  }, [editor, initialFileId]);

  // Opening a .docx converts it into a new, unsaved native document, leaving
  // the original Word file untouched.
  useEffect(() => {
    if (!editor || !importFrom) return;
    setBusy("Importando documento de Word…");
    fetchFileBytes(importFrom.id)
      .then(async (bytes) => {
        const { importDocx } = await import("../../lib/office/docxIO");
        return importDocx(bytes);
      })
      .then((html) => {
        editor.commands.setContent(html || "");
        setName(withExt(importFrom.name, DOC_EXT));
        setFolderId(importFrom.folderId);
        setFileId(undefined);
        savedNameRef.current = null;
        setDirty(true);
      })
      .catch((err) => window.alert(`No se pudo importar: ${err}`))
      .finally(() => setBusy(null));
  }, [editor, importFrom]);

  // Preload the desktop id so new documents have a default destination.
  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  // Reflect the document name in the window title bar / taskbar.
  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — writeSO`);
  }, [windowId, name, dirty, setTitle]);

  const importFromDisk = async () => {
    if (!editor) return;
    const file = await pickLocalFile(".docx");
    if (!file) return;
    setBusy("Importando documento de Word…");
    try {
      const { importDocx } = await import("../../lib/office/docxIO");
      const html = await importDocx(await file.arrayBuffer());
      editor.commands.setContent(html || "");
      setName(withExt(file.name, DOC_EXT));
      setFileId(undefined);
      savedNameRef.current = null;
      setDirty(true);
    } catch (err) {
      window.alert(`No se pudo importar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const exportToWord = async () => {
    if (!editor) return;
    const target = folderId ?? desktopIdRef.current;
    if (target == null) return;
    setBusy("Exportando a Word…");
    try {
      const { exportDocx } = await import("../../lib/office/docxIO");
      const docxName = withExt(name, ".docx");
      const blob = await exportDocx(editor.getJSON(), docxName);
      await uploadBlob(target, docxName, blob);
      notifyChange();
      window.alert(`Exportado como ${docxName}`);
    } catch (err) {
      window.alert(`No se pudo exportar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

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
  const inTable = editor.isActive("table");

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
        <button className={styles.officeBtn} onClick={importFromDisk} disabled={!!busy} title="Abrir un .docx de tu equipo">
          📘 Abrir Word
        </button>
        <button className={styles.officeBtn} onClick={exportToWord} disabled={!!busy} title="Guardar una copia .docx en SOWeb">
          ⤓ Exportar .docx
        </button>
        <button className={styles.saveBtn} onClick={save} disabled={saving || (!dirty && fileId != null)}>
          {saving ? "Guardando…" : dirty || fileId == null ? "💾 Guardar" : "✓ Guardado"}
        </button>
      </div>

      {busy && <div className={styles.busyBar}>{busy}</div>}

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
        <span className={styles.tsep} />
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            className={styles.colorSwatch}
            style={{ background: c }}
            onClick={() => editor.chain().focus().setColor(c).run()}
            title={`Color ${c}`}
          />
        ))}
        <span className={styles.tsep} />
        <button
          className={styles.tbtn}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          title="Insertar tabla"
        >
          ⊞ Tabla
        </button>
        {inTable && (
          <>
            <button className={styles.tbtn} onClick={() => editor.chain().focus().addRowAfter().run()} title="Agregar fila">
              +Fila
            </button>
            <button className={styles.tbtn} onClick={() => editor.chain().focus().addColumnAfter().run()} title="Agregar columna">
              +Col
            </button>
            <button className={styles.tbtn} onClick={() => editor.chain().focus().deleteRow().run()} title="Quitar fila">
              −Fila
            </button>
            <button className={styles.tbtn} onClick={() => editor.chain().focus().deleteColumn().run()} title="Quitar columna">
              −Col
            </button>
            <button className={styles.tbtn} onClick={() => editor.chain().focus().deleteTable().run()} title="Eliminar tabla">
              🗑 Tabla
            </button>
          </>
        )}
      </div>

      <div className={styles.page}>
        <EditorContent editor={editor} className={styles.content} />
      </div>
    </div>
  );
}

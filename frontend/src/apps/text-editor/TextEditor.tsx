import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import {
  DOC_EXT,
  fetchFileBytes,
  getDesktopId,
  getFileContent,
  renameFile,
  replaceFileBinary,
  uploadBlob,
  type ImportRequest,
} from "../../lib/filesApi";
import { ensureExt } from "../../lib/names";
import { pickLocalFile } from "../../lib/office/pick";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import {
  DEFAULT_PAGE,
  PAGE_SIZES,
  mmToPx,
  pageDimsMm,
  parseStoredDoc,
  type PageSetup,
} from "./page";
import styles from "./TextEditor.module.css";

const FALLBACK_NAME = "Documento sin título";
const TEXT_COLORS = ["#1a1a1a", "#c2272d", "#1f4e79", "#1a7f43", "#b06000"];

export interface TextEditorProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  importFrom?: ImportRequest;
}

/** Documents are saved as real .docx so they're useful outside SOWeb too. */
const DOCX_EXT = ".docx";

/**
 * The name a document is saved under. A legacy `.sodoc` has its extension
 * swapped rather than appended, so converting one doesn't leave
 * "informe.sodoc.docx" behind.
 */
function docFileName(name: string): string {
  const trimmed = name.trim() || FALLBACK_NAME;
  if (trimmed.toLowerCase().endsWith(DOC_EXT)) {
    return `${trimmed.slice(0, -DOC_EXT.length)}${DOCX_EXT}`;
  }
  return ensureExt(trimmed, DOCX_EXT, FALLBACK_NAME);
}

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
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE);
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
    editorProps: {
      // Tell the browser to spellcheck in Spanish; its native context menu is
      // the only place the correction suggestions are exposed.
      attributes: { spellcheck: "true", lang: "es" },
    },
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
      const stored = parseStoredDoc(doc.content || "");
      editor.commands.setContent(stored.html);
      setPage(stored.page);
      setName(doc.name);
      setFolderId(doc.folder_id);
      savedNameRef.current = doc.name;
      // A legacy .sodoc counts as unsaved: saving rewrites it as .docx.
      setDirty(doc.name.toLowerCase().endsWith(DOC_EXT));
    });
  }, [editor, initialFileId]);

  // A .docx from the drive opens as itself: saving writes back to the same
  // file rather than leaving a second copy behind.
  useEffect(() => {
    if (!editor || !importFrom) return;
    setBusy("Abriendo documento de Word…");
    fetchFileBytes(importFrom.id)
      .then(async (bytes) => {
        const { importDocx } = await import("../../lib/office/docxIO");
        return importDocx(bytes);
      })
      .then((imported) => {
        // A file writeSO itself wrote carries the exact editor document;
        // otherwise fall back to what mammoth could read.
        editor.commands.setContent((imported.doc as never) ?? imported.html ?? "");
        if (imported.page) setPage((p) => ({ ...p, ...imported.page! }));
        setName(importFrom.name);
        setFolderId(importFrom.folderId);
        setFileId(importFrom.id);
        savedNameRef.current = importFrom.name;
        setDirty(false);
      })
      .catch((err) => window.alert(`No se pudo abrir: ${err}`))
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
      const imported = await importDocx(await file.arrayBuffer());
      editor.commands.setContent((imported.doc as never) ?? imported.html ?? "");
      if (imported.page) setPage((p) => ({ ...p, ...imported.page! }));
      setName(docFileName(file.name));
      setFileId(undefined);
      savedNameRef.current = null;
      setDirty(true);
    } catch (err) {
      window.alert(`No se pudo importar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  /** Build the .docx for the current document, page setup included. */
  const buildDocx = async (): Promise<Blob> => {
    const { exportDocx } = await import("../../lib/office/docxIO");
    const dims = pageDimsMm(page);
    return exportDocx(editor!.getJSON(), docFileName(name), {
      ...dims,
      marginMm: page.marginMm,
    });
  };

  /** Save a copy to the real machine, rather than into SOWeb's drive. */
  const downloadCopy = async () => {
    if (!editor) return;
    setBusy("Preparando la descarga…");
    try {
      const url = URL.createObjectURL(await buildDocx());
      const link = document.createElement("a");
      link.href = url;
      link.download = docFileName(name);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(`No se pudo descargar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Saves a real .docx, so the file opens in Word or Google Docs without
   * exporting first. The editor's own document rides along inside the package
   * so reopening it here loses nothing.
   */
  const save = async () => {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const blob = await buildDocx();
      const finalName = docFileName(name);

      if (fileId == null) {
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const created = await uploadBlob(target, finalName, blob);
        setFileId(created.id);
        setName(created.name);
        savedNameRef.current = created.name;
      } else {
        await replaceFileBinary(fileId, finalName, blob);
        // A document opened from a legacy .sodoc gets renamed on first save,
        // since what's now stored under that name is really a .docx.
        if (savedNameRef.current !== finalName) {
          await renameFile(fileId, finalName);
          savedNameRef.current = finalName;
        }
        setName(finalName);
      }
      setDirty(false);
      notifyChange();
    } catch (err) {
      window.alert(`No se pudo guardar: ${err}`);
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
        <button className={styles.officeBtn} onClick={downloadCopy} disabled={!!busy} title="Bajar una copia .docx a tu equipo">
          ⤓ Descargar
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
        <select
          className={styles.pageSelect}
          value={page.sizeId}
          onChange={(e) => {
            setPage((p) => ({ ...p, sizeId: e.target.value }));
            setDirty(true);
          }}
          title="Tamaño de página"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className={btn(page.landscape)}
          onClick={() => {
            setPage((p) => ({ ...p, landscape: !p.landscape }));
            setDirty(true);
          }}
          title={page.landscape ? "Orientación horizontal" : "Orientación vertical"}
        >
          {page.landscape ? "▭" : "▯"}
        </button>
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
        <EditorContent
          editor={editor}
          className={styles.content}
          style={{
            width: mmToPx(pageDimsMm(page).widthMm),
            // Show at least a full sheet so the page feels physical.
            minHeight: mmToPx(pageDimsMm(page).heightMm),
            ["--page-margin" as string]: `${mmToPx(page.marginMm)}px`,
          }}
        />
      </div>
    </div>
  );
}

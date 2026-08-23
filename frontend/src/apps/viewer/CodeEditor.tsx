import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  createTextFile,
  fetchFileBytes,
  getDesktopId,
  renameFile,
  updateFileContent,
  type FileOut,
} from "../../lib/filesApi";
import { useFsStore } from "../../lib/fsStore";
import { useWindowStore } from "../../windows/windowStore";
import styles from "./CodeEditor.module.css";

export interface CodeEditorProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  name?: string;
  contentType?: string;
}

/** Extensions worth opening here rather than downloading. */
const TEXT_EXTS = [
  ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".xml", ".yml", ".yaml",
  ".ini", ".cfg", ".conf", ".env", ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".h", ".cpp", ".cs", ".php", ".sh", ".bat", ".ps1", ".sql",
  ".html", ".htm", ".css", ".scss", ".toml", ".gitignore",
];

export function isTextFile(file: Pick<FileOut, "name" | "content_type">): boolean {
  const type = (file.content_type || "").toLowerCase();
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") {
    return true;
  }
  const name = file.name.toLowerCase();
  return TEXT_EXTS.some((ext) => name.endsWith(ext));
}

/** Rough language label, shown in the status bar. */
function languageOf(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const map: Record<string, string> = {
    ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".py": "Python", ".json": "JSON", ".md": "Markdown", ".markdown": "Markdown",
    ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "SCSS", ".xml": "XML",
    ".yml": "YAML", ".yaml": "YAML", ".sql": "SQL", ".sh": "Shell", ".bat": "Batch",
    ".ps1": "PowerShell", ".csv": "CSV", ".java": "Java", ".c": "C", ".cpp": "C++",
    ".cs": "C#", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
  };
  return map[ext] ?? "Texto";
}

export function CodeEditor({
  windowId,
  fileId: initialFileId,
  folderId: initialFolderId,
  name: initialName = "nuevo.txt",
  contentType,
}: CodeEditorProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [folderId, setFolderId] = useState<number | undefined>(initialFolderId);
  const [name, setName] = useState(initialName);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(initialFileId == null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const desktopIdRef = useRef<number | null>(null);

  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  // Read as bytes and decode as UTF-8: the /content route replaces invalid
  // sequences, which would corrupt the file when it's saved back.
  useEffect(() => {
    if (initialFileId == null) return;
    fetchFileBytes(initialFileId)
      .then((bytes) => setText(new TextDecoder("utf-8").decode(bytes)))
      .catch((err) => setError(String(err)))
      .finally(() => setLoaded(true));
  }, [initialFileId]);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — Editor`);
  }, [windowId, name, dirty, setTitle]);

  const lineCount = text.split("\n").length;

  const syncScroll = () => {
    if (gutterRef.current && textRef.current) {
      gutterRef.current.scrollTop = textRef.current.scrollTop;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    // Tab indents instead of leaving the editor.
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const next = `${text.slice(0, start)}  ${text.slice(end)}`;
      setText(next);
      setDirty(true);
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (fileId == null) {
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const created = await createTextFile(name, target, text, contentType || "text/plain");
        setFileId(created.id);
        setName(created.name);
        setFolderId(created.folder_id);
      } else {
        await updateFileContent(fileId, text);
        if (name !== initialName) await renameFile(fileId, name);
      }
      setDirty(false);
      notifyChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className={styles.loading}>Cargando…</div>;

  return (
    <div className={styles.editor}>
      <div className={styles.bar}>
        <input
          className={styles.nameInput}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
        <button onClick={() => setWrap((v) => !v)} title="Ajuste de línea">
          {wrap ? "↵ Ajustar" : "→ Sin ajuste"}
        </button>
        <button className={styles.saveBtn} onClick={save} disabled={saving || (!dirty && fileId != null)}>
          {saving ? "Guardando…" : dirty || fileId == null ? "💾 Guardar" : "✓ Guardado"}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.body}>
        <pre className={styles.gutter} ref={gutterRef} aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
        </pre>
        <textarea
          ref={textRef}
          className={`${styles.text} ${wrap ? styles.wrap : styles.noWrap}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder="Escribí acá…"
        />
      </div>

      <div className={styles.status}>
        <span>{languageOf(name)}</span>
        <span>
          {lineCount} línea{lineCount === 1 ? "" : "s"}
        </span>
        <span>{text.length} caracteres</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  SHEET_MIME,
  createTextFile,
  getDesktopId,
  getFileContent,
  renameFile,
  updateFileContent,
} from "../../lib/filesApi";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import { cellRef, computeAll, displayValue, indexToCol, parseRef, type Cells } from "./formula";
import styles from "./SpreadSheet.module.css";

const COLS = 26;
const ROWS = 40;

export interface SpreadSheetProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
}

function ensureSheetExt(name: string): string {
  const trimmed = name.trim() || "Hoja sin título";
  return trimmed.toLowerCase().endsWith(".sheet") ? trimmed : `${trimmed}.sheet`;
}

export function SpreadSheet({ windowId, fileId: initialFileId, folderId }: SpreadSheetProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [name, setName] = useState("Hoja sin título");
  const [cells, setCells] = useState<Cells>({});
  const [selected, setSelected] = useState("A1");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedNameRef = useRef<string | null>(null);
  const desktopIdRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const computed = useMemo(() => computeAll(cells), [cells]);

  useEffect(() => {
    if (initialFileId == null) return;
    getFileContent(initialFileId).then((doc) => {
      try {
        setCells(JSON.parse(doc.content || "{}"));
      } catch {
        setCells({});
      }
      setName(doc.name);
      savedNameRef.current = doc.name;
      setDirty(false);
    });
  }, [initialFileId]);

  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — spreadSO`);
  }, [windowId, name, dirty, setTitle]);

  const commitCell = (ref: string, raw: string) => {
    setCells((prev) => {
      const next = { ...prev };
      if (raw.trim() === "") delete next[ref];
      else next[ref] = raw;
      return next;
    });
    setDirty(true);
  };

  const startEdit = (ref: string, initial?: string) => {
    setSelected(ref);
    setEditing(ref);
    setEditValue(initial ?? cells[ref] ?? "");
  };

  const finishEdit = (move?: "down" | "right") => {
    if (editing) {
      commitCell(editing, editValue);
      setEditing(null);
    }
    if (move) {
      const p = parseRef(selected)!;
      const nextRef =
        move === "down"
          ? cellRef(p.col, Math.min(ROWS - 1, p.row + 1))
          : cellRef(Math.min(COLS - 1, p.col + 1), p.row);
      setSelected(nextRef);
    }
    gridRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    gridRef.current?.focus();
  };

  const moveSelection = (dCol: number, dRow: number) => {
    const p = parseRef(selected)!;
    const col = Math.max(0, Math.min(COLS - 1, p.col + dCol));
    const row = Math.max(0, Math.min(ROWS - 1, p.row + dRow));
    setSelected(cellRef(col, row));
  };

  const onGridKeyDown = (e: KeyboardEvent) => {
    if (editing) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(0, -1);
    } else if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      moveSelection(0, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveSelection(-1, 0);
    } else if (e.key === "ArrowRight" || e.key === "Tab") {
      e.preventDefault();
      moveSelection(1, 0);
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit(selected);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      commitCell(selected, "");
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      startEdit(selected, e.key);
    }
  };

  const onEditKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishEdit("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      finishEdit("right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const content = JSON.stringify(cells);
      if (fileId == null) {
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const created = await createTextFile(ensureSheetExt(name), target, content, SHEET_MIME);
        setFileId(created.id);
        setName(created.name);
        savedNameRef.current = created.name;
      } else {
        await updateFileContent(fileId, content);
        const finalName = ensureSheetExt(name);
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

  const onToolbarKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  const selRaw = editing === selected ? editValue : cells[selected] ?? "";

  return (
    <div className={styles.sheet} onKeyDown={onToolbarKeyDown}>
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

      <div className={styles.formulaBar}>
        <span className={styles.cellName}>{selected}</span>
        <span className={styles.fx}>fx</span>
        <input
          className={styles.formulaInput}
          value={selRaw}
          onChange={(e) => {
            if (editing !== selected) setEditing(selected);
            setEditValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishEdit("down");
            } else if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          placeholder="Valor o =fórmula"
        />
      </div>

      <div className={styles.gridWrap} ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.corner} />
              {Array.from({ length: COLS }, (_, c) => (
                <th key={c} className={styles.colHead}>
                  {indexToCol(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r}>
                <th className={styles.rowHead}>{r + 1}</th>
                {Array.from({ length: COLS }, (_, c) => {
                  const ref = cellRef(c, r);
                  const isSel = ref === selected;
                  const isEditing = editing === ref;
                  const val = computed.get(ref) ?? "";
                  const isError = typeof val === "string" && val.startsWith("#");
                  return (
                    <td
                      key={c}
                      data-ref={ref}
                      className={`${styles.cell} ${isSel ? styles.selectedCell : ""} ${isError ? styles.errorCell : ""}`}
                      onMouseDown={() => {
                        if (!isEditing) {
                          finishEdit();
                          setSelected(ref);
                        }
                      }}
                      onDoubleClick={() => startEdit(ref)}
                    >
                      {isEditing ? (
                        <input
                          className={styles.cellInput}
                          value={editValue}
                          autoFocus
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={onEditKeyDown}
                          onBlur={() => finishEdit()}
                        />
                      ) : (
                        <span className={typeof val === "number" ? styles.numeric : undefined}>
                          {displayValue(val)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

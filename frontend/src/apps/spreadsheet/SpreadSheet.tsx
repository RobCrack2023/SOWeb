import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  SHEET_EXT,
  SHEET_MIME,
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
import { cellRef, computeWorkbook, displayValue, indexToCol, parseRef, type Sheet } from "./formula";
import {
  blankWorkbook,
  makeSheet,
  nextSheetName,
  parseDocument,
  sanitizeSheetName,
  serializeDocument,
  uniqueSheetName,
} from "./workbook";
import { SheetTabs } from "./SheetTabs";
import styles from "./SpreadSheet.module.css";

/** A blank sheet still shows this much room to type into. */
const MIN_COLS = 26;
const MIN_ROWS = 40;
/** Spare space past the last used cell, so there's always somewhere to grow. */
const SLACK_COLS = 3;
const SLACK_ROWS = 12;
/** Must match .cell/.rowHead height in the stylesheet. */
const ROW_H = 24;
/** Rows drawn beyond the viewport, to keep scrolling from flashing blanks. */
const OVERSCAN = 12;
const FALLBACK_NAME = "Hoja sin título";

export interface SpreadSheetProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  importFrom?: ImportRequest;
}

const ensureSheetExt = (name: string) => ensureExt(name, SHEET_EXT, FALLBACK_NAME);

export function SpreadSheet({
  windowId,
  fileId: initialFileId,
  folderId: initialFolderId,
  importFrom,
}: SpreadSheetProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [folderId, setFolderId] = useState<number | undefined>(initialFolderId);
  const [name, setName] = useState(FALLBACK_NAME);
  const [sheets, setSheets] = useState<Sheet[]>(blankWorkbook);
  const [activeId, setActiveId] = useState<string>(() => "");
  const [selected, setSelected] = useState("A1");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const savedNameRef = useRef<string | null>(null);
  const desktopIdRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // The whole workbook is evaluated together so formulas can cross sheets.
  const computedBySheet = useMemo(() => computeWorkbook(sheets), [sheets]);
  const active = sheets.find((s) => s.id === activeId) ?? sheets[0];
  const cells = active?.cells ?? {};
  const computed = computedBySheet.get(active?.id ?? "") ?? new Map();

  /** Replace the active sheet's cells, leaving the other tabs untouched. */
  const updateActiveCells = (mutate: (cells: Sheet["cells"]) => Sheet["cells"]) => {
    setSheets((prev) =>
      prev.map((s) => (s.id === active?.id ? { ...s, cells: mutate(s.cells) } : s)),
    );
    setDirty(true);
  };

  // The grid grows to fit whatever the sheet actually holds — an imported
  // workbook can run to thousands of rows.
  const { cols: COLS, rows: ROWS } = useMemo(() => {
    let maxCol = MIN_COLS - SLACK_COLS - 1;
    let maxRow = MIN_ROWS - SLACK_ROWS - 1;
    const refs = new Set([...Object.keys(cells), ...Object.keys(active?.styles ?? {})]);
    for (const ref of refs) {
      const p = parseRef(ref);
      if (!p) continue;
      if (p.col > maxCol) maxCol = p.col;
      if (p.row > maxRow) maxRow = p.row;
    }
    return {
      cols: Math.max(MIN_COLS, maxCol + 1 + SLACK_COLS),
      rows: Math.max(MIN_ROWS, maxRow + 1 + SLACK_ROWS),
    };
  }, [cells, active?.styles]);

  const loadSheets = (loaded: Sheet[]) => {
    setSheets(loaded);
    setActiveId(loaded[0]?.id ?? "");
    setSelected("A1");
    setEditing(null);
  };

  useEffect(() => {
    if (initialFileId == null) return;
    getFileContent(initialFileId).then((doc) => {
      loadSheets(parseDocument(doc.content));
      setName(doc.name);
      setFolderId(doc.folder_id);
      savedNameRef.current = doc.name;
      setDirty(false);
    });
  }, [initialFileId]);

  // Opening an .xlsx converts it into a new, unsaved native sheet.
  useEffect(() => {
    if (!importFrom) return;
    setBusy("Importando libro de Excel…");
    fetchFileBytes(importFrom.id)
      .then(async (bytes) => {
        const { importXlsx } = await import("../../lib/office/xlsxIO");
        return importXlsx(bytes);
      })
      .then((imported) => {
        loadSheets(imported);
        setName(withExt(importFrom.name, SHEET_EXT));
        setFolderId(importFrom.folderId);
        setFileId(undefined);
        savedNameRef.current = null;
        setDirty(true);
      })
      .catch((err) => window.alert(`No se pudo importar: ${err}`))
      .finally(() => setBusy(null));
  }, [importFrom]);

  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  // Only the rows near the viewport are put in the DOM; a 6000-row sheet would
  // otherwise mean well over a hundred thousand cells.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setViewportH(el.clientHeight);
    onResize();
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // Switching to a shorter sheet leaves the old scroll offset behind, which
  // would put the drawn window past the end of the new sheet — i.e. blank.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [activeId]);

  const maxFirstRow = Math.max(0, ROWS - 1);
  const firstRow = Math.min(maxFirstRow, Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const lastRow = Math.min(
    ROWS,
    Math.max(firstRow + 1, Math.ceil((scrollTop + (viewportH || 600)) / ROW_H) + OVERSCAN),
  );

  // Keyboard navigation can walk the selection outside the drawn window.
  useEffect(() => {
    const el = gridRef.current;
    const p = parseRef(selected);
    if (!el || !p) return;
    const top = p.row * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_H - el.clientHeight;
    }
  }, [selected]);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — spreadSO`);
  }, [windowId, name, dirty, setTitle]);

  const commitCell = (ref: string, raw: string) => {
    updateActiveCells((prev) => {
      const next = { ...prev };
      if (raw.trim() === "") delete next[ref];
      else next[ref] = raw;
      return next;
    });
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

  const addSheet = () => {
    const sheet = makeSheet(nextSheetName(sheets.map((s) => s.name)));
    setSheets((prev) => [...prev, sheet]);
    setActiveId(sheet.id);
    setSelected("A1");
    setEditing(null);
    setDirty(true);
  };

  const renameSheet = (id: string, raw: string) => {
    const clean = sanitizeSheetName(raw);
    const current = sheets.find((s) => s.id === id);
    if (!current || !clean || clean === current.name) return;
    const others = sheets.filter((s) => s.id !== id).map((s) => s.name);
    const finalName = uniqueSheetName(others, clean);
    setSheets((prev) => prev.map((s) => (s.id === id ? { ...s, name: finalName } : s)));
    setDirty(true);
  };

  const deleteSheet = (id: string) => {
    if (sheets.length === 1) {
      window.alert("Un libro necesita al menos una hoja.");
      return;
    }
    const sheet = sheets.find((s) => s.id === id);
    if (!sheet) return;
    const hasContent = Object.keys(sheet.cells).length > 0;
    if (hasContent && !window.confirm(`¿Eliminar la hoja "${sheet.name}" y su contenido?`)) return;

    const index = sheets.findIndex((s) => s.id === id);
    const remaining = sheets.filter((s) => s.id !== id);
    setSheets(remaining);
    if (activeId === id) {
      setActiveId(remaining[Math.max(0, index - 1)].id);
      setSelected("A1");
      setEditing(null);
    }
    setDirty(true);
  };

  const selectSheet = (id: string) => {
    if (id === activeId) return;
    finishEdit();
    setActiveId(id);
    setSelected("A1");
  };

  const importFromDisk = async () => {
    const file = await pickLocalFile(".xlsx");
    if (!file) return;
    setBusy("Importando libro de Excel…");
    try {
      const { importXlsx } = await import("../../lib/office/xlsxIO");
      loadSheets(await importXlsx(await file.arrayBuffer()));
      setName(withExt(file.name, SHEET_EXT));
      setFileId(undefined);
      savedNameRef.current = null;
      setDirty(true);
    } catch (err) {
      window.alert(`No se pudo importar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const exportToExcel = async () => {
    const target = folderId ?? desktopIdRef.current;
    if (target == null) return;
    setBusy("Exportando a Excel…");
    try {
      const { exportXlsx } = await import("../../lib/office/xlsxIO");
      const xlsxName = withExt(name, ".xlsx");
      const blob = await exportXlsx(sheets);
      await uploadBlob(target, xlsxName, blob);
      notifyChange();
      window.alert(`Exportado como ${xlsxName}`);
    } catch (err) {
      window.alert(`No se pudo exportar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const content = serializeDocument(sheets);
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
        <button className={styles.officeBtn} onClick={importFromDisk} disabled={!!busy} title="Abrir un .xlsx de tu equipo">
          📗 Abrir Excel
        </button>
        <button className={styles.officeBtn} onClick={exportToExcel} disabled={!!busy} title="Guardar una copia .xlsx en SOWeb">
          ⤓ Exportar .xlsx
        </button>
        <button className={styles.saveBtn} onClick={save} disabled={saving || (!dirty && fileId != null)}>
          {saving ? "Guardando…" : dirty || fileId == null ? "💾 Guardar" : "✓ Guardado"}
        </button>
      </div>

      {busy && <div className={styles.busyBar}>{busy}</div>}

      <div className={styles.formulaBar}>
        <span className={styles.cellName} title={`Hoja: ${active?.name ?? ""}`}>
          {selected}
        </span>
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
            {firstRow > 0 && (
              <tr style={{ height: firstRow * ROW_H }} aria-hidden>
                <td colSpan={COLS + 1} />
              </tr>
            )}
            {Array.from({ length: Math.max(0, lastRow - firstRow) }, (_, i) => {
              const r = firstRow + i;
              return (
              <tr key={r}>
                <th className={styles.rowHead}>{r + 1}</th>
                {Array.from({ length: COLS }, (_, c) => {
                  const ref = cellRef(c, r);
                  const isSel = ref === selected;
                  const isEditing = editing === ref;
                  const val = computed.get(ref) ?? "";
                  const isError = typeof val === "string" && val.startsWith("#");
                  const style = active?.styles[ref];
                  return (
                    <td
                      key={c}
                      data-ref={ref}
                      className={`${styles.cell} ${isSel ? styles.selectedCell : ""} ${isError ? styles.errorCell : ""}`}
                      style={
                        style && {
                          background: style.fill,
                          // An error has to stay visibly red, whatever the
                          // sheet's own font colour says.
                          color: isError ? undefined : style.color,
                          fontWeight: style.bold ? 700 : undefined,
                          fontStyle: style.italic ? "italic" : undefined,
                        }
                      }
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
              );
            })}
            {lastRow < ROWS && (
              <tr style={{ height: (ROWS - lastRow) * ROW_H }} aria-hidden>
                <td colSpan={COLS + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SheetTabs
        sheets={sheets}
        activeId={active?.id ?? ""}
        onSelect={selectSheet}
        onAdd={addSheet}
        onRename={renameSheet}
        onDelete={deleteSheet}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import {
  fetchFileBytes,
  getDesktopId,
  getFileContent,
  renameFile,
  replaceFileBinary,
  uploadBlob,
  type ImportRequest,
} from "../../lib/filesApi";
import { withExt } from "../../lib/names";
import { pickLocalFile } from "../../lib/office/pick";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import { PageCanvas } from "./PageCanvas";
import { CSS_FAMILY, baselineOffset } from "./textMetrics";
import {
  loadPdf,
  sampleBackground,
  savePdf,
  viewToPage,
  type LoadedPdf,
  type TextSpan,
} from "./pdfEngine";
import {
  BLACK,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  WHITE,
  rgbToCss,
  uid,
  type PdfDocState,
  type PdfEdit,
  type Rgb,
  type TextEdit,
} from "./types";
import styles from "./PdfSO.module.css";

const FALLBACK_NAME = "Documento.pdf";
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const THUMB_SCALE = 0.16;

type Tool = "select" | "text" | "highlight" | "image";

export interface PdfSOProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  importFrom?: ImportRequest;
}

export function PdfSO({ windowId, fileId, folderId: initialFolderId, importFrom }: PdfSOProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);

  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [state, setState] = useState<PdfDocState>({ pages: [], edits: [] });
  const [name, setName] = useState(FALLBACK_NAME);
  const [folderId, setFolderId] = useState<number | undefined>(initialFolderId);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [showSpans, setShowSpans] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [color, setColor] = useState<Rgb>(BLACK);
  const [warnRedaction, setWarnRedaction] = useState(false);

  const pageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalRef = useRef<ArrayBuffer | null>(null);
  const desktopIdRef = useRef<number | null>(null);
  /** The PDF being edited; saving overwrites this file in place. */
  const sourceIdRef = useRef<number | null>(null);
  /** The name that file carries on disk, to know when a rename is due. */
  const savedNameRef = useRef<string | null>(null);

  const visiblePages = useMemo(() => state.pages.filter((p) => !p.deleted), [state.pages]);
  const page = visiblePages[Math.min(current, Math.max(0, visiblePages.length - 1))];
  const pageSize = page && pdf ? pdf.pages[page.sourceIndex] : null;
  const rotated = page ? page.rotation === 90 || page.rotation === 270 : false;
  const selected = state.edits.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — pdfSO`);
  }, [windowId, name, dirty, setTitle]);

  const openBytes = useCallback(async (bytes: ArrayBuffer, docName: string) => {
    setBusy("Abriendo PDF…");
    try {
      originalRef.current = bytes;
      const loaded = await loadPdf(bytes);
      setPdf(loaded);
      setState({
        pages: loaded.pages.map((p) => ({ sourceIndex: p.index, rotation: 0, deleted: false })),
        edits: [],
      });
      setName(docName);
      setCurrent(0);
      setDirty(false);
    } catch (err) {
      window.alert(`No se pudo abrir el PDF: ${err}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // Opened from the SOWeb filesystem.
  useEffect(() => {
    if (!importFrom) return;
    setFolderId(importFrom.folderId);
    sourceIdRef.current = importFrom.id;
    savedNameRef.current = importFrom.name;
    fetchFileBytes(importFrom.id).then((bytes) => openBytes(bytes, importFrom.name));
  }, [importFrom, openBytes]);

  // A .pdfso project from before saving overwrote the original. pdfSO no longer
  // creates these: the edits are already drawn into the PDF it points at, so it
  // opens as a plain document and the stored edit list is dropped — replaying it
  // would paint everything a second time.
  useEffect(() => {
    if (fileId == null) return;
    getFileContent(fileId).then(async (doc) => {
      setFolderId(doc.folder_id);
      try {
        const sidecar = JSON.parse(doc.content) as { pdfFileId: number };
        const bytes = await fetchFileBytes(sidecar.pdfFileId);
        const docName = withExt(doc.name, ".pdf");
        sourceIdRef.current = sidecar.pdfFileId;
        savedNameRef.current = docName;
        await openBytes(bytes, docName);
      } catch {
        window.alert("No se pudo abrir el proyecto de pdfSO.");
      }
    });
  }, [fileId, openBytes]);

  // Text positions power click-to-replace.
  useEffect(() => {
    if (!pdf || !page) return;
    let alive = true;
    pdf.textSpans(page.sourceIndex).then((s) => alive && setSpans(s));
    return () => {
      alive = false;
    };
  }, [pdf, page]);

  const mutate = (fn: (s: PdfDocState) => PdfDocState) => {
    setState(fn);
    setDirty(true);
  };

  const addEdit = (edit: PdfEdit) => {
    mutate((s) => ({ ...s, edits: [...s.edits, edit] }));
    setSelectedId(edit.id);
  };

  const updateEdit = (id: string, patch: Partial<PdfEdit>) =>
    mutate((s) => ({
      ...s,
      edits: s.edits.map((e) => (e.id === id ? ({ ...e, ...patch } as PdfEdit) : e)),
    }));

  const deleteEdit = (id: string) => {
    mutate((s) => ({ ...s, edits: s.edits.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };

  const openLocal = async () => {
    const file = await pickLocalFile(".pdf");
    if (!file) return;
    sourceIdRef.current = null;
    savedNameRef.current = null;
    await openBytes(await file.arrayBuffer(), file.name);
    setDirty(true);
  };

  /** Click on existing text: cover it and drop an editable copy on top. */
  const replaceSpan = (span: TextSpan) => {
    if (!page) return;
    const pad = 1;
    const cover = {
      x: span.x - pad,
      y: span.y - pad,
      w: span.w + pad * 2,
      h: span.h + pad * 2,
    };
    // Match the surrounding page colour so the patch doesn't show.
    const bg = pageCanvasRef.current
      ? sampleBackground(pageCanvasRef.current, cover, zoom)
      : WHITE;

    const rect = {
      id: uid("r"),
      kind: "rect" as const,
      page: page.sourceIndex,
      ...cover,
      color: bg,
      opacity: 1,
    };
    const textEdit: TextEdit = {
      id: uid("t"),
      kind: "text",
      page: page.sourceIndex,
      x: span.x,
      y: span.y,
      w: Math.max(span.w, 40),
      h: span.h,
      text: span.str,
      fontSize: span.fontSize,
      color: BLACK,
      bold: span.bold,
      italic: span.italic,
      baseline: span.baseline,
      family: span.family,
    };
    // Add both at once so the cover always sits under its replacement.
    mutate((s) => ({ ...s, edits: [...s.edits, rect, textEdit] }));
    setSelectedId(textEdit.id);
    setEditingId(textEdit.id);
    setTool("select");
    setWarnRedaction(true);
  };

  /** Click on empty canvas with a tool active: create the corresponding edit. */
  const onSurfaceClick = (e: React.MouseEvent) => {
    if (!page || !pageSize) return;
    if (tool === "select") {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vx = (e.clientX - rect.left) / zoom;
    const vy = (e.clientY - rect.top) / zoom;
    const { x, y } = viewToPage(vx, vy, page.rotation, pageSize.width, pageSize.height);

    if (tool === "text") {
      const fontSize = 14;
      const edit: TextEdit = {
        id: uid("t"),
        kind: "text",
        page: page.sourceIndex,
        x,
        y,
        w: 220,
        h: fontSize * 0.93,
        text: "Texto",
        fontSize,
        color,
        bold: false,
        italic: false,
        // Helvetica's ascent, so a fresh box behaves like a replaced run.
        baseline: y + fontSize * 0.718,
        family: "sans",
      };
      addEdit(edit);
      setEditingId(edit.id);
    } else if (tool === "highlight") {
      addEdit({
        id: uid("h"),
        kind: "rect",
        page: page.sourceIndex,
        x,
        y,
        w: 160,
        h: 18,
        color: HIGHLIGHT_COLORS[0].value,
        opacity: 0.45,
      });
    }
    setTool("select");
  };

  const addImage = async () => {
    if (!page) return;
    const file = await pickLocalFile("image/png,image/jpeg");
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    addEdit({
      id: uid("i"),
      kind: "image",
      page: page.sourceIndex,
      x: 60,
      y: 60,
      w: 180,
      h: 140,
      dataUrl,
    });
    setTool("select");
  };

  const rotatePage = () => {
    if (!page) return;
    mutate((s) => ({
      ...s,
      pages: s.pages.map((p) =>
        p.sourceIndex === page.sourceIndex
          ? { ...p, rotation: (((p.rotation + 90) % 360) as 0 | 90 | 180 | 270) }
          : p,
      ),
    }));
  };

  const deletePage = () => {
    if (!page || visiblePages.length <= 1) return;
    if (!window.confirm("¿Quitar esta página del documento?")) return;
    mutate((s) => ({
      ...s,
      pages: s.pages.map((p) => (p.sourceIndex === page.sourceIndex ? { ...p, deleted: true } : p)),
    }));
    setCurrent((c) => Math.max(0, c - 1));
  };

  const movePage = (dir: -1 | 1) => {
    const from = state.pages.findIndex((p) => p.sourceIndex === page?.sourceIndex);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= state.pages.length) return;
    mutate((s) => {
      const pages = [...s.pages];
      [pages[from], pages[to]] = [pages[to], pages[from]];
      return { ...s, pages };
    });
    setCurrent((c) => Math.max(0, Math.min(visiblePages.length - 1, c + dir)));
  };

  /**
   * Writes the edited PDF over the file it was opened from. Uploading instead
   * left the original untouched beside a second icon with the same name.
   *
   * The pristine bytes stay in `originalRef`, so saving twice in one session
   * still redraws the whole edit list onto the original rather than stacking
   * this save on top of the last one.
   */
  const save = async () => {
    if (!originalRef.current) return;
    setBusy("Generando PDF…");
    try {
      const blob = await savePdf(originalRef.current, state);
      const outName = withExt(name, ".pdf");

      if (sourceIdRef.current == null) {
        // Opened from the local disk: there is nothing here yet to overwrite.
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const created = await uploadBlob(target, outName, blob);
        sourceIdRef.current = created.id;
      } else {
        await replaceFileBinary(sourceIdRef.current, outName, blob);
        // The name box is editable, so the file may need to follow along.
        if (savedNameRef.current !== outName) await renameFile(sourceIdRef.current, outName);
      }

      savedNameRef.current = outName;
      setName(outName);
      setDirty(false);
      notifyChange();
    } catch (err) {
      window.alert(`No se pudo guardar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteEdit(selectedId);
    }
  };

  if (!pdf) {
    return (
      <div className={styles.empty} onKeyDown={onKeyDown}>
        {busy ? (
          <div className={styles.emptyMsg}>{busy}</div>
        ) : (
          <>
            <div className={styles.emptyIcon}>📕</div>
            <div className={styles.emptyMsg}>Abrí un PDF para empezar</div>
            <button className={styles.primaryBtn} onClick={openLocal}>
              📂 Abrir PDF…
            </button>
          </>
        )}
      </div>
    );
  }

  const viewW = (rotated ? pageSize!.height : pageSize!.width) * zoom;
  const viewH = (rotated ? pageSize!.width : pageSize!.height) * zoom;
  const pageEdits = state.edits.filter((e) => e.page === page!.sourceIndex);

  return (
    <div className={styles.app} onKeyDown={onKeyDown}>
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
        <button className={styles.toolBtn} onClick={openLocal} disabled={!!busy}>
          📂 Abrir
        </button>
        <button className={styles.primaryBtn} onClick={save} disabled={!!busy || !dirty}>
          {busy ? "…" : dirty ? "💾 Guardar PDF" : "✓ Guardado"}
        </button>
      </div>

      <div className={styles.toolbar}>
        <button
          className={`${styles.toolBtn} ${tool === "select" ? styles.toolOn : ""}`}
          onClick={() => setTool("select")}
          title="Seleccionar y mover"
        >
          ↖ Selección
        </button>
        <button
          className={`${styles.toolBtn} ${tool === "text" ? styles.toolOn : ""}`}
          onClick={() => setTool("text")}
          title="Clic en la página para escribir"
        >
          T Texto
        </button>
        <button
          className={`${styles.toolBtn} ${tool === "highlight" ? styles.toolOn : ""}`}
          onClick={() => setTool("highlight")}
          title="Clic en la página para resaltar"
        >
          ▭ Resaltar
        </button>
        <button className={styles.toolBtn} onClick={addImage} title="Insertar una imagen">
          🖼 Imagen
        </button>
        <span className={styles.sep} />
        <button
          className={`${styles.toolBtn} ${showSpans ? styles.toolOn : ""}`}
          onClick={() => setShowSpans((v) => !v)}
          title="Resalta el texto original; al hacer clic lo reemplazás"
        >
          ✎ Editar texto original
        </button>
        <span className={styles.sep} />
        <button className={styles.toolBtn} onClick={rotatePage} title="Rotar 90°">
          ⟳
        </button>
        <button className={styles.toolBtn} onClick={() => movePage(-1)} title="Mover página antes">
          ↑
        </button>
        <button className={styles.toolBtn} onClick={() => movePage(1)} title="Mover página después">
          ↓
        </button>
        <button
          className={styles.toolBtn}
          onClick={deletePage}
          disabled={visiblePages.length <= 1}
          title="Quitar página"
        >
          🗑
        </button>
        <span className={styles.spacer} />
        <button
          className={styles.toolBtn}
          onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)}
        >
          −
        </button>
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button
          className={styles.toolBtn}
          onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)}
        >
          ＋
        </button>
      </div>

      {selected && selected.kind === "text" && (
        <div className={styles.toolbar}>
          <button
            className={`${styles.toolBtn} ${selected.bold ? styles.toolOn : ""}`}
            onClick={() => updateEdit(selected.id, { bold: !selected.bold })}
          >
            <b>N</b>
          </button>
          <button
            className={`${styles.toolBtn} ${selected.italic ? styles.toolOn : ""}`}
            onClick={() => updateEdit(selected.id, { italic: !selected.italic })}
          >
            <i>C</i>
          </button>
          <span className={styles.sep} />
          <span className={styles.label}>Tamaño</span>
          <button
            className={styles.toolBtn}
            onClick={() => updateEdit(selected.id, { fontSize: Math.max(6, selected.fontSize - 1) })}
          >
            −
          </button>
          <span className={styles.zoomLabel}>{Math.round(selected.fontSize)}</span>
          <button
            className={styles.toolBtn}
            onClick={() => updateEdit(selected.id, { fontSize: Math.min(96, selected.fontSize + 1) })}
          >
            ＋
          </button>
          <span className={styles.sep} />
          {TEXT_COLORS.map((c) => (
            <button
              key={c.css}
              className={styles.swatch}
              style={{ background: c.css }}
              onClick={() => {
                setColor(c.value);
                updateEdit(selected.id, { color: c.value });
              }}
              title={c.name}
            />
          ))}
          <span className={styles.sep} />
          <button className={styles.toolBtn} onClick={() => deleteEdit(selected.id)}>
            🗑 Quitar
          </button>
        </div>
      )}

      {selected && selected.kind === "rect" && (
        <div className={styles.toolbar}>
          <span className={styles.label}>Color</span>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.css}
              className={styles.swatch}
              style={{ background: c.css }}
              onClick={() => updateEdit(selected.id, { color: c.value })}
              title={c.name}
            />
          ))}
          <button
            className={styles.swatch}
            style={{ background: "#fff", border: "1px solid #bbb" }}
            onClick={() => updateEdit(selected.id, { color: WHITE, opacity: 1 })}
            title="Tapar (blanco)"
          />
          <span className={styles.sep} />
          <button className={styles.toolBtn} onClick={() => deleteEdit(selected.id)}>
            🗑 Quitar
          </button>
        </div>
      )}

      {busy && <div className={styles.busyBar}>{busy}</div>}

      {warnRedaction && (
        <div className={styles.warnBar}>
          <span>
            ⚠ El texto original queda <b>oculto pero no borrado</b>: sigue dentro del PDF y se puede
            extraer. No uses esto para tachar datos sensibles.
          </span>
          <button className={styles.warnClose} onClick={() => setWarnRedaction(false)}>
            ✕
          </button>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.thumbs}>
          {visiblePages.map((p, i) => (
            <div
              key={p.sourceIndex}
              className={`${styles.thumbRow} ${i === current ? styles.thumbActive : ""}`}
              onClick={() => setCurrent(i)}
            >
              <span className={styles.thumbIndex}>{i + 1}</span>
              <div className={styles.thumbBox}>
                <PageCanvas
                  pdf={pdf}
                  pageIndex={p.sourceIndex}
                  scale={THUMB_SCALE}
                  rotation={p.rotation}
                />
              </div>
            </div>
          ))}
        </div>

        <div className={styles.viewer}>
          <div
            className={styles.pageWrap}
            style={{ width: viewW, height: viewH }}
            onMouseDown={onSurfaceClick}
          >
            <PageCanvas
              pdf={pdf}
              pageIndex={page!.sourceIndex}
              scale={zoom}
              rotation={page!.rotation}
              className={styles.pageCanvas}
              canvasRef={pageCanvasRef}
            />

            {/* Overlays live in page-point coordinates and are scaled as a
                whole, so they stay glued to the page at every zoom level. */}
            <div
              className={styles.overlay}
              style={{
                width: pageSize!.width,
                height: pageSize!.height,
                transform: `scale(${zoom})`,
              }}
            >
              {/* Original text: click to cover-and-replace. */}
              {showSpans && page!.rotation === 0 && (
                <div className={styles.spanLayer}>
                  {spans.map((s, i) => (
                    <div
                      key={i}
                      className={styles.span}
                      style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
                      title={`Reemplazar: ${s.str}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        replaceSpan(s);
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Our edits, movable and resizable. */}
              {page!.rotation === 0 &&
                pageEdits.map((edit) => (
                <Rnd
                  key={edit.id}
                  scale={zoom}
                  size={{ width: edit.w, height: edit.h }}
                  position={{ x: edit.x, y: edit.y }}
                  style={{ zIndex: selectedId === edit.id ? 20 : 10 }}
                  disableDragging={editingId === edit.id}
                  enableResizing={editingId !== edit.id}
                  onDragStop={(_e, d) =>
                    updateEdit(edit.id, {
                      x: Math.round(d.x),
                      y: Math.round(d.y),
                      // Carry the baseline along, or dragged text would snap
                      // back to where it was originally anchored.
                      ...(edit.kind === "text"
                        ? { baseline: edit.baseline + (Math.round(d.y) - edit.y) }
                        : {}),
                    })
                  }
                  onResizeStop={(_e, _dir, ref, _delta, pos) =>
                    updateEdit(edit.id, {
                      x: Math.round(pos.x),
                      y: Math.round(pos.y),
                      w: Math.round(parseFloat(ref.style.width)),
                      h: Math.round(parseFloat(ref.style.height)),
                    })
                  }
                  className={`${styles.editBox} ${selectedId === edit.id ? styles.editSelected : ""}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(edit.id);
                    if (editingId && editingId !== edit.id) setEditingId(null);
                  }}
                  onDoubleClick={() => edit.kind === "text" && setEditingId(edit.id)}
                >
                  {edit.kind === "rect" && (
                    <div
                      className={styles.fill}
                      style={{ background: rgbToCss(edit.color), opacity: edit.opacity }}
                    />
                  )}
                  {edit.kind === "image" && (
                    <img className={styles.fill} src={edit.dataUrl} alt="" draggable={false} />
                  )}
                  {edit.kind === "text" &&
                    (() => {
                      const family = edit.family ?? "sans";
                      // Place the glyphs so their baseline falls exactly where
                      // the PDF will draw it, matching the preview to the file.
                      const textStyle: React.CSSProperties = {
                        position: "absolute",
                        left: 0,
                        top: edit.baseline - edit.y - baselineOffset(family, edit.fontSize, edit.bold, edit.italic),
                        width: "100%",
                        fontSize: edit.fontSize,
                        lineHeight: 1,
                        fontFamily: CSS_FAMILY[family],
                        color: rgbToCss(edit.color),
                        fontWeight: edit.bold ? 700 : 400,
                        fontStyle: edit.italic ? "italic" : "normal",
                      };
                      return editingId === edit.id ? (
                        <textarea
                          className={styles.textArea}
                          autoFocus
                          value={edit.text}
                          style={textStyle}
                          onChange={(ev) => updateEdit(edit.id, { text: ev.target.value })}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Escape") setEditingId(null);
                            ev.stopPropagation();
                          }}
                        />
                      ) : (
                        <div className={styles.textView} style={textStyle}>
                          {edit.text}
                        </div>
                      );
                    })()}
                </Rnd>
              ))}
            </div>
          </div>

          {page!.rotation !== 0 && (
            <div className={styles.rotHint}>
              La edición se desactiva mientras la página está rotada. Volvé a 0° para editar.
            </div>
          )}
        </div>
      </div>

      <div className={styles.statusBar}>
        Página {current + 1} de {visiblePages.length} · {pageEdits.length} edición(es) en esta página
      </div>
    </div>
  );
}

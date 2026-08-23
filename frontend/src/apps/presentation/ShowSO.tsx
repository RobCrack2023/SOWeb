import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Rnd } from "react-rnd";
import {
  SLIDES_EXT,
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
import { SlideCanvas, elementStyle } from "./SlideCanvas";
import { Presenter } from "./Presenter";
import {
  SLIDE_H,
  SLIDE_W,
  makeContentSlide,
  makeEmptyDeck,
  makeTextElement,
  parseDeck,
  type Deck,
  type Slide,
  type SlideElement,
} from "./types";
import styles from "./ShowSO.module.css";

const THUMB_SCALE = 0.15;
const BG_SWATCHES = ["#ffffff", "#f5f2e8", "#1e2430", "#123a2e", "#3a1c2e", "#2f6fed"];
const COLOR_SWATCHES = ["#1a1a1a", "#ffffff", "#2f6fed", "#c2272d", "#1a7f43", "#f0a500"];

const FALLBACK_NAME = "Presentación sin título";

export interface ShowSOProps {
  windowId?: string;
  fileId?: number;
  folderId?: number;
  importFrom?: ImportRequest;
}

/** Decks are saved as real .pptx so they're useful outside SOWeb too. */
const PPTX_EXT = ".pptx";

/**
 * The name a deck is saved under. A legacy `.soslides` has its extension
 * swapped rather than appended, so converting one doesn't leave
 * "charla.soslides.pptx" behind.
 */
function deckFileName(name: string): string {
  const trimmed = name.trim() || FALLBACK_NAME;
  if (trimmed.toLowerCase().endsWith(SLIDES_EXT)) {
    return `${trimmed.slice(0, -SLIDES_EXT.length)}${PPTX_EXT}`;
  }
  return ensureExt(trimmed, PPTX_EXT, FALLBACK_NAME);
}

/** Keep a box inside the logical slide canvas. */
function clampBox(x: number, y: number, w: number, h: number) {
  return {
    x: Math.round(Math.max(0, Math.min(x, SLIDE_W - w))),
    y: Math.round(Math.max(0, Math.min(y, SLIDE_H - h))),
  };
}

export function ShowSO({
  windowId,
  fileId: initialFileId,
  folderId: initialFolderId,
  importFrom,
}: ShowSOProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const notifyChange = useFsStore((s) => s.notifyChange);

  const [fileId, setFileId] = useState<number | undefined>(initialFileId);
  const [folderId, setFolderId] = useState<number | undefined>(initialFolderId);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(FALLBACK_NAME);
  const [deck, setDeck] = useState<Deck>(() => makeEmptyDeck());
  const [current, setCurrent] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stageScale, setStageScale] = useState(0.5);

  const savedNameRef = useRef<string | null>(null);
  const desktopIdRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const slide: Slide = deck.slides[Math.min(current, deck.slides.length - 1)];
  const selected = slide?.elements.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (initialFileId == null) return;
    getFileContent(initialFileId).then((doc) => {
      setDeck(parseDeck(doc.content));
      setName(doc.name);
      setFolderId(doc.folder_id);
      savedNameRef.current = doc.name;
      setCurrent(0);
      // A legacy .soslides counts as unsaved: saving rewrites it as .pptx.
      setDirty(doc.name.toLowerCase().endsWith(SLIDES_EXT));
    });
  }, [initialFileId]);

  // A .pptx from the drive opens as itself: saving writes back to the same
  // file rather than leaving a second copy behind.
  useEffect(() => {
    if (!importFrom) return;
    setBusy("Abriendo presentación de PowerPoint…");
    fetchFileBytes(importFrom.id)
      .then(async (bytes) => {
        const { importPptx } = await import("../../lib/office/pptxIO");
        return importPptx(bytes);
      })
      .then((imported) => {
        setDeck(imported);
        setName(importFrom.name);
        setFolderId(importFrom.folderId);
        setFileId(importFrom.id);
        setCurrent(0);
        savedNameRef.current = importFrom.name;
        setDirty(false);
      })
      .catch((err) => window.alert(`No se pudo abrir: ${err}`))
      .finally(() => setBusy(null));
  }, [importFrom]);

  useEffect(() => {
    getDesktopId().then((id) => (desktopIdRef.current = id));
  }, []);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${dirty ? "● " : ""}${name} — showSO`);
  }, [windowId, name, dirty, setTitle]);

  // Fit the editing stage to the available area, keeping the 16:9 canvas whole.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const pad = 32;
      const w = el.clientWidth - pad;
      const h = el.clientHeight - pad;
      if (w > 0 && h > 0) setStageScale(Math.max(0.1, Math.min(w / SLIDE_W, h / SLIDE_H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- deck mutations ------------------------------------------------------

  const mutateSlide = (index: number, fn: (s: Slide) => Slide) => {
    setDeck((d) => ({ slides: d.slides.map((s, i) => (i === index ? fn(s) : s)) }));
    setDirty(true);
  };

  const updateElement = (id: string, patch: Partial<SlideElement>) => {
    mutateSlide(current, (s) => ({
      ...s,
      elements: s.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  };

  const addTextBox = () => {
    const el = makeTextElement({ y: 240 + slide.elements.length * 12 });
    mutateSlide(current, (s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedId(el.id);
  };

  const deleteElement = () => {
    if (!selectedId) return;
    mutateSlide(current, (s) => ({ ...s, elements: s.elements.filter((e) => e.id !== selectedId) }));
    setSelectedId(null);
  };

  const addSlide = () => {
    const s = makeContentSlide();
    setDeck((d) => ({ slides: [...d.slides.slice(0, current + 1), s, ...d.slides.slice(current + 1)] }));
    setCurrent((c) => c + 1);
    setSelectedId(null);
    setDirty(true);
  };

  const duplicateSlide = () => {
    const copy: Slide = {
      ...slide,
      id: `s${Date.now().toString(36)}`,
      elements: slide.elements.map((e) => ({ ...e, id: `${e.id}c${Date.now().toString(36)}` })),
    };
    setDeck((d) => ({ slides: [...d.slides.slice(0, current + 1), copy, ...d.slides.slice(current + 1)] }));
    setCurrent((c) => c + 1);
    setDirty(true);
  };

  const deleteSlide = () => {
    if (deck.slides.length === 1) return;
    setDeck((d) => ({ slides: d.slides.filter((_, i) => i !== current) }));
    setCurrent((c) => Math.max(0, c - 1));
    setSelectedId(null);
    setDirty(true);
  };

  const moveSlide = (dir: -1 | 1) => {
    const to = current + dir;
    if (to < 0 || to >= deck.slides.length) return;
    setDeck((d) => {
      const next = [...d.slides];
      [next[current], next[to]] = [next[to], next[current]];
      return { slides: next };
    });
    setCurrent(to);
    setDirty(true);
  };

  const setBackground = (bg: string) => mutateSlide(current, (s) => ({ ...s, background: bg }));

  // ---- persistence ---------------------------------------------------------

  const importFromDisk = async () => {
    const file = await pickLocalFile(".pptx");
    if (!file) return;
    setBusy("Importando presentación de PowerPoint…");
    try {
      const { importPptx } = await import("../../lib/office/pptxIO");
      setDeck(await importPptx(await file.arrayBuffer()));
      setName(deckFileName(file.name));
      setFileId(undefined);
      setCurrent(0);
      savedNameRef.current = null;
      setDirty(true);
    } catch (err) {
      window.alert(`No se pudo importar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  /** Save a copy to the real machine, rather than into SOWeb's drive. */
  const downloadCopy = async () => {
    setBusy("Preparando la descarga…");
    try {
      const { exportPptx } = await import("../../lib/office/pptxIO");
      const blob = await exportPptx(deck, deckFileName(name));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = deckFileName(name);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(`No se pudo descargar: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Saves a real .pptx, so the deck opens in PowerPoint or Google Slides
   * without exporting first.
   */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { exportPptx } = await import("../../lib/office/pptxIO");
      const finalName = deckFileName(name);
      const blob = await exportPptx(deck, finalName);

      if (fileId == null) {
        const target = folderId ?? desktopIdRef.current;
        if (target == null) return;
        const created = await uploadBlob(target, finalName, blob);
        setFileId(created.id);
        setName(created.name);
        savedNameRef.current = created.name;
      } else {
        await replaceFileBinary(fileId, finalName, blob);
        // A deck opened from a legacy .soslides gets renamed on first save,
        // since what's now stored under that name is really a .pptx.
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

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      setPresenting(true);
      return;
    }
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteElement();
    }
  };

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
        <button className={styles.officeBtn} onClick={importFromDisk} disabled={!!busy} title="Abrir un .pptx de tu equipo">
          📙 Abrir PowerPoint
        </button>
        <button className={styles.officeBtn} onClick={downloadCopy} disabled={!!busy} title="Bajar una copia .pptx a tu equipo">
          ⤓ Descargar
        </button>
        <button className={styles.presentBtn} onClick={() => setPresenting(true)} title="Presentar (F5)">
          ▶ Presentar
        </button>
        <button className={styles.saveBtn} onClick={save} disabled={saving || (!dirty && fileId != null)}>
          {saving ? "Guardando…" : dirty || fileId == null ? "💾 Guardar" : "✓ Guardado"}
        </button>
      </div>

      {busy && <div className={styles.busyBar}>{busy}</div>}

      <div className={styles.toolbar}>
        <button onClick={addSlide}>＋ Diapositiva</button>
        <button onClick={duplicateSlide}>⧉ Duplicar</button>
        <button onClick={deleteSlide} disabled={deck.slides.length === 1}>
          🗑 Eliminar
        </button>
        <span className={styles.sep} />
        <button onClick={addTextBox}>🆕 Cuadro de texto</button>
        <button onClick={deleteElement} disabled={!selected}>
          ✕ Quitar elemento
        </button>
        <span className={styles.sep} />
        <span className={styles.label}>Fondo</span>
        {BG_SWATCHES.map((bg) => (
          <button
            key={bg}
            className={`${styles.swatch} ${slide.background === bg ? styles.swatchActive : ""}`}
            style={{ background: bg }}
            onClick={() => setBackground(bg)}
            title={bg}
          />
        ))}
      </div>

      {selected && (
        <div className={styles.toolbar}>
          <button
            className={selected.bold ? styles.toggleOn : ""}
            onClick={() => updateElement(selected.id, { bold: !selected.bold })}
            title="Negrita"
          >
            <b>N</b>
          </button>
          <button
            className={selected.italic ? styles.toggleOn : ""}
            onClick={() => updateElement(selected.id, { italic: !selected.italic })}
            title="Cursiva"
          >
            <i>C</i>
          </button>
          <span className={styles.sep} />
          <span className={styles.label}>Tamaño</span>
          <button onClick={() => updateElement(selected.id, { fontSize: Math.max(10, selected.fontSize - 4) })}>
            −
          </button>
          <span className={styles.sizeValue}>{selected.fontSize}</span>
          <button onClick={() => updateElement(selected.id, { fontSize: Math.min(140, selected.fontSize + 4) })}>
            ＋
          </button>
          <span className={styles.sep} />
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              className={selected.align === a ? styles.toggleOn : ""}
              onClick={() => updateElement(selected.id, { align: a })}
              title={`Alinear ${a}`}
            >
              {a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}
            </button>
          ))}
          <span className={styles.sep} />
          <span className={styles.label}>Color</span>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              className={`${styles.swatch} ${selected.color === c ? styles.swatchActive : ""}`}
              style={{ background: c }}
              onClick={() => updateElement(selected.id, { color: c })}
              title={c}
            />
          ))}
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.filmstrip}>
          {deck.slides.map((s, i) => (
            <div
              key={s.id}
              className={`${styles.thumbRow} ${i === current ? styles.thumbActive : ""}`}
              onClick={() => {
                setCurrent(i);
                setSelectedId(null);
              }}
            >
              <span className={styles.thumbIndex}>{i + 1}</span>
              <SlideCanvas slide={s} scale={THUMB_SCALE} className={styles.thumb} />
            </div>
          ))}
          <div className={styles.filmActions}>
            <button onClick={() => moveSlide(-1)} disabled={current === 0} title="Subir">
              ↑
            </button>
            <button onClick={() => moveSlide(1)} disabled={current >= deck.slides.length - 1} title="Bajar">
              ↓
            </button>
          </div>
        </div>

        <div className={styles.stage} ref={stageRef}>
          <SlideCanvas
            slide={slide}
            scale={stageScale}
            className={styles.stageSlide}
            onMouseDown={() => {
              setSelectedId(null);
              setEditingId(null);
            }}
          >
            {slide.elements.map((el) => (
              <Rnd
                key={el.id}
                scale={stageScale}
                size={{ width: el.w, height: el.h }}
                position={{ x: el.x, y: el.y }}
                // No `bounds="parent"`: react-draggable measures the parent with
                // getBoundingClientRect, which returns scaled pixels here and
                // yields wrong limits. Clamp to the logical canvas ourselves.
                disableDragging={editingId === el.id}
                enableResizing={editingId !== el.id}
                onDragStop={(_e, d) => updateElement(el.id, clampBox(d.x, d.y, el.w, el.h))}
                onResizeStop={(_e, _dir, ref, _delta, pos) => {
                  const w = Math.round(parseFloat(ref.style.width));
                  const h = Math.round(parseFloat(ref.style.height));
                  updateElement(el.id, { ...clampBox(pos.x, pos.y, w, h), w, h });
                }}
                className={`${styles.handle} ${selectedId === el.id ? styles.handleSelected : ""}`}
                onMouseDown={(e) => {
                  // Native stopPropagation also keeps React's parent handler
                  // (which clears the selection) from firing.
                  e.stopPropagation();
                  setSelectedId(el.id);
                  if (editingId && editingId !== el.id) setEditingId(null);
                }}
                onDoubleClick={() => setEditingId(el.id)}
              >
                {editingId === el.id ? (
                  <textarea
                    className={styles.editArea}
                    style={elementStyle({ ...el, x: 0, y: 0 })}
                    value={el.text}
                    autoFocus
                    onChange={(ev) => updateElement(el.id, { text: ev.target.value })}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Escape") setEditingId(null);
                      ev.stopPropagation();
                    }}
                  />
                ) : (
                  <div className={styles.handleFill} />
                )}
              </Rnd>
            ))}
          </SlideCanvas>

          <div className={styles.stageHint}>
            Doble clic en un elemento para editar el texto · F5 para presentar
          </div>
        </div>
      </div>

      {presenting && (
        <Presenter slides={deck.slides} startIndex={current} onClose={() => setPresenting(false)} />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  NOTE_COLORS,
  type Note,
} from "../lib/deskApi";
import styles from "./StickyNotes.module.css";

/** Wait this long after typing stops before saving. */
const SAVE_DELAY = 700;

export interface StickyNotesHandle {
  add: () => void;
}

export function StickyNotes({ registerAdd }: { registerAdd: (add: () => void) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const timers = useRef<Record<number, number>>({});

  useEffect(() => {
    listNotes().then(setNotes).catch(() => {});
  }, []);

  const persist = useCallback((note: Note) => {
    clearTimeout(timers.current[note.id]);
    timers.current[note.id] = window.setTimeout(() => {
      const { id, ...input } = note;
      updateNote(id, input).catch(() => {});
    }, SAVE_DELAY);
  }, []);

  const patch = useCallback(
    (id: number, changes: Partial<Note>, save = true) => {
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, ...changes } : n));
        if (save) {
          const updated = next.find((n) => n.id === id);
          if (updated) persist(updated);
        }
        return next;
      });
    },
    [persist],
  );

  const add = useCallback(() => {
    // Cascade slightly so a new note never lands exactly on the last one.
    const offset = (notes.length % 8) * 22;
    createNote({
      body: "",
      color: NOTE_COLORS[notes.length % NOTE_COLORS.length],
      pos_x: 60 + offset,
      pos_y: 60 + offset,
      width: 220,
      height: 190,
    })
      .then((note) => setNotes((prev) => [...prev, note]))
      .catch(() => {});
  }, [notes.length]);

  // Braces matter: an expression body would return `add` itself, which React
  // would then run as the effect's cleanup — creating a note on every render.
  useEffect(() => {
    registerAdd(add);
  }, [registerAdd, add]);

  const remove = (note: Note) => {
    if (note.body.trim() && !window.confirm("¿Eliminar esta nota?")) return;
    clearTimeout(timers.current[note.id]);
    deleteNote(note.id).catch(() => {});
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
  };

  // Flush anything still pending when the desktop goes away.
  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  return (
    <>
      {notes.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          onChange={(changes, save) => patch(note.id, changes, save)}
          onDelete={() => remove(note)}
        />
      ))}
    </>
  );
}

function StickyNote({
  note,
  onChange,
  onDelete,
}: {
  note: Note;
  onChange: (changes: Partial<Note>, save?: boolean) => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [palette, setPalette] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the header drags; the textarea has to stay usable.
    dragRef.current = { x: e.clientX - note.pos_x, y: e.clientY - note.pos_y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    onChange(
      {
        pos_x: Math.max(0, e.clientX - dragRef.current.x),
        pos_y: Math.max(0, e.clientY - dragRef.current.y),
      },
      // Don't hit the API on every mouse move; the release saves.
      false,
    );
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onChange({}, true);
  };

  return (
    <div
      className={`${styles.note} ${styles[note.color] ?? styles.amarillo}`}
      style={{ left: note.pos_x, top: note.pos_y, width: note.width, height: note.height }}
    >
      <div
        className={styles.head}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          className={styles.colorBtn}
          onClick={() => setPalette((v) => !v)}
          title="Cambiar color"
        >
          ●
        </button>
        <span className={styles.grip} />
        <button className={styles.closeBtn} onClick={onDelete} title="Eliminar nota">
          ✕
        </button>

        {palette && (
          <div className={styles.palette}>
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                className={`${styles.swatch} ${styles[c]}`}
                onClick={() => {
                  onChange({ color: c });
                  setPalette(false);
                }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      <textarea
        className={styles.body}
        value={note.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder="Escribí algo…"
        spellCheck={false}
      />
    </div>
  );
}

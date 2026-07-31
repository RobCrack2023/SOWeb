import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SlideCanvas } from "./SlideCanvas";
import { SLIDE_H, SLIDE_W, type Slide } from "./types";
import styles from "./Presenter.module.css";

export function Presenter({
  slides,
  startIndex,
  onClose,
}: {
  slides: Slide[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / SLIDE_W, window.innerHeight / SLIDE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(slides.length - 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [slides.length, onClose]);

  const slide = slides[Math.min(index, slides.length - 1)];

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }}
    >
      <SlideCanvas slide={slide} scale={scale} />

      <div className={styles.hud} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.hudBtn}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          title="Anterior"
        >
          ‹
        </button>
        <span className={styles.counter}>
          {index + 1} / {slides.length}
        </span>
        <button
          className={styles.hudBtn}
          onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
          disabled={index >= slides.length - 1}
          title="Siguiente"
        >
          ›
        </button>
        <button className={styles.hudBtn} onClick={onClose} title="Salir (Esc)">
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}

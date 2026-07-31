import type { CSSProperties, ReactNode } from "react";
import { SLIDE_H, SLIDE_W, type Slide, type SlideElement } from "./types";
import styles from "./SlideCanvas.module.css";

export function elementStyle(el: SlideElement): CSSProperties {
  return {
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    fontSize: el.fontSize,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? "italic" : "normal",
    textAlign: el.align,
    color: el.color,
  };
}

/**
 * Renders a slide at logical size (SLIDE_W x SLIDE_H) scaled by `scale`.
 * The outer box takes the scaled size so it occupies correct layout space.
 */
export function SlideCanvas({
  slide,
  scale,
  className,
  children,
  onMouseDown,
}: {
  slide: Slide;
  scale: number;
  className?: string;
  /** Editor overlays (draggable handles) rendered inside the scaled surface. */
  children?: ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`${styles.outer} ${className ?? ""}`}
      style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}
      onMouseDown={onMouseDown}
    >
      <div
        className={styles.surface}
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          background: slide.background,
        }}
      >
        {slide.elements.map((el) => (
          <div key={el.id} className={styles.element} style={elementStyle(el)}>
            {el.text}
          </div>
        ))}
        {children}
      </div>
    </div>
  );
}

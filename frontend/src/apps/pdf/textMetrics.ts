import type { FontFamily } from "./types";

export const CSS_FAMILY: Record<FontFamily, string> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

let measurer: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/**
 * Distance from the top of a `line-height: 1` box to the text baseline.
 *
 * The browser places the baseline using the font's own ascent plus half of the
 * leftover leading, so guessing it puts replaced text slightly off. Measuring
 * the actual font is what makes the on-screen preview line up with the PDF.
 */
export function baselineOffset(family: FontFamily, fontSize: number, bold: boolean, italic: boolean): number {
  const font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontSize}px ${CSS_FAMILY[family]}`;
  const cached = cache.get(font);
  if (cached != null) return cached;

  if (!measurer) {
    measurer = document.createElement("canvas").getContext("2d");
  }
  if (!measurer) return fontSize * 0.76;

  measurer.font = font;
  const m = measurer.measureText("HxgÁ");
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? fontSize * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? fontSize * 0.2;
  // line-height: 1 means the line box is exactly fontSize tall.
  const halfLeading = (fontSize - (ascent + descent)) / 2;
  const offset = halfLeading + ascent;

  cache.set(font, offset);
  return offset;
}

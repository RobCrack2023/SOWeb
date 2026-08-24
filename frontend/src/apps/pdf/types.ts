/**
 * pdfSO edit model.
 *
 * A PDF is a print format, not a document format: it stores "draw this glyph
 * at this point", with no paragraphs to reflow. So we never rewrite the
 * original page content. Instead we keep a list of overlay edits and apply
 * them on save, which is why the original formatting survives untouched.
 *
 * Replacing existing text works by covering it with a filled rectangle and
 * drawing the new string on top ("whiteout"). That is exactly what desktop PDF
 * editors do, and it shares their limits: it looks right on flat backgrounds
 * and gets obvious over images or textures.
 *
 * Coordinates are PDF points with a TOP-LEFT origin (what the UI works in).
 * pdf-lib uses a bottom-left origin, so we flip on save.
 */

export type Rgb = { r: number; g: number; b: number };

export interface BaseEdit {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontFamily = "sans" | "serif" | "mono";

export interface TextEdit extends BaseEdit {
  kind: "text";
  text: string;
  fontSize: number;
  color: Rgb;
  bold: boolean;
  italic: boolean;
  /**
   * Distance from the top of the page to the text baseline. PDF positions text
   * by its baseline, not by a box, so storing it is what keeps replaced text
   * sitting exactly where the original sat instead of drifting.
   */
  baseline: number;
  family: FontFamily;
  /**
   * The run this edit replaced, kept at the coordinates it had when it was
   * picked so saving can cut it out of the page's content stream. Dragging the
   * box must not touch these: they are how the original is located, not where
   * the replacement now sits. Absent on text added from scratch.
   */
  replaces?: { x: number; baseline: number; width: number };
}

export interface RectEdit extends BaseEdit {
  kind: "rect";
  color: Rgb;
  opacity: number;
}

export interface ImageEdit extends BaseEdit {
  kind: "image";
  /** data: URL of a PNG or JPEG. */
  dataUrl: string;
}

export type PdfEdit = TextEdit | RectEdit | ImageEdit;

/** Per-page state layered on top of the original document. */
export interface PageState {
  /** Index into the ORIGINAL document, so reordering never loses provenance. */
  sourceIndex: number;
  rotation: 0 | 90 | 180 | 270;
  deleted: boolean;
}

export interface PdfDocState {
  pages: PageState[];
  edits: PdfEdit[];
}

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const WHITE: Rgb = { r: 1, g: 1, b: 1 };

export const TEXT_COLORS: { name: string; value: Rgb; css: string }[] = [
  { name: "Negro", value: BLACK, css: "#000000" },
  { name: "Rojo", value: { r: 0.76, g: 0.15, b: 0.18 }, css: "#c2272d" },
  { name: "Azul", value: { r: 0.18, g: 0.44, b: 0.93 }, css: "#2f6fed" },
  { name: "Verde", value: { r: 0.1, g: 0.5, b: 0.26 }, css: "#1a7f43" },
];

export const HIGHLIGHT_COLORS: { name: string; value: Rgb; css: string }[] = [
  { name: "Amarillo", value: { r: 1, g: 0.92, b: 0.23 }, css: "#ffeb3b" },
  { name: "Verde", value: { r: 0.55, g: 0.9, b: 0.45 }, css: "#8ce673" },
  { name: "Rosa", value: { r: 1, g: 0.6, b: 0.75 }, css: "#ff99bf" },
];

export const rgbToCss = (c: Rgb) =>
  `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

/** Serialised sidecar so a session's edits survive save/reopen inside SOWeb. */
export interface PdfSidecar {
  version: 1;
  state: PdfDocState;
}

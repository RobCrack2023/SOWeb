/**
 * PDF rendering (pdf.js) and writing (pdf-lib).
 *
 * Both libraries are heavy, so everything here is behind dynamic imports and
 * only pulled in when pdfSO actually opens a document.
 */

import type { PdfDocState, PdfEdit, Rgb } from "./types";

export interface TextSpan {
  str: string;
  /** Top-left origin, PDF points (unscaled). */
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
}

export interface LoadedPage {
  index: number;
  width: number;
  height: number;
}

export interface LoadedPdf {
  pageCount: number;
  pages: LoadedPage[];
  /** Renders a page into a canvas at `scale`, honouring extra rotation. */
  render: (
    pageIndex: number,
    canvas: HTMLCanvasElement,
    scale: number,
    rotation: number,
  ) => Promise<void>;
  textSpans: (pageIndex: number) => Promise<TextSpan[]>;
  destroy: () => void;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Vite resolves this to a hashed URL for the worker bundle.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function loadPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const pdfjs = await getPdfJs();
  // pdf.js takes ownership of the buffer it reads, so hand it a copy and keep
  // the pristine original for pdf-lib to write from later.
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
  const doc = await loadingTask.promise;

  const pages: LoadedPage[] = [];
  for (let i = 0; i < doc.numPages; i += 1) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ index: i, width: vp.width, height: vp.height });
  }

  return {
    pageCount: doc.numPages,
    pages,
    async render(pageIndex, canvas, scale, rotation) {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale, rotation });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    },
    async textSpans(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const spans: TextSpan[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        // transform = [a, b, c, d, e, f]; e/f is the baseline origin and
        // |d| approximates the glyph height in points.
        const [, , , d, e, f] = item.transform as number[];
        const fontSize = Math.abs(d) || 12;
        spans.push({
          str: item.str,
          x: e,
          // f is the baseline measured from the bottom; convert to a top-left box.
          y: vp.height - f - fontSize,
          w: item.width || fontSize * item.str.length * 0.5,
          h: fontSize * 1.2,
          fontSize,
        });
      }
      return spans;
    },
    destroy: () => void loadingTask.destroy(),
  };
}

/** Rotation-aware conversion from on-screen point to unrotated page space. */
export function viewToPage(
  vx: number,
  vy: number,
  rotation: number,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: vy, y: pageH - vx };
    case 180:
      return { x: pageW - vx, y: pageH - vy };
    case 270:
      return { x: pageW - vy, y: vx };
    default:
      return { x: vx, y: vy };
  }
}

/** Inverse of viewToPage: unrotated page space to on-screen point. */
export function pageToView(
  px: number,
  py: number,
  rotation: number,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: pageH - py, y: px };
    case 180:
      return { x: pageW - px, y: pageH - py };
    case 270:
      return { x: py, y: pageW - px };
    default:
      return { x: px, y: py };
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Write out a new PDF: original pages are copied verbatim (so their content is
 * bit-for-bit preserved) and our edits are drawn on top.
 */
export async function savePdf(originalBytes: ArrayBuffer, state: PdfDocState): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");

  const src = await PDFDocument.load(originalBytes.slice(0), { ignoreEncryption: true });
  const out = await PDFDocument.create();

  const kept = state.pages.filter((p) => !p.deleted);
  const copied = await out.copyPages(
    src,
    kept.map((p) => p.sourceIndex),
  );

  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const italic = await out.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await out.embedFont(StandardFonts.HelveticaBoldOblique);
  const pick = (b: boolean, i: boolean) => (b && i ? boldItalic : b ? bold : i ? italic : regular);

  const col = (c: Rgb) => rgb(c.r, c.g, c.b);

  for (let i = 0; i < kept.length; i += 1) {
    const pageState = kept[i];
    const page = copied[i];
    out.addPage(page);

    const { width, height } = page.getSize();
    const edits = state.edits.filter((e) => e.page === pageState.sourceIndex);

    for (const edit of edits) {
      // Our model is top-left origin; PDF is bottom-left.
      const bottom = height - edit.y - edit.h;
      await drawEdit(page, edit, bottom, width, height);
    }

    if (pageState.rotation) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + pageState.rotation) % 360));
    }
  }

  async function drawEdit(
    page: Awaited<ReturnType<typeof out.copyPages>>[number],
    edit: PdfEdit,
    bottom: number,
    _pageW: number,
    _pageH: number,
  ) {
    if (edit.kind === "rect") {
      page.drawRectangle({
        x: edit.x,
        y: bottom,
        width: edit.w,
        height: edit.h,
        color: col(edit.color),
        opacity: edit.opacity,
        borderWidth: 0,
      });
      return;
    }
    if (edit.kind === "image") {
      const bytes = dataUrlToBytes(edit.dataUrl);
      const img = edit.dataUrl.startsWith("data:image/png")
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes);
      page.drawImage(img, { x: edit.x, y: bottom, width: edit.w, height: edit.h });
      return;
    }
    const font = pick(edit.bold, edit.italic);
    // drawText places the baseline; nudge down from the box top by the ascent.
    page.drawText(sanitise(edit.text), {
      x: edit.x,
      y: bottom + edit.h - edit.fontSize,
      size: edit.fontSize,
      font,
      color: col(edit.color),
      lineHeight: edit.fontSize * 1.2,
      maxWidth: edit.w,
    });
  }

  const bytes = await out.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

/**
 * The standard PDF fonts use WinAnsi, which covers Latin-1 (accents included)
 * but throws on anything outside it — strip those so a stray character can
 * never fail the whole save.
 */
function sanitise(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\r") out += ch;
    else if (code >= 32 && code <= 255) out += ch;
    else out += "?";
  }
  return out;
}

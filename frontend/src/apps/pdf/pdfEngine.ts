/**
 * PDF rendering (pdf.js) and writing (pdf-lib).
 *
 * Both libraries are heavy, so everything here is behind dynamic imports and
 * only pulled in when pdfSO actually opens a document.
 */

import type { FontFamily, PdfDocState, PdfEdit, Rgb } from "./types";

export interface TextSpan {
  str: string;
  /** Top-left origin, PDF points (unscaled). */
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  /** Distance from the page top to the text baseline. */
  baseline: number;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
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
      // pdf.js reports per-font metrics here: family plus ascent/descent as
      // fractions of the em, which is what lets us land on the exact baseline.
      const styles = (content.styles ?? {}) as Record<
        string,
        { fontFamily?: string; ascent?: number; descent?: number }
      >;

      const spans: TextSpan[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [, , c, d, e, f] = item.transform as number[];
        const fontSize = Math.hypot(c, d) || Math.abs(d) || 12;
        const style = styles[item.fontName] ?? {};
        const ascent = typeof style.ascent === "number" && style.ascent > 0 ? style.ascent : 0.72;
        const descent = typeof style.descent === "number" ? Math.abs(style.descent) : 0.21;

        // The real font name (e.g. "ABCDEF+Arial-BoldMT") carries the weight and
        // slant that the generic family alone doesn't; it's only there once the
        // page has been rendered, so treat it as optional.
        let rawName = "";
        try {
          rawName = (page.commonObjs.get(item.fontName) as { name?: string })?.name ?? "";
        } catch {
          /* font not resolved yet */
        }
        const lower = `${rawName} ${item.fontName}`.toLowerCase();
        const generic = (style.fontFamily ?? "").toLowerCase();
        const family: FontFamily = generic.includes("mono")
          ? "mono"
          : generic.includes("serif") && !generic.includes("sans")
            ? "serif"
            : "sans";

        const baseline = vp.height - f;
        spans.push({
          str: item.str,
          x: e,
          y: baseline - ascent * fontSize,
          w: item.width || fontSize * item.str.length * 0.5,
          h: (ascent + descent) * fontSize,
          fontSize,
          baseline,
          family,
          bold: /bold|black|heavy|semibold/.test(lower),
          italic: /italic|oblique/.test(lower),
        });
      }
      return spans;
    },
    destroy: () => void loadingTask.destroy(),
  };
}

/**
 * Sample the page background just outside a text run so the rectangle that
 * covers it blends in, instead of punching a white hole through shaded table
 * cells or coloured banners.
 */
export function sampleBackground(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; w: number; h: number },
  scale: number,
): Rgb {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fallback: Rgb = { r: 1, g: 1, b: 1 };
  if (!ctx) return fallback;

  const px = (v: number) => Math.round(v * scale);
  const probes: [number, number][] = [
    [px(box.x + box.w / 2), px(box.y) - 3],
    [px(box.x + box.w / 2), px(box.y + box.h) + 3],
    [px(box.x) - 4, px(box.y + box.h / 2)],
    [px(box.x + box.w) + 4, px(box.y + box.h / 2)],
  ];

  const counts = new Map<string, { rgb: Rgb; n: number }>();
  for (const [x, y] of probes) {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
    const d = ctx.getImageData(x, y, 1, 1).data;
    const key = `${d[0]},${d[1]},${d[2]}`;
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { rgb: { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255 }, n: 1 });
  }

  let best = fallback;
  let bestN = 0;
  for (const { rgb: c, n } of counts.values()) {
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

/**
 * Sample the colour of the glyphs in a text run. pdf.js hands back a span's
 * position and font but not its colour, so a replacement copy has to read that
 * back off the rendered page — otherwise every edit comes out black and stands
 * out against headings that were never black to begin with.
 */
export function sampleInk(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; w: number; h: number },
  scale: number,
  background: Rgb,
): Rgb {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fallback: Rgb = { r: 0, g: 0, b: 0 };
  if (!ctx) return fallback;

  const x0 = Math.max(0, Math.round(box.x * scale));
  const y0 = Math.max(0, Math.round(box.y * scale));
  const x1 = Math.min(canvas.width, Math.round((box.x + box.w) * scale));
  const y1 = Math.min(canvas.height, Math.round((box.y + box.h) * scale));
  if (x1 <= x0 || y1 <= y0) return fallback;

  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const bgR = background.r * 255;
  const bgG = background.g * 255;
  const bgB = background.b * 255;
  const distance = (i: number) =>
    Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB);

  let farthest = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = distance(i);
    if (d > farthest) farthest = d;
  }
  // Nothing in the box stands out from the page: no ink to read.
  if (farthest < 30) return fallback;

  // Antialiasing blends every glyph edge toward the background, so only the
  // pixels furthest from it show the true colour. Averaging that group beats
  // taking a single winner, which one stray pixel could decide.
  const cutoff = farthest * 0.8;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (distance(i) < cutoff) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  if (n === 0) return fallback;
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
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

  // Embed the standard-14 equivalents of each family so replacement text keeps
  // the look of what it replaced rather than always coming back as Helvetica.
  const fonts = {
    sans: [
      await out.embedFont(StandardFonts.Helvetica),
      await out.embedFont(StandardFonts.HelveticaBold),
      await out.embedFont(StandardFonts.HelveticaOblique),
      await out.embedFont(StandardFonts.HelveticaBoldOblique),
    ],
    serif: [
      await out.embedFont(StandardFonts.TimesRoman),
      await out.embedFont(StandardFonts.TimesRomanBold),
      await out.embedFont(StandardFonts.TimesRomanItalic),
      await out.embedFont(StandardFonts.TimesRomanBoldItalic),
    ],
    mono: [
      await out.embedFont(StandardFonts.Courier),
      await out.embedFont(StandardFonts.CourierBold),
      await out.embedFont(StandardFonts.CourierOblique),
      await out.embedFont(StandardFonts.CourierBoldOblique),
    ],
  };
  const pick = (family: FontFamily, b: boolean, i: boolean) =>
    fonts[family][(b ? 1 : 0) + (i ? 2 : 0)];

  const col = (c: Rgb) => rgb(c.r, c.g, c.b);

  for (let i = 0; i < kept.length; i += 1) {
    const pageState = kept[i];
    const page = copied[i];
    out.addPage(page);

    const { height } = page.getSize();
    const edits = state.edits.filter((e) => e.page === pageState.sourceIndex);

    for (const edit of edits) {
      // Our model is top-left origin; PDF is bottom-left.
      const bottom = height - edit.y - edit.h;
      await drawEdit(page, edit, bottom, height);
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
    pageH: number,
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
    const font = pick(edit.family ?? "sans", edit.bold, edit.italic);
    // drawText positions by baseline, which is exactly what we captured from
    // the original run — so the replacement lands on the very same line.
    page.drawText(sanitise(edit.text), {
      x: edit.x,
      y: pageH - edit.baseline,
      size: edit.fontSize,
      font,
      color: col(edit.color),
      lineHeight: edit.fontSize * 1.15,
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

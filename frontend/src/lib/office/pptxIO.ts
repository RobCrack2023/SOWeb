/**
 * PowerPoint (.pptx) interop for showSO.
 *
 * Export uses pptxgenjs. Import unzips the package and reads the slide XML
 * directly (OOXML), because no maintained browser library reads .pptx.
 *
 * Geometry: PowerPoint positions everything in EMU (English Metric Units).
 * We read the deck's real slide size from presentation.xml and scale it onto
 * showSO's logical 1000x562 canvas, so decks authored at 4:3 or 16:9 both land
 * correctly.
 */

import { PPTX_MIME } from "../filesApi";
import {
  DEFAULT_BG,
  SLIDE_H,
  SLIDE_W,
  makeTextElement,
  uid,
  type Deck,
  type Slide,
  type SlideElement,
} from "../../apps/presentation/types";

/** showSO maps its 1000px-wide canvas to a 10in-wide slide: 100 px per inch. */
const PX_PER_INCH = 100;
/** 1 inch = 72 points, so one logical px is 0.72pt. */
const PT_PER_PX = 72 / PX_PER_INCH;
const EMU_PER_POINT = 12700;

// ---------------------------------------------------------------- export ---

export async function exportPptx(deck: Deck, title: string): Promise<Blob> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();

  pptx.defineLayout({ name: "SOWEB", width: SLIDE_W / PX_PER_INCH, height: SLIDE_H / PX_PER_INCH });
  pptx.layout = "SOWEB";
  pptx.title = title;

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: hexOnly(slide.background) };

    for (const el of slide.elements) {
      s.addText(el.text, {
        x: el.x / PX_PER_INCH,
        y: el.y / PX_PER_INCH,
        w: el.w / PX_PER_INCH,
        h: el.h / PX_PER_INCH,
        fontSize: Math.max(1, Math.round(el.fontSize * PT_PER_PX)),
        bold: el.bold,
        italic: el.italic,
        align: el.align,
        color: hexOnly(el.color),
        valign: "top",
        margin: 0,
      });
    }
  }

  const data = (await pptx.write({ outputType: "blob" })) as Blob;
  return new Blob([data], { type: PPTX_MIME });
}

/** pptxgenjs wants "RRGGBB" without the leading '#'. */
function hexOnly(color: string): string {
  return color.replace("#", "").toUpperCase();
}

// ---------------------------------------------------------------- import ---

/** Collect descendants by local name, ignoring namespace prefixes. */
function findAll(root: Element | Document, localName: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.localName === localName) out.push(child);
      walk(child);
    }
  };
  walk(root instanceof Document ? root.documentElement : root);
  return out;
}

function firstChild(el: Element, localName: string): Element | null {
  for (const child of Array.from(el.children)) if (child.localName === localName) return child;
  return null;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

export async function importPptx(bytes: ArrayBuffer): Promise<Deck> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);

  // Slide dimensions (defaults are the classic 10x7.5in 4:3 deck).
  let cx = 9144000;
  let cy = 6858000;
  const presFile = zip.file("ppt/presentation.xml");
  if (presFile) {
    const pres = parseXml(await presFile.async("string"));
    const sz = findAll(pres, "sldSz")[0];
    if (sz) {
      cx = Number(sz.getAttribute("cx")) || cx;
      cy = Number(sz.getAttribute("cy")) || cy;
    }
  }

  const slidePaths = await orderedSlidePaths(zip);
  const slides: Slide[] = [];

  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    slides.push(parseSlide(parseXml(await file.async("string")), cx, cy));
  }

  if (slides.length === 0) {
    slides.push({ id: uid("s"), background: DEFAULT_BG, elements: [] });
  }
  return { slides };
}

/**
 * Slide order lives in presentation.xml (sldIdLst -> r:id) resolved through the
 * rels file. Falls back to sorting slideN.xml numerically.
 */
async function orderedSlidePaths(zip: {
  file: (p: string) => { async: (t: "string") => Promise<string> } | null;
  folder: (p: string) => unknown;
  files: Record<string, unknown>;
}): Promise<string[]> {
  const numericOrder = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });

  try {
    const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
    const presFile = zip.file("ppt/presentation.xml");
    if (!relsFile || !presFile) return numericOrder;

    const rels = parseXml(await relsFile.async("string"));
    const idToTarget = new Map<string, string>();
    for (const rel of findAll(rels, "Relationship")) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) idToTarget.set(id, target.replace(/^\.\.\//, "ppt/").replace(/^\//, ""));
    }

    const pres = parseXml(await presFile.async("string"));
    const ordered: string[] = [];
    for (const sldId of findAll(pres, "sldId")) {
      const rId =
        sldId.getAttribute("r:id") ??
        sldId.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const target = rId ? idToTarget.get(rId) : undefined;
      if (target) ordered.push(target.startsWith("ppt/") ? target : `ppt/${target}`);
    }
    return ordered.length ? ordered : numericOrder;
  } catch {
    return numericOrder;
  }
}

function parseSlide(doc: Document, cx: number, cy: number): Slide {
  const toX = (emu: number) => Math.round((emu / cx) * SLIDE_W);
  const toY = (emu: number) => Math.round((emu / cy) * SLIDE_H);
  // Font sizes scale with slide width so text keeps its relative size.
  const toFontPx = (hundredthsPt: number) =>
    Math.max(8, Math.round(((hundredthsPt / 100) * EMU_PER_POINT * SLIDE_W) / cx));

  const elements: SlideElement[] = [];
  let fallbackY = 60;

  for (const sp of findAll(doc, "sp")) {
    const txBody = firstChild(sp, "txBody") ?? findAll(sp, "txBody")[0];
    if (!txBody) continue;

    const paragraphs = findAll(txBody, "p");
    const lines: string[] = [];
    let fontSize = 0;
    let bold = false;
    let italic = false;
    let color = "";
    let align: SlideElement["align"] = "left";

    for (const p of paragraphs) {
      const runs = findAll(p, "r");
      lines.push(runs.map((r) => findAll(r, "t")[0]?.textContent ?? "").join(""));

      const pPr = firstChild(p, "pPr");
      const algn = pPr?.getAttribute("algn");
      if (algn === "ctr") align = "center";
      else if (algn === "r") align = "right";

      for (const r of runs) {
        const rPr = firstChild(r, "rPr");
        if (!rPr) continue;
        const sz = Number(rPr.getAttribute("sz"));
        if (sz && !fontSize) fontSize = toFontPx(sz);
        if (rPr.getAttribute("b") === "1") bold = true;
        if (rPr.getAttribute("i") === "1") italic = true;
        const clr = findAll(rPr, "srgbClr")[0]?.getAttribute("val");
        if (clr && !color) color = `#${clr.toLowerCase()}`;
      }
    }

    const text = lines.join("\n").trim();
    if (!text) continue;

    // Placeholders can inherit geometry from the layout; lay those out in a
    // readable stack instead of dropping them.
    const off = findAll(sp, "off")[0];
    const ext = findAll(sp, "ext")[0];
    const hasGeometry = !!off && !!ext;

    const x = hasGeometry ? toX(Number(off!.getAttribute("x")) || 0) : 70;
    const y = hasGeometry ? toY(Number(off!.getAttribute("y")) || 0) : fallbackY;
    const w = hasGeometry ? toX(Number(ext!.getAttribute("cx")) || 0) : SLIDE_W - 140;
    const h = hasGeometry ? toY(Number(ext!.getAttribute("cy")) || 0) : 90;
    if (!hasGeometry) fallbackY += 110;

    elements.push(
      makeTextElement({
        text,
        x: clamp(x, 0, SLIDE_W - 20),
        y: clamp(y, 0, SLIDE_H - 20),
        w: clamp(w || 300, 40, SLIDE_W),
        h: clamp(h || 60, 24, SLIDE_H),
        fontSize: fontSize || 28,
        bold,
        italic,
        align,
        color: color || "#1a1a1a",
      }),
    );
  }

  return { id: uid("s"), background: slideBackground(doc), elements };
}

function slideBackground(doc: Document): string {
  const bg = findAll(doc, "bg")[0];
  const clr = bg ? findAll(bg, "srgbClr")[0]?.getAttribute("val") : null;
  return clr ? `#${clr.toLowerCase()}` : DEFAULT_BG;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

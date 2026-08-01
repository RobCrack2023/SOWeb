/** Page setup for writeSO documents, shared by the editor and the .docx writer. */

export interface PageSize {
  id: string;
  label: string;
  /** Portrait dimensions in millimetres. */
  widthMm: number;
  heightMm: number;
}

export const PAGE_SIZES: PageSize[] = [
  { id: "a4", label: "A4", widthMm: 210, heightMm: 297 },
  { id: "letter", label: "Carta", widthMm: 215.9, heightMm: 279.4 },
  { id: "legal", label: "Oficio", widthMm: 215.9, heightMm: 355.6 },
  { id: "a3", label: "A3", widthMm: 297, heightMm: 420 },
  { id: "a5", label: "A5", widthMm: 148, heightMm: 210 },
  { id: "tabloid", label: "Tabloide", widthMm: 279.4, heightMm: 431.8 },
];

export interface PageSetup {
  sizeId: string;
  landscape: boolean;
  /** Page margin in millimetres (Word's default is 25.4). */
  marginMm: number;
}

export const DEFAULT_PAGE: PageSetup = { sizeId: "a4", landscape: false, marginMm: 25.4 };

export const sizeById = (id: string): PageSize =>
  PAGE_SIZES.find((s) => s.id === id) ?? PAGE_SIZES[0];

/** Actual dimensions once orientation is applied. */
export function pageDimsMm(page: PageSetup): { widthMm: number; heightMm: number } {
  const s = sizeById(page.sizeId);
  return page.landscape
    ? { widthMm: s.heightMm, heightMm: s.widthMm }
    : { widthMm: s.widthMm, heightMm: s.heightMm };
}

/** CSS pixels at the conventional 96 dpi. */
export const mmToPx = (mm: number) => (mm * 96) / 25.4;

/** Pick the closest known size to a measured page, for imported documents. */
export function matchSize(widthMm: number, heightMm: number): { sizeId: string; landscape: boolean } {
  const landscape = widthMm > heightMm;
  const w = landscape ? heightMm : widthMm;
  const h = landscape ? widthMm : heightMm;
  let best = PAGE_SIZES[0];
  let bestDelta = Infinity;
  for (const s of PAGE_SIZES) {
    const delta = Math.abs(s.widthMm - w) + Math.abs(s.heightMm - h);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return { sizeId: best.id, landscape };
}

/**
 * writeSO documents are stored as an envelope so page setup travels with the
 * text. Older files are plain HTML, so anything that isn't our JSON is treated
 * as content.
 */
export interface StoredDoc {
  page: PageSetup;
  html: string;
}

export function parseStoredDoc(raw: string): StoredDoc {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { html?: unknown; page?: Partial<PageSetup> };
      if (typeof parsed.html === "string") {
        return { html: parsed.html, page: { ...DEFAULT_PAGE, ...parsed.page } };
      }
    } catch {
      /* not our envelope — fall through to raw HTML */
    }
  }
  return { html: raw, page: DEFAULT_PAGE };
}

export function serialiseDoc(doc: StoredDoc): string {
  return JSON.stringify({ version: 1, page: doc.page, html: doc.html });
}

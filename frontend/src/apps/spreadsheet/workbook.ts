/**
 * Reading the old spreadSO document format.
 *
 * Workbooks are saved as real .xlsx now, so nothing writes this any more — but
 * `.sosheet` files saved earlier still have to open. Two shapes exist: a
 * `{ version: 2, sheets: [...] }` document, and, older still, a bare
 * `{ "A1": "..." }` cell map from before multi-sheet support.
 */

import type { Cells, CellStyles, Sheet } from "./formula";

export const DEFAULT_SHEET_NAME = "Hoja1";
/** Excel's own limit, worth matching so exports never get truncated. */
export const MAX_SHEET_NAME = 31;

interface DocumentV2 {
  version: 2;
  sheets: { name: string; cells: Cells; styles?: CellStyles }[];
}

let counter = 0;

function newId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter}`;
}

export function makeSheet(name: string, cells: Cells = {}, styles: CellStyles = {}): Sheet {
  return { id: newId(), name, cells, styles };
}

export function blankWorkbook(): Sheet[] {
  return [makeSheet(DEFAULT_SHEET_NAME)];
}

/** Characters Excel rejects in a sheet name, plus a length cap. */
export function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, "").trim().slice(0, MAX_SHEET_NAME);
}

/** Append a numeric suffix until the name is free (case-insensitive). */
export function uniqueSheetName(existing: string[], desired: string): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const base = sanitizeSheetName(desired) || DEFAULT_SHEET_NAME;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i += 1) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, MAX_SHEET_NAME - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "Hoja1", "Hoja2", … skipping any already in use. */
export function nextSheetName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let i = 1; ; i += 1) {
    const candidate = `Hoja${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function isCellMap(value: unknown): value is Cells {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

export function parseDocument(content: string): Sheet[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    return blankWorkbook();
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as DocumentV2).sheets)
  ) {
    const sheets = (parsed as DocumentV2).sheets
      .filter((s) => s && isCellMap(s.cells))
      .map((s) =>
        makeSheet(
          sanitizeSheetName(String(s.name)) || DEFAULT_SHEET_NAME,
          s.cells,
          // Styles arrived later than the sheets array; older files lack them.
          typeof s.styles === "object" && s.styles !== null ? s.styles : {},
        ),
      );
    return sheets.length ? sheets : blankWorkbook();
  }

  // Legacy single-sheet document.
  if (isCellMap(parsed)) return [makeSheet(DEFAULT_SHEET_NAME, parsed)];
  return blankWorkbook();
}

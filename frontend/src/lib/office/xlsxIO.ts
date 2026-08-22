/**
 * Excel (.xlsx) interop for spreadSO, via exceljs (loaded on demand).
 *
 * spreadSO stores every cell as a raw string, where a leading "=" marks a
 * formula — the same convention Excel uses in the UI, so the mapping in both
 * directions is direct.
 */

import { XLSX_MIME } from "../filesApi";
import type { Cells, CellStyle, CellStyles, Sheet } from "../../apps/spreadsheet/formula";
import { blankWorkbook, makeSheet, sanitizeSheetName, uniqueSheetName } from "../../apps/spreadsheet/workbook";

/** Read every worksheet of a workbook, in the order Excel shows its tabs. */
export async function importXlsx(bytes: ArrayBuffer): Promise<Sheet[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const sheets: Sheet[] = [];
  for (const ws of wb.worksheets) {
    // Excel keeps hidden sheets in the file; importing them would show tabs
    // the user never seeded in Excel.
    if (ws.state === "hidden" || ws.state === "veryHidden") continue;

    const cells: Cells = {};
    const styles: CellStyles = {};
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const ref = `${columnLetter(colNumber)}${rowNumber}`;
        const raw = readCell(cell);
        if (raw !== "") cells[ref] = raw;
        // Formatting often carries meaning (a legend of editable vs read-only
        // columns, say), so it's kept even on cells with no value.
        const style = readStyle(cell);
        if (style) styles[ref] = style;
      });
    });

    const name = uniqueSheetName(
      sheets.map((s) => s.name),
      sanitizeSheetName(ws.name),
    );
    sheets.push(makeSheet(name, cells, styles));
  }

  return sheets.length ? sheets : blankWorkbook();
}

function columnLetter(index: number): string {
  let s = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Excel stores colours as ARGB ("FF1E3A5F"). The alpha byte is dropped: files
 * in the wild write 00 for opaque just as often as FF, so honouring it would
 * make solid fills vanish.
 */
function toCssColor(argb: unknown): string | undefined {
  if (typeof argb !== "string") return undefined;
  const hex = argb.trim().replace(/^#/, "");
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return undefined;
}

/** CSS hex back to the ARGB Excel expects, always fully opaque. */
function toArgb(css: string): string {
  return `FF${css.replace(/^#/, "").toUpperCase()}`;
}

type StyledCell = {
  fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } };
  font?: { color?: { argb?: string }; bold?: boolean; italic?: boolean };
};

/** Pull the formatting spreadSO can show; undefined when there's none. */
function readStyle(cell: StyledCell): CellStyle | undefined {
  const style: CellStyle = {};

  // Only solid fills map onto a flat background; gradients are skipped.
  if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid") {
    const fill = toCssColor(cell.fill.fgColor?.argb);
    // White fills are the default look; storing them adds noise.
    if (fill && fill.toLowerCase() !== "#ffffff") style.fill = fill;
  }
  const color = toCssColor(cell.font?.color?.argb);
  if (color && color.toLowerCase() !== "#000000") style.color = color;
  if (cell.font?.bold) style.bold = true;
  if (cell.font?.italic) style.italic = true;

  return Object.keys(style).length ? style : undefined;
}

/** Collapse an exceljs cell into spreadSO's raw-string representation. */
function readCell(cell: { value: unknown; formula?: string }): string {
  const v = cell.value as
    | null
    | undefined
    | string
    | number
    | boolean
    | Date
    | { formula?: string; result?: unknown; richText?: { text: string }[]; text?: string };

  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toLocaleDateString();

  if (typeof v === "object") {
    if ("formula" in v && v.formula) return `=${v.formula}`;
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v && v.result != null) return String(v.result);
  }
  return "";
}

/** Write a whole workbook out as a real .xlsx, one tab per sheet. */
export async function exportXlsx(sheets: Sheet[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOWeb — spreadSO";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name) || "Hoja1");
    for (const [ref, raw] of Object.entries(sheet.cells)) {
      if (raw === "") continue;
      const cell = ws.getCell(ref);
      if (raw.startsWith("=")) {
        cell.value = { formula: raw.slice(1) };
      } else {
        const n = Number(raw);
        cell.value = raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
      }
    }
    // Styles are written separately: a formatted cell may hold no value.
    for (const [ref, style] of Object.entries(sheet.styles)) {
      const cell = ws.getCell(ref);
      if (style.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: toArgb(style.fill) },
        };
      }
      if (style.color || style.bold || style.italic) {
        cell.font = {
          ...(style.color ? { color: { argb: toArgb(style.color) } } : {}),
          ...(style.bold ? { bold: true } : {}),
          ...(style.italic ? { italic: true } : {}),
        };
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

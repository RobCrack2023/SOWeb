/**
 * Excel (.xlsx) interop for spreadSO, via exceljs (loaded on demand).
 *
 * spreadSO stores every cell as a raw string, where a leading "=" marks a
 * formula — the same convention Excel uses in the UI, so the mapping in both
 * directions is direct.
 */

import { XLSX_MIME } from "../filesApi";
import type { Cells } from "../../apps/spreadsheet/formula";

/** Read the first worksheet of a workbook into spreadSO cells. */
export async function importXlsx(bytes: ArrayBuffer): Promise<Cells> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const ws = wb.worksheets[0];
  const cells: Cells = {};
  if (!ws) return cells;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const ref = `${columnLetter(colNumber)}${rowNumber}`;
      const raw = readCell(cell);
      if (raw !== "") cells[ref] = raw;
    });
  });
  return cells;
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

/** Write spreadSO cells out as a real .xlsx, preserving formulas. */
export async function exportXlsx(cells: Cells, sheetName: string): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOWeb — spreadSO";
  wb.created = new Date();
  // Excel rejects these characters in sheet names.
  const ws = wb.addWorksheet(sheetName.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Hoja1");

  for (const [ref, raw] of Object.entries(cells)) {
    if (raw === "") continue;
    const cell = ws.getCell(ref);
    if (raw.startsWith("=")) {
      cell.value = { formula: raw.slice(1) };
    } else {
      const n = Number(raw);
      cell.value = raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

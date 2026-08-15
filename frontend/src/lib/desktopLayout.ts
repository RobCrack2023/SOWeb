import type { IconPos } from "./filesApi";

/** Desktop icons snap to a fixed grid so free-form dragging never overlaps. */
export const CELL_W = 100;
export const CELL_H = 118;
export const ORIGIN_X = 16;
export const ORIGIN_Y = 16;
/** Reserve room for the taskbar at the bottom of the screen. */
const TASKBAR_RESERVE = 64;

export function cellKey(pos: IconPos): string {
  const col = Math.round((pos.x - ORIGIN_X) / CELL_W);
  const row = Math.round((pos.y - ORIGIN_Y) / CELL_H);
  return `${col},${row}`;
}

function posOfCell(col: number, row: number): IconPos {
  return { x: ORIGIN_X + col * CELL_W, y: ORIGIN_Y + row * CELL_H };
}

export function maxRows(viewportHeight: number): number {
  return Math.max(1, Math.floor((viewportHeight - ORIGIN_Y - TASKBAR_RESERVE) / CELL_H));
}

/** First free cell scanning top-to-bottom, then left-to-right. */
export function nextFreeCell(occupied: Set<string>, rows: number): IconPos {
  for (let col = 0; col < 1000; col++) {
    for (let row = 0; row < rows; row++) {
      const key = `${col},${row}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        return posOfCell(col, row);
      }
    }
  }
  return posOfCell(0, 0);
}

/** Snap a raw drop point to the nearest grid cell, clamped to the visible desktop. */
export function snapToGrid(x: number, y: number, viewportW: number, viewportH: number): IconPos {
  const rows = maxRows(viewportH);
  const maxCol = Math.max(0, Math.floor((viewportW - ORIGIN_X - CELL_W) / CELL_W));
  const col = Math.min(Math.max(Math.round((x - ORIGIN_X) / CELL_W), 0), maxCol);
  const row = Math.min(Math.max(Math.round((y - ORIGIN_Y) / CELL_H), 0), Math.max(0, rows - 1));
  return posOfCell(col, row);
}

const APP_POS_KEY = "soweb.desktop.appPositions";

export function loadAppPositions(): Record<string, IconPos> {
  try {
    const raw = localStorage.getItem(APP_POS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAppPosition(appId: string, pos: IconPos): void {
  const all = loadAppPositions();
  all[appId] = pos;
  try {
    localStorage.setItem(APP_POS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — the position just won't survive a reload.
  }
}

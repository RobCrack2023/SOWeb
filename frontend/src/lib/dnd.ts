import type { DragEvent } from "react";

const DND_MIME = "application/x-soweb-item";

export interface DndPayload {
  kind: "folder" | "file";
  id: number;
}

export function startDrag(e: DragEvent, payload: DndPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

export function readDrag(e: DragEvent): DndPayload | null {
  const raw = e.dataTransfer.getData(DND_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DndPayload;
  } catch {
    return null;
  }
}

/**
 * True when the drag carries files from outside the browser (the real desktop).
 * `types` is readable during dragover, unlike the files themselves, so this is
 * what we use to decide whether to show the "drop to upload" affordance.
 */
export function isExternalFileDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  const dt = e.dataTransfer;
  if (!dt) return false;
  // An internal move also exposes its own MIME; that one wins.
  if (Array.from(dt.types).includes(DND_MIME)) return false;
  return Array.from(dt.types).includes("Files");
}

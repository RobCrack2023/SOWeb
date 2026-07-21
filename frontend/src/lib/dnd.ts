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

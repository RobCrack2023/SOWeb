import { useRef, useState, type DragEvent } from "react";
import { isExternalFileDrag } from "./dnd";
import { captureDrop, uploadDrop, type DropProgress } from "./dropUpload";

/**
 * Wires up "drag files in from the desktop" for a container.
 *
 * dragenter/dragleave fire for every child element too, so a plain boolean
 * flickers as the pointer moves across the UI. We track nesting depth instead
 * and only hide the overlay once the drag truly leaves the container.
 */
export function useExternalDrop(onUploaded: () => void) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<DropProgress | null>(null);
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  const onDragEnter = (e: DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    depth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (e: DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    depth.current -= 1;
    if (depth.current <= 0) reset();
  };

  /**
   * Handles the drop if it carries external files. Returns false when it
   * doesn't, so callers can fall through to their internal move logic.
   */
  const handleDrop = (e: DragEvent, targetFolderId: number | null | undefined): boolean => {
    if (!isExternalFileDrag(e)) return false;
    e.preventDefault();
    e.stopPropagation();
    reset();

    if (targetFolderId == null) {
      window.alert("Los archivos deben ir dentro de una carpeta.");
      return true;
    }

    // Must read the item list before this handler returns.
    const captured = captureDrop(e.dataTransfer);
    setProgress({ done: 0, total: 0, current: "" });

    uploadDrop(captured, targetFolderId, setProgress)
      .then((result) => {
        if (result.errors.length) {
          window.alert(
            `Se subieron ${result.files} archivo(s). No se pudieron subir ${result.errors.length}:\n` +
              result.errors.slice(0, 5).join("\n"),
          );
        }
        onUploaded();
      })
      .catch((err) => window.alert(`No se pudo subir: ${err}`))
      .finally(() => setProgress(null));

    return true;
  };

  return { dragging, progress, onDragEnter, onDragLeave, handleDrop, busy: progress != null };
}

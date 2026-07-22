import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { InlineEditLabel } from "../ui/InlineEditLabel";
import { readDrag, type DndPayload } from "../lib/dnd";
import styles from "./DesktopIcon.module.css";

export function DesktopIcon({
  icon,
  label,
  onOpen,
  onContextMenu,
  editing = false,
  onRenameCommit,
  onRenameCancel,
  draggable = false,
  onDragStart,
  onDropItem,
  selected = false,
  selectionKey,
  onSelect,
}: {
  icon: string;
  label: string;
  onOpen: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  editing?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDropItem?: (payload: DndPayload | null) => void;
  selected?: boolean;
  selectionKey?: string;
  onSelect?: (e: MouseEvent) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const canDrop = !!onDropItem;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!editing && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      className={`${styles.icon} ${selected ? styles.selected : ""} ${isOver ? styles.dragOver : ""}`}
      role="button"
      tabIndex={0}
      data-icon-key={selectionKey}
      draggable={draggable}
      onMouseDown={onSelect}
      onDragStart={onDragStart}
      onDragOver={canDrop ? (e) => e.preventDefault() : undefined}
      onDragEnter={canDrop ? () => setIsOver(true) : undefined}
      onDragLeave={canDrop ? () => setIsOver(false) : undefined}
      onDrop={
        canDrop
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOver(false);
              onDropItem!(readDrag(e));
            }
          : undefined
      }
      onDoubleClick={editing ? undefined : onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.glyph}>{icon}</span>
      <InlineEditLabel
        value={label}
        editing={editing}
        onCommit={onRenameCommit ?? (() => {})}
        onCancel={onRenameCancel ?? (() => {})}
        className={editing ? styles.labelInput : styles.label}
      />
    </div>
  );
}

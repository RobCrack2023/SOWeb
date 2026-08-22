import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Sheet } from "./formula";
import styles from "./SpreadSheet.module.css";

export function SheetTabs({
  sheets,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  sheets: Sheet[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // Keep the current tab reachable when a workbook has many sheets.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-sheet-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const startRename = (sheet: Sheet) => {
    setRenaming(sheet.id);
    setDraft(sheet.name);
  };

  const commit = () => {
    if (renaming) onRename(renaming, draft);
    setRenaming(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(null);
    }
  };

  return (
    <div className={styles.tabsBar}>
      <button className={styles.addSheet} onClick={onAdd} title="Agregar hoja">
        ＋
      </button>

      <div className={styles.tabStrip} ref={stripRef}>
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeId;
          return (
            <div
              key={sheet.id}
              data-sheet-id={sheet.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onMouseDown={() => onSelect(sheet.id)}
              onDoubleClick={() => startRename(sheet)}
              title={`${sheet.name} — doble clic para renombrar`}
            >
              {renaming === sheet.id ? (
                <input
                  ref={inputRef}
                  className={styles.tabInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  onBlur={commit}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className={styles.tabName}>{sheet.name}</span>
                  {isActive && sheets.length > 1 && (
                    <button
                      className={styles.tabClose}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onDelete(sheet.id);
                      }}
                      title="Eliminar hoja"
                    >
                      ✕
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <span className={styles.sheetCount}>
        {sheets.length} {sheets.length === 1 ? "hoja" : "hojas"}
      </span>
    </div>
  );
}

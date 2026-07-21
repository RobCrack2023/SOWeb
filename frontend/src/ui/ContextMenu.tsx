import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - rect.width - 4);
    const y = Math.min(state.y, window.innerHeight - rect.height - 4);
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [state]);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ top: pos.y, left: pos.x }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          className={`${styles.item} ${item.danger ? styles.danger : ""}`}
          onClick={() => {
            // Close first so this menu's own listeners (click/blur) are detached
            // before the action runs — several actions open window.prompt(),
            // whose native dialog blurs the window and would otherwise race
            // with (or double-fire) this menu's own close handling.
            onClose();
            setTimeout(() => item.onClick(), 0);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

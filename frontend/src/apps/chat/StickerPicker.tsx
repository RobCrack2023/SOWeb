import { useEffect, useRef } from "react";
import { STICKERS, type Sticker } from "./stickers";
import { StickerView } from "./StickerView";
import styles from "./WaSO.module.css";

export function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (sticker: Sticker) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Deferred so the click that opened the picker doesn't immediately close it.
    const timer = window.setTimeout(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={styles.picker} ref={ref}>
      <div className={styles.pickerTitle}>Stickers</div>
      <div className={styles.pickerGrid}>
        {STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            className={styles.pickerItem}
            onClick={() => onPick(sticker)}
            title={sticker.label}
          >
            <StickerView sticker={sticker} size={34} />
          </button>
        ))}
      </div>
    </div>
  );
}

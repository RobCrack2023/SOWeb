import { stickerFor, type Sticker } from "./stickers";
import styles from "./Stickers.module.css";

/** Renders one animated sticker at the requested size. */
export function StickerView({
  sticker,
  size = 64,
  title,
}: {
  sticker: Sticker | string;
  size?: number;
  title?: string;
}) {
  const resolved = typeof sticker === "string" ? stickerFor(sticker) : sticker;
  return (
    <span
      className={`${styles.sticker} ${styles[resolved.anim]}`}
      style={{ fontSize: size }}
      role="img"
      aria-label={resolved.label}
      title={title ?? resolved.label}
    >
      {resolved.emoji}
    </span>
  );
}

import type { DropProgress } from "../lib/dropUpload";
import styles from "./DropOverlay.module.css";

/** Shown while external files hover over a drop target, and while uploading. */
export function DropOverlay({
  visible,
  label,
  progress,
}: {
  visible: boolean;
  label: string;
  progress?: DropProgress | null;
}) {
  if (!visible && !progress) return null;

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className={styles.overlay}>
        <div className={styles.card}>
          <div className={styles.icon}>⬆</div>
          <div className={styles.title}>
            Subiendo {progress.done} de {progress.total}
          </div>
          <div className={styles.sub}>{progress.current}</div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.icon}>📥</div>
        <div className={styles.title}>{label}</div>
        <div className={styles.sub}>Se admiten archivos y carpetas</div>
      </div>
    </div>
  );
}

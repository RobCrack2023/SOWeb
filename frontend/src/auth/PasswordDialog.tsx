import { useState, type FormEvent } from "react";
import { changePassword } from "../lib/auth";
import styles from "./PasswordDialog.module.css";

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) {
      setError("La contraseña nueva debe tener al menos 6 caracteres.");
      return;
    }
    if (next !== confirm) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <form className={styles.dialog} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={styles.title}>Cambiar contraseña</h2>

        {done ? (
          <>
            <div className={styles.ok}>
              Listo, tu contraseña quedó cambiada. Si habías iniciado sesión en otro navegador o
              equipo, esas sesiones se cerraron.
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Contraseña actual</span>
              <input
                className={styles.input}
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Contraseña nueva</span>
              <input
                className={styles.input}
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Repetir la nueva</span>
              <input
                className={styles.input}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? "Cambiando…" : "Cambiar"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

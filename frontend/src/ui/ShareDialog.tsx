import { useEffect, useState, type FormEvent } from "react";
import { listShareTargets, shareFile, type FileOut, type ShareTarget } from "../lib/filesApi";
import styles from "./ShareDialog.module.css";

export function ShareDialog({ file, onClose }: { file: FileOut; onClose: () => void }) {
  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [toUserId, setToUserId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listShareTargets()
      .then((list) => {
        setTargets(list);
        setToUserId(list[0]?.id ?? null);
      })
      .catch((err) => setError(String(err)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (toUserId == null) return;
    setError(null);
    setBusy(true);
    try {
      await shareFile(file.id, toUserId, note);
      setSentTo(targets?.find((t) => t.id === toUserId)?.username ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <form className={styles.dialog} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={styles.title}>Compartir archivo</h2>
        <div className={styles.fileName}>📎 {file.name}</div>

        {sentTo !== null ? (
          <>
            <div className={styles.ok}>
              Enviado a <strong>{sentTo}</strong>. Le llegó una copia a su carpeta «Recibidos» y un
              aviso por waSO.
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            {targets === null && <div className={styles.muted}>Cargando usuarios…</div>}
            {targets?.length === 0 && (
              <div className={styles.muted}>
                No hay otras cuentas todavía. Creá una segunda cuenta para poder compartir.
              </div>
            )}
            {targets && targets.length > 0 && (
              <>
                <label className={styles.field}>
                  <span className={styles.label}>Enviar a</span>
                  <select
                    className={styles.input}
                    value={toUserId ?? ""}
                    onChange={(e) => setToUserId(Number(e.target.value))}
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.username}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Mensaje (opcional)</span>
                  <textarea
                    className={styles.textarea}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Te dejo el informe…"
                  />
                </label>
                <div className={styles.hint}>
                  Se envía una copia: quien la reciba pasa a ser su dueño y tus cambios posteriores
                  no la afectan.
                </div>
              </>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                type="submit"
                className={styles.primary}
                disabled={busy || toUserId == null}
              >
                {busy ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { sendMail, type MailAccount } from "../../lib/mailApi";
import styles from "./MailSO.module.css";

export interface Draft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  inReplyTo: string;
}

const splitAddresses = (value: string): string[] =>
  value
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);

export function Compose({
  account,
  draft,
  onClose,
  onSent,
}: {
  account: MailAccount;
  draft: Draft;
  onClose: () => void;
  onSent: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const to = splitAddresses(form.to);
    const cc = splitAddresses(form.cc);
    if (to.length === 0 && cc.length === 0) {
      setError("Falta el destinatario.");
      return;
    }
    if (!account.smtp_host) {
      setError("Esta cuenta no tiene servidor de salida configurado. Editala para agregarlo.");
      return;
    }
    setBusy(true);
    try {
      await sendMail(account.id, {
        to,
        cc,
        subject: form.subject,
        body: form.body,
        in_reply_to: form.inReplyTo,
      });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} onMouseDown={onClose}>
      <form
        className={styles.composeDialog}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className={styles.dialogTitle}>Nuevo mensaje</h2>
        <div className={styles.fromLine}>
          De: <strong>{account.email}</strong>
        </div>

        <input
          className={styles.composeField}
          placeholder="Para (separá con comas)"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
          autoFocus
        />
        <input
          className={styles.composeField}
          placeholder="CC (opcional)"
          value={form.cc}
          onChange={(e) => setForm({ ...form, cc: e.target.value })}
        />
        <input
          className={styles.composeField}
          placeholder="Asunto"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
        <textarea
          className={styles.composeBody}
          placeholder="Escribí tu mensaje…"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />

        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.dialogActions}>
          <div className={styles.spacer} />
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Descartar
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={busy}>
            {busy ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </div>
  );
}

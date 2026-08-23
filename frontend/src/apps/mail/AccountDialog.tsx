import { useState, type FormEvent } from "react";
import {
  createAccount,
  testAccount,
  updateAccount,
  PRESETS,
  type MailAccount,
  type MailAccountInput,
} from "../../lib/mailApi";
import styles from "./MailSO.module.css";

function blankInput(): MailAccountInput {
  const gmail = PRESETS[0];
  return {
    label: "",
    email: "",
    protocol: "imap",
    host: gmail.host,
    port: gmail.port,
    use_ssl: gmail.use_ssl,
    username: "",
    password: "",
    smtp_host: gmail.smtp_host,
    smtp_port: gmail.smtp_port,
    smtp_ssl: gmail.smtp_ssl,
    smtp_username: "",
    smtp_password: "",
  };
}

function fromAccount(account: MailAccount): MailAccountInput {
  return {
    label: account.label,
    email: account.email,
    protocol: account.protocol,
    host: account.host,
    port: account.port,
    use_ssl: account.use_ssl,
    username: account.username,
    // Never round-trips from the server; empty means "keep the stored one".
    password: "",
    smtp_host: account.smtp_host,
    smtp_port: account.smtp_port,
    smtp_ssl: account.smtp_ssl,
    smtp_username: account.smtp_username,
    smtp_password: "",
  };
}

export function AccountDialog({
  account,
  onClose,
  onSaved,
}: {
  account: MailAccount | null;
  onClose: () => void;
  onSaved: (account: MailAccount) => void;
}) {
  const editing = account !== null;
  const [presetId, setPresetId] = useState(editing ? "custom" : "gmail");
  const [form, setForm] = useState<MailAccountInput>(
    editing ? fromAccount(account) : blankInput(),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId);

  const set = <K extends keyof MailAccountInput>(key: K, value: MailAccountInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const applyPreset = (id: string) => {
    setPresetId(id);
    const chosen = PRESETS.find((p) => p.id === id);
    if (!chosen) return;
    setForm((prev) => ({
      ...prev,
      host: chosen.host,
      port: chosen.port,
      use_ssl: chosen.use_ssl,
      smtp_host: chosen.smtp_host,
      smtp_port: chosen.smtp_port,
      smtp_ssl: chosen.smtp_ssl,
    }));
  };

  /** The username is nearly always the address; fill it in as they type. */
  const onEmailChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      email: value,
      username: prev.username === "" || prev.username === prev.email ? value : prev.username,
      label: prev.label === "" || prev.label === prev.email ? value : prev.label,
    }));
  };

  const validate = (): string | null => {
    if (!form.email.trim()) return "Falta la dirección de correo.";
    if (!form.host.trim()) return "Falta el servidor de entrada.";
    if (!form.username.trim()) return "Falta el usuario.";
    if (!editing && !form.password) return "Falta la contraseña.";
    return null;
  };

  const runTest = async () => {
    setError(null);
    setStatus(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!form.password) {
      setError("Para probar la conexión escribí la contraseña.");
      return;
    }
    setBusy(true);
    try {
      await testAccount(form);
      setStatus("Conexión correcta.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const saved = editing
        ? await updateAccount(account.id, form)
        : await createAccount(form);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} onMouseDown={onClose}>
      <form
        className={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className={styles.dialogTitle}>
          {editing ? "Editar cuenta" : "Agregar cuenta de correo"}
        </h2>

        {!editing && (
          <label className={styles.field}>
            <span className={styles.label}>Proveedor</span>
            <select
              className={styles.input}
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {preset?.note && <div className={styles.presetNote}>{preset.note}</div>}

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Dirección</span>
            <input
              className={styles.input}
              value={form.email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="vos@gmail.com"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Nombre para mostrar</span>
            <input
              className={styles.input}
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Personal"
            />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Usuario</span>
            <input
              className={styles.input}
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>
              Contraseña {editing && <em className={styles.hint}>(vacío = sin cambios)</em>}
            </span>
            <input
              className={styles.input}
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className={styles.sectionTitle}>Entrada</div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Protocolo</span>
            <select
              className={styles.input}
              value={form.protocol}
              onChange={(e) => set("protocol", e.target.value as "imap" | "pop3")}
            >
              <option value="imap">IMAP (recomendado)</option>
              <option value="pop3">POP3</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Servidor</span>
            <input
              className={styles.input}
              value={form.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </label>
          <label className={styles.fieldNarrow}>
            <span className={styles.label}>Puerto</span>
            <input
              className={styles.input}
              type="number"
              value={form.port}
              onChange={(e) => set("port", Number(e.target.value))}
            />
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={form.use_ssl}
              onChange={(e) => set("use_ssl", e.target.checked)}
            />
            SSL
          </label>
        </div>

        <div className={styles.sectionTitle}>Salida (SMTP)</div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Servidor</span>
            <input
              className={styles.input}
              value={form.smtp_host}
              onChange={(e) => set("smtp_host", e.target.value)}
              placeholder="Dejalo vacío si solo querés leer"
            />
          </label>
          <label className={styles.fieldNarrow}>
            <span className={styles.label}>Puerto</span>
            <input
              className={styles.input}
              type="number"
              value={form.smtp_port}
              onChange={(e) => set("smtp_port", Number(e.target.value))}
            />
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={form.smtp_ssl}
              onChange={(e) => set("smtp_ssl", e.target.checked)}
            />
            SSL directo
          </label>
        </div>
        <div className={styles.smtpHint}>
          Si dejás vacíos usuario y contraseña de salida, se reutilizan los de entrada.
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}
        {status && <div className={styles.okBox}>{status}</div>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostBtn} onClick={runTest} disabled={busy}>
            Probar conexión
          </button>
          <div className={styles.spacer} />
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={busy}>
            {busy ? "Un momento…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from "react";
import { createGroup, getContacts, openDirect, type ChatContact } from "../../lib/chatApi";
import styles from "./WaSO.module.css";

type Mode = "direct" | "group";

export function NewChatDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (conversationId: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("direct");
  const [contacts, setContacts] = useState<ChatContact[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch((err) => setError(String(err)));
  }, []);

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "direct") {
        const [only] = [...picked];
        if (only == null) throw new Error("Elegí a alguien.");
        const conversation = await openDirect(only);
        onStarted(conversation.id);
      } else {
        if (!title.trim()) throw new Error("Ponele un nombre al grupo.");
        if (picked.size === 0) throw new Error("Elegí al menos a una persona.");
        const conversation = await createGroup(title.trim(), [...picked]);
        onStarted(conversation.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setPicked(new Set());
    setError(null);
  };

  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTabs}>
          <button
            className={`${styles.dialogTab} ${mode === "direct" ? styles.dialogTabActive : ""}`}
            onClick={() => switchMode("direct")}
          >
            Chat directo
          </button>
          <button
            className={`${styles.dialogTab} ${mode === "group" ? styles.dialogTabActive : ""}`}
            onClick={() => switchMode("group")}
          >
            Grupo
          </button>
        </div>

        {mode === "group" && (
          <input
            className={styles.dialogInput}
            placeholder="Nombre del grupo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        )}

        <div className={styles.dialogList}>
          {contacts === null && <div className={styles.loading}>Cargando…</div>}
          {contacts?.length === 0 && (
            <div className={styles.loading}>
              No hay otros usuarios registrados todavía. Creá otra cuenta para poder chatear.
            </div>
          )}
          {contacts?.map((contact) => (
            <label key={contact.id} className={styles.dialogRow}>
              <input
                type={mode === "direct" ? "radio" : "checkbox"}
                name="contact"
                checked={picked.has(contact.id)}
                onChange={() => (mode === "direct" ? setPicked(new Set([contact.id])) : toggle(contact.id))}
              />
              <span className={styles.avatarSmall}>
                {contact.username[0]?.toUpperCase()}
                {contact.online && <span className={styles.presenceDot} />}
              </span>
              <span>{contact.username}</span>
              <span className={styles.dialogState}>{contact.online ? "en línea" : ""}</span>
            </label>
          ))}
        </div>

        {error && <div className={styles.sendError}>{error}</div>}

        <div className={styles.dialogActions}>
          <button className={styles.dialogCancel} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className={styles.dialogConfirm}
            onClick={start}
            disabled={busy || picked.size === 0}
          >
            {mode === "direct" ? "Abrir chat" : "Crear grupo"}
          </button>
        </div>
      </div>
    </div>
  );
}

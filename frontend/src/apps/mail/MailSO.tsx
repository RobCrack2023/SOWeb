import { useCallback, useEffect, useState } from "react";
import {
  deleteAccount,
  deleteMessage,
  downloadAttachment,
  getMessage,
  listAccounts,
  listFolders,
  listMessages,
  type MailAccount,
  type MailEnvelope,
  type MailMessage,
} from "../../lib/mailApi";
import { AccountDialog } from "./AccountDialog";
import { Compose, type Draft } from "./Compose";
import { MessageBody } from "./MessageBody";
import styles from "./MailSO.module.css";

const PAGE = 30;

const EMPTY_DRAFT: Draft = { to: "", cc: "", subject: "", body: "", inReplyTo: "" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function MailSO() {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingBody, setLoadingBody] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogFor, setDialogFor] = useState<MailAccount | null | "new">(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const account = accounts?.find((a) => a.id === accountId) ?? null;

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await listAccounts();
      setAccounts(list);
      setAccountId((current) => current ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  // Folders come from the server, so a broken account surfaces here first.
  useEffect(() => {
    if (accountId == null) return;
    setError(null);
    setFolders([]);
    listFolders(accountId)
      .then((list) => {
        setFolders(list);
        setFolder((current) => (list.includes(current) ? current : list[0] ?? "INBOX"));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [accountId]);

  const loadList = useCallback(() => {
    if (accountId == null) return;
    setLoadingList(true);
    setError(null);
    listMessages(accountId, folder, PAGE, offset)
      .then((data) => {
        setEnvelopes(data.messages);
        setTotal(data.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingList(false));
  }, [accountId, folder, offset]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Changing folder or account starts a fresh page and clears the reading pane.
  useEffect(() => {
    setOffset(0);
    setSelected(null);
  }, [folder, accountId]);

  const openMessage = async (envelope: MailEnvelope) => {
    if (accountId == null) return;
    setLoadingBody(true);
    setError(null);
    try {
      const message = await getMessage(accountId, envelope.uid, folder);
      setSelected(message);
      // The server marked it read; reflect that without a full reload.
      setEnvelopes((prev) =>
        prev.map((e) => (e.uid === envelope.uid ? { ...e, seen: true } : e)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBody(false);
    }
  };

  const removeMessage = async (uid: string) => {
    if (accountId == null) return;
    if (!window.confirm("¿Eliminar este mensaje del servidor?")) return;
    try {
      await deleteMessage(accountId, uid, folder);
      setSelected(null);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeAccount = async (target: MailAccount) => {
    if (!window.confirm(`¿Quitar la cuenta "${target.label}" de SOWeb?`)) return;
    await deleteAccount(target.id);
    setAccountId(null);
    setSelected(null);
    setEnvelopes([]);
    refreshAccounts();
  };

  const replyTo = (message: MailMessage) => {
    const quoted = (message.text || "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setDraft({
      to: message.from_email,
      cc: "",
      subject: message.subject.toLowerCase().startsWith("re:")
        ? message.subject
        : `Re: ${message.subject}`,
      body: `\n\n---\n${message.from_name || message.from_email} escribió:\n${quoted}`,
      inReplyTo: message.message_id,
    });
  };

  if (accounts === null) {
    return <div className={styles.centered}>Cargando…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className={styles.centered}>
        <div className={styles.welcomeIcon}>✉️</div>
        <h2 className={styles.welcomeTitle}>mailSO</h2>
        <p className={styles.welcomeText}>
          Conectá una cuenta que ya tengas —Gmail, Outlook o cualquier servidor IMAP/POP3— y
          leé tu correo desde acá.
        </p>
        <button className={styles.primaryBtn} onClick={() => setDialogFor("new")}>
          Agregar cuenta
        </button>
        {dialogFor !== null && (
          <AccountDialog
            account={null}
            onClose={() => setDialogFor(null)}
            onSaved={(saved) => {
              setDialogFor(null);
              setAccountId(saved.id);
              refreshAccounts();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.accountBar}>
          <select
            className={styles.accountSelect}
            value={accountId ?? ""}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label || a.email}
              </option>
            ))}
          </select>
          <button
            className={styles.iconBtn}
            onClick={() => setDialogFor("new")}
            title="Agregar cuenta"
          >
            ＋
          </button>
        </div>

        <button
          className={styles.composeBtn}
          onClick={() => setDraft(EMPTY_DRAFT)}
          disabled={!account}
        >
          ✏️ Redactar
        </button>

        <div className={styles.folderList}>
          {folders.length === 0 && <div className={styles.muted}>Sin carpetas</div>}
          {folders.map((f) => (
            <button
              key={f}
              className={`${styles.folder} ${f === folder ? styles.folderActive : ""}`}
              onClick={() => setFolder(f)}
              title={f}
            >
              {f}
            </button>
          ))}
        </div>

        {account && (
          <div className={styles.accountActions}>
            <button className={styles.linkBtn} onClick={() => setDialogFor(account)}>
              Editar cuenta
            </button>
            <button className={styles.linkBtnDanger} onClick={() => removeAccount(account)}>
              Quitar
            </button>
          </div>
        )}
      </aside>

      <section className={styles.listPane}>
        <div className={styles.listHead}>
          <span className={styles.listTitle}>{folder}</span>
          <button className={styles.iconBtn} onClick={loadList} title="Actualizar">
            🔄
          </button>
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}
        {loadingList && <div className={styles.muted}>Cargando mensajes…</div>}
        {!loadingList && envelopes.length === 0 && !error && (
          <div className={styles.muted}>No hay mensajes en esta carpeta.</div>
        )}

        <ul className={styles.messageList}>
          {envelopes.map((e) => (
            <li key={e.uid}>
              <button
                className={`${styles.messageItem} ${
                  selected?.uid === e.uid ? styles.messageItemActive : ""
                } ${e.seen ? "" : styles.unread}`}
                onClick={() => openMessage(e)}
              >
                <span className={styles.itemTop}>
                  <span className={styles.itemFrom}>{e.from_name || e.from_email}</span>
                  <span className={styles.itemDate}>{formatDate(e.date)}</span>
                </span>
                <span className={styles.itemSubject}>
                  {e.has_attachments && <span className={styles.clip}>📎</span>}
                  {e.subject || "(sin asunto)"}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {total > PAGE && (
          <div className={styles.pager}>
            <button
              className={styles.ghostBtn}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
              disabled={offset === 0 || loadingList}
            >
              ← Más nuevos
            </button>
            <span className={styles.pageInfo}>
              {offset + 1}–{Math.min(offset + PAGE, total)} de {total}
            </span>
            <button
              className={styles.ghostBtn}
              onClick={() => setOffset((o) => o + PAGE)}
              disabled={offset + PAGE >= total || loadingList}
            >
              Más antiguos →
            </button>
          </div>
        )}
      </section>

      <section className={styles.readPane}>
        {loadingBody && <div className={styles.muted}>Abriendo mensaje…</div>}
        {!loadingBody && !selected && (
          <div className={styles.centered}>
            <div className={styles.welcomeIcon}>📬</div>
            <p className={styles.muted}>Elegí un mensaje para leerlo.</p>
          </div>
        )}
        {!loadingBody && selected && (
          <>
            <header className={styles.readHead}>
              <h2 className={styles.readSubject}>{selected.subject || "(sin asunto)"}</h2>
              <div className={styles.readMeta}>
                <strong>{selected.from_name || selected.from_email}</strong>
                {selected.from_name && <span className={styles.muted}> {selected.from_email}</span>}
              </div>
              <div className={styles.readMeta}>
                <span className={styles.muted}>Para: {selected.to.join(", ") || "—"}</span>
              </div>
              {selected.cc.length > 0 && (
                <div className={styles.readMeta}>
                  <span className={styles.muted}>CC: {selected.cc.join(", ")}</span>
                </div>
              )}
              <div className={styles.readActions}>
                <button className={styles.ghostBtn} onClick={() => replyTo(selected)}>
                  ↩ Responder
                </button>
                <button
                  className={styles.linkBtnDanger}
                  onClick={() => removeMessage(selected.uid)}
                >
                  🗑 Eliminar
                </button>
              </div>
            </header>

            {selected.attachments.length > 0 && (
              <div className={styles.attachments}>
                {selected.attachments.map((a) => (
                  <button
                    key={a.index}
                    className={styles.attachment}
                    onClick={() =>
                      accountId != null &&
                      downloadAttachment(accountId, selected.uid, folder, a).catch((err) =>
                        setError(String(err)),
                      )
                    }
                    title={`${a.content_type} — ${formatSize(a.size)}`}
                  >
                    📎 {a.filename}
                    <span className={styles.muted}> ({formatSize(a.size)})</span>
                  </button>
                ))}
              </div>
            )}

            <MessageBody text={selected.text} html={selected.html} />
          </>
        )}
      </section>

      {dialogFor !== null && (
        <AccountDialog
          account={dialogFor === "new" ? null : dialogFor}
          onClose={() => setDialogFor(null)}
          onSaved={(saved) => {
            setDialogFor(null);
            setAccountId(saved.id);
            refreshAccounts();
          }}
        />
      )}

      {draft && account && (
        <Compose
          account={account}
          draft={draft}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            window.alert("Mensaje enviado.");
          }}
        />
      )}
    </div>
  );
}

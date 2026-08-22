import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useChatStore } from "../../lib/chatStore";
import { addMembers, getContacts, leaveGroup, type ChatConversation } from "../../lib/chatApi";
import type { User } from "../../lib/auth";
import { StickerPicker } from "./StickerPicker";
import { StickerView } from "./StickerView";
import styles from "./WaSO.module.css";

/** Don't flood the socket while someone holds down a key. */
const TYPING_THROTTLE = 1500;

function timeOf(value: string): string {
  const date = new Date(/[Z+]/.test(value) ? value : `${value}Z`);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(value: string): string {
  const date = new Date(/[Z+]/.test(value) ? value : `${value}Z`);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Hoy";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString();
}

export function Thread({
  conversation,
  user,
}: {
  conversation: ChatConversation;
  user: User;
}) {
  const messages = useChatStore((s) => s.messages[conversation.id]);
  const typing = useChatStore((s) => s.typing[conversation.id]);
  const send = useChatStore((s) => s.send);
  const notifyTyping = useChatStore((s) => s.notifyTyping);
  const refresh = useChatStore((s) => s.refresh);

  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);

  // Follow the conversation as it grows, and when someone starts typing.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  const subtitle = useMemo(() => {
    if (conversation.kind === "group") {
      return conversation.members.map((m) => m.username).join(", ");
    }
    const other = conversation.members.find((m) => m.id !== user.id);
    return other?.online ? "en línea" : "desconectado";
  }, [conversation, user.id]);

  const deliver = async (kind: "text" | "sticker", body: string) => {
    setError(null);
    try {
      await send(conversation.id, kind, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    deliver("text", body);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
      return;
    }
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_THROTTLE) {
      lastTypingSent.current = now;
      notifyTyping(conversation.id);
    }
  };

  const invite = async () => {
    const contacts = await getContacts();
    const current = new Set(conversation.members.map((m) => m.id));
    const candidates = contacts.filter((c) => !current.has(c.id));
    if (candidates.length === 0) {
      window.alert("No hay más usuarios para sumar.");
      return;
    }
    const name = window.prompt(
      `¿A quién sumás al grupo?\nDisponibles: ${candidates.map((c) => c.username).join(", ")}`,
    );
    if (!name) return;
    const match = candidates.find((c) => c.username === name.trim());
    if (!match) {
      window.alert("No encontré ese usuario.");
      return;
    }
    await addMembers(conversation.id, [match.id]);
    refresh();
  };

  const leave = async () => {
    if (!window.confirm(`¿Salir de "${conversation.title}"?`)) return;
    await leaveGroup(conversation.id);
    refresh();
  };

  let lastDay = "";

  return (
    <div className={styles.thread}>
      <header className={styles.threadHead}>
        <span className={styles.avatar}>
          {conversation.kind === "group" ? "👥" : conversation.title[0]?.toUpperCase()}
        </span>
        <div className={styles.threadTitles}>
          <div className={styles.threadTitle}>{conversation.title}</div>
          <div className={styles.threadSubtitle}>{subtitle}</div>
        </div>
        {conversation.kind === "group" && (
          <div className={styles.threadActions}>
            <button className={styles.headBtn} onClick={invite} title="Sumar a alguien">
              ＋
            </button>
            <button className={styles.headBtn} onClick={leave} title="Salir del grupo">
              🚪
            </button>
          </div>
        )}
      </header>

      <div className={styles.messages}>
        {messages === undefined && <div className={styles.loading}>Cargando…</div>}
        {messages?.length === 0 && (
          <div className={styles.loading}>Todavía no hay mensajes. ¡Escribí el primero!</div>
        )}

        {messages?.map((message) => {
          const mine = message.sender_id === user.id;
          const day = dayOf(message.created_at);
          const showDay = day !== lastDay;
          lastDay = day;

          return (
            <div key={message.id}>
              {showDay && <div className={styles.daySeparator}>{day}</div>}
              <div className={`${styles.row} ${mine ? styles.rowMine : ""}`}>
                <div
                  className={`${styles.bubble} ${mine ? styles.bubbleMine : ""} ${
                    message.kind === "sticker" ? styles.bubbleSticker : ""
                  }`}
                >
                  {conversation.kind === "group" && !mine && (
                    <div className={styles.bubbleSender}>{message.sender}</div>
                  )}
                  {message.kind === "sticker" ? (
                    <StickerView sticker={message.body} size={72} />
                  ) : (
                    <div className={styles.bubbleText}>{message.body}</div>
                  )}
                  <div className={styles.bubbleTime}>{timeOf(message.created_at)}</div>
                </div>
              </div>
            </div>
          );
        })}

        {typing && (
          <div className={styles.row}>
            <div className={`${styles.bubble} ${styles.typingBubble}`}>
              <span className={styles.typingName}>{typing}</span>
              <span className={styles.dots}>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && <div className={styles.sendError}>{error}</div>}

      <form className={styles.composer} onSubmit={submit}>
        <button
          type="button"
          className={`${styles.stickerBtn} ${pickerOpen ? styles.stickerBtnOpen : ""}`}
          onClick={() => setPickerOpen((v) => !v)}
          title="Stickers"
        >
          😀
        </button>
        <textarea
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí un mensaje…"
          rows={1}
        />
        <button className={styles.sendBtn} type="submit" disabled={!draft.trim()} title="Enviar">
          ➤
        </button>

        {pickerOpen && (
          <StickerPicker
            onPick={(sticker) => {
              setPickerOpen(false);
              deliver("sticker", sticker.id);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </form>
    </div>
  );
}

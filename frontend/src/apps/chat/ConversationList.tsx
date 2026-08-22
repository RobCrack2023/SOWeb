import { useChatStore } from "../../lib/chatStore";
import type { ChatConversation } from "../../lib/chatApi";
import { stickerFor } from "./stickers";
import styles from "./WaSO.module.css";

function preview(conversation: ChatConversation): string {
  const last = conversation.last_message;
  if (!last) return "Sin mensajes todavía";
  const body = last.kind === "sticker" ? `${stickerFor(last.body).emoji} sticker` : last.body;
  return conversation.kind === "group" ? `${last.sender}: ${body}` : body;
}

function when(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(/[Z+]/.test(value) ? value : `${value}Z`);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ChatConversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const typing = useChatStore((s) => s.typing);

  if (conversations.length === 0) {
    return <div className={styles.emptyList}>Todavía no tenés conversaciones.</div>;
  }

  return (
    <ul className={styles.list}>
      {conversations.map((c) => {
        const someoneTyping = typing[c.id];
        // A direct chat is online when the other person is; a group, when anyone is.
        const online = c.members.some((m) => m.online);
        return (
          <li key={c.id}>
            <button
              className={`${styles.item} ${c.id === selectedId ? styles.itemActive : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className={styles.avatar}>
                {c.kind === "group" ? "👥" : c.title[0]?.toUpperCase()}
                {online && c.kind === "direct" && <span className={styles.presenceDot} />}
              </span>

              <span className={styles.itemBody}>
                <span className={styles.itemTop}>
                  <span className={styles.itemTitle}>{c.title}</span>
                  <span className={styles.itemWhen}>{when(c.last_message?.created_at)}</span>
                </span>
                <span className={styles.itemPreview}>
                  {someoneTyping ? (
                    <span className={styles.typingHint}>escribiendo…</span>
                  ) : (
                    preview(c)
                  )}
                </span>
              </span>

              {c.unread > 0 && <span className={styles.unread}>{c.unread}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

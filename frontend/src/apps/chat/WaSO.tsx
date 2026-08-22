import { useEffect, useState } from "react";
import { useChatStore } from "../../lib/chatStore";
import { getCurrentUser } from "../../lib/auth";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";
import { NewChatDialog } from "./NewChatDialog";
import styles from "./WaSO.module.css";

export interface WaSOProps {
  /** Set when the app is opened straight into a conversation. */
  conversationId?: number;
}

export function WaSO({ conversationId }: WaSOProps) {
  const user = getCurrentUser();
  const conversations = useChatStore((s) => s.conversations);
  const connected = useChatStore((s) => s.connected);
  const setActive = useChatStore((s) => s.setActive);
  const refresh = useChatStore((s) => s.refresh);
  const [selected, setSelected] = useState<number | null>(conversationId ?? null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Track which conversation is on screen so incoming messages for it count as
  // read, and so closing the window stops swallowing unread badges.
  useEffect(() => {
    setActive(selected);
    return () => setActive(null);
  }, [selected, setActive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const current = conversations.find((c) => c.id === selected) ?? null;

  // Only reachable while logged in; this keeps the types honest.
  if (!user) return null;

  const startedConversation = (id: number) => {
    setNewChatOpen(false);
    setSelected(id);
    refresh();
  };

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <span className={styles.me}>
            <span className={connected ? styles.linkOn : styles.linkOff} />
            {user.username}
          </span>
          <button
            className={styles.newBtn}
            onClick={() => setNewChatOpen(true)}
            title="Nueva conversación"
          >
            ✏️
          </button>
        </div>

        <ConversationList
          conversations={conversations}
          selectedId={selected}
          onSelect={setSelected}
        />
      </aside>

      <main className={styles.main}>
        {current ? (
          <Thread conversation={current} user={user} />
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderIcon}>💬</div>
            <p className={styles.placeholderTitle}>waSO</p>
            <p className={styles.placeholderText}>
              Elegí una conversación, o creá una nueva con ✏️.
            </p>
          </div>
        )}
      </main>

      {newChatOpen && (
        <NewChatDialog onClose={() => setNewChatOpen(false)} onStarted={startedConversation} />
      )}
    </div>
  );
}

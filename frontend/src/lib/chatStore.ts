import { create } from "zustand";
import {
  getConversations,
  getMessages,
  markRead,
  sendMessage,
  type ChatConversation,
  type ChatMessage,
} from "./chatApi";
import { chatSocket, type ChatEvent } from "./chatSocket";

/** How long a "está escribiendo…" indicator stays up without a new signal. */
const TYPING_TTL = 3500;

interface TypingEntry {
  username: string;
  timer: number;
}

interface ChatState {
  ready: boolean;
  connected: boolean;
  conversations: ChatConversation[];
  messages: Record<number, ChatMessage[]>;
  /** The conversation currently on screen, or null when waSO is closed. */
  activeId: number | null;
  typing: Record<number, string>;

  start: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  setActive: (id: number | null) => void;
  loadMessages: (id: number) => Promise<void>;
  send: (id: number, kind: "text" | "sticker", body: string) => Promise<void>;
  notifyTyping: (id: number) => void;
  totalUnread: () => number;
}

let unsubscribe: (() => void) | null = null;
const typingTimers: Record<number, TypingEntry> = {};

export const useChatStore = create<ChatState>((set, get) => ({
  ready: false,
  connected: false,
  conversations: [],
  messages: {},
  activeId: null,
  typing: {},

  start: () => {
    if (unsubscribe) return;
    unsubscribe = chatSocket.subscribe((event) => handleEvent(event, set, get));
    chatSocket.connect();
    get().refresh();
  },

  stop: () => {
    unsubscribe?.();
    unsubscribe = null;
    chatSocket.disconnect();
    Object.values(typingTimers).forEach((entry) => clearTimeout(entry.timer));
    set({
      ready: false,
      connected: false,
      conversations: [],
      messages: {},
      activeId: null,
      typing: {},
    });
  },

  refresh: async () => {
    try {
      const conversations = await getConversations();
      set({ conversations, ready: true });
    } catch {
      // Offline or logged out; the socket's reconnect will bring us back.
    }
  },

  setActive: (id) => {
    set({ activeId: id });
    if (id == null) return;
    get().loadMessages(id);
    markRead(id).catch(() => {});
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    }));
  },

  loadMessages: async (id) => {
    try {
      const messages = await getMessages(id);
      set((state) => ({ messages: { ...state.messages, [id]: messages } }));
    } catch {
      // Leave whatever is cached on screen.
    }
  },

  send: async (id, kind, body) => {
    const message = await sendMessage(id, kind, body);
    appendMessage(message, set, get);
  },

  notifyTyping: (id) => chatSocket.sendTyping(id),

  totalUnread: () => get().conversations.reduce((sum, c) => sum + c.unread, 0),
}));

type Setter = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;
type Getter = () => ChatState;

function appendMessage(message: ChatMessage, set: Setter, get: Getter): void {
  const { activeId } = get();
  const isActive = activeId === message.conversation_id;

  set((state) => {
    const existing = state.messages[message.conversation_id];
    // Only grow a thread that's already loaded; the rest load on open.
    const thread =
      existing && !existing.some((m) => m.id === message.id)
        ? [...existing, message]
        : existing;

    return {
      messages: thread ? { ...state.messages, [message.conversation_id]: thread } : state.messages,
      conversations: state.conversations.map((c) =>
        c.id === message.conversation_id
          ? { ...c, last_message: message, unread: isActive ? 0 : c.unread + 1 }
          : c,
      ),
    };
  });

  if (isActive) markRead(message.conversation_id).catch(() => {});
}

function handleEvent(event: ChatEvent, set: Setter, get: Getter): void {
  switch (event.type) {
    case "ready":
      set({ connected: true });
      // A reconnect may have missed messages; resync the list.
      get().refresh();
      break;

    case "message": {
      const message = event.message;
      // A conversation we've never seen (someone messaged us first).
      if (!get().conversations.some((c) => c.id === message.conversation_id)) {
        get().refresh();
        return;
      }
      appendMessage(message, set, get);
      break;
    }

    case "conversation":
      get().refresh();
      break;

    case "typing": {
      const id = event.conversation_id;
      clearTimeout(typingTimers[id]?.timer);
      typingTimers[id] = {
        username: event.username,
        timer: window.setTimeout(() => {
          delete typingTimers[id];
          set((state) => {
            const next = { ...state.typing };
            delete next[id];
            return { typing: next };
          });
        }, TYPING_TTL),
      };
      set((state) => ({ typing: { ...state.typing, [id]: event.username } }));
      break;
    }

    case "closed":
      set({ connected: false });
      break;

    case "presence":
      set((state) => ({
        conversations: state.conversations.map((c) => ({
          ...c,
          members: c.members.map((m) =>
            m.id === event.user_id ? { ...m, online: event.online } : m,
          ),
        })),
      }));
      break;
  }
}

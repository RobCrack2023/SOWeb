import { getToken } from "./auth";
import { API_BASE } from "./config";
import type { ChatMessage } from "./chatApi";

export type ChatEvent =
  | { type: "ready"; user_id: number }
  | { type: "message"; message: ChatMessage }
  | { type: "conversation" }
  | { type: "typing"; conversation_id: number; user_id: number; username: string }
  | { type: "presence"; user_id: number; username: string; online: boolean }
  /** Emitted locally, not by the server, so the UI can show it lost the link. */
  | { type: "closed" };

const WS_URL = `${API_BASE.replace(/^http/, "ws")}/chat/ws`;

/** Backoff between reconnection attempts, in ms. */
const RETRY_MIN = 1000;
const RETRY_MAX = 15000;

type Listener = (event: ChatEvent) => void;

/**
 * Connection to the chat socket, with reconnection.
 *
 * The session token is sent in the first frame instead of the URL, so it never
 * ends up in a browser history entry or a server log.
 */
export class ChatSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = RETRY_MIN;
  private retryTimer: number | null = null;
  private closedByUs = false;

  connect(): void {
    if (this.socket || !getToken()) return;
    this.closedByUs = false;

    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ token: getToken() }));
    };

    socket.onmessage = (raw) => {
      let event: ChatEvent;
      try {
        event = JSON.parse(raw.data);
      } catch {
        return;
      }
      // A successful exchange means the connection is healthy again.
      if (event.type === "ready") this.retry = RETRY_MIN;
      this.listeners.forEach((listener) => listener(event));
    };

    socket.onclose = () => {
      this.socket = null;
      this.listeners.forEach((listener) => listener({ type: "closed" }));
      if (this.closedByUs || !getToken()) return;
      this.scheduleReconnect();
    };

    // onclose always follows onerror, so reconnection is handled there.
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.retryTimer != null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.retry = Math.min(this.retry * 2, RETRY_MAX);
      this.connect();
    }, this.retry);
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.retry = RETRY_MIN;
  }

  /** Tell the other members that this user is typing. Dropped if offline. */
  sendTyping(conversationId: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "typing", conversation_id: conversationId }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const chatSocket = new ChatSocket();

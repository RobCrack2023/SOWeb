import { apiFetch } from "./api";

export interface ChatContact {
  id: number;
  username: string;
  online: boolean;
}

export interface ChatMember {
  id: number;
  username: string;
  online: boolean;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender: string;
  kind: "text" | "sticker";
  body: string;
  created_at: string;
}

export interface ChatConversation {
  id: number;
  kind: "direct" | "group";
  title: string;
  members: ChatMember[];
  unread: number;
  last_message: ChatMessage | null;
}

export const getContacts = () => apiFetch<ChatContact[]>("/chat/contacts");

export const getConversations = () => apiFetch<ChatConversation[]>("/chat/conversations");

export const openDirect = (userId: number) =>
  apiFetch<ChatConversation>(`/chat/direct/${userId}`, { method: "POST" });

export const createGroup = (title: string, memberIds: number[]) =>
  apiFetch<ChatConversation>("/chat/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, member_ids: memberIds }),
  });

export const addMembers = (conversationId: number, memberIds: number[]) =>
  apiFetch<ChatConversation>(`/chat/groups/${conversationId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_ids: memberIds }),
  });

export const leaveGroup = (conversationId: number) =>
  apiFetch<void>(`/chat/groups/${conversationId}/members/me`, { method: "DELETE" });

export const getMessages = (conversationId: number) =>
  apiFetch<ChatMessage[]>(`/chat/conversations/${conversationId}/messages`);

export const sendMessage = (conversationId: number, kind: "text" | "sticker", body: string) =>
  apiFetch<ChatMessage>(`/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, body }),
  });

export const markRead = (conversationId: number) =>
  apiFetch<void>(`/chat/conversations/${conversationId}/read`, { method: "POST" });

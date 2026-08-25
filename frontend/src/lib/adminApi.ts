import { apiFetch } from "./api";

export interface AdminOverview {
  users: number;
  online: number;
  folders: number;
  files: number;
  storage_bytes: number;
  actions_today: number;
  conversations: number;
  messages: number;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
  online: boolean;
  last_seen: string | null;
  files: number;
  folders: number;
  storage_bytes: number;
  messages_sent: number;
}

export interface AdminSession {
  user_id: number;
  username: string;
  started_at: string;
  last_seen: string;
  online: boolean;
}

export interface AdminActivity {
  id: number;
  user_id: number;
  username: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface AdminFile {
  id: number;
  name: string;
  folder: string;
  size: number;
  content_type: string | null;
  created_at: string;
}

export const getOverview = () => apiFetch<AdminOverview>("/admin/overview");
export const getUsers = () => apiFetch<AdminUser[]>("/admin/users");
export const getSessions = () => apiFetch<AdminSession[]>("/admin/sessions");

export const getActivity = (userId?: number) =>
  apiFetch<AdminActivity[]>(`/admin/activity${userId != null ? `?user_id=${userId}` : ""}`);

export const getUserFiles = (userId: number) =>
  apiFetch<AdminFile[]>(`/admin/users/${userId}/files`);

/** Tell the server about something only the browser can see, e.g. an app opening. */
export function reportActivity(action: string, detail?: string): void {
  // Fire-and-forget: usage tracking must never interrupt what the user is doing.
  apiFetch<void>("/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, detail }),
  }).catch(() => {});
}

import { apiFetch, API_BASE } from "./api";

export interface FolderOut {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
  type: "folder";
}

export interface FileOut {
  id: number;
  name: string;
  folder_id: number;
  size: number;
  content_type: string | null;
  created_at: string;
  type: "file";
}

export interface FolderContents {
  folder: FolderOut | null;
  breadcrumb: FolderOut[];
  folders: FolderOut[];
  files: FileOut[];
}

export function getDesktopId(): Promise<number> {
  return apiFetch<{ id: number }>(`/folders/desktop-id`).then((r) => r.id);
}

export function getContents(folderId: number | null): Promise<FolderContents> {
  const query = folderId != null ? `?folder_id=${folderId}` : "";
  return apiFetch<FolderContents>(`/folders/contents${query}`);
}

export function createFolder(name: string, parentId: number | null): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: parentId }),
  });
}

export function deleteFolder(id: number): Promise<void> {
  return apiFetch<void>(`/folders/${id}`, { method: "DELETE" });
}

export function deleteFile(id: number): Promise<void> {
  return apiFetch<void>(`/files/${id}`, { method: "DELETE" });
}

export function renameFolder(id: number, name: string): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function renameFile(id: number, name: string): Promise<FileOut> {
  return apiFetch<FileOut>(`/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function moveFolder(id: number, parentId: number | null): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId }),
  });
}

export function moveFile(id: number, folderId: number): Promise<FileOut> {
  return apiFetch<FileOut>(`/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export async function uploadFile(folderId: number, file: File): Promise<FileOut> {
  const form = new FormData();
  form.append("folder_id", String(folderId));
  form.append("file", file);
  return apiFetch<FileOut>(`/files/upload`, { method: "POST", body: form });
}

export function downloadUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/download`;
}

import { apiFetch, API_BASE } from "./api";

export interface FolderOut {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
  pos_x: number | null;
  pos_y: number | null;
  type: "folder";
}

export interface FileOut {
  id: number;
  name: string;
  folder_id: number;
  size: number;
  content_type: string | null;
  created_at: string;
  pos_x: number | null;
  pos_y: number | null;
  type: "file";
}

/** A free-form desktop icon position. */
export interface IconPos {
  x: number;
  y: number;
}

export interface FolderContents {
  folder: FolderOut | null;
  breadcrumb: FolderOut[];
  folders: FolderOut[];
  files: FileOut[];
}

export interface FileContent {
  id: number;
  name: string;
  folder_id: number;
  content_type: string | null;
  content: string;
}

/** An Office file an app should import instead of parsing natively. */
export interface ImportRequest {
  id: number;
  name: string;
  kind: OfficeKind;
  folderId: number;
}

/** content_type used for rich-text documents created by the word processor. */
export const DOC_MIME = "application/x-soweb-document";
/** content_type used for spreadsheets. */
export const SHEET_MIME = "application/x-soweb-sheet";
/** content_type used for slide decks. */
export const SLIDES_MIME = "application/x-soweb-slides";

/**
 * Native extensions are namespaced (".sodoc" rather than ".doc") so they never
 * collide with real Office files, which we now also open.
 */
export const DOC_EXT = ".sodoc";
export const SHEET_EXT = ".sosheet";
export const SLIDES_EXT = ".soslides";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const PDF_MIME = "application/pdf";
/** pdfSO project: the edit list that sits beside an exported PDF. */
export const PDFSO_MIME = "application/x-soweb-pdf";
export const PDFSO_EXT = ".pdfso";

type FileLike = { content_type: string | null; name: string };

const hasExt = (file: FileLike, ext: string) => file.name.toLowerCase().endsWith(ext);

/** Office file this maps to, if any — tells an app to run an importer. */
export type OfficeKind = "docx" | "xlsx" | "pptx" | "pdf";

export function officeKind(file: FileLike): OfficeKind | null {
  if (hasExt(file, ".docx") || file.content_type === DOCX_MIME) return "docx";
  if (hasExt(file, ".xlsx") || file.content_type === XLSX_MIME) return "xlsx";
  if (hasExt(file, ".pptx") || file.content_type === PPTX_MIME) return "pptx";
  // A .pdfso project is opened natively, not imported, so exclude it here.
  if (!hasExt(file, PDFSO_EXT) && (hasExt(file, ".pdf") || file.content_type === PDF_MIME))
    return "pdf";
  return null;
}

export function isPdfProject(file: FileLike): boolean {
  return file.content_type === PDFSO_MIME || hasExt(file, PDFSO_EXT);
}

export function isDocument(file: FileLike): boolean {
  return file.content_type === DOC_MIME || hasExt(file, DOC_EXT);
}

export function isSpreadsheet(file: FileLike): boolean {
  return file.content_type === SHEET_MIME || hasExt(file, SHEET_EXT);
}

export function isPresentation(file: FileLike): boolean {
  return file.content_type === SLIDES_MIME || hasExt(file, SLIDES_EXT);
}

/** Which desktop app opens this file on double-click, or null to download. */
export function appForFile(file: FileLike): string | null {
  const office = officeKind(file);
  if (office === "docx") return "text-editor";
  if (office === "xlsx") return "spreadsheet";
  if (office === "pptx") return "presentation";
  if (office === "pdf") return "pdf";
  if (isPdfProject(file)) return "pdf";
  if (isDocument(file)) return "text-editor";
  if (isSpreadsheet(file)) return "spreadsheet";
  if (isPresentation(file)) return "presentation";
  return null;
}

/** Emoji icon shown for a file based on its type. */
export function iconForFile(file: FileLike): string {
  const office = officeKind(file);
  if (office === "docx") return "📘";
  if (office === "xlsx") return "📗";
  if (office === "pptx") return "📙";
  if (office === "pdf") return "📕";
  if (isPdfProject(file)) return "📕";
  if (isDocument(file)) return "📝";
  if (isSpreadsheet(file)) return "📊";
  if (isPresentation(file)) return "📽️";
  return "📄";
}

/** Fetch a file's raw bytes (used to feed Office importers). */
export async function fetchFileBytes(id: number): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl(id));
  if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`);
  return res.arrayBuffer();
}

/** Store a generated binary (an exported Office file) inside SOWeb. */
export function uploadBlob(folderId: number, name: string, blob: Blob): Promise<FileOut> {
  return uploadFile(folderId, new File([blob], name, { type: blob.type }));
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

export function moveFolder(id: number, parentId: number | null, pos?: IconPos): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId, ...(pos ? { pos_x: pos.x, pos_y: pos.y } : {}) }),
  });
}

export function moveFile(id: number, folderId: number, pos?: IconPos): Promise<FileOut> {
  return apiFetch<FileOut>(`/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId, ...(pos ? { pos_x: pos.x, pos_y: pos.y } : {}) }),
  });
}

/** Reposition a desktop icon without touching its parent folder. */
export function setFolderPosition(id: number, pos: IconPos): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pos_x: pos.x, pos_y: pos.y }),
  });
}

export function setFilePosition(id: number, pos: IconPos): Promise<FileOut> {
  return apiFetch<FileOut>(`/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pos_x: pos.x, pos_y: pos.y }),
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

export function createTextFile(
  name: string,
  folderId: number,
  content: string,
  contentType: string = DOC_MIME,
): Promise<FileOut> {
  return apiFetch<FileOut>(`/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder_id: folderId, content, content_type: contentType }),
  });
}

export function getFileContent(id: number): Promise<FileContent> {
  return apiFetch<FileContent>(`/files/${id}/content`);
}

export function updateFileContent(id: number, content: string): Promise<FileOut> {
  return apiFetch<FileOut>(`/files/${id}/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

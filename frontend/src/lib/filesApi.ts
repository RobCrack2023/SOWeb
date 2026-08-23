import { apiFetch, API_BASE } from "./api";
import { authHeaders } from "./auth";

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

export interface TrashItem {
  kind: "file" | "folder";
  id: number;
  name: string;
  size: number | null;
  content_type: string | null;
  location: string;
  deleted_at: string;
}

export interface SearchHit {
  kind: "file" | "folder";
  id: number;
  name: string;
  folder_id: number | null;
  location: string;
  size: number | null;
  content_type: string | null;
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

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"];
const VIDEO_EXTS = [".mp4", ".webm", ".ogv", ".mov", ".mkv"];
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"];
const TEXT_EXTS = [
  ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".xml", ".yml", ".yaml",
  ".ini", ".cfg", ".conf", ".env", ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".h", ".cpp", ".cs", ".php", ".sh", ".bat", ".ps1", ".sql",
  ".html", ".htm", ".css", ".scss", ".toml", ".gitignore",
];

const anyExt = (file: FileLike, exts: string[]) => exts.some((e) => hasExt(file, e));

/** Media this can play or show, if any. */
export type MediaKind = "image" | "audio" | "video";

export function mediaKind(file: FileLike): MediaKind | null {
  const type = (file.content_type || "").toLowerCase();
  if (type.startsWith("image/") || anyExt(file, IMAGE_EXTS)) return "image";
  if (type.startsWith("video/") || anyExt(file, VIDEO_EXTS)) return "video";
  if (type.startsWith("audio/") || anyExt(file, AUDIO_EXTS)) return "audio";
  return null;
}

export function isPlainText(file: FileLike): boolean {
  const type = (file.content_type || "").toLowerCase();
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") {
    return true;
  }
  return anyExt(file, TEXT_EXTS);
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
  if (mediaKind(file)) return "viewer";
  // Checked after the native formats, whose extensions would also read as text.
  if (isPlainText(file)) return "code-editor";
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
  const media = mediaKind(file);
  if (media === "image") return "🖼️";
  if (media === "video") return "🎬";
  if (media === "audio") return "🎵";
  if (isPlainText(file)) return "📃";
  return "📄";
}

/** Fetch a file's raw bytes (used to feed Office importers). */
export async function fetchFileBytes(id: number): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl(id), { headers: authHeaders() });
  if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`);
  return res.arrayBuffer();
}

/**
 * Save a file to the real machine. The download URL needs an Authorization
 * header now, which a plain `window.open` can't send, so fetch the bytes and
 * hand them to the browser as a blob instead.
 */
export async function downloadToDisk(file: FileOut): Promise<void> {
  const bytes = await fetchFileBytes(file.id);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: file.content_type ?? "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Store a generated binary (an exported Office file) inside SOWeb. */
export function uploadBlob(folderId: number, name: string, blob: Blob): Promise<FileOut> {
  return uploadFile(folderId, new File([blob], name, { type: blob.type }));
}

/**
 * Overwrite an existing file's bytes, for apps that save a real binary format.
 * Uploading instead would leave a new copy behind on every save.
 */
export async function replaceFileBinary(
  fileId: number,
  name: string,
  blob: Blob,
): Promise<FileOut> {
  const form = new FormData();
  form.append("file", new File([blob], name, { type: blob.type }));
  return apiFetch<FileOut>(`/files/${fileId}/binary`, { method: "PUT", body: form });
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

// --- Papelera y búsqueda ---------------------------------------------------

export const listTrash = () => apiFetch<TrashItem[]>("/trash");

export const restoreTrashItem = (item: TrashItem) =>
  apiFetch<void>(`/trash/${item.kind === "folder" ? "folders" : "files"}/${item.id}/restore`, {
    method: "POST",
  });

export const purgeTrashItem = (item: TrashItem) =>
  apiFetch<void>(`/trash/${item.kind === "folder" ? "folders" : "files"}/${item.id}`, {
    method: "DELETE",
  });

export const emptyTrash = () => apiFetch<void>("/trash", { method: "DELETE" });

export const searchDrive = (query: string) =>
  apiFetch<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`);

// --- Compartir entre cuentas -----------------------------------------------

export interface ShareTarget {
  id: number;
  username: string;
}

export const listShareTargets = () => apiFetch<ShareTarget[]>("/users");

export const shareFile = (fileId: number, toUserId: number, note: string) =>
  apiFetch<FileOut>(`/files/${fileId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to_user_id: toUserId, note }),
  });

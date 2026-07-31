/**
 * Uploading files dragged in from the real desktop (Windows/Linux/macOS).
 *
 * Dropping a folder is supported through the non-standard but widely available
 * `webkitGetAsEntry` API, which lets us walk a directory tree and recreate it
 * inside SOWeb. Browsers without it still get flat multi-file uploads.
 */

import { createFolder, uploadFile } from "./filesApi";

export interface DropProgress {
  done: number;
  total: number;
  current: string;
}

export interface DropResult {
  files: number;
  folders: number;
  errors: string[];
}

/** A file to upload, along with the folder path it should land in. */
interface PlannedFile {
  file: File;
  path: string[];
}

/**
 * Snapshot the dragged entries. MUST run synchronously inside the drop
 * handler — the browser clears `dataTransfer.items` as soon as it returns.
 */
export function captureDrop(dt: DataTransfer): { entries: FileSystemEntry[]; files: File[] } {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  // Fallback for browsers without the entries API.
  return { entries, files: entries.length ? [] : Array.from(dt.files) };
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries yields at most ~100 per call; keep going until it's empty.
    const readBatch = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    readBatch();
  });
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Walk the dropped entries into a flat upload plan plus the folders to create. */
async function planUpload(
  entries: FileSystemEntry[],
  loose: File[],
): Promise<{ files: PlannedFile[]; dirs: string[][] }> {
  const files: PlannedFile[] = [];
  const dirs: string[][] = [];

  const visit = async (entry: FileSystemEntry, path: string[]) => {
    if (entry.isFile) {
      files.push({ file: await fileOf(entry as FileSystemFileEntry), path });
      return;
    }
    if (entry.isDirectory) {
      const here = [...path, entry.name];
      dirs.push(here);
      const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
      for (const child of children) await visit(child, here);
    }
  };

  for (const entry of entries) await visit(entry, []);
  for (const file of loose) files.push({ file, path: [] });

  return { files, dirs };
}

/**
 * Upload everything from a captured drop into `targetFolderId`, recreating any
 * dropped folder structure.
 */
export async function uploadDrop(
  captured: { entries: FileSystemEntry[]; files: File[] },
  targetFolderId: number,
  onProgress?: (p: DropProgress) => void,
): Promise<DropResult> {
  const { files, dirs } = await planUpload(captured.entries, captured.files);
  const result: DropResult = { files: 0, folders: 0, errors: [] };

  // Map a dropped folder path to the SOWeb folder id standing in for it.
  const folderIds = new Map<string, number>();
  folderIds.set("", targetFolderId);

  const folderIdFor = async (path: string[]): Promise<number> => {
    const key = path.join("/");
    const known = folderIds.get(key);
    if (known != null) return known;
    const parentId = await folderIdFor(path.slice(0, -1));
    const created = await createFolder(path[path.length - 1], parentId);
    folderIds.set(key, created.id);
    result.folders += 1;
    return created.id;
  };

  // Create folders first (shallowest first) so empty ones survive too.
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
    try {
      await folderIdFor(dir);
    } catch (err) {
      result.errors.push(`${dir.join("/")}: ${err}`);
    }
  }

  let done = 0;
  for (const planned of files) {
    onProgress?.({ done, total: files.length, current: planned.file.name });
    try {
      await uploadFile(await folderIdFor(planned.path), planned.file);
      result.files += 1;
    } catch (err) {
      result.errors.push(`${planned.file.name}: ${err}`);
    }
    done += 1;
    onProgress?.({ done, total: files.length, current: planned.file.name });
  }

  return result;
}

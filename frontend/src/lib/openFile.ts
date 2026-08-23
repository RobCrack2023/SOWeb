import { appForFile, downloadToDisk, mediaKind, officeKind, type FileOut } from "./filesApi";
import { getApp } from "../apps/registry";
import { useWindowStore } from "../windows/windowStore";

/**
 * Open a file with whatever app handles it, or save it to disk when nothing
 * does. Both the desktop and the explorer route through here so a new file
 * type only has to be taught once.
 */
export function openFileWithApp(file: FileOut): void {
  const appId = appForFile(file);
  if (!appId) {
    downloadToDisk(file).catch((err) => window.alert(String(err)));
    return;
  }

  const app = getApp(appId);
  if (!app) return;
  const { openApp } = useWindowStore.getState();

  const office = officeKind(file);
  const media = mediaKind(file);

  let props: Record<string, unknown>;
  if (appId === "viewer") {
    props = { fileId: file.id, name: file.name, contentType: file.content_type, kind: media };
  } else if (appId === "code-editor") {
    props = {
      fileId: file.id,
      folderId: file.folder_id,
      name: file.name,
      contentType: file.content_type,
    };
  } else if (office) {
    // Office formats are imported rather than opened natively.
    props = { importFrom: { id: file.id, name: file.name, kind: office, folderId: file.folder_id } };
  } else {
    props = { fileId: file.id };
  }

  openApp(appId, {
    title: app.title,
    ...app.defaultSize,
    multiInstance: true,
    props,
  });
}

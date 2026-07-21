import { useCallback, useEffect, useState, type DragEvent, type MouseEvent } from "react";
import { APPS } from "../apps/registry";
import { useWindowStore } from "../windows/windowStore";
import { Window } from "../windows/Window";
import { DesktopIcon } from "./DesktopIcon";
import { Taskbar } from "./Taskbar";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { nextFolderName } from "../lib/names";
import { startDrag, readDrag, type DndPayload } from "../lib/dnd";
import {
  createFolder,
  deleteFile,
  deleteFolder,
  downloadUrl,
  getContents,
  getDesktopId,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  uploadFile,
  type FolderContents,
} from "../lib/filesApi";
import styles from "./Desktop.module.css";

type Renaming = { type: "folder" | "file"; id: number } | null;

export function Desktop() {
  const { windows, openApp } = useWindowStore();
  const [desktopId, setDesktopId] = useState<number | null>(null);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);

  const load = useCallback((id: number) => {
    getContents(id).then(setContents);
  }, []);

  useEffect(() => {
    getDesktopId().then((id) => {
      setDesktopId(id);
      load(id);
    });
  }, [load]);

  const openFileExplorerAt = (folderId: number | null) => {
    openApp("file-explorer", {
      title: "Explorador de archivos",
      width: 780,
      height: 520,
      props: { initialFolderId: folderId },
    });
  };

  const handleNewFolder = () => {
    if (desktopId == null || !contents) return;
    const name = nextFolderName(contents.folders.map((f) => f.name));
    createFolder(name, desktopId).then((created) => {
      load(desktopId);
      setRenaming({ type: "folder", id: created.id });
    });
  };

  const handleUpload = () => {
    if (desktopId == null) return;
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      uploadFile(desktopId, file).then(() => load(desktopId));
    };
    input.click();
  };

  const commitFolderRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (desktopId == null || name === currentName) return;
    renameFolder(id, name).then(() => load(desktopId));
  };

  const commitFileRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (desktopId == null || name === currentName) return;
    renameFile(id, name).then(() => load(desktopId));
  };

  const handleDeleteFolder = (id: number) => {
    if (!window.confirm("¿Eliminar esta carpeta y todo su contenido?") || desktopId == null) return;
    deleteFolder(id).then(() => load(desktopId));
  };

  const handleDeleteFile = (id: number) => {
    if (!window.confirm("¿Eliminar este archivo?") || desktopId == null) return;
    deleteFile(id).then(() => load(desktopId));
  };

  const movePayloadInto = (payload: DndPayload | null, targetFolderId: number) => {
    if (!payload || desktopId == null) return;
    if (payload.kind === "folder") {
      if (payload.id === targetFolderId) return;
      moveFolder(payload.id, targetFolderId)
        .then(() => load(desktopId))
        .catch((err) => window.alert(String(err)));
    } else {
      moveFile(payload.id, targetFolderId)
        .then(() => load(desktopId))
        .catch((err) => window.alert(String(err)));
    }
  };

  const handleDropOnDesktop = (e: DragEvent) => {
    e.preventDefault();
    if (desktopId == null) return;
    movePayloadInto(readDrag(e), desktopId);
  };

  const openBackgroundMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "📁 Nueva carpeta", onClick: handleNewFolder },
        { label: "⬆ Subir archivo", onClick: handleUpload },
        { label: "🔄 Actualizar", onClick: () => desktopId != null && load(desktopId) },
      ],
    });
  };

  const openFolderMenu = (e: MouseEvent, folder: { id: number }) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "📂 Abrir", onClick: () => openFileExplorerAt(folder.id) },
        { label: "✏️ Renombrar", onClick: () => setRenaming({ type: "folder", id: folder.id }) },
        { label: "🗑️ Eliminar", onClick: () => handleDeleteFolder(folder.id), danger: true },
      ],
    });
  };

  const openFileMenu = (e: MouseEvent, file: { id: number }) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "⬇ Descargar", onClick: () => window.open(downloadUrl(file.id), "_blank") },
        { label: "✏️ Renombrar", onClick: () => setRenaming({ type: "file", id: file.id }) },
        { label: "🗑️ Eliminar", onClick: () => handleDeleteFile(file.id), danger: true },
      ],
    });
  };

  return (
    <div
      className={styles.desktop}
      onContextMenu={openBackgroundMenu}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropOnDesktop}
    >
      <div className={styles.icons}>
        {APPS.map((app) => (
          <DesktopIcon
            key={app.id}
            icon={app.icon}
            label={app.title}
            onOpen={() => openApp(app.id, { title: app.title, ...app.defaultSize })}
          />
        ))}

        {contents?.folders.map((folder) => (
          <DesktopIcon
            key={`folder-${folder.id}`}
            icon="📁"
            label={folder.name}
            onOpen={() => openFileExplorerAt(folder.id)}
            onContextMenu={(e) => openFolderMenu(e, folder)}
            editing={renaming?.type === "folder" && renaming.id === folder.id}
            onRenameCommit={(name) => commitFolderRename(folder.id, folder.name, name)}
            onRenameCancel={() => setRenaming(null)}
            draggable
            onDragStart={(e) => startDrag(e, { kind: "folder", id: folder.id })}
            onDropItem={(payload) => movePayloadInto(payload, folder.id)}
          />
        ))}

        {contents?.files.map((file) => (
          <DesktopIcon
            key={`file-${file.id}`}
            icon="📄"
            label={file.name}
            onOpen={() => window.open(downloadUrl(file.id), "_blank")}
            onContextMenu={(e) => openFileMenu(e, file)}
            editing={renaming?.type === "file" && renaming.id === file.id}
            onRenameCommit={(name) => commitFileRename(file.id, file.name, name)}
            onRenameCancel={() => setRenaming(null)}
            draggable
            onDragStart={(e) => startDrag(e, { kind: "file", id: file.id })}
          />
        ))}
      </div>

      <div className={styles.windowLayer}>
        {windows.map((w) => (
          <Window key={w.id} win={w} />
        ))}
      </div>

      <Taskbar />

      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

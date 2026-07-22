import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { APPS, getApp } from "../apps/registry";
import { useWindowStore } from "../windows/windowStore";
import { Window } from "../windows/Window";
import { DesktopIcon } from "./DesktopIcon";
import { Taskbar } from "./Taskbar";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { nextFolderName } from "../lib/names";
import { startDrag, readDrag, type DndPayload } from "../lib/dnd";
import { useFsStore } from "../lib/fsStore";
import {
  appForFile,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadUrl,
  getContents,
  getDesktopId,
  iconForFile,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  uploadFile,
  type FileOut,
  type FolderContents,
} from "../lib/filesApi";
import styles from "./Desktop.module.css";

type Renaming = { type: "folder" | "file"; id: number } | null;
type Marquee = { x: number; y: number; w: number; h: number } | null;

export function Desktop() {
  const { windows, openApp } = useWindowStore();
  const [desktopId, setDesktopId] = useState<number | null>(null);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const fsVersion = useFsStore((s) => s.version);

  const selectIcon = (key: string, e: MouseEvent) => {
    const additive = e.ctrlKey || e.metaKey;
    setSelected((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }
      return new Set([key]);
    });
  };

  const startMarquee = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-icon-key]") || t.closest("[data-window-layer]")) return;

    const additive = e.ctrlKey || e.metaKey;
    const base = additive ? new Set(selected) : new Set<string>();
    if (!additive) setSelected(new Set());
    const start = { x: e.clientX, y: e.clientY };

    const onMove = (ev: globalThis.MouseEvent) => {
      const left = Math.min(start.x, ev.clientX);
      const top = Math.min(start.y, ev.clientY);
      const right = Math.max(start.x, ev.clientX);
      const bottom = Math.max(start.y, ev.clientY);
      setMarquee({ x: left, y: top, w: right - left, h: bottom - top });

      const next = new Set(base);
      iconsRef.current?.querySelectorAll("[data-icon-key]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const intersects = !(r.right < left || r.left > right || r.bottom < top || r.top > bottom);
        const key = el.getAttribute("data-icon-key");
        if (intersects && key) next.add(key);
      });
      setSelected(next);
    };

    const onUp = () => {
      setMarquee(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const load = useCallback((id: number) => {
    getContents(id).then(setContents);
  }, []);

  useEffect(() => {
    getDesktopId().then(setDesktopId);
  }, []);

  // Reload desktop contents when it's ready or when any app changes the filesystem.
  useEffect(() => {
    if (desktopId != null) load(desktopId);
  }, [desktopId, fsVersion, load]);

  const openFileExplorerAt = (folderId: number | null) => {
    openApp("file-explorer", {
      title: "Explorador de archivos",
      width: 780,
      height: 520,
      props: { initialFolderId: folderId },
    });
  };

  const openFile = (file: FileOut) => {
    const appId = appForFile(file);
    if (!appId) {
      window.open(downloadUrl(file.id), "_blank");
      return;
    }
    const app = getApp(appId)!;
    openApp(appId, { title: app.title, ...app.defaultSize, multiInstance: true, props: { fileId: file.id } });
  };

  const newFileWith = (appId: string) => {
    if (desktopId == null) return;
    const app = getApp(appId)!;
    openApp(appId, {
      title: app.title,
      ...app.defaultSize,
      multiInstance: true,
      props: { folderId: desktopId },
    });
  };

  const handleNewFolder = () => {
    if (desktopId == null || !contents) return;
    const name = nextFolderName(contents.folders.map((f) => f.name));
    createFolder(name, desktopId).then((created) => {
      notifyChange();
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
      uploadFile(desktopId, file).then(notifyChange);
    };
    input.click();
  };

  const commitFolderRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (desktopId == null || name === currentName) return;
    renameFolder(id, name).then(notifyChange);
  };

  const commitFileRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (desktopId == null || name === currentName) return;
    renameFile(id, name).then(notifyChange);
  };

  const handleDeleteFolder = (id: number) => {
    if (!window.confirm("¿Eliminar esta carpeta y todo su contenido?") || desktopId == null) return;
    deleteFolder(id).then(notifyChange);
  };

  const handleDeleteFile = (id: number) => {
    if (!window.confirm("¿Eliminar este archivo?") || desktopId == null) return;
    deleteFile(id).then(notifyChange);
  };

  const movePayloadInto = (payload: DndPayload | null, targetFolderId: number) => {
    if (!payload || desktopId == null) return;
    if (payload.kind === "folder") {
      if (payload.id === targetFolderId) return;
      moveFolder(payload.id, targetFolderId)
        .then(notifyChange)
        .catch((err) => window.alert(String(err)));
    } else {
      moveFile(payload.id, targetFolderId)
        .then(notifyChange)
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
        { label: "📝 Nuevo documento", onClick: () => newFileWith("text-editor") },
        { label: "📊 Nueva hoja de cálculo", onClick: () => newFileWith("spreadsheet") },
        { label: "📁 Nueva carpeta", onClick: handleNewFolder },
        { label: "⬆ Subir archivo", onClick: handleUpload },
        { label: "🔄 Actualizar", onClick: () => notifyChange() },
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

  const openFileMenu = (e: MouseEvent, file: FileOut) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(appForFile(file)
          ? [{ label: "📂 Abrir", onClick: () => openFile(file) }]
          : []),
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
      onMouseDown={startMarquee}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropOnDesktop}
    >
      <div className={styles.icons} ref={iconsRef}>
        {APPS.map((app) => {
          const key = `app:${app.id}`;
          return (
            <DesktopIcon
              key={app.id}
              icon={app.icon}
              label={app.title}
              onOpen={() =>
                openApp(app.id, { title: app.title, ...app.defaultSize, multiInstance: app.multiInstance })
              }
              selectionKey={key}
              selected={selected.has(key)}
              onSelect={(e) => selectIcon(key, e)}
            />
          );
        })}

        {contents?.folders.map((folder) => {
          const key = `folder:${folder.id}`;
          return (
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
              selectionKey={key}
              selected={selected.has(key)}
              onSelect={(e) => selectIcon(key, e)}
            />
          );
        })}

        {contents?.files.map((file) => {
          const key = `file:${file.id}`;
          return (
            <DesktopIcon
              key={`file-${file.id}`}
              icon={iconForFile(file)}
              label={file.name}
              onOpen={() => openFile(file)}
              onContextMenu={(e) => openFileMenu(e, file)}
              editing={renaming?.type === "file" && renaming.id === file.id}
              onRenameCommit={(name) => commitFileRename(file.id, file.name, name)}
              onRenameCancel={() => setRenaming(null)}
              draggable
              onDragStart={(e) => startDrag(e, { kind: "file", id: file.id })}
              selectionKey={key}
              selected={selected.has(key)}
              onSelect={(e) => selectIcon(key, e)}
            />
          );
        })}
      </div>

      {marquee && (
        <div
          className={styles.marquee}
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      <div className={styles.windowLayer} data-window-layer>
        {windows.map((w) => (
          <Window key={w.id} win={w} />
        ))}
      </div>

      <Taskbar />

      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

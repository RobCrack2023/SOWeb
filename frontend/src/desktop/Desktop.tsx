import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { appsFor, getApp } from "../apps/registry";
import { useWindowStore } from "../windows/windowStore";
import { Window } from "../windows/Window";
import { DesktopIcon } from "./DesktopIcon";
import { Taskbar } from "./Taskbar";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { nextFolderName } from "../lib/names";
import { startDrag, readDrag, type DndPayload } from "../lib/dnd";
import { useExternalDrop } from "../lib/useExternalDrop";
import { openFileWithApp } from "../lib/openFile";
import type { User } from "../lib/auth";
import { DropOverlay } from "../ui/DropOverlay";
import { useFsStore } from "../lib/fsStore";
import {
  CELL_W,
  cellKey,
  loadAppPositions,
  maxRows,
  nextFreeCell,
  saveAppPosition,
  snapToGrid,
} from "../lib/desktopLayout";
import {
  appForFile,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadToDisk,
  getContents,
  getDesktopId,
  iconForFile,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  setFilePosition,
  setFolderPosition,
  uploadFile,
  type FileOut,
  type FolderContents,
  type IconPos,
} from "../lib/filesApi";
import styles from "./Desktop.module.css";

type Renaming = { type: "folder" | "file"; id: number } | null;
type Marquee = { x: number; y: number; w: number; h: number } | null;

export function Desktop({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { windows, openApp } = useWindowStore();
  const [desktopId, setDesktopId] = useState<number | null>(null);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [layout, setLayout] = useState<{
    apps: Record<string, IconPos>;
    folders: Record<number, IconPos>;
    files: Record<number, IconPos>;
  }>({ apps: {}, folders: {}, files: {} });
  const iconsRef = useRef<HTMLDivElement>(null);
  const visibleApps = useMemo(() => appsFor(user.is_admin), [user.is_admin]);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const fsVersion = useFsStore((s) => s.version);
  const extDrop = useExternalDrop(() => notifyChange());

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

  // Any icon without a saved position (new files, or the very first run) gets
  // slotted into the next free grid cell and that position is persisted, so
  // dragging is the only thing that ever moves it after that.
  useEffect(() => {
    if (!contents) return;
    const rows = maxRows(window.innerHeight);
    const occupied = new Set<string>();
    const apps: Record<string, IconPos> = {};
    const folders: Record<number, IconPos> = {};
    const files: Record<number, IconPos> = {};
    const savedAppPositions = loadAppPositions(user.id);

    for (const app of visibleApps) {
      const pos = savedAppPositions[app.id];
      if (pos) {
        apps[app.id] = pos;
        occupied.add(cellKey(pos));
      }
    }
    for (const folder of contents.folders) {
      if (folder.pos_x != null && folder.pos_y != null) {
        const pos = { x: folder.pos_x, y: folder.pos_y };
        folders[folder.id] = pos;
        occupied.add(cellKey(pos));
      }
    }
    for (const file of contents.files) {
      if (file.pos_x != null && file.pos_y != null) {
        const pos = { x: file.pos_x, y: file.pos_y };
        files[file.id] = pos;
        occupied.add(cellKey(pos));
      }
    }

    for (const app of visibleApps) {
      if (apps[app.id]) continue;
      const pos = nextFreeCell(occupied, rows);
      apps[app.id] = pos;
      saveAppPosition(user.id, app.id, pos);
    }
    for (const folder of contents.folders) {
      if (folders[folder.id]) continue;
      const pos = nextFreeCell(occupied, rows);
      folders[folder.id] = pos;
      setFolderPosition(folder.id, pos).catch(() => {});
    }
    for (const file of contents.files) {
      if (files[file.id]) continue;
      const pos = nextFreeCell(occupied, rows);
      files[file.id] = pos;
      setFilePosition(file.id, pos).catch(() => {});
    }

    setLayout({ apps, folders, files });
  }, [contents, user.id, visibleApps]);

  const openFileExplorerAt = (folderId: number | null) => {
    openApp("file-explorer", {
      title: "Explorador de archivos",
      width: 780,
      height: 520,
      props: { initialFolderId: folderId },
    });
  };

  const openFile = (file: FileOut) => openFileWithApp(file);

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

  const movePayloadInto = (payload: DndPayload | null, targetFolderId: number, pos?: IconPos) => {
    if (!payload || desktopId == null || payload.kind === "app") return;
    if (payload.kind === "folder") {
      if (payload.id === targetFolderId && !pos) return;
      moveFolder(payload.id, targetFolderId, pos)
        .then(notifyChange)
        .catch((err) => window.alert(String(err)));
    } else {
      moveFile(payload.id, targetFolderId, pos)
        .then(notifyChange)
        .catch((err) => window.alert(String(err)));
    }
  };

  /** A drop on empty desktop space: either a reposition, or a move onto the Desktop folder. */
  const handleDropOnDesktop = (e: DragEvent) => {
    if (extDrop.handleDrop(e, desktopId)) return;
    e.preventDefault();
    const payload = readDrag(e);
    if (!payload) return;
    const pos = snapToGrid(e.clientX - CELL_W / 2, e.clientY - CELL_W / 2, window.innerWidth, window.innerHeight);

    if (payload.kind === "app") {
      saveAppPosition(user.id, payload.id, pos);
      setLayout((prev) => ({ ...prev, apps: { ...prev.apps, [payload.id]: pos } }));
      return;
    }
    if (desktopId == null) return;
    setLayout((prev) =>
      payload.kind === "folder"
        ? { ...prev, folders: { ...prev.folders, [payload.id]: pos } }
        : { ...prev, files: { ...prev.files, [payload.id]: pos } },
    );
    movePayloadInto(payload, desktopId, pos);
  };

  /** A drop landing on a folder icon: upload into it, or move the item into it. */
  const handleDropOnFolder = (e: DragEvent, folderId: number) => {
    if (extDrop.handleDrop(e, folderId)) return;
    e.preventDefault();
    e.stopPropagation();
    movePayloadInto(readDrag(e), folderId);
  };

  const openBackgroundMenu = (e: MouseEvent) => {
    // A right-click inside an app window belongs to that app — or to the
    // browser, whose native menu is the only place spelling suggestions exist
    // (there is no web API to read them). Swallowing it here would remove them.
    if ((e.target as HTMLElement).closest("[data-window-layer]")) return;
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "📝 Nuevo documento", onClick: () => newFileWith("text-editor") },
        { label: "📊 Nueva hoja de cálculo", onClick: () => newFileWith("spreadsheet") },
        { label: "📽️ Nueva presentación", onClick: () => newFileWith("presentation") },
        { label: "📕 Abrir PDF", onClick: () => newFileWith("pdf") },
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
        {
          label: "⬇ Descargar",
          onClick: () => downloadToDisk(file).catch((err) => window.alert(String(err))),
        },
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
      onDragEnter={extDrop.onDragEnter}
      onDragLeave={extDrop.onDragLeave}
      onDrop={handleDropOnDesktop}
    >
      <div className={styles.icons} ref={iconsRef}>
        {visibleApps.map((app) => {
          const key = `app:${app.id}`;
          const pos = layout.apps[app.id];
          if (!pos) return null;
          return (
            <DesktopIcon
              key={app.id}
              icon={app.icon}
              label={app.title}
              onOpen={() =>
                openApp(app.id, { title: app.title, ...app.defaultSize, multiInstance: app.multiInstance })
              }
              draggable
              onDragStart={(e) => startDrag(e, { kind: "app", id: app.id })}
              selectionKey={key}
              selected={selected.has(key)}
              onSelect={(e) => selectIcon(key, e)}
              style={{ left: pos.x, top: pos.y }}
            />
          );
        })}

        {contents?.folders.map((folder) => {
          const key = `folder:${folder.id}`;
          const pos = layout.folders[folder.id];
          if (!pos) return null;
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
              onDropItem={(e) => handleDropOnFolder(e, folder.id)}
              selectionKey={key}
              selected={selected.has(key)}
              onSelect={(e) => selectIcon(key, e)}
              style={{ left: pos.x, top: pos.y }}
            />
          );
        })}

        {contents?.files.map((file) => {
          const key = `file:${file.id}`;
          const pos = layout.files[file.id];
          if (!pos) return null;
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
              style={{ left: pos.x, top: pos.y }}
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

      <Taskbar user={user} onLogout={onLogout} />

      <DropOverlay
        visible={extDrop.dragging}
        label="Soltá para copiar al Escritorio"
        progress={extDrop.progress}
      />

      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

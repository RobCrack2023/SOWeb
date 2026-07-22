import { useCallback, useEffect, useRef, useState } from "react";
import {
  appForFile,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadUrl,
  getContents,
  iconForFile,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  uploadFile,
  type FolderContents,
  type FolderOut,
  type FileOut,
} from "../../lib/filesApi";
import { ContextMenu, type ContextMenuState } from "../../ui/ContextMenu";
import { InlineEditLabel } from "../../ui/InlineEditLabel";
import { nextFolderName } from "../../lib/names";
import { startDrag, readDrag, type DndPayload } from "../../lib/dnd";
import { useWindowStore } from "../../windows/windowStore";
import { useFsStore } from "../../lib/fsStore";
import { getApp } from "../registry";
import { FolderTree } from "./FolderTree";
import styles from "./FileExplorer.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

type Renaming = { type: "folder" | "file"; id: number } | null;
type View = "list" | "grid";

export interface FileExplorerProps {
  initialFolderId?: number | null;
}

export function FileExplorer({ initialFolderId = null }: FileExplorerProps) {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(initialFolderId);
  const [history, setHistory] = useState<(number | null)[]>([initialFolderId]);
  const [histIndex, setHistIndex] = useState(0);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [dragOverId, setDragOverId] = useState<number | "root" | null>(null);
  const [view, setView] = useState<View>("list");
  const [reloadKey, setReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openApp = useWindowStore((s) => s.openApp);
  const notifyChange = useFsStore((s) => s.notifyChange);
  const fsVersion = useFsStore((s) => s.version);

  const openFileItem = (file: FileOut) => {
    const appId = appForFile(file);
    if (!appId) {
      window.open(downloadUrl(file.id), "_blank");
      return;
    }
    const app = getApp(appId)!;
    openApp(appId, { title: app.title, ...app.defaultSize, multiInstance: true, props: { fileId: file.id } });
  };

  const newFileWith = (appId: string) => {
    if (currentFolderId == null) {
      window.alert("Entrá a una carpeta para crear un archivo.");
      return;
    }
    const app = getApp(appId)!;
    openApp(appId, {
      title: app.title,
      ...app.defaultSize,
      multiInstance: true,
      props: { folderId: currentFolderId },
    });
  };

  // Reused windows (e.g. re-opening a desktop folder into an already-open
  // Explorer) update this prop; reset navigation history when that happens.
  useEffect(() => {
    setCurrentFolderId(initialFolderId);
    setHistory([initialFolderId]);
    setHistIndex(0);
  }, [initialFolderId]);

  const load = useCallback((folderId: number | null) => {
    getContents(folderId)
      .then((data) => {
        setContents(data);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Reload when navigating or when any app changes the filesystem.
  useEffect(() => {
    load(currentFolderId);
    setReloadKey((k) => k + 1);
  }, [currentFolderId, fsVersion, load]);

  const refresh = () => notifyChange();

  const navigate = (id: number | null) => {
    setHistory((h) => [...h.slice(0, histIndex + 1), id]);
    setHistIndex((i) => i + 1);
    setCurrentFolderId(id);
  };

  const goBack = () => {
    if (histIndex === 0) return;
    const i = histIndex - 1;
    setHistIndex(i);
    setCurrentFolderId(history[i]);
  };

  const goForward = () => {
    if (histIndex >= history.length - 1) return;
    const i = histIndex + 1;
    setHistIndex(i);
    setCurrentFolderId(history[i]);
  };

  const goUp = () => {
    if (!contents?.folder) return;
    navigate(contents.folder.parent_id);
  };

  const handleNewFolder = () => {
    if (!contents) return;
    const name = nextFolderName(contents.folders.map((f) => f.name));
    createFolder(name, currentFolderId).then((created) => {
      refresh();
      setRenaming({ type: "folder", id: created.id });
    });
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || currentFolderId == null) return;
    await uploadFile(currentFolderId, file);
    refresh();
  };

  const handleDeleteFolder = async (id: number) => {
    if (!window.confirm("¿Eliminar esta carpeta y todo su contenido?")) return;
    await deleteFolder(id);
    refresh();
  };

  const handleDeleteFile = async (id: number) => {
    if (!window.confirm("¿Eliminar este archivo?")) return;
    await deleteFile(id);
    refresh();
  };

  const commitFolderRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (name === currentName) return;
    renameFolder(id, name).then(refresh);
  };

  const commitFileRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (name === currentName) return;
    renameFile(id, name).then(refresh);
  };

  const movePayloadInto = (payload: DndPayload | null, targetFolderId: number | null) => {
    if (!payload) return;
    if (payload.kind === "file" && targetFolderId == null) {
      window.alert("Los archivos no pueden estar sueltos en la raíz, movelos dentro de una carpeta.");
      return;
    }
    if (payload.kind === "folder") {
      if (payload.id === targetFolderId) return;
      moveFolder(payload.id, targetFolderId)
        .then(refresh)
        .catch((err) => window.alert(String(err)));
    } else {
      moveFile(payload.id, targetFolderId as number)
        .then(refresh)
        .catch((err) => window.alert(String(err)));
    }
  };

  const openBackgroundMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(currentFolderId != null
          ? [
              { label: "📝 Nuevo documento", onClick: () => newFileWith("text-editor") },
              { label: "📊 Nueva hoja de cálculo", onClick: () => newFileWith("spreadsheet") },
            ]
          : []),
        { label: "📁 Nueva carpeta", onClick: handleNewFolder },
        ...(currentFolderId != null
          ? [{ label: "⬆ Subir archivo", onClick: handleUploadClick }]
          : []),
        { label: "🔄 Actualizar", onClick: refresh },
      ],
    });
  };

  const openFolderMenu = (e: React.MouseEvent, folder: { id: number }) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "📂 Abrir", onClick: () => navigate(folder.id) },
        { label: "✏️ Renombrar", onClick: () => setRenaming({ type: "folder", id: folder.id }) },
        { label: "🗑️ Eliminar", onClick: () => handleDeleteFolder(folder.id), danger: true },
      ],
    });
  };

  const openFileMenu = (e: React.MouseEvent, file: FileOut) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(appForFile(file)
          ? [{ label: "📂 Abrir", onClick: () => openFileItem(file) }]
          : []),
        { label: "⬇ Descargar", onClick: () => window.open(downloadUrl(file.id), "_blank") },
        { label: "✏️ Renombrar", onClick: () => setRenaming({ type: "file", id: file.id }) },
        { label: "🗑️ Eliminar", onClick: () => handleDeleteFile(file.id), danger: true },
      ],
    });
  };

  const renderFolder = (folder: FolderOut) => {
    const editing = renaming?.type === "folder" && renaming.id === folder.id;
    return (
      <div
        key={`folder-${folder.id}`}
        className={`${view === "grid" ? styles.gridItem : styles.item} ${
          dragOverId === folder.id ? styles.itemDragOver : ""
        }`}
        onDoubleClick={editing ? undefined : () => navigate(folder.id)}
        onContextMenu={(e) => openFolderMenu(e, folder)}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "folder", id: folder.id })}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={() => setDragOverId(folder.id)}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOverId(null);
          movePayloadInto(readDrag(e), folder.id);
        }}
      >
        <span className={view === "grid" ? styles.gridIcon : styles.itemIcon}>📁</span>
        <InlineEditLabel
          value={folder.name}
          editing={editing}
          onCommit={(name) => commitFolderRename(folder.id, folder.name, name)}
          onCancel={() => setRenaming(null)}
          className={editing ? styles.itemNameInput : view === "grid" ? styles.gridName : styles.itemName}
        />
        {view === "list" && <span className={styles.itemMeta}></span>}
        {view === "list" && (
          <button
            className={styles.deleteBtn}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteFolder(folder.id);
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const renderFile = (file: FileOut) => {
    const editing = renaming?.type === "file" && renaming.id === file.id;
    return (
      <div
        key={`file-${file.id}`}
        className={view === "grid" ? styles.gridItem : styles.item}
        onDoubleClick={editing ? undefined : () => openFileItem(file)}
        onContextMenu={(e) => openFileMenu(e, file)}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "file", id: file.id })}
      >
        <span className={view === "grid" ? styles.gridIcon : styles.itemIcon}>
          {iconForFile(file)}
        </span>
        <InlineEditLabel
          value={file.name}
          editing={editing}
          onCommit={(name) => commitFileRename(file.id, file.name, name)}
          onCancel={() => setRenaming(null)}
          className={editing ? styles.itemNameInput : view === "grid" ? styles.gridName : styles.itemName}
        />
        {view === "list" && <span className={styles.itemMeta}>{formatSize(file.size)}</span>}
        {view === "list" && (
          <button
            className={styles.deleteBtn}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteFile(file.id);
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  const canBack = histIndex > 0;
  const canForward = histIndex < history.length - 1;
  const canUp = !!contents?.folder;

  return (
    <div
      className={styles.explorer}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        movePayloadInto(readDrag(e), currentFolderId);
      }}
    >
      <div className={styles.toolbar}>
        <div className={styles.navGroup}>
          <button className={styles.navBtn} onClick={goBack} disabled={!canBack} title="Atrás">
            ←
          </button>
          <button className={styles.navBtn} onClick={goForward} disabled={!canForward} title="Adelante">
            →
          </button>
          <button className={styles.navBtn} onClick={goUp} disabled={!canUp} title="Arriba">
            ↑
          </button>
        </div>
        <div className={styles.sep} />
        <button onClick={handleNewFolder}>+ Nueva carpeta</button>
        <button onClick={handleUploadClick} disabled={currentFolderId == null} title={currentFolderId == null ? "Entrá a una carpeta para subir archivos" : ""}>
          ⬆ Subir archivo
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} />
        <div className={styles.spacer} />
        <div className={styles.viewToggle}>
          <button
            className={view === "list" ? styles.viewActive : ""}
            onClick={() => setView("list")}
            title="Ver como lista"
          >
            ☰
          </button>
          <button
            className={view === "grid" ? styles.viewActive : ""}
            onClick={() => setView("grid")}
            title="Ver como íconos"
          >
            ▦
          </button>
        </div>
      </div>

      <div className={styles.breadcrumb}>
        <button
          className={`${styles.crumb} ${dragOverId === "root" ? styles.crumbDragOver : ""}`}
          onClick={() => navigate(null)}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setDragOverId("root")}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverId(null);
            movePayloadInto(readDrag(e), null);
          }}
        >
          🏠 Mi unidad
        </button>
        {contents?.breadcrumb.map((f) => (
          <span key={f.id} className={styles.crumbGroup}>
            <span className={styles.crumbSep}>/</span>
            <button
              className={`${styles.crumb} ${dragOverId === f.id ? styles.crumbDragOver : ""}`}
              onClick={() => navigate(f.id)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setDragOverId(f.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverId(null);
                movePayloadInto(readDrag(e), f.id);
              }}
            >
              {f.name}
            </button>
          </span>
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.sidebar}>
          <FolderTree currentFolderId={currentFolderId} reloadKey={reloadKey} onNavigate={navigate} />
        </div>

        <div
          className={`${styles.main} ${view === "grid" ? styles.mainGrid : ""}`}
          onContextMenu={openBackgroundMenu}
        >
          {!contents && <div className={styles.loading}>Cargando…</div>}
          {contents && contents.folders.length === 0 && contents.files.length === 0 && (
            <div className={styles.empty}>
              {currentFolderId == null
                ? "No hay carpetas todavía. Creá una para empezar (clic derecho aquí)."
                : "Esta carpeta está vacía."}
            </div>
          )}
          {contents?.folders.map(renderFolder)}
          {contents?.files.map(renderFile)}
        </div>
      </div>

      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

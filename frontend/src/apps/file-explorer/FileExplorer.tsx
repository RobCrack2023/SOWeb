import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFolder,
  deleteFile,
  deleteFolder,
  downloadUrl,
  getContents,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  uploadFile,
  type FolderContents,
} from "../../lib/filesApi";
import { ContextMenu, type ContextMenuState } from "../../ui/ContextMenu";
import { InlineEditLabel } from "../../ui/InlineEditLabel";
import { nextFolderName } from "../../lib/names";
import { startDrag, readDrag, type DndPayload } from "../../lib/dnd";
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

export interface FileExplorerProps {
  initialFolderId?: number | null;
}

export function FileExplorer({ initialFolderId = null }: FileExplorerProps) {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(initialFolderId);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [dragOverId, setDragOverId] = useState<number | "root" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reused windows (e.g. re-opening a desktop folder into an already-open
  // Explorer) update this prop rather than remounting the component.
  useEffect(() => {
    setCurrentFolderId(initialFolderId);
  }, [initialFolderId]);

  const load = useCallback((folderId: number | null) => {
    getContents(folderId)
      .then((data) => {
        setContents(data);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load(currentFolderId);
  }, [currentFolderId, load]);

  const handleNewFolder = () => {
    if (!contents) return;
    const name = nextFolderName(contents.folders.map((f) => f.name));
    createFolder(name, currentFolderId).then((created) => {
      load(currentFolderId);
      setRenaming({ type: "folder", id: created.id });
    });
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || currentFolderId == null) return;
    await uploadFile(currentFolderId, file);
    load(currentFolderId);
  };

  const handleDeleteFolder = async (id: number) => {
    if (!window.confirm("¿Eliminar esta carpeta y todo su contenido?")) return;
    await deleteFolder(id);
    load(currentFolderId);
  };

  const handleDeleteFile = async (id: number) => {
    if (!window.confirm("¿Eliminar este archivo?")) return;
    await deleteFile(id);
    load(currentFolderId);
  };

  const commitFolderRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (name === currentName) return;
    renameFolder(id, name).then(() => load(currentFolderId));
  };

  const commitFileRename = (id: number, currentName: string, name: string) => {
    setRenaming(null);
    if (name === currentName) return;
    renameFile(id, name).then(() => load(currentFolderId));
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
        .then(() => load(currentFolderId))
        .catch((err) => window.alert(String(err)));
    } else {
      moveFile(payload.id, targetFolderId as number)
        .then(() => load(currentFolderId))
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
        { label: "📁 Nueva carpeta", onClick: handleNewFolder },
        ...(currentFolderId != null
          ? [{ label: "⬆ Subir archivo", onClick: handleUploadClick }]
          : []),
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
        { label: "📂 Abrir", onClick: () => setCurrentFolderId(folder.id) },
        { label: "✏️ Renombrar", onClick: () => setRenaming({ type: "folder", id: folder.id }) },
        { label: "🗑️ Eliminar", onClick: () => handleDeleteFolder(folder.id), danger: true },
      ],
    });
  };

  const openFileMenu = (e: React.MouseEvent, file: { id: number }) => {
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

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }
  if (!contents) {
    return <div className={styles.loading}>Cargando…</div>;
  }

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
        <button onClick={handleNewFolder}>+ Nueva carpeta</button>
        <button onClick={handleUploadClick} disabled={currentFolderId == null} title={currentFolderId == null ? "Entrá a una carpeta para subir archivos" : ""}>
          ⬆ Subir archivo
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} />
      </div>

      <div className={styles.breadcrumb}>
        <button
          className={`${styles.crumb} ${dragOverId === "root" ? styles.crumbDragOver : ""}`}
          onClick={() => setCurrentFolderId(null)}
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
        {contents.breadcrumb.map((f) => (
          <span key={f.id} className={styles.crumbGroup}>
            <span className={styles.sep}>/</span>
            <button
              className={`${styles.crumb} ${dragOverId === f.id ? styles.crumbDragOver : ""}`}
              onClick={() => setCurrentFolderId(f.id)}
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

      <div
        className={styles.list}
        onContextMenu={openBackgroundMenu}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          movePayloadInto(readDrag(e), currentFolderId);
        }}
      >
        {contents.folders.length === 0 && contents.files.length === 0 && (
          <div className={styles.empty}>
            {currentFolderId == null
              ? "No hay carpetas todavía. Creá una para empezar (clic derecho aquí)."
              : "Esta carpeta está vacía."}
          </div>
        )}

        {contents.folders.map((folder) => {
          const editing = renaming?.type === "folder" && renaming.id === folder.id;
          return (
            <div
              key={`folder-${folder.id}`}
              className={`${styles.item} ${dragOverId === folder.id ? styles.itemDragOver : ""}`}
              onDoubleClick={editing ? undefined : () => setCurrentFolderId(folder.id)}
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
              <span className={styles.itemIcon}>📁</span>
              <InlineEditLabel
                value={folder.name}
                editing={editing}
                onCommit={(name) => commitFolderRename(folder.id, folder.name, name)}
                onCancel={() => setRenaming(null)}
                className={editing ? styles.itemNameInput : styles.itemName}
              />
              <span className={styles.itemMeta}></span>
              <button
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFolder(folder.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}

        {contents.files.map((file) => {
          const editing = renaming?.type === "file" && renaming.id === file.id;
          return (
            <div
              key={`file-${file.id}`}
              className={styles.item}
              onDoubleClick={editing ? undefined : () => window.open(downloadUrl(file.id), "_blank")}
              onContextMenu={(e) => openFileMenu(e, file)}
              draggable
              onDragStart={(e) => startDrag(e, { kind: "file", id: file.id })}
            >
              <span className={styles.itemIcon}>📄</span>
              <InlineEditLabel
                value={file.name}
                editing={editing}
                onCommit={(name) => commitFileRename(file.id, file.name, name)}
                onCancel={() => setRenaming(null)}
                className={editing ? styles.itemNameInput : styles.itemName}
              />
              <span className={styles.itemMeta}>{formatSize(file.size)}</span>
              <button
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFile(file.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

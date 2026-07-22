import { useEffect, useState } from "react";
import { getContents, type FolderOut } from "../../lib/filesApi";
import styles from "./FolderTree.module.css";

interface NodeProps {
  folderId: number | null;
  label: string;
  icon: string;
  currentFolderId: number | null;
  reloadKey: number;
  depth: number;
  onNavigate: (id: number | null) => void;
}

function TreeNode({ folderId, label, icon, currentFolderId, reloadKey, depth, onNavigate }: NodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState<FolderOut[] | null>(null);

  useEffect(() => {
    if (!expanded) return;
    getContents(folderId).then((c) => setChildren(c.folders));
  }, [expanded, folderId, reloadKey]);

  const isActive = currentFolderId === folderId;
  const showChevron = children === null || children.length > 0;

  return (
    <div>
      <div
        className={`${styles.row} ${isActive ? styles.active : ""}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => onNavigate(folderId)}
      >
        <span
          className={styles.chevron}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {showChevron ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.label}>{label}</span>
      </div>
      {expanded &&
        children?.map((f) => (
          <TreeNode
            key={f.id}
            folderId={f.id}
            label={f.name}
            icon="📁"
            currentFolderId={currentFolderId}
            reloadKey={reloadKey}
            depth={depth + 1}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}

export function FolderTree({
  currentFolderId,
  reloadKey,
  onNavigate,
}: {
  currentFolderId: number | null;
  reloadKey: number;
  onNavigate: (id: number | null) => void;
}) {
  return (
    <div className={styles.tree}>
      <TreeNode
        folderId={null}
        label="Mi unidad"
        icon="🏠"
        currentFolderId={currentFolderId}
        reloadKey={reloadKey}
        depth={0}
        onNavigate={onNavigate}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { fetchFileBytes, type FileOut } from "../../lib/filesApi";
import { useWindowStore } from "../../windows/windowStore";
import styles from "./MediaViewer.module.css";

export type MediaKind = "image" | "audio" | "video";

export interface MediaViewerProps {
  windowId?: string;
  fileId?: number;
  name?: string;
  contentType?: string;
  kind?: MediaKind;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export function MediaViewer({
  windowId,
  fileId,
  name = "Archivo",
  contentType,
  kind = "image",
}: MediaViewerProps) {
  const setTitle = useWindowStore((s) => s.setTitle);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (windowId) setTitle(windowId, `${name} — Visor`);
  }, [windowId, name, setTitle]);

  // The download route needs the auth header, so the bytes are fetched and
  // handed to the media element as a blob URL.
  useEffect(() => {
    if (fileId == null) return;
    let revoked: string | null = null;
    let cancelled = false;

    fetchFileBytes(fileId)
      .then((bytes) => {
        if (cancelled) return;
        const blobUrl = URL.createObjectURL(
          new Blob([bytes], { type: contentType || "application/octet-stream" }),
        );
        revoked = blobUrl;
        setUrl(blobUrl);
      })
      .catch((err) => !cancelled && setError(String(err)));

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [fileId, contentType]);

  /** Scales relative to the current zoom, read functionally so clicks landing
   *  in the same tick still compound. */
  const scaleBy = (factor: number) => {
    setFit(false);
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
  };

  const setZoomTo = (value: number) => {
    setFit(false);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (kind !== "image" || !e.ctrlKey) return;
    e.preventDefault();
    scaleBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (kind !== "image" || fit) return;
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const reset = () => {
    setFit(true);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  if (error) return <div className={styles.error}>No se pudo abrir: {error}</div>;
  if (!url) return <div className={styles.loading}>Cargando…</div>;

  return (
    <div className={styles.viewer}>
      {kind === "image" && (
        <div className={styles.bar}>
          <button onClick={() => scaleBy(1 / 1.25)} title="Alejar">
            −
          </button>
          <span className={styles.zoomLabel}>{fit ? "Ajustado" : `${Math.round(zoom * 100)}%`}</span>
          <button onClick={() => scaleBy(1.25)} title="Acercar">
            +
          </button>
          <button onClick={reset}>Ajustar</button>
          <button onClick={() => setZoomTo(1)}>100%</button>
          <span className={styles.hint}>Ctrl + rueda para hacer zoom; arrastrá para mover</span>
        </div>
      )}

      <div
        className={styles.stage}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {kind === "image" && (
          <img
            className={fit ? styles.imageFit : styles.image}
            src={url}
            alt={name}
            draggable={false}
            style={
              fit
                ? undefined
                : {
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    cursor: dragRef.current ? "grabbing" : "grab",
                  }
            }
          />
        )}
        {kind === "video" && <video className={styles.media} src={url} controls autoPlay />}
        {kind === "audio" && (
          <div className={styles.audioCard}>
            <div className={styles.audioIcon}>🎵</div>
            <div className={styles.audioName}>{name}</div>
            <audio src={url} controls autoPlay />
          </div>
        )}
      </div>
    </div>
  );
}

/** Kept beside the viewer so the registry and the file-type map agree. */
export function mediaKindOf(file: Pick<FileOut, "name" | "content_type">): MediaKind | null {
  const type = (file.content_type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));

  if (type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"].includes(ext))
    return "image";
  if (type.startsWith("video/") || [".mp4", ".webm", ".ogv", ".mov", ".mkv"].includes(ext))
    return "video";
  if (type.startsWith("audio/") || [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"].includes(ext))
    return "audio";
  return null;
}

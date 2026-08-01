import { useEffect, useRef, type RefObject } from "react";
import type { LoadedPdf } from "./pdfEngine";

/** Renders one PDF page into a canvas, re-rendering on zoom/rotation change. */
export function PageCanvas({
  pdf,
  pageIndex,
  scale,
  rotation,
  className,
  canvasRef,
}: {
  pdf: LoadedPdf;
  pageIndex: number;
  scale: number;
  rotation: number;
  className?: string;
  /** Exposed so the editor can read pixels back for background sampling. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
}) {
  const own = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? own;

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas) return;
    pdf.render(pageIndex, canvas, scale, rotation).catch((err) => {
      // A render can be superseded while zooming; that's expected.
      if (!cancelled) console.debug("pdf render", err);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex, scale, rotation]);

  return <canvas ref={ref} className={className} />;
}

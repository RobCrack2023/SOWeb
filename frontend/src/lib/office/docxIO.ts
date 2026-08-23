/**
 * Word (.docx) interop for writeSO.
 *
 * Import uses mammoth (docx -> semantic HTML, which TipTap consumes directly).
 * Export walks the TipTap document JSON and builds a real .docx with the
 * `docx` library. Both libraries are loaded on demand so they never weigh on
 * the initial SOWeb load.
 */

import { DOCX_MIME } from "../filesApi";

/**
 * Mammoth converts semantically and drops direct formatting by default, so we
 * opt back into the marks writeSO can represent. Underline especially: it is
 * ignored out of the box because Word often uses it for links.
 */
const STYLE_MAP = [
  "u => u",
  "strike => s",
  "r[style-name='Strong'] => strong",
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Título 1'] => h1:fresh",
  "p[style-name='Título 2'] => h2:fresh",
  "p[style-name='Título 3'] => h3:fresh",
].join("\n");

/**
 * writeSO saves real .docx files, but mammoth reads them semantically and
 * drops direct formatting — reopening one would lose text colour, paragraph
 * alignment and table header shading on every save.
 *
 * So the editor's own document is tucked into the package as an extra part.
 * Word ignores it, while writeSO reopens its own files losslessly. It is only
 * trusted when nothing else has written the file since: any other editor
 * rewrites `lastModifiedBy`, and then mammoth's reading is the honest one.
 */
const SIDECAR_PATH = "soweb/document.json";
const SIDECAR_AUTHOR = "SOWeb — writeSO";

export interface ImportedDocx {
  html: string;
  /** Page geometry read from the document, so imports keep their real size. */
  page: { sizeId: string; landscape: boolean } | null;
  /** The exact TipTap document, when this .docx was last written by writeSO. */
  doc?: unknown;
}

export async function importDocx(bytes: ArrayBuffer): Promise<ImportedDocx> {
  const page = await readPageSize(bytes);

  const sidecar = await readSidecar(bytes);
  if (sidecar !== null) return { html: "", page, doc: sidecar };

  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes }, { styleMap: STYLE_MAP });
  return { html: result.value, page };
}

/** The embedded document, or null when absent or no longer trustworthy. */
async function readSidecar(bytes: ArrayBuffer): Promise<unknown | null> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes.slice(0));

    const core = zip.file("docProps/core.xml");
    if (!core) return null;
    const xml = await core.async("string");
    const lastBy = /<cp:lastModifiedBy>([^<]*)<\/cp:lastModifiedBy>/.exec(xml)?.[1] ?? "";
    // Someone else saved over it; what they wrote is the real content now.
    if (lastBy.trim() !== SIDECAR_AUTHOR) return null;

    const part = zip.file(SIDECAR_PATH);
    if (!part) return null;
    return JSON.parse(await part.async("string"));
  } catch {
    return null;
  }
}

/**
 * Mammoth only reports content, so read the section's page size straight from
 * the package. Word stores it in twips (1/1440 inch) on <w:pgSz>.
 */
async function readPageSize(
  bytes: ArrayBuffer,
): Promise<{ sizeId: string; landscape: boolean } | null> {
  try {
    const JSZip = (await import("jszip")).default;
    const { matchSize } = await import("../../apps/text-editor/page");
    const zip = await JSZip.loadAsync(bytes.slice(0));
    const file = zip.file("word/document.xml");
    if (!file) return null;
    const xml = await file.async("string");
    const m = /<w:pgSz\b[^>]*>/.exec(xml);
    if (!m) return null;
    const w = /w:w="(\d+)"/.exec(m[0]);
    const h = /w:h="(\d+)"/.exec(m[0]);
    if (!w || !h) return null;
    const twipToMm = (t: number) => (t / 1440) * 25.4;
    return matchSize(twipToMm(Number(w[1])), twipToMm(Number(h[1])));
  } catch {
    return null;
  }
}

/** A TipTap JSON node (loosely typed — we only read what we map). */
interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
}

type Align = "left" | "center" | "right" | "both";

function alignOf(node: TipTapNode): Align | undefined {
  const a = node.attrs?.textAlign as string | undefined;
  if (a === "center" || a === "right" || a === "left") return a;
  if (a === "justify") return "both";
  return undefined;
}

export async function exportDocx(
  doc: TipTapNode,
  title: string,
  page?: { widthMm: number; heightMm: number; marginMm: number },
): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    convertMillimetersToTwip,
  } = await import("docx");

  const alignMap: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    both: AlignmentType.JUSTIFIED,
  };

  const headingFor = (level: number) =>
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : level === 3
          ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_4;

  const runsOf = (node: TipTapNode, inherited?: { color?: string }): InstanceType<typeof TextRun>[] => {
    const out: InstanceType<typeof TextRun>[] = [];
    for (const child of node.content ?? []) {
      if (child.type === "text" && child.text) {
        const marks = child.marks ?? [];
        const kinds = new Set(marks.map((m) => m.type));
        // Colour rides on a `textStyle` mark rather than being its own type.
        const styleMark = marks.find((m) => m.type === "textStyle") as
          | { attrs?: { color?: string } }
          | undefined;
        const hex = (styleMark?.attrs?.color ?? inherited?.color ?? "").replace("#", "");
        out.push(
          new TextRun({
            text: child.text,
            bold: kinds.has("bold"),
            italics: kinds.has("italic"),
            strike: kinds.has("strike"),
            underline: kinds.has("underline") ? {} : undefined,
            color: hex || undefined,
          }),
        );
      } else if (child.type === "hardBreak") {
        out.push(new TextRun({ text: "", break: 1 }));
      } else if (child.content) {
        out.push(...runsOf(child, inherited));
      }
    }
    return out;
  };

  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;

  const paragraphFor = (
    node: TipTapNode,
    listKind?: "bullet" | "ordered",
    depth = 0,
    opts?: { color?: string },
  ) =>
    new Paragraph({
      children: runsOf(node, opts),
      alignment: alignOf(node) ? alignMap[alignOf(node)!] : undefined,
      ...(listKind === "bullet"
        ? { bullet: { level: depth } }
        : listKind === "ordered"
          ? { numbering: { reference: "soweb-ordered", level: depth } }
          : {}),
    });

  /** Collect a node's block-level content into `out`. */
  const walk = (
    node: TipTapNode,
    out: Block[],
    listKind?: "bullet" | "ordered",
    depth = 0,
    opts?: { color?: string },
  ) => {
    switch (node.type) {
      case "paragraph":
        out.push(paragraphFor(node, listKind, depth, opts));
        break;
      case "heading":
        out.push(
          new Paragraph({
            children: runsOf(node, opts),
            heading: headingFor(Number(node.attrs?.level ?? 1)),
            alignment: alignOf(node) ? alignMap[alignOf(node)!] : undefined,
          }),
        );
        break;
      case "bulletList":
        for (const item of node.content ?? []) walk(item, out, "bullet", depth, opts);
        break;
      case "orderedList":
        for (const item of node.content ?? []) walk(item, out, "ordered", depth, opts);
        break;
      case "listItem":
      case "blockquote":
        for (const child of node.content ?? []) walk(child, out, listKind, depth, opts);
        break;
      case "horizontalRule":
        out.push(new Paragraph({ text: "―――――――――――" }));
        break;
      case "table":
        out.push(tableFor(node));
        break;
      default:
        for (const child of node.content ?? []) walk(child, out, listKind, depth, opts);
    }
  };

  const HEADER_FILL = "1F4E79";

  const tableFor = (node: TipTapNode): InstanceType<typeof Table> => {
    const rows = (node.content ?? []).map((rowNode) => {
      const cells = (rowNode.content ?? []).map((cellNode) => {
        const isHeader = cellNode.type === "tableHeader";
        const inner: Block[] = [];
        for (const child of cellNode.content ?? []) {
          // Header text is white so it reads against the dark fill.
          walk(child, inner, undefined, 0, isHeader ? { color: "FFFFFF" } : undefined);
        }
        if (inner.length === 0) inner.push(new Paragraph({ text: "" }));
        return new TableCell({
          children: inner,
          columnSpan: Number(cellNode.attrs?.colspan ?? 1),
          rowSpan: Number(cellNode.attrs?.rowspan ?? 1),
          shading: isHeader ? { fill: HEADER_FILL } : undefined,
        });
      });
      // Only set tableHeader when true: passing false still writes
      // <w:tblHeader w:val="false"/>, and readers that only look for the
      // element's presence then treat every row as a header row.
      const isHeaderRow = rowNode.content?.[0]?.type === "tableHeader";
      return new TableRow({ children: cells, ...(isHeaderRow ? { tableHeader: true } : {}) });
    });

    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  };

  const paragraphs: Block[] = [];
  walk(doc, paragraphs);
  if (paragraphs.length === 0) paragraphs.push(new Paragraph({ text: "" }));

  const file = new Document({
    title,
    creator: SIDECAR_AUTHOR,
    // Read back on import to tell "writeSO wrote this last" from "Word did".
    lastModifiedBy: SIDECAR_AUTHOR,
    numbering: {
      config: [
        {
          reference: "soweb-ordered",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [
      {
        properties: page
          ? {
              page: {
                size: {
                  width: convertMillimetersToTwip(page.widthMm),
                  height: convertMillimetersToTwip(page.heightMm),
                },
                margin: {
                  top: convertMillimetersToTwip(page.marginMm),
                  bottom: convertMillimetersToTwip(page.marginMm),
                  left: convertMillimetersToTwip(page.marginMm),
                  right: convertMillimetersToTwip(page.marginMm),
                },
              },
            }
          : undefined,
        children: paragraphs,
      },
    ],
  });

  const packed = await Packer.toBlob(file);

  // Tuck the editor's own document alongside the Word parts. A .docx is a zip,
  // and an unreferenced entry is ignored by every reader that isn't looking
  // for it.
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await packed.arrayBuffer());
  zip.file(SIDECAR_PATH, JSON.stringify(doc));
  const withSidecar = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

  return new Blob([withSidecar], { type: DOCX_MIME });
}

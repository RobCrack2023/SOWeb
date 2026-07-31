/**
 * Word (.docx) interop for writeSO.
 *
 * Import uses mammoth (docx -> semantic HTML, which TipTap consumes directly).
 * Export walks the TipTap document JSON and builds a real .docx with the
 * `docx` library. Both libraries are loaded on demand so they never weigh on
 * the initial SOWeb load.
 */

import { DOCX_MIME } from "../filesApi";

export async function importDocx(bytes: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value;
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

export async function exportDocx(doc: TipTapNode, title: string): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
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

  const runsOf = (node: TipTapNode): InstanceType<typeof TextRun>[] => {
    const out: InstanceType<typeof TextRun>[] = [];
    for (const child of node.content ?? []) {
      if (child.type === "text" && child.text) {
        const marks = new Set((child.marks ?? []).map((m) => m.type));
        out.push(
          new TextRun({
            text: child.text,
            bold: marks.has("bold"),
            italics: marks.has("italic"),
            strike: marks.has("strike"),
            underline: marks.has("underline") ? {} : undefined,
          }),
        );
      } else if (child.type === "hardBreak") {
        out.push(new TextRun({ text: "", break: 1 }));
      } else if (child.content) {
        out.push(...runsOf(child));
      }
    }
    return out;
  };

  const paragraphs: InstanceType<typeof Paragraph>[] = [];

  const walk = (node: TipTapNode, listKind?: "bullet" | "ordered", depth = 0) => {
    switch (node.type) {
      case "paragraph": {
        const align = alignOf(node);
        paragraphs.push(
          new Paragraph({
            children: runsOf(node),
            alignment: align ? alignMap[align] : undefined,
            ...(listKind === "bullet"
              ? { bullet: { level: depth } }
              : listKind === "ordered"
                ? { numbering: { reference: "soweb-ordered", level: depth } }
                : {}),
          }),
        );
        break;
      }
      case "heading": {
        const align = alignOf(node);
        paragraphs.push(
          new Paragraph({
            children: runsOf(node),
            heading: headingFor(Number(node.attrs?.level ?? 1)),
            alignment: align ? alignMap[align] : undefined,
          }),
        );
        break;
      }
      case "bulletList":
        for (const item of node.content ?? []) walk(item, "bullet", depth);
        break;
      case "orderedList":
        for (const item of node.content ?? []) walk(item, "ordered", depth);
        break;
      case "listItem":
        for (const child of node.content ?? []) walk(child, listKind, depth);
        break;
      case "blockquote":
        for (const child of node.content ?? []) walk(child, listKind, depth);
        break;
      case "horizontalRule":
        paragraphs.push(new Paragraph({ text: "―――――――――――" }));
        break;
      default:
        for (const child of node.content ?? []) walk(child, listKind, depth);
    }
  };

  walk(doc);
  if (paragraphs.length === 0) paragraphs.push(new Paragraph({ text: "" }));

  const file = new Document({
    title,
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
    sections: [{ children: paragraphs }],
  });

  const blob = await Packer.toBlob(file);
  return new Blob([blob], { type: DOCX_MIME });
}

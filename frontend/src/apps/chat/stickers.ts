/**
 * The sticker catalog.
 *
 * Each sticker is an emoji plus a CSS animation rather than an image file:
 * nothing to download, crisp at any size, and the repo stays free of binary
 * assets. `anim` maps to a keyframe class in Stickers.module.css.
 */

export type StickerAnim =
  | "wave"
  | "beat"
  | "bounce"
  | "shake"
  | "spin"
  | "float"
  | "pop"
  | "flicker"
  | "swing"
  | "blink";

export interface Sticker {
  id: string;
  emoji: string;
  label: string;
  anim: StickerAnim;
}

export const STICKERS: Sticker[] = [
  { id: "hola", emoji: "👋", label: "Hola", anim: "wave" },
  { id: "amor", emoji: "❤️", label: "Me encanta", anim: "beat" },
  { id: "ok", emoji: "👍", label: "Dale", anim: "bounce" },
  { id: "risa", emoji: "😂", label: "Jaja", anim: "shake" },
  { id: "fuego", emoji: "🔥", label: "Genial", anim: "flicker" },
  { id: "fiesta", emoji: "🎉", label: "Festejo", anim: "pop" },
  { id: "pensando", emoji: "🤔", label: "Mmm", anim: "swing" },
  { id: "dormido", emoji: "😴", label: "Zzz", anim: "float" },
  { id: "cohete", emoji: "🚀", label: "Vamos", anim: "float" },
  { id: "cafe", emoji: "☕", label: "Café", anim: "float" },
  { id: "listo", emoji: "✅", label: "Listo", anim: "pop" },
  { id: "triste", emoji: "😢", label: "Qué pena", anim: "float" },
  { id: "aplausos", emoji: "👏", label: "Bravo", anim: "shake" },
  { id: "sorpresa", emoji: "😮", label: "Wow", anim: "blink" },
  { id: "cerebro", emoji: "🧠", label: "Buena idea", anim: "spin" },
  { id: "chau", emoji: "🫡", label: "Chau", anim: "wave" },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/** Unknown ids can arrive from an older or newer catalog; render something. */
export const stickerFor = (id: string): Sticker =>
  BY_ID.get(id) ?? { id, emoji: "❓", label: id, anim: "blink" };

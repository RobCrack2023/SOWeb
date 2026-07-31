/**
 * Presentation model.
 *
 * Slides are laid out on a fixed logical canvas (SLIDE_W x SLIDE_H). Every
 * position and font size is stored in those logical pixels, and views render
 * the slide with a CSS `transform: scale(k)`. That keeps thumbnails, the
 * editor and fullscreen presenting pixel-identical without recomputing layout.
 */

export const SLIDE_W = 1000;
export const SLIDE_H = 562;

export type ElementKind = "text";

export interface SlideElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  color: string;
}

export interface Slide {
  id: string;
  background: string;
  elements: SlideElement[];
}

export interface Deck {
  slides: Slide[];
}

let seq = 0;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const DEFAULT_BG = "#ffffff";

export function makeTextElement(partial: Partial<SlideElement> = {}): SlideElement {
  return {
    id: uid("e"),
    kind: "text",
    x: 90,
    y: 220,
    w: 820,
    h: 90,
    text: "Texto",
    fontSize: 32,
    bold: false,
    italic: false,
    align: "left",
    color: "#1a1a1a",
    ...partial,
  };
}

export function makeTitleSlide(): Slide {
  return {
    id: uid("s"),
    background: DEFAULT_BG,
    elements: [
      makeTextElement({
        text: "Título de la presentación",
        x: 90,
        y: 190,
        w: 820,
        h: 110,
        fontSize: 60,
        bold: true,
        align: "center",
      }),
      makeTextElement({
        text: "Subtítulo",
        x: 90,
        y: 310,
        w: 820,
        h: 70,
        fontSize: 30,
        align: "center",
        color: "#666666",
      }),
    ],
  };
}

export function makeContentSlide(): Slide {
  return {
    id: uid("s"),
    background: DEFAULT_BG,
    elements: [
      makeTextElement({
        text: "Título",
        x: 70,
        y: 60,
        w: 860,
        h: 80,
        fontSize: 44,
        bold: true,
      }),
      makeTextElement({
        text: "Contenido de la diapositiva",
        x: 70,
        y: 180,
        w: 860,
        h: 300,
        fontSize: 28,
      }),
    ],
  };
}

export function makeEmptyDeck(): Deck {
  return { slides: [makeTitleSlide()] };
}

/** Parse stored JSON, falling back to a fresh deck if it's missing or invalid. */
export function parseDeck(raw: string): Deck {
  try {
    const parsed = JSON.parse(raw) as Deck;
    if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) return parsed;
  } catch {
    /* fall through */
  }
  return makeEmptyDeck();
}

export { uid };

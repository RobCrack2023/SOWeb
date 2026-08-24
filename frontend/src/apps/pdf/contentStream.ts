/**
 * Cutting text out of a PDF page's content stream.
 *
 * pdfSO replaces text by covering it and drawing a new run on top, which looks
 * right but leaves the original characters in the file, where copy-paste and
 * text search still find them. To actually remove one, the operator that draws
 * it has to come out of the page's content stream.
 *
 * Everything here works on the stream as a Latin-1 string — one character per
 * byte — and splices the original text rather than re-serialising it, so every
 * byte we don't deliberately touch survives untouched.
 */

/** A run to remove, located the way pdf.js reports it: top-left origin. */
export interface TextRun {
  /** Left edge of the run, in PDF points from the page's left edge. */
  x: number;
  /** Distance from the page top down to the text baseline. */
  baseline: number;
  /** Rendered width, used to keep following text from sliding left. */
  width: number;
}

export interface StripResult {
  content: string;
  /** How many of the requested runs were found. */
  removed: number;
}

/** A run's origin has to land this close, in points, to count as a match. */
const TOLERANCE = 1.2;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** PDF matrices multiply as row vectors: [a b 0; c d 0; e f 1]. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function translation(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

/** Horizontal scale a matrix applies, for converting device widths back. */
function horizontalScale(m: Matrix): number {
  return Math.hypot(m[0], m[1]) || 1;
}

const WHITESPACE = " \t\r\n\f\0";
const DELIMITERS = "()<>[]{}/%";

interface Token {
  /** Operators are bare keywords; everything else is an operand. */
  kind: "operand" | "operator";
  text: string;
  start: number;
  end: number;
}

/**
 * Walk the stream one token at a time.
 *
 * Inline images are the trap here: between `ID` and `EI` sits raw binary that
 * would otherwise tokenise as garbage operators, so that span is consumed
 * whole.
 */
function* tokenize(s: string): Generator<Token> {
  let i = 0;
  const n = s.length;

  while (i < n) {
    const c = s[i];

    if (WHITESPACE.includes(c)) {
      i += 1;
      continue;
    }

    if (c === "%") {
      while (i < n && s[i] !== "\n" && s[i] !== "\r") i += 1;
      continue;
    }

    const start = i;

    if (c === "(") {
      let depth = 0;
      while (i < n) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === "(") depth += 1;
        else if (s[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
        i += 1;
      }
      yield { kind: "operand", text: s.slice(start, i), start, end: i };
      continue;
    }

    if (c === "<" && s[i + 1] === "<") {
      let depth = 0;
      while (i < n) {
        if (s[i] === "<" && s[i + 1] === "<") {
          depth += 1;
          i += 2;
        } else if (s[i] === ">" && s[i + 1] === ">") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else i += 1;
      }
      yield { kind: "operand", text: s.slice(start, i), start, end: i };
      continue;
    }

    if (c === "<") {
      while (i < n && s[i] !== ">") i += 1;
      i += 1;
      yield { kind: "operand", text: s.slice(start, i), start, end: i };
      continue;
    }

    if (c === "[" || c === "]" || c === "{" || c === "}") {
      i += 1;
      yield { kind: "operand", text: c, start, end: i };
      continue;
    }

    if (c === "/") {
      i += 1;
      while (i < n && !WHITESPACE.includes(s[i]) && !DELIMITERS.includes(s[i])) i += 1;
      yield { kind: "operand", text: s.slice(start, i), start, end: i };
      continue;
    }

    while (i < n && !WHITESPACE.includes(s[i]) && !DELIMITERS.includes(s[i])) i += 1;
    if (i === start) i += 1; // never stall on an unexpected delimiter
    const text = s.slice(start, i);
    const numeric = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
    yield { kind: numeric ? "operand" : "operator", text, start, end: i };

    if (text === "ID") {
      // Binary follows, up to the next EI standing on its own. NUL counts as
      // whitespace here, escaped so it never sits in the source as a raw byte.
      // eslint-disable-next-line no-control-regex -- NUL is whitespace to a PDF
      const match = /[\s\u0000]EI(?=[\s\u0000]|$)/.exec(s.slice(i));
      i = match ? i + match.index + match[0].length : n;
    }
  }
}

const SHOW_OPS = new Set(["Tj", "TJ", "'", '"']);

/**
 * Remove the operators that draw `runs` from a page's content stream.
 *
 * Runs are matched on where they start, not on what they say: the bytes in a
 * show operator are font-encoded, and decoding them back to characters would
 * mean carrying the font's ToUnicode map in here. Two runs starting on the
 * same point to within a fraction of a point is not something a real page
 * does.
 *
 * A matched operator becomes a `TJ` holding nothing but the advance it used to
 * produce. Showing text moves the text matrix but not the line matrix, so this
 * only matters for a run drawn immediately after another without repositioning
 * in between — but that run would otherwise slide left by the width of what we
 * removed.
 */
export function stripTextRuns(content: string, runs: TextRun[], pageHeight: number): StripResult {
  if (runs.length === 0) return { content, removed: 0 };

  const pending = runs.map((r) => ({ run: r, done: false }));

  let ctm: Matrix = IDENTITY;
  const ctmStack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let fontSize = 0;
  let leading = 0;
  let horizontalScaling = 1;

  const operands: string[] = [];
  const num = (i: number) => {
    const v = parseFloat(operands[operands.length - i]);
    return Number.isFinite(v) ? v : 0;
  };

  /** Splices to apply, collected in order and applied in one pass at the end. */
  const cuts: { start: number; end: number; text: string }[] = [];

  for (const token of tokenize(content)) {
    if (token.kind === "operand") {
      operands.push(token.text);
      continue;
    }

    const op = token.text;

    // `'` and `"` drop to the next line before they draw, so the origin to
    // match against is the moved one, not the one we arrived with.
    if (op === "'" || op === '"') {
      tlm = multiply(translation(0, -leading), tlm);
      tm = tlm;
    }

    if (SHOW_OPS.has(op)) {
      const rendering = multiply(tm, ctm);
      const originX = rendering[4];
      const originY = rendering[5];

      const hit = pending.find(
        (p) =>
          !p.done &&
          Math.abs(p.run.x - originX) <= TOLERANCE &&
          Math.abs(pageHeight - p.run.baseline - originY) <= TOLERANCE,
      );

      if (hit) {
        hit.done = true;
        // The device width has to come back to text space before it can be
        // written as a TJ adjustment, which is in thousandths of an em.
        const scale = horizontalScale(rendering);
        const advance = hit.run.width / scale;
        const thousandths =
          fontSize > 0 && horizontalScaling !== 0
            ? -(advance * 1000) / (fontSize * horizontalScaling)
            : 0;
        const replacement = `[${thousandths.toFixed(3)}] TJ`;

        // `'` and `"` move to the next line before drawing, so that part of
        // what they did has to survive the cut.
        let prefix = "";
        if (op === "'") prefix = "T* ";
        else if (op === '"') prefix = `${num(3)} Tw ${num(2)} Tc T* `;

        // Take the operands with the operator; they belong to it.
        const start = findOperandStart(content, token, op);
        cuts.push({ start, end: token.end, text: prefix + replacement });
      }
    }

    switch (op) {
      case "q":
        ctmStack.push(ctm);
        break;
      case "Q":
        ctm = ctmStack.pop() ?? IDENTITY;
        break;
      case "cm":
        ctm = multiply([num(6), num(5), num(4), num(3), num(2), num(1)], ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "ET":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf":
        fontSize = num(1);
        break;
      case "Tz":
        horizontalScaling = num(1) / 100;
        break;
      case "TL":
        leading = num(1);
        break;
      case "Td":
        tlm = multiply(translation(num(2), num(1)), tlm);
        tm = tlm;
        break;
      case "TD":
        leading = -num(1);
        tlm = multiply(translation(num(2), num(1)), tlm);
        tm = tlm;
        break;
      case "Tm":
        tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
        tm = tlm;
        break;
      case "T*":
        tlm = multiply(translation(0, -leading), tlm);
        tm = tlm;
        break;
      default:
        break;
    }

    operands.length = 0;
  }

  if (cuts.length === 0) return { content, removed: 0 };

  let out = "";
  let cursor = 0;
  for (const cut of cuts) {
    out += content.slice(cursor, cut.start) + cut.text;
    cursor = cut.end;
  }
  out += content.slice(cursor);

  return { content: out, removed: cuts.length };
}

/**
 * Where a show operator's own operands begin, so the cut takes them along
 * instead of leaving a stray string sitting in the stream.
 */
function findOperandStart(content: string, token: Token, op: string): number {
  // Scan back over exactly as many operands as this operator consumes.
  const wanted = op === '"' ? 3 : 1;
  let end = token.start;
  let found = 0;

  while (found < wanted && end > 0) {
    let i = end - 1;
    while (i >= 0 && WHITESPACE.includes(content[i])) i -= 1;
    if (i < 0) break;

    if (content[i] === ")") {
      let depth = 0;
      while (i >= 0) {
        if (content[i] === ")" && content[i - 1] !== "\\") depth += 1;
        else if (content[i] === "(" && content[i - 1] !== "\\") {
          depth -= 1;
          if (depth === 0) break;
        }
        i -= 1;
      }
    } else if (content[i] === "]") {
      let depth = 0;
      while (i >= 0) {
        if (content[i] === "]") depth += 1;
        else if (content[i] === "[") {
          depth -= 1;
          if (depth === 0) break;
        }
        i -= 1;
      }
    } else if (content[i] === ">") {
      while (i >= 0 && content[i] !== "<") i -= 1;
    } else {
      while (i >= 0 && !WHITESPACE.includes(content[i]) && !DELIMITERS.includes(content[i])) i -= 1;
      i += 1;
    }

    if (i < 0) break;
    end = i;
    found += 1;
  }

  return end;
}

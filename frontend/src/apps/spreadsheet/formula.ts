/**
 * Minimal spreadsheet formula engine.
 *
 * Cells are stored as raw strings keyed by A1-style refs ("A1", "B2", ...).
 * A raw value starting with "=" is a formula; otherwise it's a literal
 * (number if it parses, else text).
 *
 * Supported in formulas: numbers, cell refs (A1), ranges (A1:B3, only as
 * function arguments), operators + - * / and parentheses, and the functions
 * SUM, AVERAGE, MIN, MAX, COUNT.
 */

export type CellValue = number | string;
export type Cells = Record<string, string>;

const ERR_CYCLE = "#CICLO";
const ERR = "#ERROR";

// ---- ref helpers -----------------------------------------------------------

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

export function cellRef(col: number, row: number): string {
  return `${indexToCol(col)}${row + 1}`;
}

function expandRange(a: string, b: string): string[] {
  const pa = parseRef(a);
  const pb = parseRef(b);
  if (!pa || !pb) return [];
  const refs: string[] = [];
  const c0 = Math.min(pa.col, pb.col);
  const c1 = Math.max(pa.col, pb.col);
  const r0 = Math.min(pa.row, pb.row);
  const r1 = Math.max(pa.row, pb.row);
  for (let c = c0; c <= c1; c += 1) {
    for (let r = r0; r <= r1; r += 1) refs.push(cellRef(c, r));
  }
  return refs;
}

// ---- tokenizer -------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "comma" }
  | { t: "colon" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i += 1;
    } else if (ch === "(") {
      tokens.push({ t: "lparen" });
      i += 1;
    } else if (ch === ")") {
      tokens.push({ t: "rparen" });
      i += 1;
    } else if (ch === ",") {
      tokens.push({ t: "comma" });
      i += 1;
    } else if (ch === ":") {
      tokens.push({ t: "colon" });
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < src.length && /[0-9.]/.test(src[i])) num += src[i++];
      tokens.push({ t: "num", v: parseFloat(num) });
    } else if (/[A-Za-z]/.test(ch)) {
      let word = "";
      while (i < src.length && /[A-Za-z0-9]/.test(src[i])) word += src[i++];
      const upper = word.toUpperCase();
      // A cell ref looks like letters followed by digits (A1); otherwise it's
      // a function name.
      if (/^[A-Z]+\d+$/.test(upper)) tokens.push({ t: "ref", v: upper });
      else tokens.push({ t: "ident", v: upper });
    } else {
      throw new Error(`Unexpected char: ${ch}`);
    }
  }
  return tokens;
}

// ---- parser / evaluator ----------------------------------------------------

type Resolve = (ref: string) => CellValue;

function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (v === "") return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error("not a number");
  return n;
}

function evalFormula(src: string, resolve: Resolve): CellValue {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // Additive parser handling + and - with correct left-associativity.
  function parseAdditive(): number {
    let value = parseTerm();
    while (peek()?.t === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
      const op = (next() as { v: string }).v;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek()?.t === "op" && ((peek() as { v: string }).v === "*" || (peek() as { v: string }).v === "/")) {
      const op = (next() as { v: string }).v;
      const rhs = parseFactor();
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  function collectArgs(): number[] {
    // Parse comma-separated args; each is a range (ref:ref) or an expression.
    const values: number[] = [];
    if (peek()?.t === "rparen") return values;
    for (;;) {
      if (peek()?.t === "ref" && tokens[pos + 1]?.t === "colon") {
        const a = (next() as { v: string }).v;
        next(); // colon
        const b = (next() as { v: string }).v;
        for (const ref of expandRange(a, b)) {
          const v = resolve(ref);
          if (typeof v === "number") values.push(v);
          else if (v !== "" && !Number.isNaN(Number(v))) values.push(Number(v));
        }
      } else {
        values.push(parseAdditive());
      }
      if (peek()?.t === "comma") {
        next();
        continue;
      }
      break;
    }
    return values;
  }

  function applyFunction(name: string, args: number[]): number {
    switch (name) {
      case "SUM":
        return args.reduce((a, b) => a + b, 0);
      case "AVERAGE":
        return args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0;
      case "MIN":
        return args.length ? Math.min(...args) : 0;
      case "MAX":
        return args.length ? Math.max(...args) : 0;
      case "COUNT":
        return args.length;
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }

  function parseFactor(): number {
    const tok = peek();
    if (!tok) throw new Error("Unexpected end");
    if (tok.t === "op" && tok.v === "-") {
      next();
      return -parseFactor();
    }
    if (tok.t === "op" && tok.v === "+") {
      next();
      return parseFactor();
    }
    if (tok.t === "num") {
      next();
      return tok.v;
    }
    if (tok.t === "lparen") {
      next();
      const v = parseAdditive();
      if (peek()?.t !== "rparen") throw new Error("Expected )");
      next();
      return v;
    }
    if (tok.t === "ident") {
      next();
      if (peek()?.t !== "lparen") throw new Error("Expected ( after function");
      next();
      const args = collectArgs();
      if (peek()?.t !== "rparen") throw new Error("Expected )");
      next();
      return applyFunction(tok.v, args);
    }
    if (tok.t === "ref") {
      next();
      return toNumber(resolve(tok.v));
    }
    throw new Error("Unexpected token");
  }

  const result = parseAdditive();
  if (pos !== tokens.length) throw new Error("Trailing tokens");
  return result;
}

// ---- whole-grid evaluation -------------------------------------------------

export function computeAll(cells: Cells): Map<string, CellValue> {
  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();

  function evalRef(ref: string): CellValue {
    if (cache.has(ref)) return cache.get(ref)!;
    const raw = cells[ref];
    if (raw == null || raw === "") {
      cache.set(ref, "");
      return "";
    }
    if (!raw.startsWith("=")) {
      const n = Number(raw);
      const v: CellValue = raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
      cache.set(ref, v);
      return v;
    }
    if (visiting.has(ref)) return ERR_CYCLE;
    visiting.add(ref);
    let v: CellValue;
    try {
      v = evalFormula(raw.slice(1), evalRef);
    } catch {
      v = ERR;
    }
    visiting.delete(ref);
    cache.set(ref, v);
    return v;
  }

  for (const ref of Object.keys(cells)) evalRef(ref);
  return cache;
}

export function displayValue(value: CellValue): string {
  if (typeof value === "number") {
    // Trim floating point noise.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10);
  }
  return value;
}

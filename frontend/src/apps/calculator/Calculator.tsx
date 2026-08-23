import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./Calculator.module.css";

type Op = "+" | "−" | "×" | "÷";

/** Kept apart from rendering so the arithmetic is easy to follow. */
function apply(a: number, b: number, op: Op): number {
  switch (op) {
    case "+":
      return a + b;
    case "−":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? NaN : a / b;
  }
}

/** Trim floating-point noise: 0.1 + 0.2 should read as 0.3. */
function show(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

export function Calculator() {
  const [display, setDisplay] = useState("0");
  const [pending, setPending] = useState<{ value: number; op: Op } | null>(null);
  // After "=" or an operator, the next digit starts a new number.
  const [fresh, setFresh] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const inputDigit = (digit: string) => {
    setDisplay((prev) => {
      if (fresh) return digit;
      if (prev === "0" && digit !== ".") return digit;
      if (digit === "." && prev.includes(".")) return prev;
      return prev + digit;
    });
    setFresh(false);
  };

  const chooseOp = (op: Op) => {
    const current = Number(display);
    if (pending && !fresh) {
      const result = apply(pending.value, current, pending.op);
      setDisplay(show(result));
      setPending({ value: result, op });
    } else {
      setPending({ value: current, op });
    }
    setFresh(true);
  };

  const equals = () => {
    if (!pending) return;
    const current = Number(display);
    const result = apply(pending.value, current, pending.op);
    setHistory((h) => [`${show(pending.value)} ${pending.op} ${show(current)} = ${show(result)}`, ...h].slice(0, 12));
    setDisplay(show(result));
    setPending(null);
    setFresh(true);
  };

  const clearAll = () => {
    setDisplay("0");
    setPending(null);
    setFresh(true);
  };

  const backspace = () => {
    if (fresh) return;
    setDisplay((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  };

  const negate = () => setDisplay((prev) => (prev.startsWith("-") ? prev.slice(1) : `-${prev}`));
  const percent = () => {
    setDisplay((prev) => show(Number(prev) / 100));
    setFresh(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const { key } = e;
    if (/^[0-9.]$/.test(key)) return inputDigit(key);
    if (key === "+") return chooseOp("+");
    if (key === "-") return chooseOp("−");
    if (key === "*") return chooseOp("×");
    if (key === "/") {
      e.preventDefault();
      return chooseOp("÷");
    }
    if (key === "Enter" || key === "=") {
      e.preventDefault();
      return equals();
    }
    if (key === "Backspace") return backspace();
    if (key === "Escape") return clearAll();
    if (key === "%") return percent();
  };

  const keys: { label: string; onClick: () => void; kind?: string }[] = [
    { label: "C", onClick: clearAll, kind: "fn" },
    { label: "±", onClick: negate, kind: "fn" },
    { label: "%", onClick: percent, kind: "fn" },
    { label: "÷", onClick: () => chooseOp("÷"), kind: "op" },
    { label: "7", onClick: () => inputDigit("7") },
    { label: "8", onClick: () => inputDigit("8") },
    { label: "9", onClick: () => inputDigit("9") },
    { label: "×", onClick: () => chooseOp("×"), kind: "op" },
    { label: "4", onClick: () => inputDigit("4") },
    { label: "5", onClick: () => inputDigit("5") },
    { label: "6", onClick: () => inputDigit("6") },
    { label: "−", onClick: () => chooseOp("−"), kind: "op" },
    { label: "1", onClick: () => inputDigit("1") },
    { label: "2", onClick: () => inputDigit("2") },
    { label: "3", onClick: () => inputDigit("3") },
    { label: "+", onClick: () => chooseOp("+"), kind: "op" },
    { label: "0", onClick: () => inputDigit("0"), kind: "wide" },
    { label: ",", onClick: () => inputDigit(".") },
    { label: "=", onClick: equals, kind: "eq" },
  ];

  return (
    <div className={styles.calc} ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div className={styles.screen}>
        <div className={styles.pending}>
          {pending ? `${show(pending.value)} ${pending.op}` : " "}
        </div>
        <div className={styles.display} title={display}>
          {display}
        </div>
      </div>

      <div className={styles.pad}>
        {keys.map((k) => (
          <button
            key={k.label}
            className={`${styles.key} ${k.kind ? styles[k.kind] : ""}`}
            onClick={k.onClick}
          >
            {k.label}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className={styles.history}>
          {history.map((line, i) => (
            <div key={i} className={styles.historyLine}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

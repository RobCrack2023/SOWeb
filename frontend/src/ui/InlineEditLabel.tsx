import { useEffect, useRef } from "react";

export function InlineEditLabel({
  value,
  editing,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  editing: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    cancelledRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, [editing, value]);

  if (!editing) {
    return <span className={className}>{value}</span>;
  }

  return (
    <input
      ref={inputRef}
      className={className}
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (cancelledRef.current) return;
        const name = e.target.value.trim();
        onCommit(name || value);
      }}
    />
  );
}

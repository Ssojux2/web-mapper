import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  onCommit(value: number): void;
}

/** Numeric input that commits on Enter/blur, so typing is a single undo step. */
export function NumberField({ label, value, min, max, step = 1, digits = 0, onCommit }: Props) {
  const shown = Number(value.toFixed(digits));
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);

  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v)) {
      setText(String(shown));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== shown) onCommit(v);
    else setText(String(shown));
  };

  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

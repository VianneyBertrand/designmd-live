import type { FlatToken } from '@designmd-live/core';
import { useEffect, useRef, useState } from 'react';
import { useDesign } from '../store.ts';
import { oklchToHex, hexToOklch } from '../lib/color.ts';

interface Props {
  token: FlatToken;
}

export function TokenRow({ token }: Props) {
  const setTokenValue = useDesign((s) => s.setTokenValue);
  const name = token.path.join('.');
  const stringValue = Array.isArray(token.value) ? token.value.join(', ') : token.value;

  const handleTextChange = (next: string) => {
    if (token.type === 'fontFamily') {
      const arr = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setTokenValue(token.path, arr);
    } else {
      setTokenValue(token.path, next);
    }
  };

  return (
    <li className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <Sample token={token} onChange={handleTextChange} />
      <div className="flex flex-1 flex-col">
        <span className="font-mono text-xs text-foreground">{name}</span>
        {token.description ? (
          <span className="text-xs text-muted-foreground">{token.description}</span>
        ) : null}
      </div>
      <ValueInput value={stringValue} onCommit={handleTextChange} />
    </li>
  );
}

function Sample({
  token,
  onChange,
}: {
  token: FlatToken;
  onChange: (value: string) => void;
}) {
  if (token.type === 'color' && typeof token.value === 'string') {
    return <ColorSwatch value={token.value} onChange={onChange} />;
  }
  if (token.type === 'fontFamily') {
    const family = Array.isArray(token.value) ? token.value.join(', ') : token.value;
    return (
      <span
        className="inline-block w-6 shrink-0 text-center text-base"
        style={{ fontFamily: family }}
        aria-hidden="true"
      >
        Aa
      </span>
    );
  }
  if (token.type === 'dimension' && typeof token.value === 'string') {
    return (
      <span
        className="inline-block shrink-0 rounded bg-muted"
        style={{ width: token.value, height: '1.25rem' }}
        aria-hidden="true"
      />
    );
  }
  return <span className="inline-block size-6 shrink-0" aria-hidden="true" />;
}

function ColorSwatch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hex = oklchToHex(value) ?? value;

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="relative size-6 shrink-0 cursor-pointer rounded border border-border outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-foreground"
      style={{ background: value }}
      aria-label="Pick color"
    >
      <input
        ref={inputRef}
        type="color"
        defaultValue={hex}
        onChange={(e) => {
          const newHex = e.target.value;
          // Try preserving oklch format if original was oklch
          const next = value.startsWith('oklch') ? hexToOklch(newHex) ?? newHex : newHex;
          onChange(next);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
        tabIndex={-1}
      />
    </button>
  );
}

function ValueInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-56 rounded bg-transparent px-2 py-1 text-right font-mono text-xs text-muted-foreground outline-none transition focus:bg-muted focus:text-foreground focus:ring-1 focus:ring-border"
    />
  );
}

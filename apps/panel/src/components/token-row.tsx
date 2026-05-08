import type { FlatToken, TokenKind } from '@designmd-live/core';
import { useEffect, useRef, useState } from 'react';
import { hexToOklch, oklchToHex } from '../lib/color.ts';
import { validateValue } from '../lib/validate.ts';
import { useDesign } from '../store.ts';

interface Props {
  token: FlatToken;
}

function valueToString(value: FlatToken['value']): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

export function TokenRow({ token }: Props) {
  const setTokenValue = useDesign((s) => s.setTokenValue);
  const name = token.path.join('.');
  const stringValue = valueToString(token.value);
  const editable = typeof token.value !== 'object' || Array.isArray(token.value);

  const handleChange = (next: string) => {
    if (token.kind === 'fontFamily') {
      const arr = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setTokenValue(token.path, arr);
    } else if (token.kind === 'opacity' || token.kind === 'fontWeight' || token.kind === 'number') {
      const num = Number(next);
      setTokenValue(token.path, Number.isFinite(num) ? num : next);
    } else {
      setTokenValue(token.path, next);
    }
  };

  return (
    <li className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <Sample token={token} onChange={handleChange} />
      <div className="flex flex-1 flex-col">
        <span className="font-mono text-xs text-foreground">{name}</span>
        {token.description ? (
          <span className="text-xs text-muted-foreground">{token.description}</span>
        ) : null}
      </div>
      {editable ? (
        <ValueInput kind={token.kind} value={stringValue} onCommit={handleChange} />
      ) : (
        <span
          className="w-56 truncate text-right font-mono text-xs text-muted-foreground"
          title={stringValue}
        >
          {stringValue}
        </span>
      )}
    </li>
  );
}

function Sample({ token, onChange }: { token: FlatToken; onChange: (value: string) => void }) {
  const { kind, value } = token;

  if (kind === 'color' && typeof value === 'string') {
    return <ColorSwatch value={value} onChange={onChange} />;
  }

  if (kind === 'fontFamily') {
    const family = Array.isArray(value) ? value.join(', ') : String(value);
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

  if (kind === 'fontSize' && typeof value === 'string') {
    return (
      <span
        className="inline-block w-6 shrink-0 text-center"
        style={{ fontSize: value, lineHeight: 1 }}
        aria-hidden="true"
      >
        A
      </span>
    );
  }

  if (kind === 'fontWeight') {
    const weight = typeof value === 'number' || typeof value === 'string' ? value : 400;
    return (
      <span
        className="inline-block w-6 shrink-0 text-center text-sm"
        style={{ fontWeight: weight }}
        aria-hidden="true"
      >
        Aa
      </span>
    );
  }

  if (kind === 'dimension' && typeof value === 'string') {
    return (
      <span
        className="inline-block shrink-0 rounded bg-muted"
        style={{ width: value, height: '1.25rem' }}
        aria-hidden="true"
      />
    );
  }

  if (kind === 'shadow') {
    const css = typeof value === 'string' ? value : objectShadowToCss(value);
    return (
      <span
        className="inline-block size-6 shrink-0 rounded bg-background"
        style={{ boxShadow: css ?? 'none' }}
        aria-hidden="true"
      />
    );
  }

  if (kind === 'opacity') {
    const op = Number(value);
    const display = Number.isFinite(op) ? op : 1;
    return (
      <span
        className="inline-block size-6 shrink-0 rounded bg-foreground"
        style={{ opacity: display }}
        aria-hidden="true"
      />
    );
  }

  if (kind === 'duration') {
    return (
      <span
        className="inline-block size-6 shrink-0 rounded bg-muted text-center font-mono text-[10px] leading-6 text-muted-foreground"
        aria-hidden="true"
      >
        ⏱
      </span>
    );
  }

  return (
    <span
      className="inline-block size-6 shrink-0 rounded bg-muted text-center text-[10px] leading-6 text-muted-foreground"
      aria-hidden="true"
    >
      ?
    </span>
  );
}

function objectShadowToCss(value: FlatToken['value']): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const offsetX = String(obj.offsetX ?? '0');
  const offsetY = String(obj.offsetY ?? '0');
  const blur = String(obj.blur ?? '0');
  const spread = String(obj.spread ?? '0');
  const color = String(obj.color ?? 'rgba(0,0,0,0.1)');
  return `${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
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
        defaultValue={hex.startsWith('#') ? hex : '#000000'}
        onChange={(e) => {
          const newHex = e.target.value;
          const next = value.startsWith('oklch') ? (hexToOklch(newHex) ?? newHex) : newHex;
          onChange(next);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
        tabIndex={-1}
      />
    </button>
  );
}

function ValueInput({
  kind,
  value,
  onCommit,
}: {
  kind: TokenKind;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const validate = (next: string) => validateValue(kind, next);

  return (
    <div className="flex w-56 flex-col items-end">
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(validate(e.target.value));
        }}
        onBlur={() => {
          if (draft === value) return;
          const err = validate(draft);
          if (err) {
            setDraft(value);
            setError(null);
            return;
          }
          onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-invalid={error ? 'true' : undefined}
        className={`w-full rounded bg-transparent px-2 py-1 text-right font-mono text-xs outline-none transition focus:bg-muted focus:text-foreground focus:ring-1 ${
          error
            ? 'text-rose-600 ring-1 ring-rose-500/40 focus:ring-rose-500/60'
            : 'text-muted-foreground focus:ring-border'
        }`}
      />
      {error ? <span className="mt-0.5 text-[10px] text-rose-500">{error}</span> : null}
    </div>
  );
}

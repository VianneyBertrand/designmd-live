import type { FlatToken } from '@designmd-live/core';
import { TokenRow } from './token-row.tsx';

interface Props {
  tokens: FlatToken[];
}

const FRIENDLY_LABELS: Record<string, string> = {
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  borderRadius: 'Radius',
  border: 'Border',
  shadow: 'Shadow',
  shadows: 'Shadow',
  opacity: 'Opacity',
  duration: 'Motion',
  motion: 'Motion',
  zIndex: 'Layers',
};

function labelFor(category: string): string {
  return FRIENDLY_LABELS[category] ?? capitalize(category);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]?.toUpperCase() + s.slice(1);
}

export function TokenTree({ tokens }: Props) {
  const groups = groupByCategory(tokens);

  return (
    <div className="flex flex-col gap-8">
      {groups.map(([category, items]) => (
        <section key={category}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {labelFor(category)}
          </h2>
          <ul className="rounded-md border border-border px-3">
            {items.map((token) => (
              <TokenRow key={token.path.join('.')} token={token} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByCategory(tokens: FlatToken[]): [string, FlatToken[]][] {
  const map = new Map<string, FlatToken[]>();
  for (const token of tokens) {
    const bucket = map.get(token.category) ?? [];
    bucket.push(token);
    map.set(token.category, bucket);
  }
  return Array.from(map.entries());
}

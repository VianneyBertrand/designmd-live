import type { FlatToken } from '@designmd-live/core';
import { TokenRow } from './token-row.tsx';

interface Props {
  tokens: FlatToken[];
}

const CATEGORY_LABEL: Record<FlatToken['category'], string> = {
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
};

export function TokenTree({ tokens }: Props) {
  const groups = groupByCategory(tokens);

  return (
    <div className="flex flex-col gap-8">
      {(Object.keys(groups) as FlatToken['category'][]).map((category) => {
        const items = groups[category];
        if (!items?.length) return null;
        return (
          <section key={category}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABEL[category]}
            </h2>
            <ul className="rounded-md border border-border px-3">
              {items.map((token) => (
                <TokenRow key={token.path.join('.')} token={token} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function groupByCategory(tokens: FlatToken[]): Partial<Record<FlatToken['category'], FlatToken[]>> {
  const result: Partial<Record<FlatToken['category'], FlatToken[]>> = {};
  for (const token of tokens) {
    (result[token.category] ??= []).push(token);
  }
  return result;
}

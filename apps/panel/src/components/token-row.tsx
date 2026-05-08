import type { FlatToken } from '@designmd-live/core';

interface Props {
  token: FlatToken;
}

export function TokenRow({ token }: Props) {
  const name = token.path.join('.');
  const value = Array.isArray(token.value) ? token.value.join(', ') : token.value;

  return (
    <li className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <Sample token={token} />
      <div className="flex flex-1 flex-col">
        <span className="font-mono text-xs text-foreground">{name}</span>
        {token.description ? (
          <span className="text-xs text-muted-foreground">{token.description}</span>
        ) : null}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </li>
  );
}

function Sample({ token }: { token: FlatToken }) {
  if (token.type === 'color' && typeof token.value === 'string') {
    return (
      <span
        className="inline-block size-6 shrink-0 rounded border border-border"
        style={{ background: token.value }}
        aria-hidden="true"
      />
    );
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

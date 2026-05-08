import { useEffect } from 'react';
import { TokenTree } from './components/token-tree.tsx';
import { useDesign } from './store.ts';

export function App() {
  const { tokens, status, error, load } = useDesign();

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">designmd-live</h1>
        <p className="text-sm text-muted-foreground">
          Tweak your DESIGN.md, see your real app react. Live.
        </p>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        {status === 'loading' && <p className="text-sm text-muted-foreground">Loading DESIGN.md…</p>}

        {status === 'error' && (
          <div className="rounded-md border border-border bg-muted px-4 py-3">
            <p className="text-sm text-foreground">Could not load DESIGN.md</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{error}</p>
          </div>
        )}

        {status === 'ready' && tokens.length > 0 && <TokenTree tokens={tokens} />}

        {status === 'ready' && tokens.length === 0 && (
          <p className="text-sm text-muted-foreground">No tokens found in DESIGN.md.</p>
        )}
      </section>
    </main>
  );
}

import { useEffect } from 'react';
import { TokenTree } from './components/token-tree.tsx';
import { useDesign } from './store.ts';

export function App() {
  const { tokens, status, saveStatus, dirty, error, load, save } = useDesign();

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">designmd-live</h1>
          <p className="text-sm text-muted-foreground">
            Tweak your DESIGN.md, see your real app react. Live.
          </p>
        </div>
        <SaveControls dirty={dirty} saveStatus={saveStatus} onSave={save} />
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

function SaveControls({
  dirty,
  saveStatus,
  onSave,
}: {
  dirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onSave: () => void;
}) {
  const label = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save';
  const disabled = !dirty || saveStatus === 'saving';

  return (
    <div className="flex items-center gap-3">
      {dirty ? (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      ) : saveStatus === 'saved' ? (
        <span className="text-xs text-muted-foreground">All changes saved</span>
      ) : null}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="rounded-md border border-border bg-foreground px-3 py-1.5 text-xs font-medium text-background transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:opacity-90"
      >
        {label}
      </button>
    </div>
  );
}

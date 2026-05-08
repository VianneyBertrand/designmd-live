import { useEffect, useState } from 'react';

const STORAGE_KEY = 'designmd-live:target-url';
const DEFAULT_URL = 'http://localhost:3000';

export function PreviewFrame() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [draft, setDraft] = useState(DEFAULT_URL);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setUrl(stored);
      setDraft(stored);
    }
  }, []);

  const commit = (next: string) => {
    setUrl(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <label className="sr-only" htmlFor="target-url">
          Target URL
        </label>
        <input
          id="target-url"
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft);
            if (e.key === 'Escape') setDraft(url);
          }}
          onBlur={() => {
            if (draft !== url) commit(draft);
          }}
          placeholder="http://localhost:3000"
          className="flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
        />
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          aria-label="Reload preview"
        >
          ↻
        </button>
      </div>
      <div className="relative flex-1 bg-muted">
        {url ? (
          <iframe
            key={`${url}-${reloadKey}`}
            src={url}
            title="Live preview"
            className="size-full border-0"
          />
        ) : (
          <p className="m-6 text-sm text-muted-foreground">Set a URL to preview.</p>
        )}
      </div>
    </section>
  );
}

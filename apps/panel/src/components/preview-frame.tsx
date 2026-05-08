import { useEffect, useState } from 'react';
import { fetchConfig } from '../lib/config.ts';

const STORAGE_KEY = 'designmd-live:target-url';
const FALLBACK_URL = 'http://localhost:3000';

export function PreviewFrame() {
  const [proxyMode, setProxyMode] = useState<boolean | null>(null);
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [url, setUrl] = useState(FALLBACK_URL);
  const [draft, setDraft] = useState(FALLBACK_URL);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchConfig().then((cfg) => {
      if (cancelled) return;
      if (cfg?.proxy) {
        // The proxy is at the panel host root.
        const origin = window.location.origin;
        const next = origin + cfg.proxy.path;
        setProxyMode(true);
        setProxyUrl(next);
        setUrl(next);
        setDraft(next);
        return;
      }
      setProxyMode(false);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setUrl(stored);
        setDraft(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = (next: string) => {
    setUrl(next);
    if (!proxyMode) localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        {proxyMode ? (
          <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
            <span className="mr-2 inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background">
              proxy
            </span>
            {proxyUrl}
          </span>
        ) : (
          <>
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
          </>
        )}
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

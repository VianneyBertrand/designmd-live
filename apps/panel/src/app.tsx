import { useEffect, useState } from 'react';
import { ConnectionDot } from './components/connection-dot.tsx';
import { PreviewFrame } from './components/preview-frame.tsx';
import { TokenTree } from './components/token-tree.tsx';
import { startWs } from './lib/ws.ts';
import { useDesign } from './store.ts';

const SIDEBAR_KEY = 'designmd-live:sidebar-collapsed';

export function App() {
  const {
    tokens,
    status,
    saveStatus,
    dirty,
    externalChange,
    error,
    inspectMode,
    load,
    save,
    dismissExternalChange,
    toggleInspectMode,
  } = useDesign();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    startWs();
    load();
  }, [load]);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === 'true') setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Show tokens panel' : 'Hide tokens panel'}
            className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <SidebarIcon collapsed={sidebarCollapsed} />
          </button>
          <h1 className="text-sm font-semibold tracking-tight">designmd-live</h1>
          <p className="text-xs text-muted-foreground">
            Tweak your DESIGN.md, see your real app react.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionDot />
          <button
            type="button"
            onClick={toggleInspectMode}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              inspectMode
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
            aria-pressed={inspectMode}
          >
            {inspectMode ? '◉ Inspecting' : '◎ Inspect'}
          </button>
          <SaveControls dirty={dirty} saveStatus={saveStatus} onSave={save} />
        </div>
      </header>

      {externalChange ? (
        <ExternalChangeBanner onReload={() => void load()} onDismiss={dismissExternalChange} />
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`shrink-0 overflow-hidden border-border transition-[width,border-right-width] duration-200 ease-out ${
            sidebarCollapsed ? 'w-0 border-r-0' : 'w-[420px] border-r'
          }`}
          aria-hidden={sidebarCollapsed}
        >
          <div className="flex h-full w-[420px] flex-col overflow-y-auto px-6 py-6">
            {status === 'loading' && (
              <p className="text-sm text-muted-foreground">Loading DESIGN.md…</p>
            )}

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
          </div>
        </aside>

        <div className="flex-1 overflow-hidden">
          <PreviewFrame />
        </div>
      </div>
    </main>
  );
}

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  // A tiny "panel" pictogram: vertical bar on one side, hollow rectangle on the other.
  // The bar flips sides depending on collapsed state to telegraph what the click does.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="14" height="12" rx="2" />
      {collapsed ? (
        <line x1="13" y1="4" x2="13" y2="16" />
      ) : (
        <line x1="7" y1="4" x2="7" y2="16" />
      )}
    </svg>
  );
}

function ExternalChangeBanner({
  onReload,
  onDismiss,
}: {
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs">
      <span className="text-foreground">
        DESIGN.md was changed on disk. You have unsaved edits in the panel.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReload}
          className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground transition hover:bg-muted"
        >
          Reload from disk
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2.5 py-1 text-muted-foreground transition hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
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

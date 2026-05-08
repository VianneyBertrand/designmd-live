export function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-6">
          <span className="flex items-center gap-2 text-title">
            <span
              className="inline-block size-3 rounded-sm bg-brand-500 transition-token"
              aria-hidden="true"
            />
            Acme
          </span>
          <nav className="flex items-center gap-6 text-caption">
            {NAV.map((item) => (
              <button
                key={item}
                type="button"
                className="text-foreground/70 transition-token hover:text-foreground"
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              className="rounded-md bg-brand-500 px-4 py-2 text-caption text-background shadow-token-sm transition-token hover:opacity-90"
            >
              Get started
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-8">
        <section className="py-12">
          <p className="mb-2 inline-block rounded-md bg-brand-50 px-3 py-1 text-caption text-brand-900">
            New · Live token editing
          </p>
          <h1 className="text-hero">
            A design system you can <span className="text-brand-500">tweak in real time</span>
          </h1>
          <p className="mt-4 max-w-2xl text-body text-foreground/70">
            Open the side panel, change a token, watch every component on this page react. No
            reload, no rebuild.
          </p>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-brand-500 px-5 py-2.5 text-caption text-background shadow-token-md transition-token hover:opacity-90"
            >
              Start tweaking
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-background px-5 py-2.5 text-caption text-foreground transition-token hover:bg-muted"
            >
              View on GitHub
            </button>
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="rounded-lg border border-border bg-background p-6 shadow-token-sm transition-token hover:bg-muted hover:shadow-token-md"
            >
              <div className="mb-4 inline-flex size-8 items-center justify-center rounded-md bg-brand-50 text-brand-500">
                <span aria-hidden="true">{f.icon}</span>
              </div>
              <h3 className="text-title">{f.title}</h3>
              <p className="mt-1 text-caption text-foreground/70">{f.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-16 rounded-xl border border-border bg-muted/40 p-8 shadow-token-lg">
          <div className="flex items-baseline justify-between">
            <h2 className="text-title">Recent activity</h2>
            <button
              type="button"
              className="text-caption text-brand-500 transition-token hover:opacity-80"
            >
              View all →
            </button>
          </div>
          <ul className="mt-6 divide-y divide-border">
            {ACTIVITY.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block size-8 rounded-full bg-brand-50"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-caption text-foreground">{a.title}</p>
                    <p className="text-caption text-foreground/60">{a.subtitle}</p>
                  </div>
                </div>
                <span className="rounded-md bg-brand-500/10 px-2 py-1 text-caption text-brand-500">
                  {a.tag}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-16 border-t border-border pt-8 pb-12 text-caption text-foreground/60">
          <p>© 2026 Acme. Built for the designmd-live demo.</p>
        </footer>
      </main>
    </div>
  );
}

const NAV = ['Product', 'Pricing', 'Docs'];

const FEATURES = [
  {
    icon: '◉',
    title: 'Token-first',
    body: 'Every visual decision lives in your DESIGN.md. Edit there, see results everywhere.',
  },
  {
    icon: '↻',
    title: 'Live preview',
    body: 'CSS variables hot-swap on the fly — no rebuild, no reload, no waiting.',
  },
  {
    icon: '◐',
    title: 'Framework-agnostic',
    body: 'Works with any project consuming custom properties. Tailwind v4 ships ready.',
  },
];

const ACTIVITY = [
  { id: 1, title: 'New brand color shipped', subtitle: 'Updated by Marie · 2m ago', tag: 'design' },
  {
    id: 2,
    title: 'Spacing scale tightened',
    subtitle: 'Updated by Thomas · 1h ago',
    tag: 'tokens',
  },
  { id: 3, title: 'Typography review', subtitle: 'Started by Léa · 3h ago', tag: 'review' },
];

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenTokens, parseDesignMd } from '@designmd-live/core';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import chokidar from 'chokidar';
import { consola } from 'consola';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { AGENT_SCRIPT } from './agent.ts';
import { proxyMiddleware } from './proxy.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = resolve(__dirname, 'panel');
const HAS_PANEL = existsSync(join(PANEL_DIR, 'index.html'));
const PANEL_PREFIX = '/__designmd-live';

interface ServerOptions {
  port: number;
  cwd: string;
  proxy?: string | null;
}

export async function startServer({ port, cwd, proxy }: ServerOptions): Promise<void> {
  const app = new Hono();
  const proxyTarget = normalizeProxyTarget(proxy);

  // ── API ────────────────────────────────────────────────────────────────
  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/config', (c) =>
    c.json({
      proxy: proxyTarget ? { target: proxyTarget, path: '/' } : null,
      panelPath: PANEL_PREFIX,
    }),
  );

  app.get('/api/design-md', async (c) => {
    const path = join(cwd, 'DESIGN.md');
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseDesignMd(raw);
      return c.json({ raw, parsed });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  let lastWriteAt = 0;
  app.post('/api/design-md', async (c) => {
    const path = join(cwd, 'DESIGN.md');
    const { raw } = await c.req.json<{ raw: string }>();
    parseDesignMd(raw);
    lastWriteAt = Date.now();
    await writeFile(path, raw, 'utf8');
    return c.json({ ok: true });
  });

  // ── Browser agent ──────────────────────────────────────────────────────
  app.get('/client.js', (c) => {
    c.header('content-type', 'application/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(AGENT_SCRIPT);
  });

  // ── Panel UI ───────────────────────────────────────────────────────────
  if (HAS_PANEL) {
    // Strip the prefix so /__designmd-live/foo → look up /foo on disk.
    app.use(
      `${PANEL_PREFIX}/*`,
      serveStatic({
        root: PANEL_DIR,
        rewriteRequestPath: (path) => {
          const stripped = path.replace(PANEL_PREFIX, '') || '/';
          return stripped === '/' ? '/index.html' : stripped;
        },
      }),
    );
    // SPA fallback (handles a refresh on a deep panel route)
    app.get(`${PANEL_PREFIX}/*`, async (c) => {
      const html = await readFile(join(PANEL_DIR, 'index.html'), 'utf8');
      return c.html(html);
    });
  }

  // ── Root + proxy ───────────────────────────────────────────────────────
  if (proxyTarget) {
    app.all('*', proxyMiddleware({ target: proxyTarget, panelPrefix: PANEL_PREFIX }));
  } else if (HAS_PANEL) {
    // No proxy: root serves the panel directly (no prefix needed).
    app.get('/', (c) => c.redirect(`${PANEL_PREFIX}/`));
  } else {
    app.get('/', (c) =>
      c.text(
        `designmd-live (API-only mode — panel statics not bundled)\n\nAPI:\n  GET  /api/design-md\n  POST /api/design-md\n  GET  /api/config\n  GET  /client.js\n  WS   /ws\n`,
      ),
    );
  }

  // ── Boot HTTP server + WS broker ───────────────────────────────────────
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const text = data.toString();
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(text);
        }
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  // ── File watcher: external edits propagate to all clients ──────────────
  const designMdPath = join(cwd, 'DESIGN.md');
  const watcher = chokidar.watch(designMdPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });

  watcher.on('change', async () => {
    // Suppress the echo for ~750ms after our own POST write.
    if (Date.now() - lastWriteAt < 750) return;
    try {
      const raw = await readFile(designMdPath, 'utf8');
      const parsed = parseDesignMd(raw);
      const tokens = flattenTokens(parsed.tokens).map((t) => ({
        path: t.path,
        value: t.value,
      }));
      const msg = JSON.stringify({ type: 'snapshot', tokens, source: 'watcher' });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
      consola.info('DESIGN.md changed externally — pushed snapshot to clients');
    } catch (err) {
      consola.warn('Failed to reparse DESIGN.md on change:', (err as Error).message);
    }
  });

  // ── Logging ────────────────────────────────────────────────────────────
  consola.success(`Panel ready at http://localhost:${port}${PANEL_PREFIX}/`);
  if (proxyTarget) {
    consola.success(`Proxying ${proxyTarget} at http://localhost:${port}/`);
    consola.info('Agent script injected automatically — no project changes needed.');
  } else {
    consola.info(`Agent script: <script src="http://localhost:${port}/client.js"></script>`);
  }
  consola.info(`WS broker: ws://localhost:${port}/ws`);
  if (!HAS_PANEL) {
    consola.warn('Panel statics missing — running in API-only / dev mode');
  }
}

function normalizeProxyTarget(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return new URL(input).origin;
  } catch {
    consola.warn(`Invalid --proxy URL "${input}", ignoring`);
    return null;
  }
}

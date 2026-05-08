import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { parseDesignMd } from '@designmd-live/core';
import { consola } from 'consola';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { AGENT_SCRIPT } from './agent.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = resolve(__dirname, 'panel');
const HAS_PANEL = existsSync(join(PANEL_DIR, 'index.html'));

interface ServerOptions {
  port: number;
  cwd: string;
}

export async function startServer({ port, cwd }: ServerOptions): Promise<void> {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

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

  app.post('/api/design-md', async (c) => {
    const path = join(cwd, 'DESIGN.md');
    const { raw } = await c.req.json<{ raw: string }>();
    parseDesignMd(raw);
    await writeFile(path, raw, 'utf8');
    return c.json({ ok: true });
  });

  app.get('/client.js', (c) => {
    c.header('content-type', 'application/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(AGENT_SCRIPT);
  });

  if (HAS_PANEL) {
    app.use(
      '/*',
      serveStatic({
        root: PANEL_DIR,
        rewriteRequestPath: (path) => (path === '/' ? '/index.html' : path),
      }),
    );
    // SPA fallback: any unmatched route serves index.html
    app.get('*', async (c) => {
      const html = await readFile(join(PANEL_DIR, 'index.html'), 'utf8');
      return c.html(html);
    });
  } else {
    app.get('/', (c) =>
      c.text(
        `designmd-live (dev mode — panel statics not bundled)\n\nAPI:\n  GET  /api/design-md\n  POST /api/design-md\n  GET  /client.js\n  WS   /ws\n\nRun the panel separately: pnpm --filter @designmd-live/panel dev\n`,
      ),
    );
  }

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

  consola.success(`Panel ready at http://localhost:${port}`);
  consola.info(`WS broker on ws://localhost:${port}/ws`);
  if (!HAS_PANEL) {
    consola.warn('Panel statics missing — running in API-only / dev mode');
  }
  consola.info(`Agent script: <script src="http://localhost:${port}/client.js"></script>`);
}

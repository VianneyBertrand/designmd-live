import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { parseDesignMd } from '@designmd-live/core';
import { consola } from 'consola';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { AGENT_SCRIPT } from './agent.ts';

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

  app.get('/', (c) =>
    c.text(
      `designmd-live\n\nAPI:\n  GET  /api/design-md\n  POST /api/design-md\n  GET  /client.js  (browser agent)\n  WS   /ws        (broker)\n`,
    ),
  );

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
  consola.info(`Agent script: <script src="http://localhost:${port}/client.js"></script>`);
}

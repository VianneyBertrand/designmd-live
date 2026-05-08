import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { parseDesignMd } from '@designmd-live/core';
import { consola } from 'consola';
import { Hono } from 'hono';

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
    parseDesignMd(raw); // throws if invalid
    await writeFile(path, raw, 'utf8');
    return c.json({ ok: true });
  });

  app.get('/', (c) => c.text('designmd-live panel coming soon. API at /api/*'));

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  consola.success(`Panel ready at http://localhost:${port}`);
}

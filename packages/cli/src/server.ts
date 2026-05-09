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
import { getAgentScript } from './agent.ts';
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
  // Read fresh on every request so tsup rebuilds are picked up without
  // restarting the CLI process.
  app.get('/client.js', (c) => {
    c.header('content-type', 'application/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(getAgentScript());
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

  async function snapshotMessage(): Promise<string | null> {
    try {
      const raw = await readFile(join(cwd, 'DESIGN.md'), 'utf8');
      const parsed = parseDesignMd(raw);
      const tokens = flattenTokens(parsed.tokens).map((t) => ({ path: t.path, value: t.value }));
      return JSON.stringify({ type: 'snapshot', tokens, source: 'broker-init' });
    } catch {
      return null;
    }
  }

  wss.on('connection', async (ws) => {
    // Replay the current snapshot to every newcomer so target apps that
    // attach after the panel still receive the token cache.
    const snap = await snapshotMessage();
    if (snap && ws.readyState === ws.OPEN) ws.send(snap);

    ws.on('message', async (data) => {
      const text = data.toString();
      // Intercept swap-utility messages before relaying — they require a
      // server-side file edit, not just a broadcast.
      try {
        const msg = JSON.parse(text);
        if (msg?.type === 'swap-utility') {
          await handleSwapUtility(ws, msg, cwd);
          return;
        }
      } catch {
        // Not JSON or malformed — fall through to broadcast.
      }
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

interface SwapUtilityMessage {
  type: 'swap-utility';
  file: string;
  line: number;
  col: number;
  oldClass: string;
  newClass: string;
}

async function handleSwapUtility(
  ws: { send: (data: string) => void; readyState: number; OPEN: number },
  msg: SwapUtilityMessage,
  cwd: string,
): Promise<void> {
  const respond = (payload: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };
  if (!msg.file || !msg.oldClass || !msg.newClass || typeof msg.line !== 'number') {
    respond({ type: 'swap-utility-error', message: 'malformed payload' });
    return;
  }
  // Resolve file path safely under cwd.
  const target = resolve(cwd, msg.file);
  if (!target.startsWith(cwd)) {
    respond({ type: 'swap-utility-error', message: 'file outside project root' });
    return;
  }
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
  } catch (err) {
    respond({ type: 'swap-utility-error', message: `read failed: ${(err as Error).message}` });
    return;
  }
  const swapped = swapUtilityAtLoc(raw, msg.line, msg.col, msg.oldClass, msg.newClass);
  if (!swapped) {
    respond({
      type: 'swap-utility-error',
      message: `utility "${msg.oldClass}" not found at ${msg.file}:${msg.line}:${msg.col}`,
    });
    return;
  }
  try {
    await writeFile(target, swapped, 'utf8');
    respond({ type: 'swap-utility-ok', file: msg.file, line: msg.line });
    consola.info(`swap ${msg.file}:${msg.line} ${msg.oldClass} → ${msg.newClass}`);
  } catch (err) {
    respond({ type: 'swap-utility-error', message: `write failed: ${(err as Error).message}` });
  }
}

/**
 * Given a JSX opening-element location (line:col, 1-based), scan forward to
 * find the className attribute of THAT element and swap `oldClass` → `newClass`
 * inside it. Returns the new file content, or null if not found / unsupported.
 *
 * Supports:
 *   - string literals:           className="..." / '...' / `...`
 *   - JSX expressions:           className={cn('mt-6', ...)}, {clsx(...)},
 *                                ternaries, any expression containing string
 *                                literals — swaps the first string literal
 *                                whose tokens include `oldClass`.
 *
 * Not supported (Phase 3):
 *   - cva() variant tables in a separate file
 *   - identifiers that resolve to a class name (only string literals work)
 */
function swapUtilityAtLoc(
  content: string,
  line: number,
  col: number,
  oldClass: string,
  newClass: string,
): string | null {
  const lines = content.split('\n');
  if (line < 1 || line > lines.length) return null;
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i]!.length + 1;
  offset += Math.max(0, col);

  let i = offset;
  while (i < content.length) {
    const ch = content[i]!;
    if (ch === '>') return null;
    if (ch === '<' && i !== offset) return null;
    const lookahead = content.slice(i, i + 12);
    const m = lookahead.match(/^(class(?:Name)?)\s*=\s*/);
    if (m) {
      const attrEnd = i + m[0].length;
      const next = content[attrEnd];
      if (next === '"' || next === "'" || next === '`') {
        return swapInStringLiteral(content, attrEnd, oldClass, newClass);
      }
      if (next === '{') {
        const close = findMatchingBrace(content, attrEnd);
        if (close === -1) return null;
        return swapFirstStringInRange(content, attrEnd + 1, close, oldClass, newClass);
      }
      return null;
    }
    i++;
  }
  return null;
}

function swapInStringLiteral(
  content: string,
  openIdx: number,
  oldClass: string,
  newClass: string,
): string | null {
  const quote = content[openIdx]!;
  const stringStart = openIdx + 1;
  const stringEnd = content.indexOf(quote, stringStart);
  if (stringEnd === -1) return null;
  const stringVal = content.slice(stringStart, stringEnd);
  const oldEsc = oldClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = new RegExp(`(^|\\s)(${oldEsc})(\\s|$)`);
  if (!tokenRe.test(stringVal)) return null;
  const newStringVal = stringVal.replace(tokenRe, `$1${newClass}$3`);
  return content.slice(0, stringStart) + newStringVal + content.slice(stringEnd);
}

/**
 * Find string literals between `start` and `end` (exclusive end); swap
 * `oldClass` → `newClass` inside the first one whose tokens include it.
 */
function swapFirstStringInRange(
  content: string,
  start: number,
  end: number,
  oldClass: string,
  newClass: string,
): string | null {
  const oldEsc = oldClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = new RegExp(`(^|\\s)(${oldEsc})(\\s|$)`);
  let i = start;
  while (i < end) {
    const c = content[i]!;
    if (c === '"' || c === "'") {
      const e = findStringEnd(content, i, end);
      if (e === -1) return null;
      const val = content.slice(i + 1, e);
      if (tokenRe.test(val)) {
        const next = val.replace(tokenRe, `$1${newClass}$3`);
        return content.slice(0, i + 1) + next + content.slice(e);
      }
      i = e + 1;
      continue;
    }
    // Backticks may contain ${...}; only swap in static segments.
    if (c === '`') {
      const result = swapInTemplateLiteral(content, i, end, oldClass, newClass);
      if (result !== null) return result;
      // Skip to the closing backtick to avoid re-scanning inside.
      i = skipTemplateLiteral(content, i, end);
      continue;
    }
    i++;
  }
  return null;
}

function findStringEnd(content: string, openIdx: number, limit: number): number {
  const quote = content[openIdx]!;
  let i = openIdx + 1;
  while (i < limit) {
    const c = content[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i;
    i++;
  }
  return -1;
}

function swapInTemplateLiteral(
  content: string,
  openIdx: number,
  limit: number,
  oldClass: string,
  newClass: string,
): string | null {
  // Walk through static segments separated by ${...}; swap in first segment
  // whose tokens include oldClass.
  const oldEsc = oldClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = new RegExp(`(^|\\s)(${oldEsc})(\\s|$)`);
  let i = openIdx + 1;
  let segStart = i;
  while (i < limit) {
    const c = content[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      const seg = content.slice(segStart, i);
      if (tokenRe.test(seg)) {
        const next = seg.replace(tokenRe, `$1${newClass}$3`);
        return content.slice(0, segStart) + next + content.slice(i);
      }
      return null;
    }
    if (c === '$' && content[i + 1] === '{') {
      const seg = content.slice(segStart, i);
      if (tokenRe.test(seg)) {
        const next = seg.replace(tokenRe, `$1${newClass}$3`);
        return content.slice(0, segStart) + next + content.slice(i);
      }
      // Skip the ${...} expression
      const endExpr = findMatchingBrace(content, i + 1);
      if (endExpr === -1) return null;
      i = endExpr + 1;
      segStart = i;
      continue;
    }
    i++;
  }
  return null;
}

function skipTemplateLiteral(content: string, openIdx: number, limit: number): number {
  let i = openIdx + 1;
  while (i < limit) {
    const c = content[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && content[i + 1] === '{') {
      const e = findMatchingBrace(content, i + 1);
      if (e === -1) return limit;
      i = e + 1;
      continue;
    }
    i++;
  }
  return limit;
}

/**
 * Find the matching `}` for the `{` at `openIdx`. Tracks string literals
 * (single, double, backtick) and template-literal `${...}` expressions so
 * braces inside strings don't throw off the count.
 */
function findMatchingBrace(content: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  let inStr: '"' | "'" | '`' | null = null;
  // Stack of brace depths captured when entering ${...} from a backtick.
  const tplStack: number[] = [];
  while (i < content.length) {
    const c = content[i]!;
    if (inStr === '"' || inStr === "'") {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (inStr === '`') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        inStr = null;
        i++;
        continue;
      }
      if (c === '$' && content[i + 1] === '{') {
        tplStack.push(depth);
        depth++;
        inStr = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // Not in a string.
    if (c === '"' || c === "'" || c === '`') {
      inStr = c as '"' | "'" | '`';
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
      // If we just closed a template ${...}, re-enter the backtick.
      if (tplStack.length > 0 && depth === tplStack[tplStack.length - 1]) {
        tplStack.pop();
        inStr = '`';
      }
    }
    i++;
  }
  return -1;
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

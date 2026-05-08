import type { Context } from 'hono';

interface ProxyOptions {
  target: string;
  panelPrefix: string;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const SCRIPT_TAG = `<script src="/client.js" async data-designmd-live></script>`;

export function proxyMiddleware({ target, panelPrefix }: ProxyOptions) {
  return async (c: Context) => {
    const incoming = new URL(c.req.url);

    // Reserved paths bypass the proxy.
    if (
      incoming.pathname === '/client.js' ||
      incoming.pathname === '/ws' ||
      incoming.pathname.startsWith('/api/') ||
      incoming.pathname.startsWith(`${panelPrefix}/`)
    ) {
      return c.notFound();
    }

    const targetUrl = new URL(incoming.pathname + incoming.search, target);

    const reqHeaders = forwardHeaders(c.req.raw.headers, target);

    const init: RequestInit = {
      method: c.req.method,
      headers: reqHeaders,
      redirect: 'manual',
    };

    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      init.body = await c.req.arrayBuffer();
      // Fetch with body needs duplex in Node.js
      (init as RequestInit & { duplex?: string }).duplex = 'half';
    }

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (err) {
      return c.text(
        `designmd-live proxy: target unreachable (${target}).\n${(err as Error).message}`,
        502,
      );
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const respHeaders = stripHopByHop(upstream.headers);

    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      const injected = injectAgent(html);
      respHeaders.delete('content-length');
      respHeaders.delete('content-encoding');
      respHeaders.set('content-type', contentType);
      return new Response(injected, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  };
}

function forwardHeaders(src: Headers, target: string): Headers {
  const headers = new Headers();
  for (const [k, v] of src.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  // Override Host so the upstream sees the target's host
  try {
    headers.set('host', new URL(target).host);
  } catch {
    /* noop */
  }
  // Strip accept-encoding so we always receive plain HTML we can rewrite.
  headers.set('accept-encoding', 'identity');
  return headers;
}

function stripHopByHop(src: Headers): Headers {
  const headers = new Headers();
  for (const [k, v] of src.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  return headers;
}

function injectAgent(html: string): string {
  if (html.includes('data-designmd-live')) return html;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${SCRIPT_TAG}</head>`);
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${SCRIPT_TAG}</body>`);
  }
  return html + SCRIPT_TAG;
}

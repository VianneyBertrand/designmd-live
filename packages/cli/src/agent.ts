/**
 * Browser agent script.
 * Served by the CLI at GET /client.js so target projects can inject:
 *   <script src="http://localhost:3030/client.js"></script>
 *
 * It connects to the WS broker, listens for token updates, and applies
 * them to :root as CSS custom properties. Variable names are derived
 * from token paths joined by `-` (e.g. ['color','brand','500'] → --color-brand-500),
 * matching Tailwind v4 @theme conventions.
 */
export const AGENT_SCRIPT = `(() => {
  const WS_PATH = '/ws';
  const STYLE_ID = 'designmd-live-overrides';
  const overrides = Object.create(null);

  const wsUrl = (() => {
    const s = document.currentScript;
    const src = s && 'src' in s ? s.src : '';
    try {
      const u = new URL(src);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + u.host + WS_PATH;
    } catch {
      return 'ws://localhost:3030' + WS_PATH;
    }
  })();

  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  }

  function render() {
    const lines = [];
    for (const k in overrides) lines.push('  --' + k + ': ' + overrides[k] + ';');
    ensureStyle().textContent = ':root {\\n' + lines.join('\\n') + '\\n}';
  }

  function pathToVar(path) {
    return path.join('-');
  }

  function apply(msg) {
    if (msg.type === 'token-update') {
      const v = Array.isArray(msg.value) ? msg.value.join(', ') : msg.value;
      overrides[pathToVar(msg.path)] = v;
      render();
    } else if (msg.type === 'reset') {
      for (const k in overrides) delete overrides[k];
      render();
    } else if (msg.type === 'snapshot' && Array.isArray(msg.tokens)) {
      for (const k in overrides) delete overrides[k];
      for (const t of msg.tokens) {
        const v = Array.isArray(t.value) ? t.value.join(', ') : t.value;
        overrides[pathToVar(t.path)] = v;
      }
      render();
    }
  }

  let retry = 0;
  function connect() {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { schedule(); return; }
    ws.addEventListener('open', () => {
      retry = 0;
      ws.send(JSON.stringify({ type: 'hello', role: 'target' }));
    });
    ws.addEventListener('message', (e) => {
      try { apply(JSON.parse(e.data)); } catch {}
    });
    ws.addEventListener('close', schedule);
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  function schedule() {
    retry = Math.min(retry + 1, 10);
    setTimeout(connect, 250 * retry);
  }
  connect();
})();
`;

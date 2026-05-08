/**
 * Browser agent script.
 *
 * Served by the CLI at GET /client.js. Two responsibilities:
 *
 * 1. Live token override — listens to the WS broker, applies token
 *    updates as CSS custom properties on `:root`. Variable names are
 *    derived from token paths joined by `-` (Tailwind v4 convention).
 *
 * 2. Inspector mode — when enabled by the panel, draws a hover overlay
 *    over the user's app, identifies which tokens correspond to the
 *    element's computed styles, and on click reports back so the panel
 *    can focus and edit them.
 */
export const AGENT_SCRIPT = `(() => {
  const WS_PATH = '/ws';
  const STYLE_ID = 'designmd-live-overrides';
  const OVERLAY_ID = 'designmd-live-overlay';
  const LABEL_ID = 'designmd-live-label';
  const overrides = Object.create(null);
  const tokens = []; // cached snapshot for reverse lookups
  let inspectMode = false;
  let hoverEl = null;
  let activeWs = null;

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

  // ── token override pipeline ─────────────────────────────────────────
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

  function pathToVar(path) { return path.join('-'); }
  function valueAsString(v) { return Array.isArray(v) ? v.join(', ') : String(v); }

  function apply(msg) {
    if (msg.type === 'token-update') {
      overrides[pathToVar(msg.path)] = valueAsString(msg.value);
      // also update local cache for inspector
      const existing = tokens.find(t => sameArr(t.path, msg.path));
      if (existing) existing.value = msg.value;
      render();
    } else if (msg.type === 'reset') {
      for (const k in overrides) delete overrides[k];
      render();
    } else if (msg.type === 'snapshot' && Array.isArray(msg.tokens)) {
      for (const k in overrides) delete overrides[k];
      tokens.length = 0;
      for (const t of msg.tokens) {
        overrides[pathToVar(t.path)] = valueAsString(t.value);
        tokens.push({ path: t.path, value: t.value });
      }
      render();
    } else if (msg.type === 'inspect-mode') {
      setInspectMode(!!msg.enabled);
    }
  }

  function sameArr(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ── inspector ───────────────────────────────────────────────────────
  function rootFontPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }
  function toPx(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^(-?[\\d.]+)(rem|em|px|%)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'px').toLowerCase();
    if (unit === 'px') return n;
    if (unit === 'rem' || unit === 'em') return n * rootFontPx();
    return null;
  }
  function tokenMatchesValue(token, valueStr) {
    if (Array.isArray(token.value)) return false;
    if (typeof token.value === 'object') return false;
    const tv = String(token.value).trim();
    const v = valueStr.trim();
    if (tv === v) return true;
    // Unitless line-height tokens: computed style returns px (e.g. 1.5 over 16px → "24px").
    // Compare numerically against the parsed px equivalent assuming the current root font-size.
    const numericTv = Number(tv);
    if (Number.isFinite(numericTv) && /^\\d+(\\.\\d+)?(\\.\\d+)?$/.test(tv)) {
      const vpx = toPx(v);
      if (vpx != null) return Math.abs(numericTv * rootFontPx() - vpx) < 0.6;
    }
    const tpx = toPx(token.value);
    const vpx = toPx(v);
    if (tpx == null || vpx == null) return false;
    return Math.abs(tpx - vpx) < 0.5;
  }
  function tokensForValue(valueStr, hint) {
    const out = [];
    for (const t of tokens) {
      if (hint && !pathHintMatches(t.path, hint)) continue;
      if (tokenMatchesValue(t, valueStr)) out.push(t);
    }
    return out;
  }
  function pathHintMatches(path, hint) {
    if (hint === 'spacing') return path[0] === 'spacing';
    if (hint === 'radius') return path[0] === 'radius' || path[0] === 'borderRadius';
    if (hint === 'fontSize') return path[0] === 'typography' && (path[1] === 'size' || path[1] === 'sizes');
    if (hint === 'lineHeight') return path[0] === 'typography' && (path[1] === 'lineHeight' || path[1] === 'leading');
    if (hint === 'letterSpacing') return path[0] === 'typography' && (path[1] === 'letterSpacing' || path[1] === 'tracking');
    if (hint === 'fontWeight') return path[0] === 'typography' && (path[1] === 'weight' || path[1] === 'weights');
    if (hint === 'color') return path[0] === 'color';
    if (hint === 'shadow') return path[0] === 'shadow' || path[0] === 'shadows';
    return true;
  }

  function inspectElement(el) {
    const cs = getComputedStyle(el);
    const props = [];
    function add(prop, value, hint) {
      if (!value || value === 'normal' || value === '0px' || value === 'none') return;
      const matches = tokensForValue(value, hint);
      props.push({ prop, value, tokens: matches });
    }
    add('font-size', cs.fontSize, 'fontSize');
    add('font-weight', cs.fontWeight, 'fontWeight');
    add('line-height', cs.lineHeight, 'lineHeight');
    add('letter-spacing', cs.letterSpacing, 'letterSpacing');
    add('color', cs.color, 'color');
    add('background-color', cs.backgroundColor, 'color');
    add('padding-top', cs.paddingTop, 'spacing');
    add('padding-right', cs.paddingRight, 'spacing');
    add('padding-bottom', cs.paddingBottom, 'spacing');
    add('padding-left', cs.paddingLeft, 'spacing');
    add('margin-top', cs.marginTop, 'spacing');
    add('margin-right', cs.marginRight, 'spacing');
    add('margin-bottom', cs.marginBottom, 'spacing');
    add('margin-left', cs.marginLeft, 'spacing');
    add('gap', cs.gap, 'spacing');
    add('row-gap', cs.rowGap, 'spacing');
    add('column-gap', cs.columnGap, 'spacing');
    add('border-radius', cs.borderTopLeftRadius, 'radius');
    add('box-shadow', cs.boxShadow, 'shadow');
    return props;
  }

  function ensureOverlay() {
    let box = document.getElementById(OVERLAY_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = OVERLAY_ID;
      Object.assign(box.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
        boxSizing: 'border-box',
        border: '2px solid oklch(0.65 0.18 250)',
        borderRadius: '3px',
        transition: 'all 80ms ease-out',
      });
      document.body.appendChild(box);
    }
    let label = document.getElementById(LABEL_ID);
    if (!label) {
      label = document.createElement('div');
      label.id = LABEL_ID;
      Object.assign(label.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
        background: 'oklch(0.15 0 0)', color: 'oklch(0.96 0 0)',
        padding: '6px 8px', borderRadius: '6px',
        font: '11px ui-monospace, SFMono-Regular, monospace',
        lineHeight: '1.4', whiteSpace: 'pre',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        maxWidth: '360px',
      });
      document.body.appendChild(label);
    }
    return { box, label };
  }

  function removeOverlay() {
    const box = document.getElementById(OVERLAY_ID);
    const label = document.getElementById(LABEL_ID);
    if (box) box.remove();
    if (label) label.remove();
  }

  function formatLabel(el, props) {
    const tag = '<' + el.tagName.toLowerCase() + '>';
    const matches = props.filter(p => p.tokens.length > 0);
    if (matches.length === 0) {
      return tag + '\\n  no matching tokens';
    }
    const lines = matches.slice(0, 8).map(p => {
      const t = p.tokens[0].path.join('.');
      return '  ' + p.prop + ': ' + t + ' (' + p.value + ')';
    });
    return tag + '\\n' + lines.join('\\n');
  }

  function placeOverlay(el) {
    const { box, label } = ensureOverlay();
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
    const props = inspectElement(el);
    label.textContent = formatLabel(el, props);
    const lr = label.getBoundingClientRect();
    let lx = r.left;
    let ly = r.bottom + 6;
    if (ly + lr.height > window.innerHeight) ly = r.top - lr.height - 6;
    if (lx + lr.width > window.innerWidth) lx = window.innerWidth - lr.width - 8;
    if (lx < 4) lx = 4;
    label.style.left = lx + 'px';
    label.style.top = ly + 'px';
  }

  function isAgentNode(el) {
    return !!(el && el.id && (el.id === OVERLAY_ID || el.id === LABEL_ID));
  }

  function onMouseMove(e) {
    if (!inspectMode) return;
    const target = e.target;
    if (!target || isAgentNode(target)) return;
    if (target === hoverEl) return;
    hoverEl = target;
    placeOverlay(target);
  }

  function onClick(e) {
    if (!inspectMode) return;
    const target = e.target;
    if (!target || isAgentNode(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const props = inspectElement(target);
    const paths = [];
    for (const p of props) {
      for (const t of p.tokens) paths.push({ property: p.prop, path: t.path });
    }
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send(JSON.stringify({ type: 'inspect-select', items: paths }));
    }
  }

  function setInspectMode(enabled) {
    if (enabled === inspectMode) return;
    inspectMode = enabled;
    if (enabled) {
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = '';
      hoverEl = null;
      removeOverlay();
    }
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inspectMode) {
      setInspectMode(false);
      if (activeWs && activeWs.readyState === activeWs.OPEN) {
        activeWs.send(JSON.stringify({ type: 'inspect-mode', enabled: false }));
      }
    }
  });

  // ── connection ──────────────────────────────────────────────────────
  let retry = 0;
  function connect() {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { schedule(); return; }
    activeWs = ws;
    ws.addEventListener('open', () => {
      retry = 0;
      ws.send(JSON.stringify({ type: 'hello', role: 'target' }));
    });
    ws.addEventListener('message', (e) => {
      try { apply(JSON.parse(e.data)); } catch {}
    });
    ws.addEventListener('close', () => { activeWs = null; schedule(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  function schedule() {
    retry = Math.min(retry + 1, 10);
    setTimeout(connect, 250 * retry);
  }
  connect();
})();
`;

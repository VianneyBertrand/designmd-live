import type { TokenValue } from '@designmd-live/core';

// ── Types ──────────────────────────────────────────────────────────────────
interface CachedToken {
  path: string[];
  value: TokenValue;
}

type PropKind =
  | 'color'
  | 'spacing'
  | 'radius'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'shadow'
  | 'opacity'
  | 'duration';

interface PropEntry {
  prop: string;
  value: string;
  tokens: CachedToken[];
  hint: PropKind;
}

interface BrokerMessage {
  type: string;
  [k: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────────
const WS_PATH = '/ws';
const STYLE_ID = 'designmd-live-overrides';
const OVERLAY_ID = 'designmd-live-overlay';
const LABEL_ID = 'designmd-live-label';
const PANEL_ID = 'designmd-live-edit-panel';
const STYLES_ID = 'designmd-live-edit-styles';

const ACCENT = 'oklch(0.82 0.16 75)';
const SURFACE = 'oklch(0.13 0.005 250)';
const SURFACE_2 = 'oklch(0.18 0.005 250)';
const SURFACE_3 = 'oklch(0.22 0.005 250)';
const BORDER = 'oklch(0.26 0.005 250)';
const INK_1 = 'oklch(0.96 0 0)';
const INK_2 = 'oklch(0.74 0 0)';
const INK_3 = 'oklch(0.55 0 0)';

// ── State ──────────────────────────────────────────────────────────────────
const overrides: Record<string, string> = Object.create(null);
const tokens: CachedToken[] = [];
let inspectMode = false;
let hoverEl: Element | null = null;
let editPanel: HTMLElement | null = null;
let activeWs: WebSocket | null = null;
let retry = 0;

// ── WS URL ─────────────────────────────────────────────────────────────────
function wsUrl(): string {
  const s = document.currentScript as HTMLScriptElement | null;
  const src = s?.src ?? '';
  try {
    const u = new URL(src);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}${WS_PATH}`;
  } catch {
    return `ws://localhost:3030${WS_PATH}`;
  }
}

// ── Token override pipeline ────────────────────────────────────────────────
function ensureStyle(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

function render(): void {
  const lines: string[] = [];
  for (const k in overrides) lines.push(`  --${k}: ${overrides[k]};`);
  ensureStyle().textContent = `:root {\n${lines.join('\n')}\n}`;
}

function pathToVar(path: string[]): string {
  return path.join('-');
}

function valueAsString(v: TokenValue): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

function sameArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function applyTokenUpdate(path: string[], value: TokenValue): void {
  overrides[pathToVar(path)] = valueAsString(value);
  let found = false;
  for (const t of tokens) {
    if (sameArr(t.path, path)) {
      t.value = value;
      found = true;
      break;
    }
  }
  if (!found) tokens.push({ path, value });
  render();
}

function applySnapshot(snapshot: { path: string[]; value: TokenValue }[]): void {
  for (const k in overrides) delete overrides[k];
  tokens.length = 0;
  for (const t of snapshot) {
    overrides[pathToVar(t.path)] = valueAsString(t.value);
    tokens.push({ path: t.path, value: t.value });
  }
  render();
}

// ── Inspector matching ─────────────────────────────────────────────────────
function rootFontPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function toPx(value: TokenValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(-?[\d.]+)(rem|em|px|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'px') return n;
  if (unit === 'rem' || unit === 'em') return n * rootFontPx();
  return null;
}

function pathHintMatches(path: string[], hint: PropKind): boolean {
  if (hint === 'spacing') return path[0] === 'spacing';
  if (hint === 'radius') return path[0] === 'radius' || path[0] === 'borderRadius';
  if (hint === 'shadow') return path[0] === 'shadow' || path[0] === 'shadows';
  if (hint === 'color') return path[0] === 'color';
  if (hint === 'fontSize')
    return path[0] === 'typography' && (path[1] === 'size' || path[1] === 'sizes');
  if (hint === 'fontWeight')
    return path[0] === 'typography' && (path[1] === 'weight' || path[1] === 'weights');
  if (hint === 'lineHeight')
    return path[0] === 'typography' && (path[1] === 'lineHeight' || path[1] === 'leading');
  if (hint === 'letterSpacing')
    return path[0] === 'typography' && (path[1] === 'letterSpacing' || path[1] === 'tracking');
  if (hint === 'opacity') return path[0] === 'opacity';
  if (hint === 'duration') return path[0] === 'duration' || path[0] === 'motion';
  return true;
}

function tokenMatchesValue(token: CachedToken, valueStr: string): boolean {
  if (Array.isArray(token.value)) return false;
  if (typeof token.value === 'object' && token.value !== null) return false;
  const tv = String(token.value).trim();
  const v = valueStr.trim();
  if (tv === v) return true;
  const numericTv = Number(tv);
  if (Number.isFinite(numericTv) && /^-?\d+(\.\d+)?$/.test(tv)) {
    const vpx = toPx(v);
    if (vpx != null) return Math.abs(numericTv * rootFontPx() - vpx) < 0.6;
  }
  const tpx = toPx(token.value);
  const vpx = toPx(v);
  if (tpx == null || vpx == null) return false;
  return Math.abs(tpx - vpx) < 0.5;
}

function tokensForValue(valueStr: string, hint: PropKind): CachedToken[] {
  const out: CachedToken[] = [];
  for (const t of tokens) {
    if (!pathHintMatches(t.path, hint)) continue;
    if (tokenMatchesValue(t, valueStr)) out.push(t);
  }
  return out;
}

function inspectElement(el: Element): PropEntry[] {
  const cs = getComputedStyle(el);
  const props: PropEntry[] = [];
  function add(prop: string, value: string, hint: PropKind) {
    if (!value || value === 'normal' || value === 'none') return;
    props.push({ prop, value, tokens: tokensForValue(value, hint), hint });
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
  add('border-radius', cs.borderTopLeftRadius, 'radius');
  add('box-shadow', cs.boxShadow, 'shadow');
  return props;
}

// ── Hover overlay ──────────────────────────────────────────────────────────
function ensureOverlay(): { box: HTMLElement; label: HTMLElement } {
  let box = document.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!box) {
    box = document.createElement('div');
    box.id = OVERLAY_ID;
    Object.assign(box.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      boxSizing: 'border-box',
      border: `2px solid ${ACCENT}`,
      borderRadius: '3px',
      transition: 'all 80ms ease-out',
    } as CSSStyleDeclaration);
    document.body.appendChild(box);
  }
  let label = document.getElementById(LABEL_ID) as HTMLElement | null;
  if (!label) {
    label = document.createElement('div');
    label.id = LABEL_ID;
    Object.assign(label.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483647',
      background: SURFACE,
      color: INK_1,
      padding: '8px 10px',
      borderRadius: '6px',
      font: '12px ui-monospace, "SF Mono", "JetBrains Mono", monospace',
      lineHeight: '1.4',
      whiteSpace: 'pre',
      boxShadow: '0 4px 16px rgba(0,0,0,0.30)',
      maxWidth: '420px',
      border: `1px solid ${BORDER}`,
    } as CSSStyleDeclaration);
    document.body.appendChild(label);
  }
  return { box, label };
}

function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(LABEL_ID)?.remove();
}

function formatHoverLabel(el: Element, props: PropEntry[]): string {
  const tag = `<${el.tagName.toLowerCase()}>`;
  const matches = props.filter((p) => p.tokens.length > 0);
  if (matches.length === 0) return `${tag}\n  no matching tokens`;
  const lines = matches.slice(0, 8).map((p) => {
    const t = p.tokens[0]!.path.join('.');
    return `  ${p.prop}: ${t}`;
  });
  return `${tag}\n${lines.join('\n')}`;
}

function placeOverlay(el: Element): void {
  const { box, label } = ensureOverlay();
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  label.textContent = formatHoverLabel(el, inspectElement(el));
  const lr = label.getBoundingClientRect();
  let lx = r.left;
  let ly = r.bottom + 6;
  if (ly + lr.height > window.innerHeight) ly = r.top - lr.height - 6;
  if (lx + lr.width > window.innerWidth) lx = window.innerWidth - lr.width - 8;
  if (lx < 4) lx = 4;
  label.style.left = `${lx}px`;
  label.style.top = `${ly}px`;
}

// ── Edit panel styles ──────────────────────────────────────────────────────
function ensureEditStyles(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
    #${PANEL_ID}, #${PANEL_ID} * {
      box-sizing: border-box;
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
      -webkit-font-smoothing: antialiased;
    }
    #${PANEL_ID} {
      position: fixed;
      width: 480px;
      max-height: 80vh;
      overflow-y: auto;
      background: ${SURFACE};
      color: ${INK_1};
      border: 1px solid ${BORDER};
      border-radius: 12px;
      box-shadow: 0 16px 40px -8px rgba(0,0,0,.50), 0 1px 0 ${BORDER};
      padding: 16px 18px;
      z-index: 2147483647;
      font-size: 13px;
      line-height: 1.5;
    }
    #${PANEL_ID} .hdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 6px;
    }
    #${PANEL_ID} .hdr-tag { font-size: 14px; font-weight: 500; color: ${INK_1}; }
    #${PANEL_ID} .hdr-sub { font-size: 12px; color: ${INK_3}; margin-top: 3px; }
    #${PANEL_ID} .hdr-close {
      background: none; border: 0; cursor: pointer;
      color: ${INK_3}; font-size: 14px; line-height: 1;
      width: 28px; height: 28px; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    #${PANEL_ID} .hdr-close:hover { color: ${INK_1}; background: ${SURFACE_2}; }
    #${PANEL_ID} .hdr-close:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
    #${PANEL_ID} .divider { height: 1px; background: ${BORDER}; margin: 14px 0; }

    /* group */
    #${PANEL_ID} .grp { margin-bottom: 16px; }
    #${PANEL_ID} .grp:last-child { margin-bottom: 0; }
    #${PANEL_ID} .grp-label {
      font-size: 11px; font-weight: 600; letter-spacing: 0.10em;
      text-transform: uppercase; color: ${INK_3};
      margin-bottom: 10px;
    }

    /* slider row */
    #${PANEL_ID} .srow {
      display: grid;
      grid-template-columns: 80px 1fr 110px 60px;
      align-items: center; gap: 12px;
      padding: 4px 0;
      min-height: 36px;
    }
    #${PANEL_ID} .srow-label { color: ${INK_2}; font-size: 13px; }
    #${PANEL_ID} .srow-chip {
      color: ${INK_2}; font-size: 12px; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      background: ${SURFACE_2}; padding: 4px 8px; border-radius: 4px;
      text-align: center;
    }
    #${PANEL_ID} .srow-chip:hover { color: ${INK_1}; background: ${SURFACE_3}; }
    #${PANEL_ID} .srow-chip.is-empty { color: ${INK_3}; cursor: default; pointer-events: none; }
    #${PANEL_ID} .srow-value {
      background: transparent; border: 1px solid transparent; outline: none;
      color: ${INK_1}; font: inherit; font-size: 13px;
      padding: 4px 6px; border-radius: 4px; text-align: right;
      width: 100%; min-width: 0;
    }
    #${PANEL_ID} .srow-value:hover { background: ${SURFACE_2}; }
    #${PANEL_ID} .srow-value:focus { background: ${SURFACE_2}; border-color: ${ACCENT}; }

    /* slider */
    #${PANEL_ID} .slider {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 28px;
      background: transparent; outline: none; cursor: pointer; padding: 0;
    }
    #${PANEL_ID} .slider::-webkit-slider-runnable-track {
      height: 4px; background: ${SURFACE_3}; border-radius: 2px;
    }
    #${PANEL_ID} .slider::-moz-range-track {
      height: 4px; background: ${SURFACE_3}; border-radius: 2px;
    }
    #${PANEL_ID} .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px; height: 16px; border-radius: 50%;
      background: ${INK_1};
      margin-top: -6px;
      border: 2px solid ${SURFACE};
      box-shadow: 0 0 0 1px ${INK_3};
      cursor: grab;
    }
    #${PANEL_ID} .slider::-moz-range-thumb {
      width: 16px; height: 16px; border-radius: 50%;
      background: ${INK_1};
      border: 2px solid ${SURFACE};
      box-shadow: 0 0 0 1px ${INK_3};
      cursor: grab;
    }
    #${PANEL_ID} .slider:hover::-webkit-slider-thumb {
      background: ${ACCENT}; box-shadow: 0 0 0 1px ${ACCENT};
    }
    #${PANEL_ID} .slider:hover::-moz-range-thumb {
      background: ${ACCENT}; box-shadow: 0 0 0 1px ${ACCENT};
    }
    #${PANEL_ID} .slider:focus-visible::-webkit-slider-thumb {
      box-shadow: 0 0 0 2px ${ACCENT};
    }
    #${PANEL_ID} .slider:focus-visible::-moz-range-thumb {
      box-shadow: 0 0 0 2px ${ACCENT};
    }
    #${PANEL_ID} .slider-stops {
      display: flex; justify-content: space-between;
      padding: 0 6px; margin-top: -2px; pointer-events: none;
      font-size: 9px; color: ${INK_3}; letter-spacing: 0.04em;
    }
    #${PANEL_ID} .slider-stop {
      width: 1px; height: 4px; background: ${SURFACE_3};
    }

    /* spacing matrix */
    #${PANEL_ID} .matrices {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    }
    #${PANEL_ID} .matrix {
      background: ${SURFACE_2};
      border: 1px solid ${BORDER};
      border-radius: 8px;
      padding: 10px;
    }
    #${PANEL_ID} .matrix-title {
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: ${INK_3};
      text-align: center; margin-bottom: 6px;
    }
    #${PANEL_ID} .matrix-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: 30px 30px 30px;
      gap: 4px;
      align-items: center; justify-items: center;
    }
    #${PANEL_ID} .matrix-cell {
      background: ${SURFACE_3};
      border: 1px solid transparent;
      border-radius: 4px;
      color: ${INK_1};
      font: inherit; font-size: 12px;
      width: 56px; height: 28px;
      text-align: center; outline: none;
    }
    #${PANEL_ID} .matrix-cell:hover { border-color: ${BORDER}; }
    #${PANEL_ID} .matrix-cell:focus { border-color: ${ACCENT}; background: ${SURFACE_2}; }
    #${PANEL_ID} .matrix-cell.is-zero { color: ${INK_3}; }
    #${PANEL_ID} .matrix-center {
      width: 56px; height: 28px;
      border: 1px dashed ${BORDER}; border-radius: 4px;
      pointer-events: none;
    }

    /* color row */
    #${PANEL_ID} .crow {
      display: grid;
      grid-template-columns: 24px 80px 1fr 110px;
      align-items: center; gap: 12px;
      padding: 4px 0;
      min-height: 36px;
    }
    #${PANEL_ID} .crow-swatch {
      position: relative;
      width: 24px; height: 24px; border-radius: 5px;
      border: 1px solid ${BORDER};
      cursor: pointer;
      transition: transform 100ms;
    }
    #${PANEL_ID} .crow-swatch:hover { transform: scale(1.05); }
    #${PANEL_ID} .crow-swatch input[type="color"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; border: 0;
      width: 100%; height: 100%;
    }
    #${PANEL_ID} .crow-label { color: ${INK_2}; font-size: 13px; }
    #${PANEL_ID} .crow-value {
      color: ${INK_1}; font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${PANEL_ID} .crow-chip {
      color: ${INK_2}; font-size: 12px;
      background: ${SURFACE_2}; padding: 4px 8px; border-radius: 4px;
      cursor: pointer; text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${PANEL_ID} .crow-chip:hover { color: ${INK_1}; background: ${SURFACE_3}; }
    #${PANEL_ID} .crow-chip.is-empty { color: ${INK_3}; cursor: default; pointer-events: none; }

    #${PANEL_ID} .empty-state {
      color: ${INK_3}; padding: 20px 0; font-size: 13px; text-align: center;
    }
  `;
  document.head.appendChild(style);
}

// ── Group order ───────────────────────────────────────────────────────────
const TYPO_HINTS: PropKind[] = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

function tokenCandidates(hint: PropKind, ref: CachedToken | null): CachedToken[] {
  return tokens.filter((t) => {
    if (!pathHintMatches(t.path, hint)) return false;
    if (ref && t.path[0] === 'typography') return t.path[1] === ref.path[1];
    return true;
  });
}

function emitTokenUpdate(path: string[], value: TokenValue): void {
  applyTokenUpdate(path, value);
  if (activeWs && activeWs.readyState === activeWs.OPEN) {
    activeWs.send(JSON.stringify({ type: 'token-update', path, value }));
  }
}

function emitInspectSelect(prop: PropEntry): void {
  if (!prop.tokens.length || !activeWs || activeWs.readyState !== activeWs.OPEN) return;
  const items = prop.tokens.map((t) => ({ property: prop.prop, path: t.path }));
  activeWs.send(JSON.stringify({ type: 'inspect-select', items }));
}

// ── Builders ──────────────────────────────────────────────────────────────
function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const SHORT_LABEL: Record<string, string> = {
  'font-size': 'Size',
  'font-weight': 'Weight',
  'line-height': 'Line',
  'letter-spacing': 'Tracking',
  color: 'Text',
  'background-color': 'Background',
  'border-radius': 'Radius',
  'box-shadow': 'Shadow',
  gap: 'Gap',
  'padding-top': 'Top',
  'padding-right': 'Right',
  'padding-bottom': 'Bottom',
  'padding-left': 'Left',
  'margin-top': 'Top',
  'margin-right': 'Right',
  'margin-bottom': 'Bottom',
  'margin-left': 'Left',
};

function shortLabel(prop: string): string {
  return SHORT_LABEL[prop] ?? prop;
}

function formatTokenName(token: CachedToken | undefined): string {
  if (!token) return '—';
  // for typography sub-groups, drop the leading "typography."
  if (token.path[0] === 'typography') return token.path.slice(1).join('.');
  return token.path.join('.');
}

function buildSliderRow(prop: PropEntry): HTMLElement {
  const row = createEl('div', 'srow');

  // Label (short)
  row.appendChild(createEl('span', 'srow-label', shortLabel(prop.prop)));

  // Slider — snaps to candidate tokens
  const candidates = tokenCandidates(prop.hint, prop.tokens[0] ?? null);
  const slider = createEl('input', 'slider');
  slider.type = 'range';
  if (candidates.length >= 2) {
    slider.min = '0';
    slider.max = String(candidates.length - 1);
    slider.step = '1';
    const currentIdx = prop.tokens[0]
      ? candidates.findIndex(
          (c) => c.path.join('.') === prop.tokens[0]!.path.join('.'),
        )
      : 0;
    slider.value = String(currentIdx >= 0 ? currentIdx : 0);
    slider.setAttribute('aria-label', `${shortLabel(prop.prop)} value`);
    slider.addEventListener('input', () => {
      const idx = Number(slider.value);
      const next = candidates[idx];
      if (!next || !prop.tokens.length) return;
      // The slider snaps to candidate values. We mutate the *active token's
      // value* to the new candidate's value — the path stays the same so the
      // chip still labels the same token, but its global value (and every
      // element bound to it) shifts. That's the design-system semantic.
      const active = prop.tokens[0]!;
      input.value = valueAsString(next.value);
      emitTokenUpdate(active.path, next.value);
    });
  } else {
    slider.disabled = true;
    slider.style.opacity = '0.3';
  }
  row.appendChild(slider);

  // Token chip
  const chip = createEl('button', 'srow-chip');
  if (prop.tokens.length) {
    chip.textContent = formatTokenName(prop.tokens[0]);
    chip.title = `Show ${prop.tokens[0]!.path.join('.')} in panel`;
    chip.addEventListener('click', () => emitInspectSelect(prop));
  } else {
    chip.classList.add('is-empty');
    chip.textContent = '—';
  }
  row.appendChild(chip);

  // Value input (free-form)
  const input = createEl('input', 'srow-value');
  input.type = 'text';
  input.value = prop.value;
  input.setAttribute('aria-label', `${shortLabel(prop.prop)} raw value`);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = prop.value;
      input.blur();
    }
  });
  input.addEventListener('change', () => {
    if (prop.tokens.length) emitTokenUpdate(prop.tokens[0]!.path, input.value);
  });
  row.appendChild(input);

  return row;
}

function buildSpacingMatrices(props: PropEntry[]): HTMLElement {
  const wrap = createEl('div', 'matrices');

  function buildMatrix(title: string, sides: Record<'top' | 'right' | 'bottom' | 'left', PropEntry | undefined>): HTMLElement {
    const matrix = createEl('div', 'matrix');
    const t = createEl('div', 'matrix-title', title);
    matrix.appendChild(t);
    const grid = createEl('div', 'matrix-grid');

    function makeCell(prop: PropEntry | undefined): HTMLElement {
      const cell = createEl('input', 'matrix-cell');
      cell.type = 'text';
      if (!prop) {
        cell.value = '0';
        cell.disabled = true;
        cell.classList.add('is-zero');
        return cell;
      }
      cell.value = compactValue(prop.value);
      cell.title = prop.tokens.length
        ? `${prop.prop}: ${prop.tokens[0]!.path.join('.')}`
        : prop.prop;
      if (cell.value === '0' || cell.value === '0px') cell.classList.add('is-zero');
      cell.setAttribute('aria-label', prop.prop);
      cell.addEventListener('focus', () => cell.select());
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cell.blur();
        if (e.key === 'Escape') {
          cell.value = compactValue(prop.value);
          cell.blur();
        }
      });
      cell.addEventListener('change', () => {
        if (!prop.tokens.length) return;
        emitTokenUpdate(prop.tokens[0]!.path, cell.value);
      });
      return cell;
    }

    function placeholder(): HTMLElement {
      return createEl('span');
    }

    // 3x3 grid: corners empty, edges hold values, center is element preview
    grid.appendChild(placeholder());
    grid.appendChild(makeCell(sides.top));
    grid.appendChild(placeholder());
    grid.appendChild(makeCell(sides.left));
    grid.appendChild(createEl('span', 'matrix-center'));
    grid.appendChild(makeCell(sides.right));
    grid.appendChild(placeholder());
    grid.appendChild(makeCell(sides.bottom));
    grid.appendChild(placeholder());
    matrix.appendChild(grid);
    return matrix;
  }

  function findProp(prefix: string, side: string): PropEntry | undefined {
    return props.find((p) => p.prop === `${prefix}-${side}`);
  }

  wrap.appendChild(
    buildMatrix('Padding', {
      top: findProp('padding', 'top'),
      right: findProp('padding', 'right'),
      bottom: findProp('padding', 'bottom'),
      left: findProp('padding', 'left'),
    }),
  );
  wrap.appendChild(
    buildMatrix('Margin', {
      top: findProp('margin', 'top'),
      right: findProp('margin', 'right'),
      bottom: findProp('margin', 'bottom'),
      left: findProp('margin', 'left'),
    }),
  );
  return wrap;
}

function compactValue(v: string): string {
  // "16px" → "16", "0.5rem" → "0.5rem" (keep), "0px" → "0"
  if (v === '0px' || v === '0em' || v === '0rem') return '0';
  const m = v.match(/^(\d+)px$/);
  if (m) return m[1]!;
  return v;
}

function buildColorRow(prop: PropEntry): HTMLElement {
  const row = createEl('div', 'crow');
  const swatch = createEl('span', 'crow-swatch');
  swatch.style.background = prop.value;
  const colorInput = createEl('input');
  colorInput.type = 'color';
  colorInput.value = parseHex(prop.value) ?? '#000000';
  colorInput.addEventListener('input', () => {
    swatch.style.background = colorInput.value;
    if (prop.tokens.length) emitTokenUpdate(prop.tokens[0]!.path, colorInput.value);
  });
  swatch.appendChild(colorInput);
  row.appendChild(swatch);

  row.appendChild(createEl('span', 'crow-label', shortLabel(prop.prop)));
  row.appendChild(createEl('span', 'crow-value', prop.value));

  const chip = createEl('button');
  if (prop.tokens.length) {
    chip.className = 'crow-chip';
    chip.textContent = formatTokenName(prop.tokens[0]);
    chip.title = `Show ${prop.tokens[0]!.path.join('.')} in panel`;
    chip.addEventListener('click', () => emitInspectSelect(prop));
  } else {
    chip.className = 'crow-chip is-empty';
    chip.textContent = '—';
  }
  row.appendChild(chip);

  return row;
}

function parseHex(value: string): string | null {
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.color = value;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = computed.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(/[\s,]+/).map(Number);
  if (parts.length < 3) return null;
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${hex(parts[0]!)}${hex(parts[1]!)}${hex(parts[2]!)}`;
}

function buildEditPanel(el: Element, props: PropEntry[]): HTMLElement {
  const panel = createEl('div');
  panel.id = PANEL_ID;

  // Header
  const hdr = createEl('div', 'hdr');
  const title = createEl('div');
  title.appendChild(createEl('div', 'hdr-tag', `<${el.tagName.toLowerCase()}>`));
  const matched = props.filter((p) => p.tokens.length).length;
  title.appendChild(
    createEl(
      'div',
      'hdr-sub',
      `${matched} token${matched === 1 ? '' : 's'} matched · ${props.length} propert${props.length === 1 ? 'y' : 'ies'}`,
    ),
  );
  const close = createEl('button', 'hdr-close', '✕');
  close.setAttribute('aria-label', 'Close edit panel');
  close.addEventListener('click', removeEditPanel);
  hdr.appendChild(title);
  hdr.appendChild(close);
  panel.appendChild(hdr);

  panel.appendChild(createEl('div', 'divider'));

  let renderedAny = false;

  // Typography group
  const typoProps = props.filter((p) => TYPO_HINTS.includes(p.hint));
  if (typoProps.length) {
    const grp = createEl('div', 'grp');
    grp.appendChild(createEl('div', 'grp-label', 'Typography'));
    for (const p of typoProps) grp.appendChild(buildSliderRow(p));
    panel.appendChild(grp);
    renderedAny = true;
  }

  // Spacing group — box matrices
  const spacingProps = props.filter((p) => p.hint === 'spacing');
  const hasPadding = spacingProps.some((p) => p.prop.startsWith('padding'));
  const hasMargin = spacingProps.some((p) => p.prop.startsWith('margin'));
  if (hasPadding || hasMargin) {
    const grp = createEl('div', 'grp');
    grp.appendChild(createEl('div', 'grp-label', 'Spacing'));
    grp.appendChild(buildSpacingMatrices(spacingProps));
    // Gap row if present
    const gap = spacingProps.find((p) => p.prop === 'gap');
    if (gap) {
      const gapWrap = createEl('div');
      gapWrap.style.marginTop = '12px';
      gapWrap.appendChild(buildSliderRow(gap));
      grp.appendChild(gapWrap);
    }
    panel.appendChild(grp);
    renderedAny = true;
  }

  // Color group
  const colorProps = props.filter((p) => p.hint === 'color');
  if (colorProps.length) {
    const grp = createEl('div', 'grp');
    grp.appendChild(createEl('div', 'grp-label', 'Color'));
    for (const p of colorProps) grp.appendChild(buildColorRow(p));
    panel.appendChild(grp);
    renderedAny = true;
  }

  // Radius / shadow / opacity / duration — slider rows
  const otherProps = props.filter(
    (p) => p.hint === 'radius' || p.hint === 'shadow' || p.hint === 'opacity' || p.hint === 'duration',
  );
  if (otherProps.length) {
    const grp = createEl('div', 'grp');
    grp.appendChild(createEl('div', 'grp-label', 'Surface'));
    for (const p of otherProps) grp.appendChild(buildSliderRow(p));
    panel.appendChild(grp);
    renderedAny = true;
  }

  if (!renderedAny) {
    panel.appendChild(createEl('div', 'empty-state', 'No inspectable styles on this element.'));
  }

  return panel;
}

// ── Edit panel placement ───────────────────────────────────────────────────
function showEditPanel(el: Element): void {
  removeEditPanel();
  ensureEditStyles();
  hoverEl = el;
  const props = inspectElement(el);
  const panel = buildEditPanel(el, props);
  document.body.appendChild(panel);
  editPanel = panel;
  positionEditPanel(panel, el);
}

function positionEditPanel(panel: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  let top = r.bottom + 12;
  let left = r.left;
  if (top + pr.height > window.innerHeight - 8) {
    top = Math.max(8, r.top - pr.height - 12);
  }
  if (left + pr.width > window.innerWidth - 8) {
    left = window.innerWidth - pr.width - 8;
  }
  if (left < 8) left = 8;
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function removeEditPanel(): void {
  editPanel?.remove();
  editPanel = null;
  hoverEl = null;
}

// ── Inspector mode toggle ──────────────────────────────────────────────────
function setInspectMode(enabled: boolean): void {
  if (enabled === inspectMode) return;
  inspectMode = enabled;
  if (enabled) {
    document.body.style.cursor = 'crosshair';
  } else {
    document.body.style.cursor = '';
    hoverEl = null;
    removeOverlay();
    removeEditPanel();
  }
}

function isAgentNode(el: Element | null): boolean {
  if (!el) return false;
  let cur: Element | null = el;
  while (cur) {
    const id = cur.id;
    if (id === OVERLAY_ID || id === LABEL_ID || id === PANEL_ID) return true;
    cur = cur.parentElement;
  }
  return false;
}

function onMouseMove(e: MouseEvent): void {
  if (!inspectMode || editPanel) return;
  const target = e.target as Element | null;
  if (!target || isAgentNode(target)) return;
  if (target === hoverEl) return;
  hoverEl = target;
  placeOverlay(target);
}

function onClick(e: MouseEvent): void {
  if (!inspectMode) return;
  const target = e.target as Element | null;
  if (!target || isAgentNode(target)) return;
  e.preventDefault();
  e.stopPropagation();
  removeOverlay();
  showEditPanel(target);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (editPanel) {
      removeEditPanel();
    } else if (inspectMode) {
      setInspectMode(false);
      if (activeWs && activeWs.readyState === activeWs.OPEN) {
        activeWs.send(JSON.stringify({ type: 'inspect-mode', enabled: false }));
      }
    }
  }
}

// ── Connection ─────────────────────────────────────────────────────────────
function handle(msg: BrokerMessage): void {
  if (msg.type === 'snapshot' && Array.isArray(msg.tokens)) {
    applySnapshot(msg.tokens as { path: string[]; value: TokenValue }[]);
  } else if (msg.type === 'token-update') {
    applyTokenUpdate(msg.path as string[], msg.value as TokenValue);
  } else if (msg.type === 'reset') {
    for (const k in overrides) delete overrides[k];
    render();
  } else if (msg.type === 'inspect-mode') {
    setInspectMode(!!msg.enabled);
  }
}

function connect(): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    schedule();
    return;
  }
  activeWs = ws;
  ws.addEventListener('open', () => {
    retry = 0;
    ws.send(JSON.stringify({ type: 'hello', role: 'target' }));
  });
  ws.addEventListener('message', (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', () => {
    activeWs = null;
    schedule();
  });
  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

function schedule(): void {
  retry = Math.min(retry + 1, 10);
  setTimeout(connect, 250 * retry);
}

document.addEventListener('mousemove', onMouseMove, true);
document.addEventListener('click', onClick, true);
window.addEventListener('keydown', onKeyDown);
connect();

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
const DROPDOWN_ID = 'designmd-live-dropdown';

const CHEVRON_LEFT = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14L8 10L12 6"/></svg>';
const CHEVRON_RIGHT = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6L12 10L8 14"/></svg>';
const CHEVRON_LEFT_SM = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14L8 10L12 6"/></svg>';
const CHEVRON_RIGHT_SM = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6L12 10L8 14"/></svg>';

const ACCENT = 'oklch(0.82 0.16 75)';
const SURFACE = 'oklch(0.13 0.005 250)';
const SURFACE_2 = 'oklch(0.18 0.005 250)';
const SURFACE_3 = 'oklch(0.22 0.005 250)';
const BORDER = 'oklch(0.26 0.005 250)';
const BORDER_SOFT = 'oklch(0.20 0.005 250)';
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
      font: '13px ui-monospace, "SF Mono", "JetBrains Mono", monospace',
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
      width: min(1100px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow: auto;
      background: ${SURFACE};
      color: ${INK_1};
      border: 1px solid ${BORDER};
      border-radius: 12px;
      box-shadow: 0 16px 40px -8px rgba(0,0,0,.50), 0 1px 0 ${BORDER};
      padding: 18px 22px;
      z-index: 2147483647;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Header */
    #${PANEL_ID} .hdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px;
    }
    #${PANEL_ID} .hdr-tag { font-size: 14px; font-weight: 500; color: ${INK_1}; }
    #${PANEL_ID} .hdr-sub { font-size: 13px; color: ${INK_3}; margin-top: 4px; }
    #${PANEL_ID} .hdr-close {
      background: none; border: 0; cursor: pointer;
      color: ${INK_3}; font-size: 14px; line-height: 1;
      width: 28px; height: 28px; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    #${PANEL_ID} .hdr-close:hover { color: ${INK_1}; background: ${SURFACE_2}; }
    #${PANEL_ID} .hdr-close:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
    #${PANEL_ID} .divider {
      height: 1px; background: ${BORDER};
      margin: 14px -22px 18px;
    }

    /* Strip */
    #${PANEL_ID} .strip {
      display: flex;
      align-items: stretch;
      gap: 0;
    }
    #${PANEL_ID} .card {
      flex: 1 1 0;
      min-width: 0;
      padding: 0 22px;
      border-left: 1px solid ${BORDER_SOFT};
    }
    #${PANEL_ID} .card:first-child { padding-left: 0; border-left: 0; }
    #${PANEL_ID} .card:last-child { padding-right: 0; }
    #${PANEL_ID} .card-label {
      font-size: 12px; font-weight: 600;
      letter-spacing: 0.10em; text-transform: uppercase;
      color: ${INK_3};
      margin-bottom: 16px;
    }
    #${PANEL_ID} .card-empty {
      color: ${INK_3}; font-size: 13px; padding: 8px 0;
    }

    /* Property block: label / hero value / stepper */
    #${PANEL_ID} .prop {
      margin-bottom: 16px;
    }
    #${PANEL_ID} .prop:last-child { margin-bottom: 0; }
    #${PANEL_ID} .prop-label {
      font-size: 13px; color: ${INK_2};
      margin-bottom: 4px;
    }
    #${PANEL_ID} .prop-hero {
      font-size: 15px; font-weight: 500; color: ${INK_1};
      margin-bottom: 6px; line-height: 1.2;
    }

    /* Stepper — name (left, opens dropdown) + chevron group (right, side-by-side) */
    #${PANEL_ID} .stepper {
      display: flex; align-items: stretch;
      height: 34px;
      border: 1px solid ${BORDER_SOFT};
      border-radius: 6px;
      background: ${SURFACE};
      transition: border-color 80ms;
    }
    #${PANEL_ID} .stepper:hover { border-color: ${BORDER}; }
    #${PANEL_ID} .stepper-name {
      flex: 1; min-width: 0;
      background: transparent; border: 0;
      color: ${INK_2}; font: inherit; font-size: 13px;
      padding: 0 10px;
      cursor: pointer; outline: none;
      text-align: left;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-radius: 5px 0 0 5px;
    }
    #${PANEL_ID} .stepper-name:hover { color: ${INK_1}; background: ${SURFACE_2}; }
    #${PANEL_ID} .stepper-name:focus-visible {
      outline: 2px solid ${ACCENT}; outline-offset: -2px;
      background: ${SURFACE_2}; color: ${INK_1};
    }
    #${PANEL_ID} .stepper-name.is-empty { color: ${INK_3}; cursor: default; }
    #${PANEL_ID} .stepper-arrows {
      display: flex; border-left: 1px solid ${BORDER_SOFT};
    }
    #${PANEL_ID} .stepper-arr {
      width: 32px; padding: 0; border: 0;
      background: transparent;
      color: ${INK_3};
      cursor: pointer; outline: none;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 80ms, color 80ms;
    }
    #${PANEL_ID} .stepper-arr svg { display: block; }
    #${PANEL_ID} .stepper-arr:hover { background: ${SURFACE_2}; color: ${INK_1}; }
    #${PANEL_ID} .stepper-arr:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }
    #${PANEL_ID} .stepper-arr:disabled { color: ${INK_3}; opacity: 0.30; cursor: default; }
    #${PANEL_ID} .stepper-arr:disabled:hover { background: transparent; color: ${INK_3}; }
    #${PANEL_ID} .stepper-arr-next { border-left: 1px solid ${BORDER_SOFT}; border-radius: 0 5px 5px 0; }

    /* Spacing matrix */
    #${PANEL_ID} .matrix-title {
      font-size: 12px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: ${INK_3}; text-align: center;
      margin-bottom: 8px;
    }
    #${PANEL_ID} .matrix + .matrix-title { margin-top: 14px; }
    #${PANEL_ID} .matrix-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 4px;
      align-items: center; justify-items: center;
    }
    #${PANEL_ID} .matrix-center {
      width: 60px; height: 24px;
      border: 1px dashed ${BORDER}; border-radius: 4px;
    }
    #${PANEL_ID} .mini-stepper {
      display: flex; align-items: stretch;
      width: 100%; max-width: 100px;
      height: 30px;
      border: 1px solid ${BORDER_SOFT};
      border-radius: 5px;
      background: ${SURFACE};
    }
    #${PANEL_ID} .mini-stepper:hover { border-color: ${BORDER}; }
    #${PANEL_ID} .mini-stepper-value {
      flex: 1; min-width: 0;
      background: transparent; border: 0;
      color: ${INK_1}; font: inherit; font-size: 13px;
      text-align: center; outline: none;
      padding: 0 4px;
      cursor: text;
      border-radius: 4px 0 0 4px;
    }
    #${PANEL_ID} .mini-stepper-value:hover { background: ${SURFACE_2}; }
    #${PANEL_ID} .mini-stepper-value:focus { background: ${SURFACE_2}; outline: 2px solid ${ACCENT}; outline-offset: -2px; border-radius: 4px 0 0 4px; }
    #${PANEL_ID} .mini-stepper-value.is-zero { color: ${INK_3}; }
    #${PANEL_ID} .mini-stepper-arrows {
      display: flex; border-left: 1px solid ${BORDER_SOFT};
    }
    #${PANEL_ID} .mini-stepper-arr {
      width: 22px; padding: 0; border: 0;
      background: transparent; color: ${INK_3}; cursor: pointer; outline: none;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 80ms, color 80ms;
    }
    #${PANEL_ID} .mini-stepper-arr svg { display: block; }
    #${PANEL_ID} .mini-stepper-arr:hover { background: ${SURFACE_2}; color: ${INK_1}; }
    #${PANEL_ID} .mini-stepper-arr:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }
    #${PANEL_ID} .mini-stepper-arr:disabled { opacity: 0.30; cursor: default; }
    #${PANEL_ID} .mini-stepper-arr-next { border-left: 1px solid ${BORDER_SOFT}; border-radius: 0 4px 4px 0; }

    /* Token dropdown */
    #${DROPDOWN_ID} {
      position: fixed;
      background: ${SURFACE};
      border: 1px solid ${BORDER};
      border-radius: 8px;
      box-shadow: 0 12px 32px -8px rgba(0,0,0,.50);
      padding: 4px;
      z-index: 2147483647;
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
      font-size: 13px;
      min-width: 200px;
      max-height: 280px;
      overflow-y: auto;
    }
    #${DROPDOWN_ID} .ddi {
      display: grid;
      grid-template-columns: 1fr auto 16px;
      gap: 16px; padding: 8px 12px;
      border-radius: 5px; cursor: pointer;
      width: 100%; border: 0; background: transparent;
      font: inherit; color: ${INK_2}; align-items: center;
      text-align: left; outline: none;
    }
    #${DROPDOWN_ID} .ddi:hover { background: ${SURFACE_2}; color: ${INK_1}; }
    #${DROPDOWN_ID} .ddi:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }
    #${DROPDOWN_ID} .ddi.is-current { color: ${INK_1}; }
    #${DROPDOWN_ID} .ddi-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${DROPDOWN_ID} .ddi-value { color: ${INK_3}; white-space: nowrap; }
    #${DROPDOWN_ID} .ddi-check { color: ${ACCENT}; text-align: right; }
    #${DROPDOWN_ID} .ddi-check.is-hidden { visibility: hidden; }

    /* Color block */
    #${PANEL_ID} .color-prop {
      margin-bottom: 16px;
    }
    #${PANEL_ID} .color-prop:last-child { margin-bottom: 0; }
    #${PANEL_ID} .color-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 6px;
    }
    #${PANEL_ID} .color-swatch {
      position: relative;
      width: 20px; height: 20px; border-radius: 5px;
      border: 1px solid ${SURFACE_3};
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 100ms;
    }
    #${PANEL_ID} .color-swatch:hover { transform: scale(1.05); }
    #${PANEL_ID} .color-swatch input[type="color"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; border: 0;
      width: 100%; height: 100%;
    }
    #${PANEL_ID} .color-label {
      font-size: 13px; color: ${INK_2};
    }
    #${PANEL_ID} .color-value {
      font-size: 14px; font-weight: 500; color: ${INK_1};
      margin-bottom: 6px; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Color swatch grid */
    #${PANEL_ID} .swatch-grid {
      display: flex; flex-wrap: wrap; gap: 5px;
      margin-top: 8px;
    }
    #${PANEL_ID} .swatch-mini {
      width: 22px; height: 22px;
      border-radius: 5px;
      border: 1px solid ${SURFACE_3};
      cursor: pointer;
      padding: 0;
      background-clip: padding-box;
      transition: transform 100ms;
      outline: none;
      flex-shrink: 0;
    }
    #${PANEL_ID} .swatch-mini:hover { transform: scale(1.10); border-color: ${INK_3}; }
    #${PANEL_ID} .swatch-mini.is-current {
      box-shadow: 0 0 0 2px ${SURFACE}, 0 0 0 4px ${ACCENT};
    }
    #${PANEL_ID} .swatch-mini:focus-visible {
      box-shadow: 0 0 0 2px ${SURFACE}, 0 0 0 4px ${ACCENT};
    }
  `;
  document.head.appendChild(style);
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TYPO_HINTS: PropKind[] = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const SURFACE_HINTS: PropKind[] = ['radius', 'shadow', 'opacity', 'duration'];

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
};

function shortLabel(prop: string): string {
  return SHORT_LABEL[prop] ?? prop;
}

function formatTokenName(token: CachedToken | undefined): string {
  if (!token) return '—';
  if (token.path[0] === 'typography') return token.path.slice(1).join('.');
  return token.path.join('.');
}

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

function compactValue(v: string): string {
  if (v === '0px' || v === '0em' || v === '0rem') return '0';
  const m = v.match(/^(\d+(?:\.\d+)?)(px|rem|em)$/);
  if (m && m[2] === 'px') return m[1]!;
  return v;
}

function formatHero(value: string): string {
  // "16px" → "16 px", "0.5rem" → "0.5 rem"
  const m = value.match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)$/);
  if (m) return `${m[1]} ${m[2]}`;
  return value;
}

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

// ── Stepper builders ───────────────────────────────────────────────────────
interface StepperState {
  candidates: CachedToken[];
  index: number; // -1 if no current candidate
}

function initStepperState(prop: PropEntry): StepperState {
  const candidates = tokenCandidates(prop.hint, prop.tokens[0] ?? null);
  let index = -1;
  if (prop.tokens[0]) {
    index = candidates.findIndex(
      (c) => c.path.join('.') === prop.tokens[0]!.path.join('.'),
    );
  }
  return { candidates, index };
}

function buildPropertyBlock(prop: PropEntry): HTMLElement {
  const block = createEl('div', 'prop');
  block.appendChild(createEl('div', 'prop-label', shortLabel(prop.prop)));
  const hero = createEl('div', 'prop-hero', formatHero(prop.value));
  block.appendChild(hero);

  const stepper = createEl('div', 'stepper');
  const name = createEl('button', 'stepper-name');
  name.type = 'button';
  name.setAttribute('aria-haspopup', 'listbox');
  const arrows = createEl('div', 'stepper-arrows');
  const prev = createEl('button', 'stepper-arr stepper-arr-prev');
  prev.type = 'button';
  prev.innerHTML = CHEVRON_LEFT;
  prev.setAttribute('aria-label', `Previous ${shortLabel(prop.prop)}`);
  const next = createEl('button', 'stepper-arr stepper-arr-next');
  next.type = 'button';
  next.innerHTML = CHEVRON_RIGHT;
  next.setAttribute('aria-label', `Next ${shortLabel(prop.prop)}`);
  arrows.appendChild(prev);
  arrows.appendChild(next);

  const state = initStepperState(prop);

  function refresh() {
    if (state.candidates.length < 2 || state.index < 0) {
      prev.disabled = true;
      next.disabled = true;
    } else {
      prev.disabled = state.index <= 0;
      next.disabled = state.index >= state.candidates.length - 1;
    }
    if (state.index >= 0) {
      const cur = state.candidates[state.index]!;
      name.textContent = formatTokenName(cur);
      name.classList.remove('is-empty');
      name.title = cur.path.join('.');
    } else {
      name.textContent = '—';
      name.classList.add('is-empty');
      name.title = '';
    }
  }

  function applyIndex(idx: number) {
    if (!prop.tokens[0]) return;
    if (idx < 0 || idx >= state.candidates.length) return;
    state.index = idx;
    const target = state.candidates[idx]!;
    hero.textContent = formatHero(valueAsString(target.value));
    refresh();
    emitTokenUpdate(prop.tokens[0].path, target.value);
  }

  prev.addEventListener('click', () => applyIndex(state.index - 1));
  next.addEventListener('click', () => applyIndex(state.index + 1));
  name.addEventListener('click', (e) => {
    if (state.candidates.length === 0 || !prop.tokens[0]) return;
    e.stopPropagation();
    openTokenDropdown(name, state, applyIndex);
  });

  stepper.appendChild(name);
  stepper.appendChild(arrows);
  block.appendChild(stepper);

  refresh();
  return block;
}

// ── Token dropdown ─────────────────────────────────────────────────────────
function closeDropdown(): void {
  document.getElementById(DROPDOWN_ID)?.remove();
}

function openTokenDropdown(
  anchor: HTMLElement,
  state: StepperState,
  onSelect: (idx: number) => void,
): void {
  closeDropdown();
  if (state.candidates.length === 0) return;

  const dd = createEl('div');
  dd.id = DROPDOWN_ID;
  dd.setAttribute('role', 'listbox');

  const items: HTMLButtonElement[] = [];
  state.candidates.forEach((c, i) => {
    const item = createEl('button', 'ddi');
    item.type = 'button';
    item.setAttribute('role', 'option');
    if (i === state.index) item.classList.add('is-current');
    item.appendChild(createEl('span', 'ddi-name', formatTokenName(c)));
    item.appendChild(createEl('span', 'ddi-value', valueAsString(c.value)));
    const check = createEl('span', 'ddi-check', i === state.index ? '✓' : '');
    if (i !== state.index) check.classList.add('is-hidden');
    item.appendChild(check);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(i);
      closeDropdown();
    });
    items.push(item);
    dd.appendChild(item);
  });

  document.body.appendChild(dd);

  // Position below anchor; flip above if it overflows.
  const ar = anchor.getBoundingClientRect();
  const dr = dd.getBoundingClientRect();
  let top = ar.bottom + 4;
  let left = ar.left;
  if (top + dr.height > window.innerHeight - 8) {
    const aboveTop = ar.top - dr.height - 4;
    if (aboveTop >= 8) top = aboveTop;
    else top = window.innerHeight - dr.height - 8;
  }
  if (left + dr.width > window.innerWidth - 8) {
    left = window.innerWidth - dr.width - 8;
  }
  if (left < 8) left = 8;
  dd.style.top = `${top}px`;
  dd.style.left = `${left}px`;

  // Focus current item for keyboard navigation
  setTimeout(() => items[Math.max(0, state.index)]?.focus(), 0);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      cleanup();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const focused = document.activeElement as HTMLElement | null;
      const idx = items.findIndex((b) => b === focused);
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(items.length - 1, idx + dir));
      items[nextIdx]?.focus();
    }
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as Element | null;
    if (t && (t === dd || dd.contains(t))) return;
    closeDropdown();
    cleanup();
  }

  function cleanup() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDocClick, true);
  }

  setTimeout(() => {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDocClick, true);
  }, 0);
}

// ── Spacing matrix ─────────────────────────────────────────────────────────
function buildMiniStepper(maybeProp: PropEntry | undefined): HTMLElement {
  const wrap = createEl('div', 'mini-stepper');
  if (!maybeProp) {
    const empty = createEl('span', 'mini-stepper-value is-zero', '—');
    empty.style.flex = '1';
    wrap.appendChild(empty);
    return wrap;
  }
  const prop: PropEntry = maybeProp;

  const value = createEl('input', 'mini-stepper-value');
  value.type = 'text';
  value.value = compactValue(prop.value);
  value.setAttribute('aria-label', prop.prop);
  if (value.value === '0') value.classList.add('is-zero');
  if (prop.tokens.length) {
    value.title = `${prop.prop}: ${prop.tokens[0]!.path.join('.')}`;
  } else {
    value.title = prop.prop;
  }

  const arrows = createEl('div', 'mini-stepper-arrows');
  const prev = createEl('button', 'mini-stepper-arr mini-stepper-arr-prev');
  prev.type = 'button';
  prev.innerHTML = CHEVRON_LEFT_SM;
  prev.setAttribute('aria-label', `Decrease ${prop.prop}`);
  const next = createEl('button', 'mini-stepper-arr mini-stepper-arr-next');
  next.type = 'button';
  next.innerHTML = CHEVRON_RIGHT_SM;
  next.setAttribute('aria-label', `Increase ${prop.prop}`);
  arrows.appendChild(prev);
  arrows.appendChild(next);

  const state = initStepperState(prop);

  function refresh() {
    if (state.candidates.length < 2 || state.index < 0) {
      prev.disabled = true;
      next.disabled = true;
    } else {
      prev.disabled = state.index <= 0;
      next.disabled = state.index >= state.candidates.length - 1;
    }
  }

  function applyIndex(idx: number) {
    if (!prop.tokens[0]) return;
    if (idx < 0 || idx >= state.candidates.length) return;
    state.index = idx;
    const target = state.candidates[idx]!;
    const newDisplay = compactValue(valueAsString(target.value));
    value.value = newDisplay;
    value.classList.toggle('is-zero', newDisplay === '0');
    refresh();
    emitTokenUpdate(prop.tokens[0].path, target.value);
  }

  prev.addEventListener('click', () => applyIndex(state.index - 1));
  next.addEventListener('click', () => applyIndex(state.index + 1));
  value.addEventListener('focus', () => value.select());
  value.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      applyIndex(state.index - 1);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      applyIndex(state.index + 1);
    }
    if (e.key === 'Enter') value.blur();
    if (e.key === 'Escape') {
      value.value = compactValue(prop.value);
      value.blur();
    }
  });
  value.addEventListener('change', () => {
    if (!prop.tokens.length) return;
    emitTokenUpdate(prop.tokens[0]!.path, value.value);
  });

  wrap.appendChild(value);
  wrap.appendChild(arrows);
  refresh();
  return wrap;
}

function buildSpacingCross(
  title: string,
  sides: Record<'top' | 'right' | 'bottom' | 'left', PropEntry | undefined>,
): HTMLElement {
  const wrap = createEl('div');
  wrap.appendChild(createEl('div', 'matrix-title', title));
  const grid = createEl('div', 'matrix-grid');
  function placeholder() {
    return createEl('span');
  }
  grid.appendChild(placeholder());
  grid.appendChild(buildMiniStepper(sides.top));
  grid.appendChild(placeholder());
  grid.appendChild(buildMiniStepper(sides.left));
  grid.appendChild(createEl('div', 'matrix-center'));
  grid.appendChild(buildMiniStepper(sides.right));
  grid.appendChild(placeholder());
  grid.appendChild(buildMiniStepper(sides.bottom));
  grid.appendChild(placeholder());
  wrap.appendChild(grid);
  return wrap;
}

// ── Color card ─────────────────────────────────────────────────────────────
function buildColorBlock(prop: PropEntry): HTMLElement {
  const block = createEl('div', 'color-prop');

  const head = createEl('div', 'color-head');
  const swatch = createEl('span', 'color-swatch');
  swatch.style.background = prop.value;
  const colorInput = createEl('input');
  colorInput.type = 'color';
  colorInput.value = parseHex(prop.value) ?? '#000000';
  swatch.appendChild(colorInput);
  head.appendChild(swatch);
  head.appendChild(createEl('span', 'color-label', shortLabel(prop.prop)));
  block.appendChild(head);

  const value = createEl('div', 'color-value', prop.value);
  block.appendChild(value);

  const stepper = createEl('div', 'stepper');
  const name = createEl('button', 'stepper-name');
  name.type = 'button';
  name.setAttribute('aria-haspopup', 'listbox');
  const arrows = createEl('div', 'stepper-arrows');
  const prev = createEl('button', 'stepper-arr stepper-arr-prev');
  prev.type = 'button';
  prev.innerHTML = CHEVRON_LEFT;
  prev.setAttribute('aria-label', 'Previous color');
  const next = createEl('button', 'stepper-arr stepper-arr-next');
  next.type = 'button';
  next.innerHTML = CHEVRON_RIGHT;
  next.setAttribute('aria-label', 'Next color');
  arrows.appendChild(prev);
  arrows.appendChild(next);

  const state = initStepperState(prop);

  function refresh() {
    if (state.candidates.length < 2 || state.index < 0) {
      prev.disabled = true;
      next.disabled = true;
    } else {
      prev.disabled = state.index <= 0;
      next.disabled = state.index >= state.candidates.length - 1;
    }
    if (state.index >= 0) {
      const cur = state.candidates[state.index]!;
      name.textContent = formatTokenName(cur);
      name.classList.remove('is-empty');
    } else {
      name.textContent = '—';
      name.classList.add('is-empty');
    }
  }

  function applyIndex(idx: number) {
    if (!prop.tokens[0]) return;
    if (idx < 0 || idx >= state.candidates.length) return;
    state.index = idx;
    const target = state.candidates[idx]!;
    const nextValue = valueAsString(target.value);
    value.textContent = nextValue;
    swatch.style.background = nextValue;
    colorInput.value = parseHex(nextValue) ?? colorInput.value;
    refresh();
    emitTokenUpdate(prop.tokens[0].path, target.value);
  }

  prev.addEventListener('click', () => applyIndex(state.index - 1));
  next.addEventListener('click', () => applyIndex(state.index + 1));
  name.addEventListener('click', (e) => {
    if (state.candidates.length === 0 || !prop.tokens[0]) return;
    e.stopPropagation();
    openTokenDropdown(name, state, applyIndex);
  });

  colorInput.addEventListener('input', () => {
    swatch.style.background = colorInput.value;
    value.textContent = colorInput.value;
    swatchRefs.forEach((s) => s.classList.remove('is-current'));
    if (prop.tokens.length) emitTokenUpdate(prop.tokens[0]!.path, colorInput.value);
  });

  stepper.appendChild(name);
  stepper.appendChild(arrows);
  block.appendChild(stepper);

  // Swatch grid — every color token visible at a glance.
  const grid = createEl('div', 'swatch-grid');
  const swatchRefs: HTMLButtonElement[] = [];
  state.candidates.forEach((c, i) => {
    if (typeof c.value !== 'string') return;
    const mini = createEl('button', 'swatch-mini');
    mini.type = 'button';
    mini.style.background = c.value;
    const tokenName = formatTokenName(c);
    mini.title = `${tokenName} · ${c.value}`;
    mini.setAttribute('aria-label', tokenName);
    if (i === state.index) mini.classList.add('is-current');
    mini.addEventListener('click', (e) => {
      e.stopPropagation();
      applyIndex(i);
    });
    swatchRefs.push(mini);
    grid.appendChild(mini);
  });
  block.appendChild(grid);

  // Wire grid into applyIndex by overriding refresh to keep current swatch in sync.
  const originalApply = applyIndex;
  function applyAndSync(idx: number) {
    originalApply(idx);
    swatchRefs.forEach((s, i) => s.classList.toggle('is-current', i === idx));
  }
  // Reassign listeners that reference applyIndex
  prev.removeEventListener('click', () => {});
  next.removeEventListener('click', () => {});
  // Easiest: replace handlers
  prev.onclick = () => applyAndSync(state.index - 1);
  next.onclick = () => applyAndSync(state.index + 1);
  name.onclick = (e) => {
    if (state.candidates.length === 0 || !prop.tokens[0]) return;
    e.stopPropagation();
    openTokenDropdown(name, state, applyAndSync);
  };
  swatchRefs.forEach((m, i) => {
    m.onclick = (e) => {
      e.stopPropagation();
      applyAndSync(i);
    };
  });

  refresh();
  return block;
}

// ── Card builders ──────────────────────────────────────────────────────────
function buildCard(label: string, content: HTMLElement | null, isEmpty: boolean): HTMLElement {
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', label));
  if (isEmpty || !content) {
    card.appendChild(createEl('div', 'card-empty', '—'));
    return card;
  }
  card.appendChild(content);
  return card;
}

function buildTypographyCard(props: PropEntry[]): HTMLElement {
  if (!props.length) return buildCard('Typography', null, true);
  const inner = document.createDocumentFragment();
  for (const p of props) inner.appendChild(buildPropertyBlock(p));
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Typography'));
  card.appendChild(inner as unknown as Node);
  // documentFragment loses ref, rebuild simply:
  const card2 = createEl('section', 'card');
  card2.appendChild(createEl('div', 'card-label', 'Typography'));
  for (const p of props) card2.appendChild(buildPropertyBlock(p));
  return card2;
}

function buildSpacingCard(spacingProps: PropEntry[], gapProp: PropEntry | undefined): HTMLElement {
  const findSide = (prefix: string, side: string) =>
    spacingProps.find((p) => p.prop === `${prefix}-${side}`);
  const hasPadding = ['top', 'right', 'bottom', 'left'].some((s) => !!findSide('padding', s));
  const hasMargin = ['top', 'right', 'bottom', 'left'].some((s) => !!findSide('margin', s));

  if (!hasPadding && !hasMargin && !gapProp) return buildCard('Spacing', null, true);

  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Spacing'));

  if (hasPadding) {
    card.appendChild(
      buildSpacingCross('Padding', {
        top: findSide('padding', 'top'),
        right: findSide('padding', 'right'),
        bottom: findSide('padding', 'bottom'),
        left: findSide('padding', 'left'),
      }),
    );
  }
  if (hasMargin) {
    card.appendChild(
      buildSpacingCross('Margin', {
        top: findSide('margin', 'top'),
        right: findSide('margin', 'right'),
        bottom: findSide('margin', 'bottom'),
        left: findSide('margin', 'left'),
      }),
    );
  }
  if (gapProp) {
    const gapBlock = buildPropertyBlock(gapProp);
    gapBlock.style.marginTop = '14px';
    card.appendChild(gapBlock);
  }
  return card;
}

function buildColorCard(props: PropEntry[]): HTMLElement {
  if (!props.length) return buildCard('Color', null, true);
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Color'));
  for (const p of props) card.appendChild(buildColorBlock(p));
  return card;
}

function buildSurfaceCard(props: PropEntry[]): HTMLElement {
  if (!props.length) return buildCard('Surface', null, true);
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Surface'));
  for (const p of props) card.appendChild(buildPropertyBlock(p));
  return card;
}

// ── Panel ──────────────────────────────────────────────────────────────────
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
  close.type = 'button';
  close.setAttribute('aria-label', 'Close edit panel');
  close.addEventListener('click', removeEditPanel);
  hdr.appendChild(title);
  hdr.appendChild(close);
  panel.appendChild(hdr);

  panel.appendChild(createEl('div', 'divider'));

  // Strip — four cards always rendered (with "—" empty state for missing categories)
  const strip = createEl('div', 'strip');

  const typoProps = props.filter((p) => TYPO_HINTS.includes(p.hint));
  const spacingProps = props.filter((p) => p.hint === 'spacing');
  const colorProps = props.filter((p) => p.hint === 'color');
  const surfaceProps = props.filter((p) => SURFACE_HINTS.includes(p.hint));
  const gapProp = spacingProps.find((p) => p.prop === 'gap');
  const sideSpacing = spacingProps.filter((p) => p.prop !== 'gap');

  strip.appendChild(buildTypographyCard(typoProps));
  strip.appendChild(buildSpacingCard(sideSpacing, gapProp));
  strip.appendChild(buildColorCard(colorProps));
  strip.appendChild(buildSurfaceCard(surfaceProps));

  panel.appendChild(strip);

  return panel;
}

// ── Edit panel placement ───────────────────────────────────────────────────
type Placement = 'below' | 'above';

function showEditPanel(el: Element): void {
  removeEditPanel();
  ensureEditStyles();
  hoverEl = el;
  const props = inspectElement(el);
  const panel = buildEditPanel(el, props);

  // Render hidden first so we can measure and decide what to do.
  panel.style.visibility = 'hidden';
  panel.style.top = '0';
  panel.style.left = '0';
  document.body.appendChild(panel);
  editPanel = panel;

  const panelHeight = panel.getBoundingClientRect().height;
  const r = el.getBoundingClientRect();
  const fitsBelow = r.bottom + 12 + panelHeight + 8 <= window.innerHeight;

  function reveal(placement: Placement) {
    if (editPanel !== panel) return; // user clicked elsewhere mid-scroll
    panel.style.visibility = '';
    positionEditPanel(panel, el, placement);
  }

  if (fitsBelow) {
    reveal('below');
    return;
  }

  // Need more room. Try scrolling the page so the panel fits below.
  const overflow = r.bottom + 12 + panelHeight + 8 - window.innerHeight;
  const docEl = document.documentElement;
  const maxScrollDown = docEl.scrollHeight - window.scrollY - window.innerHeight;

  if (maxScrollDown >= overflow) {
    window.scrollBy({ top: overflow, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => requestAnimationFrame(() => reveal('below')));
    return;
  }

  // Can't scroll enough — page is at the bottom. Flip above. If we
  // can't fit above either as-is, scroll up to make room.
  const spaceAbove = r.top - 8;
  if (spaceAbove >= panelHeight + 12) {
    reveal('above');
    return;
  }
  const scrollUpNeeded = panelHeight + 12 - spaceAbove;
  const maxScrollUp = window.scrollY;
  if (maxScrollUp > 0) {
    window.scrollBy({ top: -Math.min(scrollUpNeeded, maxScrollUp), left: 0, behavior: 'auto' });
    requestAnimationFrame(() => requestAnimationFrame(() => reveal('above')));
  } else {
    reveal('above');
  }
}

function positionEditPanel(panel: HTMLElement, el: Element, placement: Placement): void {
  const r = el.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();

  let top: number;
  if (placement === 'above') {
    top = r.top - pr.height - 12;
  } else {
    top = r.bottom + 12;
  }

  // Clamp to viewport bounds — never let the panel slip offscreen.
  const minTop = 8;
  const maxTop = window.innerHeight - pr.height - 8;
  if (maxTop > minTop && top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;

  let left = r.left;
  if (left + pr.width > window.innerWidth - 8) {
    left = window.innerWidth - pr.width - 8;
  }
  if (left < 8) left = 8;

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function removeEditPanel(): void {
  closeDropdown();
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
    if (id === OVERLAY_ID || id === LABEL_ID || id === PANEL_ID || id === DROPDOWN_ID) return true;
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

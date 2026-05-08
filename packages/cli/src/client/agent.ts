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
  | 'duration'
  | 'unknown';

interface PropEntry {
  prop: string; // CSS property name (e.g. 'padding-top')
  value: string; // resolved computed value
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

const ACCENT = 'oklch(0.82 0.16 75)';
const SURFACE = 'oklch(0.13 0.005 250)';
const SURFACE_2 = 'oklch(0.17 0.005 250)';
const BORDER = 'oklch(0.24 0.005 250)';
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
  // If the edit panel is open, refresh it (token names/values may have changed)
  if (editPanel && hoverEl) showEditPanel(hoverEl);
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
  // Unitless line-height tokens
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
    if (!value || value === 'normal' || value === '0px' || value === 'none') return;
    const matches = tokensForValue(value, hint);
    props.push({ prop, value, tokens: matches, hint });
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
      padding: '6px 8px',
      borderRadius: '6px',
      font: '11px ui-monospace, "SF Mono", "JetBrains Mono", monospace',
      lineHeight: '1.4',
      whiteSpace: 'pre',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      maxWidth: '360px',
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

// ── Edit panel ─────────────────────────────────────────────────────────────
function ensureEditStyles(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
    #${PANEL_ID}, #${PANEL_ID} *, #${DROPDOWN_ID}, #${DROPDOWN_ID} * {
      box-sizing: border-box;
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
    }
    #${PANEL_ID} {
      position: fixed;
      width: 380px;
      max-height: 70vh;
      overflow-y: auto;
      background: ${SURFACE};
      color: ${INK_1};
      border: 1px solid ${BORDER};
      border-radius: 10px;
      box-shadow: 0 12px 32px -8px rgba(0,0,0,.45), 0 1px 0 ${BORDER};
      padding: 14px 16px;
      z-index: 2147483647;
      font-size: 11px;
      line-height: 1.5;
    }
    #${PANEL_ID} .dml-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
    }
    #${PANEL_ID} .dml-tag { font-size: 12px; font-weight: 500; color: ${INK_1}; }
    #${PANEL_ID} .dml-subhead { font-size: 11px; color: ${INK_3}; margin-top: 2px; }
    #${PANEL_ID} .dml-close {
      background: none; border: 0; cursor: pointer;
      color: ${INK_3}; font-size: 13px; line-height: 1; padding: 4px;
      border-radius: 4px;
    }
    #${PANEL_ID} .dml-close:hover { color: ${INK_1}; background: ${SURFACE_2}; }
    #${PANEL_ID} .dml-divider {
      height: 1px; background: ${BORDER}; margin: 12px 0;
    }
    #${PANEL_ID} .dml-group { margin-bottom: 14px; }
    #${PANEL_ID} .dml-group:last-child { margin-bottom: 0; }
    #${PANEL_ID} .dml-group-label {
      font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: ${INK_3};
      margin-bottom: 6px;
    }
    #${PANEL_ID} .dml-row {
      display: grid;
      grid-template-columns: 16px minmax(96px, max-content) 8px 1fr 110px;
      align-items: center; height: 28px;
      padding: 0 6px;
      border-radius: 4px;
      margin: 0 -6px;
      column-gap: 6px;
    }
    #${PANEL_ID} .dml-row:hover { background: ${SURFACE_2}; }
    #${PANEL_ID} .dml-prop { color: ${INK_2}; }
    #${PANEL_ID} .dml-dot { color: ${INK_3}; text-align: center; }
    #${PANEL_ID} .dml-chip {
      color: ${INK_2}; cursor: pointer; user-select: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${PANEL_ID} .dml-chip:hover {
      color: ${INK_1};
      text-decoration: underline; text-underline-offset: 3px;
      text-decoration-color: ${ACCENT};
    }
    #${PANEL_ID} .dml-chip.is-empty { color: ${INK_3}; cursor: default; pointer-events: none; }
    #${PANEL_ID} .dml-value-cell {
      display: flex; align-items: center; gap: 4px; justify-content: flex-end;
      min-width: 0;
    }
    #${PANEL_ID} .dml-input {
      background: transparent; border: 1px solid transparent; outline: none;
      color: ${INK_1}; padding: 2px 6px; font: inherit;
      border-radius: 4px; text-align: right; min-width: 0; flex: 1;
    }
    #${PANEL_ID} .dml-input.is-readonly {
      pointer-events: none; color: ${INK_3};
    }
    #${PANEL_ID} .dml-input:hover { background: ${SURFACE_2}; }
    #${PANEL_ID} .dml-input:focus { background: ${SURFACE_2}; border-color: ${ACCENT}; }
    #${PANEL_ID} .dml-chevron {
      background: none; border: 0; cursor: pointer; color: ${INK_3};
      padding: 0 4px; font-size: 9px; line-height: 1; user-select: none;
      flex-shrink: 0;
    }
    #${PANEL_ID} .dml-chevron:hover { color: ${ACCENT}; }
    #${PANEL_ID} .dml-chevron.is-disabled { visibility: hidden; }
    #${PANEL_ID} .dml-swatch {
      position: relative;
      width: 12px; height: 12px; border-radius: 3px;
      border: 1px solid oklch(0.32 0 0); cursor: pointer;
      flex-shrink: 0;
      transition: transform 120ms;
      justify-self: center;
    }
    #${PANEL_ID} .dml-swatch:hover { transform: scale(1.10); }
    #${PANEL_ID} .dml-swatch input[type="color"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; border: 0; padding: 0;
      width: 100%; height: 100%;
    }
    #${PANEL_ID} .dml-empty {
      color: ${INK_3}; padding: 8px 0; font-size: 11px;
    }
    #${DROPDOWN_ID} {
      position: fixed;
      background: ${SURFACE};
      border: 1px solid ${BORDER};
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,.40);
      padding: 4px;
      z-index: 2147483647;
      font-size: 11px;
      min-width: 220px;
      max-height: 240px;
      overflow-y: auto;
    }
    #${DROPDOWN_ID} .ddi {
      display: grid; grid-template-columns: 1fr auto auto;
      gap: 12px; padding: 4px 8px;
      border-radius: 4px; cursor: pointer;
      color: ${INK_1};
      align-items: baseline;
    }
    #${DROPDOWN_ID} .ddi:hover { background: ${SURFACE_2}; }
    #${DROPDOWN_ID} .ddi-name { color: ${INK_2}; white-space: nowrap; }
    #${DROPDOWN_ID} .ddi-value { color: ${INK_1}; white-space: nowrap; opacity: 0.85; }
    #${DROPDOWN_ID} .ddi-check { color: ${ACCENT}; width: 10px; text-align: right; }
    #${DROPDOWN_ID} .ddi-check.is-hidden { visibility: hidden; }
  `;
  document.head.appendChild(style);
}

const GROUP_ORDER: { hints: PropKind[]; label: string }[] = [
  { hints: ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'], label: 'Typography' },
  { hints: ['spacing'], label: 'Spacing' },
  { hints: ['color'], label: 'Color' },
  { hints: ['radius'], label: 'Radius' },
  { hints: ['shadow'], label: 'Shadow' },
  { hints: ['opacity'], label: 'Opacity' },
  { hints: ['duration'], label: 'Motion' },
];

function dropdownCandidates(prop: PropEntry): CachedToken[] {
  if (!prop.tokens.length) return [];
  const ref = prop.tokens[0]!;
  const cat = ref.path[0];
  const sub = ref.path[1];
  return tokens.filter((t) => {
    if (t.path[0] !== cat) return false;
    if (cat === 'typography') return t.path[1] === sub;
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

function buildEditPanel(el: Element, props: PropEntry[]): HTMLElement {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  // Header
  const header = document.createElement('div');
  header.className = 'dml-header';
  const title = document.createElement('div');
  const tag = document.createElement('div');
  tag.className = 'dml-tag';
  tag.textContent = `<${el.tagName.toLowerCase()}>`;
  const sub = document.createElement('div');
  sub.className = 'dml-subhead';
  const matched = props.filter((p) => p.tokens.length).length;
  sub.textContent = `${props.length} propert${props.length === 1 ? 'y' : 'ies'} · ${matched} token${matched === 1 ? '' : 's'} matched`;
  title.appendChild(tag);
  title.appendChild(sub);
  const close = document.createElement('button');
  close.className = 'dml-close';
  close.textContent = '✕';
  close.addEventListener('click', removeEditPanel);
  header.appendChild(title);
  header.appendChild(close);
  panel.appendChild(header);

  const divider = document.createElement('div');
  divider.className = 'dml-divider';
  panel.appendChild(divider);

  // Groups
  let nonEmptyGroups = 0;
  for (const group of GROUP_ORDER) {
    const groupProps = props.filter((p) => group.hints.includes(p.hint));
    if (!groupProps.length) continue;
    nonEmptyGroups++;
    const groupEl = document.createElement('div');
    groupEl.className = 'dml-group';
    const groupLabel = document.createElement('div');
    groupLabel.className = 'dml-group-label';
    groupLabel.textContent = group.label;
    groupEl.appendChild(groupLabel);
    for (const prop of groupProps) {
      groupEl.appendChild(buildRow(prop));
    }
    panel.appendChild(groupEl);
  }

  if (nonEmptyGroups === 0) {
    const empty = document.createElement('div');
    empty.className = 'dml-empty';
    empty.textContent = 'No inspectable styles on this element.';
    panel.appendChild(empty);
  }

  return panel;
}

function buildRow(prop: PropEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dml-row';

  // Column 1: leading sample (color swatch only) or empty cell
  const lead = document.createElement('span');
  if (prop.hint === 'color' && prop.value) {
    lead.className = 'dml-swatch';
    lead.style.background = prop.value;
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = parseHex(prop.value) ?? '#000000';
    colorInput.addEventListener('input', () => {
      const next = colorInput.value;
      lead.style.background = next;
      if (prop.tokens.length) emitTokenUpdate(prop.tokens[0]!.path, next);
    });
    lead.appendChild(colorInput);
  }
  row.appendChild(lead);

  // Column 2: property name
  const propCell = document.createElement('span');
  propCell.className = 'dml-prop';
  propCell.textContent = prop.prop;
  row.appendChild(propCell);

  // Column 3: separator
  const dot = document.createElement('span');
  dot.className = 'dml-dot';
  dot.textContent = '·';
  row.appendChild(dot);

  // Column 4: token chip
  const chip = document.createElement('span');
  if (prop.tokens.length) {
    chip.className = 'dml-chip';
    chip.textContent = prop.tokens[0]!.path.join('.');
    chip.title = `Show ${chip.textContent} in panel`;
    chip.addEventListener('click', () => emitInspectSelect(prop));
  } else {
    chip.className = 'dml-chip is-empty';
    chip.textContent = '—';
  }
  row.appendChild(chip);

  // Column 5: value editor + chevron
  const valueCell = document.createElement('div');
  valueCell.className = 'dml-value-cell';

  const input = document.createElement('input');
  input.className = 'dml-input';
  input.type = 'text';
  input.value = prop.value;
  if (!prop.tokens.length) {
    input.classList.add('is-readonly');
    input.readOnly = true;
  }
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
  valueCell.appendChild(input);

  const chevron = document.createElement('button');
  chevron.className = 'dml-chevron';
  chevron.textContent = '▾';
  if (!prop.tokens.length) chevron.classList.add('is-disabled');
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(prop, chevron, input);
  });
  valueCell.appendChild(chevron);

  row.appendChild(valueCell);
  return row;
}

function parseHex(value: string): string | null {
  // Use the browser's parser via a probe element
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
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(parts[0]!)}${hex(parts[1]!)}${hex(parts[2]!)}`;
}

// ── Token dropdown (▾) ─────────────────────────────────────────────────────
function closeDropdown(): void {
  document.getElementById(DROPDOWN_ID)?.remove();
}

function openDropdown(prop: PropEntry, anchor: HTMLElement, input: HTMLInputElement): void {
  closeDropdown();
  const candidates = dropdownCandidates(prop);
  if (!candidates.length) return;
  const dd = document.createElement('div');
  dd.id = DROPDOWN_ID;

  const currentPath = prop.tokens[0]!.path.join('.');
  for (const c of candidates) {
    const item = document.createElement('div');
    item.className = 'ddi';
    const name = document.createElement('span');
    name.className = 'ddi-name';
    name.textContent = c.path.join('.');
    const val = document.createElement('span');
    val.className = 'ddi-value';
    val.textContent = valueAsString(c.value);
    const check = document.createElement('span');
    check.className = 'ddi-check';
    if (c.path.join('.') === currentPath) {
      check.textContent = '✓';
    } else {
      check.classList.add('is-hidden');
    }
    item.appendChild(name);
    item.appendChild(val);
    item.appendChild(check);
    item.addEventListener('click', () => {
      // Update the *active* token path's value to this candidate's value.
      // (We rebind the prop.tokens[0] reference so the chip reflects the choice.)
      const nextValue = c.value;
      input.value = valueAsString(nextValue);
      emitTokenUpdate(prop.tokens[0]!.path, nextValue);
      closeDropdown();
    });
    dd.appendChild(item);
  }

  document.body.appendChild(dd);
  const r = anchor.getBoundingClientRect();
  const ddr = dd.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.right - ddr.width;
  if (top + ddr.height > window.innerHeight - 8) top = r.top - ddr.height - 6;
  if (left < 8) left = 8;
  dd.style.top = `${top}px`;
  dd.style.left = `${left}px`;

  // Dismiss on outside click
  setTimeout(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (t && (t === dd || dd.contains(t))) return;
      closeDropdown();
      document.removeEventListener('click', onDocClick, true);
    }
    document.addEventListener('click', onDocClick, true);
  }, 0);
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
  // Walk up to see if the element is inside any of our agent-injected nodes
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

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
  | 'borderWidth';

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
const POPOVER_ID = 'designmd-live-popover';
const GAP_LABEL_ID = 'designmd-live-gap-label';

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
let selectedEl: Element | null = null;
let hoverGap: GapTarget | null = null;
let selectedGap: GapTarget | null = null;
let editPanel: HTMLElement | null = null;
// Active token stepper exposed for keyboard-driven cycling. Set by either
// the gap card (gap selected) or the property popover (row focused), unified
// so the global keydown handler doesn't have to know which UI is driving it.
let activeStepperRef: { step: (delta: number) => void } | null = null;
let propertyPopover: HTMLElement | null = null;
// Tracks the element/parent of the current gap selection so the overlay can
// re-measure as Tailwind v4 JIT + Vite HMR finalize the new utility's CSS.
let gapResizeObserver: ResizeObserver | null = null;
let gapResizeRefresh: (() => void) | null = null;
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
  if (hint === 'borderWidth') return path[0] === 'border' || path[0] === 'borderWidth';
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
  // Border (single representative side; surface-level info)
  const bw = cs.borderTopWidth;
  const hasBorder = bw && bw !== '0px';
  if (hasBorder) add('border-width', bw, 'borderWidth');
  // Only surface border-color when there's an actual border — otherwise the
  // computed value is `currentColor` (= the text color) and shows up as noise.
  if (hasBorder) {
    const bc = cs.borderTopColor;
    if (bc && bc !== 'rgba(0, 0, 0, 0)' && bc !== 'transparent') {
      add('border-color', bc, 'color');
    }
  }
  add('box-shadow', cs.boxShadow, 'shadow');
  if (cs.opacity && cs.opacity !== '1') add('opacity', cs.opacity, 'opacity');
  if (cs.transitionDuration && cs.transitionDuration !== '0s') {
    add('transition-duration', cs.transitionDuration, 'duration');
  }
  return props;
}

// ── Hover overlay (outline only — token details live in the panel) ─────────
function ensureOverlay(): HTMLElement {
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
  return box;
}

function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function placeOverlay(el: Element): void {
  const box = ensureOverlay();
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    background: 'transparent',
    border: `2px solid ${ACCENT}`,
    borderRadius: '3px',
  });
}

// ── Gap detection ─────────────────────────────────────────────────────────
type GapAxis = 'vertical' | 'horizontal';

type SpacingProp =
  | 'row-gap'
  | 'column-gap'
  | 'gap'
  | 'margin-top'
  | 'margin-bottom'
  | 'margin-left'
  | 'margin-right'
  | 'padding-top'
  | 'padding-bottom'
  | 'padding-left'
  | 'padding-right';

interface GapSource {
  kind: 'parentGap' | 'margin' | 'padding';
  el: Element;
  prop: SpacingProp;
  value: string;
}

interface GapTarget {
  parent: Element;
  before: Element;
  after: Element;
  axis: GapAxis;
  rect: { left: number; right: number; top: number; bottom: number };
  source: GapSource;
}

function isVisibleChild(el: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function pxOrZero(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function resolveGapSource(
  parent: Element,
  before: Element,
  after: Element,
  axis: GapAxis,
): GapSource {
  const cs = getComputedStyle(parent);
  const display = cs.display;
  const isFlexOrGrid =
    display === 'flex' ||
    display === 'inline-flex' ||
    display === 'grid' ||
    display === 'inline-grid';
  const gapValue = axis === 'vertical' ? cs.rowGap : cs.columnGap;
  if (
    isFlexOrGrid &&
    gapValue &&
    gapValue !== 'normal' &&
    gapValue !== '0px' &&
    gapValue !== '0'
  ) {
    return {
      kind: 'parentGap',
      el: parent,
      prop: axis === 'vertical' ? 'row-gap' : 'column-gap',
      value: gapValue,
    };
  }
  // Block flow / no parent gap: the visual gap can come from before's
  // trailing margin OR after's leading margin (or both, with collapse).
  // Pick whichever is non-zero, preferring the larger one.
  const beforeCs = getComputedStyle(before);
  const afterCs = getComputedStyle(after);
  const beforeProp = axis === 'vertical' ? 'margin-bottom' : 'margin-right';
  const afterProp = axis === 'vertical' ? 'margin-top' : 'margin-left';
  const beforeVal = axis === 'vertical' ? beforeCs.marginBottom : beforeCs.marginRight;
  const afterVal = axis === 'vertical' ? afterCs.marginTop : afterCs.marginLeft;
  const beforePx = pxOrZero(beforeVal);
  const afterPx = pxOrZero(afterVal);
  if (afterPx > beforePx) {
    return { kind: 'margin', el: after, prop: afterProp, value: afterVal };
  }
  return { kind: 'margin', el: before, prop: beforeProp, value: beforeVal };
}

function findGapInChildren(parent: Element, x: number, y: number): GapTarget | null {
  const children = Array.from(parent.children).filter(isVisibleChild);
  if (children.length < 2) return null;

  // Vertical gaps: sort by top, look for gap between consecutive rects.
  const vSorted = [...children].sort(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  );
  for (let i = 0; i < vSorted.length - 1; i++) {
    const ar = vSorted[i]!.getBoundingClientRect();
    const br = vSorted[i + 1]!.getBoundingClientRect();
    if (ar.bottom < br.top - 0.5) {
      const left = Math.min(ar.left, br.left);
      const right = Math.max(ar.right, br.right);
      if (x >= left && x <= right && y >= ar.bottom && y <= br.top) {
        return {
          parent,
          before: vSorted[i]!,
          after: vSorted[i + 1]!,
          axis: 'vertical',
          rect: { left, right, top: ar.bottom, bottom: br.top },
          source: resolveGapSource(parent, vSorted[i]!, vSorted[i + 1]!, 'vertical'),
        };
      }
    }
  }

  // Horizontal gaps: sort by left.
  const hSorted = [...children].sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
  );
  for (let i = 0; i < hSorted.length - 1; i++) {
    const ar = hSorted[i]!.getBoundingClientRect();
    const br = hSorted[i + 1]!.getBoundingClientRect();
    if (ar.right < br.left - 0.5) {
      const top = Math.min(ar.top, br.top);
      const bottom = Math.max(ar.bottom, br.bottom);
      if (x >= ar.right && x <= br.left && y >= top && y <= bottom) {
        return {
          parent,
          before: hSorted[i]!,
          after: hSorted[i + 1]!,
          axis: 'horizontal',
          rect: { left: ar.right, right: br.left, top, bottom },
          source: resolveGapSource(parent, hSorted[i]!, hSorted[i + 1]!, 'horizontal'),
        };
      }
    }
  }

  return null;
}

function sameGap(a: GapTarget, b: GapTarget): boolean {
  return a.parent === b.parent && a.before === b.before && a.after === b.after && a.axis === b.axis;
}

// Vertical empty zone in the BOTTOM padding of `el` (between its last visible
// child and `el`'s content edge / next sibling). Source = bigger of
// el.padding-bottom vs nextSibling.margin-top.
function findTrailingGapV(el: Element, x: number, y: number): GapTarget | null {
  const r = el.getBoundingClientRect();
  if (x < r.left || x > r.right) return null;
  const children = Array.from(el.children).filter(isVisibleChild);
  if (children.length === 0) return null;
  let maxBottom = -Infinity;
  for (const c of children) maxBottom = Math.max(maxBottom, c.getBoundingClientRect().bottom);
  if (!Number.isFinite(maxBottom)) return null;
  // The trailing zone extends from the last child's bottom to the next
  // sibling's top (or el's bottom edge if no next sibling).
  let zoneBottom = r.bottom;
  let nextSibling: Element | null = null;
  const next = el.nextElementSibling;
  if (next && isVisibleChild(next)) {
    const nr = next.getBoundingClientRect();
    if (nr.top > r.bottom) zoneBottom = nr.top;
    nextSibling = next;
  }
  if (y <= maxBottom || y > zoneBottom) return null;
  const cs = getComputedStyle(el);
  const padBot = pxOrZero(cs.paddingBottom);
  const mt = nextSibling ? pxOrZero(getComputedStyle(nextSibling).marginTop) : 0;
  let source: GapSource;
  if (mt > padBot && nextSibling) {
    source = {
      kind: 'margin',
      el: nextSibling,
      prop: 'margin-top',
      value: getComputedStyle(nextSibling).marginTop,
    };
  } else {
    source = { kind: 'padding', el, prop: 'padding-bottom', value: cs.paddingBottom };
  }
  return {
    parent: el,
    before: el,
    after: nextSibling ?? el,
    axis: 'vertical',
    rect: { left: r.left, right: r.right, top: maxBottom, bottom: zoneBottom },
    source,
  };
}

// Symmetric: empty zone in the TOP padding of `el`.
function findLeadingGapV(el: Element, x: number, y: number): GapTarget | null {
  const r = el.getBoundingClientRect();
  if (x < r.left || x > r.right) return null;
  const children = Array.from(el.children).filter(isVisibleChild);
  if (children.length === 0) return null;
  let minTop = Infinity;
  for (const c of children) minTop = Math.min(minTop, c.getBoundingClientRect().top);
  if (!Number.isFinite(minTop)) return null;
  let zoneTop = r.top;
  let prevSibling: Element | null = null;
  const prev = el.previousElementSibling;
  if (prev && isVisibleChild(prev)) {
    const pr = prev.getBoundingClientRect();
    if (pr.bottom < r.top) zoneTop = pr.bottom;
    prevSibling = prev;
  }
  if (y < zoneTop || y >= minTop) return null;
  const cs = getComputedStyle(el);
  const padTop = pxOrZero(cs.paddingTop);
  const mb = prevSibling ? pxOrZero(getComputedStyle(prevSibling).marginBottom) : 0;
  let source: GapSource;
  if (mb > padTop && prevSibling) {
    source = {
      kind: 'margin',
      el: prevSibling,
      prop: 'margin-bottom',
      value: getComputedStyle(prevSibling).marginBottom,
    };
  } else {
    source = { kind: 'padding', el, prop: 'padding-top', value: cs.paddingTop };
  }
  return {
    parent: el,
    before: prevSibling ?? el,
    after: el,
    axis: 'vertical',
    rect: { left: r.left, right: r.right, top: zoneTop, bottom: minTop },
    source,
  };
}

// ── Tailwind utility detection (Phase 1: spacing only) ───────────────────
// Map a CSS property to the Tailwind utility prefixes that affect it,
// ordered by specificity (most-specific first).
const UTILITY_PREFIXES: Record<string, string[]> = {
  'margin-top': ['mt-', 'my-', 'm-'],
  'margin-bottom': ['mb-', 'my-', 'm-'],
  'margin-left': ['ml-', 'mx-', 'm-'],
  'margin-right': ['mr-', 'mx-', 'm-'],
  'padding-top': ['pt-', 'py-', 'p-'],
  'padding-bottom': ['pb-', 'py-', 'p-'],
  'padding-left': ['pl-', 'px-', 'p-'],
  'padding-right': ['pr-', 'px-', 'p-'],
  'row-gap': ['gap-y-', 'gap-'],
  'column-gap': ['gap-x-', 'gap-'],
  gap: ['gap-'],
};

interface MatchedUtility {
  prefix: string;
  scale: string;
  full: string; // e.g. "mt-6"
}

function findUtilityForProp(el: Element, prop: string): MatchedUtility | null {
  const prefixes = UTILITY_PREFIXES[prop];
  if (!prefixes) return null;
  // classList may be empty if the className is computed at runtime — Phase 1
  // assumes inline string classNames.
  const classes = Array.from(el.classList);
  for (const prefix of prefixes) {
    for (const cls of classes) {
      if (cls.startsWith(prefix)) {
        const scale = cls.slice(prefix.length);
        // Reject empty / non-scale values.
        if (!scale) continue;
        return { prefix, scale, full: cls };
      }
    }
  }
  return null;
}

interface SourceLoc {
  file: string;
  line: number;
  col: number;
}

function readSourceLoc(el: Element): SourceLoc | null {
  const raw = el.getAttribute('data-loc');
  if (!raw) return null;
  // Format: "path/to/file.tsx:LINE:COL"
  const m = raw.match(/^(.+):(\d+):(\d+)$/);
  if (!m) return null;
  return { file: m[1]!, line: Number(m[2]!), col: Number(m[3]!) };
}

function spacingTokensSorted(): CachedToken[] {
  return scaleTokensFor(['spacing']);
}

// ── Property categories (popover) ─────────────────────────────────────────
interface PropCategory {
  label: string;
  utilityPrefixes: string[]; // ordered specificity-first
  tokenPath: string[]; // root path under tokens; the next segment is the scale key
}

const PROP_CATEGORIES: PropCategory[] = [
  // Typography
  { label: 'Size', utilityPrefixes: ['text-'], tokenPath: ['typography', 'size'] },
  { label: 'Weight', utilityPrefixes: ['font-'], tokenPath: ['typography', 'weight'] },
  { label: 'Line', utilityPrefixes: ['leading-'], tokenPath: ['typography', 'lineHeight'] },
  { label: 'Tracking', utilityPrefixes: ['tracking-'], tokenPath: ['typography', 'letterSpacing'] },
  // Surface
  { label: 'Radius', utilityPrefixes: ['rounded-'], tokenPath: ['radius'] },
  // Spacing — one row per side; shows up only when the matching utility exists.
  { label: 'Pad ↑', utilityPrefixes: ['pt-', 'py-', 'p-'], tokenPath: ['spacing'] },
  { label: 'Pad →', utilityPrefixes: ['pr-', 'px-', 'p-'], tokenPath: ['spacing'] },
  { label: 'Pad ↓', utilityPrefixes: ['pb-', 'py-', 'p-'], tokenPath: ['spacing'] },
  { label: 'Pad ←', utilityPrefixes: ['pl-', 'px-', 'p-'], tokenPath: ['spacing'] },
  { label: 'Mar ↑', utilityPrefixes: ['mt-', 'my-', 'm-'], tokenPath: ['spacing'] },
  { label: 'Mar →', utilityPrefixes: ['mr-', 'mx-', 'm-'], tokenPath: ['spacing'] },
  { label: 'Mar ↓', utilityPrefixes: ['mb-', 'my-', 'm-'], tokenPath: ['spacing'] },
  { label: 'Mar ←', utilityPrefixes: ['ml-', 'mx-', 'm-'], tokenPath: ['spacing'] },
  { label: 'Gap', utilityPrefixes: ['gap-'], tokenPath: ['spacing'] },
];

function pathStartsWith(path: string[], prefix: string[]): boolean {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}

function scaleTokensFor(tokenPath: string[]): CachedToken[] {
  const list = tokens.filter(
    (t) =>
      t.path.length === tokenPath.length + 1 &&
      pathStartsWith(t.path, tokenPath) &&
      (typeof t.value === 'string' || typeof t.value === 'number'),
  );
  // Sort numerically by resolved value when possible; fall back to a stable
  // string compare on the scale key for non-dimensional tokens (font weight
  // names, etc.).
  return list.sort((a, b) => {
    const av = numericTokenValue(a);
    const bv = numericTokenValue(b);
    if (av != null && bv != null) return av - bv;
    return String(a.path.at(-1)).localeCompare(String(b.path.at(-1)));
  });
}

function numericTokenValue(t: CachedToken): number | null {
  if (typeof t.value === 'number') return t.value;
  if (typeof t.value === 'string') {
    const n = parseFloat(t.value);
    if (Number.isFinite(n)) return n;
  }
  const px = toPx(t.value as TokenValue);
  return px;
}

interface CategoryMatch {
  cat: PropCategory;
  utility: MatchedUtility;
  scale: CachedToken[];
  scaleIndex: number;
}

function findCategoryMatches(el: Element): CategoryMatch[] {
  const classes = Array.from(el.classList);
  const out: CategoryMatch[] = [];
  const seenLabels = new Set<string>();
  for (const cat of PROP_CATEGORIES) {
    const scale = scaleTokensFor(cat.tokenPath);
    if (scale.length === 0) continue;
    let found: MatchedUtility | null = null;
    // First pass: prefer a utility whose suffix is a defined token (exact
    // mapping). Second pass: accept any utility with this prefix even if
    // unmapped — we still let the user step into a defined scale.
    for (const requireMatch of [true, false]) {
      if (found) break;
      for (const prefix of cat.utilityPrefixes) {
        for (const cls of classes) {
          if (!cls.startsWith(prefix)) continue;
          const scaleKey = cls.slice(prefix.length);
          if (!scaleKey) continue;
          if (requireMatch && !scale.some((t) => t.path.at(-1) === scaleKey)) continue;
          found = { full: cls, scale: scaleKey, prefix };
          break;
        }
        if (found) break;
      }
    }
    if (!found) continue;
    if (seenLabels.has(cat.label)) continue;
    seenLabels.add(cat.label);
    const idx = scale.findIndex((t) => t.path.at(-1) === found!.scale);
    out.push({ cat, utility: found, scale, scaleIndex: idx });
  }
  // Collapse spacing rows that share the same source utility (e.g. `py-4`
  // controlling both Pad ↑ and Pad ↓ should show as a single row).
  return mergeSpacingShorthands(out);
}

function mergeSpacingShorthands(matches: CategoryMatch[]): CategoryMatch[] {
  const SPACING_PADDING_LABELS = new Set(['Pad ↑', 'Pad →', 'Pad ↓', 'Pad ←']);
  const SPACING_MARGIN_LABELS = new Set(['Mar ↑', 'Mar →', 'Mar ↓', 'Mar ←']);
  const others: CategoryMatch[] = [];
  // Group spacing-side matches by their utility.full (e.g. `py-4`).
  const groups = new Map<string, { match: CategoryMatch; labels: Set<string>; family: 'p' | 'm' }>();
  for (const m of matches) {
    const isPad = SPACING_PADDING_LABELS.has(m.cat.label);
    const isMar = SPACING_MARGIN_LABELS.has(m.cat.label);
    if (!isPad && !isMar) {
      others.push(m);
      continue;
    }
    const key = `${isPad ? 'p' : 'm'}:${m.utility.full}`;
    const family: 'p' | 'm' = isPad ? 'p' : 'm';
    const existing = groups.get(key);
    if (existing) {
      existing.labels.add(m.cat.label);
    } else {
      groups.set(key, { match: m, labels: new Set([m.cat.label]), family });
    }
  }
  for (const { match, labels, family } of groups.values()) {
    const merged: CategoryMatch = {
      ...match,
      cat: { ...match.cat, label: combineSpacingLabel(family, labels) },
    };
    others.push(merged);
  }
  return others;
}

function combineSpacingLabel(family: 'p' | 'm', sides: Set<string>): string {
  const prefix = family === 'p' ? 'Pad' : 'Mar';
  const hasTop = sides.has(`${prefix} ↑`);
  const hasRight = sides.has(`${prefix} →`);
  const hasBottom = sides.has(`${prefix} ↓`);
  const hasLeft = sides.has(`${prefix} ←`);
  if (hasTop && hasRight && hasBottom && hasLeft) return prefix;
  if (hasTop && hasBottom && !hasLeft && !hasRight) return `${prefix} ↕`;
  if (hasLeft && hasRight && !hasTop && !hasBottom) return `${prefix} ↔`;
  // Mixed (e.g. T+L only) — keep the first label as-is, plus a hint marker.
  const arr: string[] = [];
  if (hasTop) arr.push('↑');
  if (hasRight) arr.push('→');
  if (hasBottom) arr.push('↓');
  if (hasLeft) arr.push('←');
  return `${prefix} ${arr.join('')}`;
}

function recomputeGapRect(gap: GapTarget): GapTarget | null {
  if (!document.contains(gap.parent)) return null;
  // Sweep along the gap's main axis to find a seed point that lands inside
  // the NEW rect — the post-swap rect can be a small subset of the original,
  // and a single center point may fall outside it.
  const tryAt = (x: number, y: number) =>
    findGapInChildren(gap.parent, x, y) ??
    findTrailingGapV(gap.parent, x, y) ??
    findLeadingGapV(gap.parent, x, y);

  if (gap.axis === 'vertical') {
    const cx = (gap.rect.left + gap.rect.right) / 2;
    const step = 2;
    for (let y = gap.rect.top + 1; y < gap.rect.bottom; y += step) {
      const found = tryAt(cx, y);
      if (found) return found;
    }
  } else {
    const cy = (gap.rect.top + gap.rect.bottom) / 2;
    const step = 2;
    for (let x = gap.rect.left + 1; x < gap.rect.right; x += step) {
      const found = tryAt(x, cy);
      if (found) return found;
    }
  }
  return null;
}

// Visual treatment depends on the gap source:
//   - parentGap / margin → orange dashed (between two siblings)
//   - padding            → blue solid (inside a container's padding zone)
const PADDING_COLOR = 'oklch(0.72 0.15 240)';

function placeGapOverlay(gap: GapTarget): void {
  const box = ensureOverlay();
  const isPadding = gap.source.kind === 'padding';
  if (isPadding) {
    placePaddingStrips(box, gap.source.el);
    return;
  }
  Object.assign(box.style, {
    left: `${gap.rect.left}px`,
    top: `${gap.rect.top}px`,
    width: `${gap.rect.right - gap.rect.left}px`,
    height: `${gap.rect.bottom - gap.rect.top}px`,
    background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`,
    border: `1px dashed ${ACCENT}`,
    borderRadius: '0px',
    boxSizing: 'border-box',
    boxShadow: 'none',
  });
}

// Visualize the four padding zones the same way Chrome DevTools does: use
// the overlay's borders (one per side) at exactly the padding's pixel width,
// filled with a translucent color. Sides with zero padding render no border.
function placePaddingStrips(box: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const pt = Math.max(0, parseFloat(cs.paddingTop) || 0);
  const pr = Math.max(0, parseFloat(cs.paddingRight) || 0);
  const pb = Math.max(0, parseFloat(cs.paddingBottom) || 0);
  const pl = Math.max(0, parseFloat(cs.paddingLeft) || 0);
  const fill = `color-mix(in oklch, ${PADDING_COLOR} 32%, transparent)`;
  Object.assign(box.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    background: 'transparent',
    border: 'none',
    borderTop: pt > 0 ? `${pt}px solid ${fill}` : '0',
    borderRight: pr > 0 ? `${pr}px solid ${fill}` : '0',
    borderBottom: pb > 0 ? `${pb}px solid ${fill}` : '0',
    borderLeft: pl > 0 ? `${pl}px solid ${fill}` : '0',
    borderRadius: '0px',
    boxSizing: 'border-box',
    // Thin outer outline so the element bounds remain readable.
    boxShadow: `inset 0 0 0 1px ${PADDING_COLOR}`,
  });
}

function ensureGapLabel(): HTMLElement {
  let el = document.getElementById(GAP_LABEL_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = GAP_LABEL_ID;
    Object.assign(el.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      background: SURFACE,
      color: INK_1,
      border: `1px solid ${BORDER}`,
      borderRadius: '5px',
      padding: '3px 7px',
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", monospace',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      boxShadow: '0 4px 12px -4px rgba(0,0,0,.5)',
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
  }
  return el;
}

function placeGapLabel(gap: GapTarget, text: string): void {
  const el = ensureGapLabel();
  el.textContent = text;
  // Position just to the left of the rect, vertically centered.
  // First commit text + measure so we know the width.
  el.style.left = '-9999px';
  el.style.top = '0px';
  const lr = el.getBoundingClientRect();
  const cy = (gap.rect.top + gap.rect.bottom) / 2;
  let left = gap.rect.left - lr.width - 8;
  if (left < 4) left = gap.rect.right + 8; // not enough room left → anchor right
  if (left + lr.width > window.innerWidth - 4) left = window.innerWidth - lr.width - 4;
  const top = Math.max(4, Math.min(window.innerHeight - lr.height - 4, cy - lr.height / 2));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function removeGapLabel(): void {
  document.getElementById(GAP_LABEL_ID)?.remove();
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
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 60vh;
      overflow: auto;
      background: ${SURFACE};
      color: ${INK_1};
      border-top: 1px solid ${BORDER};
      box-shadow: 0 -8px 32px -8px rgba(0,0,0,.45);
      padding: 16px 20px;
      z-index: 2147483647;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Header */
    #${PANEL_ID} .hdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px;
      cursor: grab;
      user-select: none;
    }
    #${PANEL_ID}.is-dragging .hdr { cursor: grabbing; }
    #${PANEL_ID}.is-dragging { user-select: none; }
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
      padding: 0 14px;
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

    /* Single-line property row: [label] [value] [stepper] */
    #${PANEL_ID} .prow {
      display: grid;
      grid-template-columns: 56px 76px 1fr;
      align-items: center;
      gap: 10px;
      padding: 3px 0;
      min-height: 36px;
    }
    #${PANEL_ID} .prow-label { font-size: 13px; color: ${INK_2}; }
    #${PANEL_ID} .prow-value {
      font-size: 14px; font-weight: 500; color: ${INK_1};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #${PANEL_ID} .prow + .prow { margin-top: 0; }

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

    /* Spacing card: 2 sub-columns of 4 compact rows each */
    #${PANEL_ID} .spacing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    #${PANEL_ID} .spacing-col-title {
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: ${INK_3};
      margin-bottom: 6px;
    }
    #${PANEL_ID} .srow {
      display: grid;
      grid-template-columns: 14px 1fr 56px;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
      min-height: 32px;
    }
    #${PANEL_ID} .srow-letter {
      font-size: 12px; color: ${INK_3}; text-align: center;
    }
    #${PANEL_ID} .srow-value {
      background: ${SURFACE_2};
      border: 1px solid transparent;
      border-radius: 5px;
      color: ${INK_1}; font: inherit; font-size: 13px;
      text-align: center;
      padding: 4px 6px;
      outline: none;
      width: 100%;
    }
    #${PANEL_ID} .srow-value:hover { border-color: ${BORDER_SOFT}; }
    #${PANEL_ID} .srow-value:focus { border-color: ${ACCENT}; }
    #${PANEL_ID} .srow-value.is-zero { color: ${INK_3}; }
    #${PANEL_ID} .srow-value.is-empty { color: ${INK_3}; opacity: 0.5; pointer-events: none; }
    #${PANEL_ID} .srow-arrows {
      display: flex;
      border: 1px solid ${BORDER_SOFT};
      border-radius: 5px;
      background: ${SURFACE};
      overflow: hidden;
      height: 28px;
    }
    #${PANEL_ID} .srow-arr {
      width: 28px; padding: 0; border: 0; background: transparent;
      color: ${INK_3}; cursor: pointer; outline: none;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 80ms, color 80ms;
    }
    #${PANEL_ID} .srow-arr svg { display: block; }
    #${PANEL_ID} .srow-arr:hover { background: ${SURFACE_2}; color: ${INK_1}; }
    #${PANEL_ID} .srow-arr:disabled { opacity: 0.30; cursor: default; }
    #${PANEL_ID} .srow-arr:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }
    #${PANEL_ID} .srow-arr + .srow-arr { border-left: 1px solid ${BORDER_SOFT}; }

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

    /* Color row — single-line, then swatch grid below */
    #${PANEL_ID} .color-prop {
      margin-bottom: 12px;
    }
    #${PANEL_ID} .color-prop:last-child { margin-bottom: 0; }
    #${PANEL_ID} .crow {
      display: grid;
      grid-template-columns: 20px 1fr minmax(120px, 1.4fr);
      align-items: center;
      gap: 8px;
      min-height: 36px;
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
    #${PANEL_ID} .crow-label { font-size: 13px; color: ${INK_2}; }
    #${PANEL_ID} .crow-value {
      font-size: 14px; font-weight: 500; color: ${INK_1};
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

    /* Property popover (anchored under the selected element) */
    #${POPOVER_ID} {
      position: fixed;
      z-index: 2147483646;
      background: ${SURFACE};
      color: ${INK_1};
      border: 1px solid ${BORDER};
      border-radius: 8px;
      box-shadow: 0 10px 32px -8px rgba(0,0,0,.55);
      padding: 4px;
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
      font-size: 12px;
      min-width: 220px;
      max-width: 340px;
    }
    #${POPOVER_ID} .pp-row {
      display: grid;
      grid-template-columns: 64px 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      border-radius: 5px;
      cursor: pointer;
      user-select: none;
    }
    #${POPOVER_ID} .pp-row:hover { background: ${SURFACE_2}; }
    #${POPOVER_ID} .pp-row.is-focused {
      background: ${SURFACE_2};
      box-shadow: inset 0 0 0 1px ${ACCENT};
    }
    #${POPOVER_ID} .pp-label { color: ${INK_3}; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; }
    #${POPOVER_ID} .pp-value { color: ${INK_1}; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${POPOVER_ID} .pp-token { color: ${INK_3}; font-size: 11px; }
    #${POPOVER_ID} .pp-row.is-focused .pp-token { color: ${ACCENT}; }
  `;
  document.head.appendChild(style);
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TYPO_HINTS: PropKind[] = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const BORDER_HINTS: PropKind[] = ['borderWidth', 'radius'];
const EFFECT_HINTS: PropKind[] = ['shadow', 'opacity', 'duration'];

const SHORT_LABEL: Record<string, string> = {
  'font-size': 'Size',
  'font-weight': 'Weight',
  'line-height': 'Line',
  'letter-spacing': 'Tracking',
  color: 'Text',
  'background-color': 'Bg',
  'border-color': 'Border',
  'border-radius': 'Radius',
  'border-width': 'Width',
  'box-shadow': 'Shadow',
  opacity: 'Opacity',
  'transition-duration': 'Duration',
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
  const row = createEl('div', 'prow');
  row.appendChild(createEl('span', 'prow-label', shortLabel(prop.prop)));
  const heroEl = createEl('span', 'prow-value', formatHero(prop.value));
  row.appendChild(heroEl);

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
    heroEl.textContent = formatHero(valueAsString(target.value));
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
  row.appendChild(stepper);

  refresh();
  return row;
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

// ── Spacing card — 2 sub-columns × 4 compact rows (Top/Right/Bottom/Left) ──
function buildSpacingRow(side: 'top' | 'right' | 'bottom' | 'left', maybeProp: PropEntry | undefined): HTMLElement {
  const row = createEl('div', 'srow');
  const letter = side[0]!.toUpperCase();
  row.appendChild(createEl('span', 'srow-letter', letter));

  if (!maybeProp) {
    const empty = createEl('input', 'srow-value is-empty');
    empty.type = 'text';
    empty.value = '0';
    empty.disabled = true;
    row.appendChild(empty);
    row.appendChild(createEl('span'));
    return row;
  }
  const prop: PropEntry = maybeProp;

  const value = createEl('input', 'srow-value');
  value.type = 'text';
  value.value = compactValue(prop.value);
  value.setAttribute('aria-label', prop.prop);
  if (value.value === '0') value.classList.add('is-zero');
  if (prop.tokens.length) {
    value.title = `${prop.prop}: ${prop.tokens[0]!.path.join('.')}`;
  } else {
    value.title = prop.prop;
  }

  const arrows = createEl('div', 'srow-arrows');
  const prev = createEl('button', 'srow-arr');
  prev.type = 'button';
  prev.innerHTML = CHEVRON_LEFT_SM;
  prev.setAttribute('aria-label', `Decrease ${prop.prop}`);
  const next = createEl('button', 'srow-arr');
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

  row.appendChild(value);
  row.appendChild(arrows);
  refresh();
  return row;
}

function buildSpacingColumn(
  title: string,
  sides: Record<'top' | 'right' | 'bottom' | 'left', PropEntry | undefined>,
): HTMLElement {
  const col = createEl('div', 'spacing-col');
  col.appendChild(createEl('div', 'spacing-col-title', title));
  col.appendChild(buildSpacingRow('top', sides.top));
  col.appendChild(buildSpacingRow('right', sides.right));
  col.appendChild(buildSpacingRow('bottom', sides.bottom));
  col.appendChild(buildSpacingRow('left', sides.left));
  return col;
}

// ── Color card ─────────────────────────────────────────────────────────────
function buildColorBlock(prop: PropEntry): HTMLElement {
  const block = createEl('div', 'color-prop');

  const row = createEl('div', 'crow');
  const swatch = createEl('span', 'color-swatch');
  swatch.style.background = prop.value;
  const colorInput = createEl('input');
  colorInput.type = 'color';
  colorInput.value = parseHex(prop.value) ?? '#000000';
  swatch.appendChild(colorInput);
  row.appendChild(swatch);
  const label = createEl('span', 'crow-label', shortLabel(prop.prop));
  label.title = prop.value;
  row.appendChild(label);

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
    label.title = nextValue;
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
    label.title = colorInput.value;
    swatchRefs.forEach((s) => s.classList.remove('is-current'));
    if (prop.tokens.length) emitTokenUpdate(prop.tokens[0]!.path, colorInput.value);
  });

  stepper.appendChild(name);
  stepper.appendChild(arrows);
  row.appendChild(stepper);
  block.appendChild(row);

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

  if (hasPadding || hasMargin) {
    const grid = createEl('div', 'spacing-grid');
    if (hasPadding) {
      grid.appendChild(
        buildSpacingColumn('Padding', {
          top: findSide('padding', 'top'),
          right: findSide('padding', 'right'),
          bottom: findSide('padding', 'bottom'),
          left: findSide('padding', 'left'),
        }),
      );
    }
    if (hasMargin) {
      grid.appendChild(
        buildSpacingColumn('Margin', {
          top: findSide('margin', 'top'),
          right: findSide('margin', 'right'),
          bottom: findSide('margin', 'bottom'),
          left: findSide('margin', 'left'),
        }),
      );
    }
    card.appendChild(grid);
  }

  if (gapProp) {
    const gapBlock = buildPropertyBlock(gapProp);
    gapBlock.style.marginTop = '12px';
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

function buildBorderCard(props: PropEntry[]): HTMLElement {
  if (!props.length) return buildCard('Border', null, true);
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Border'));
  for (const p of props) card.appendChild(buildPropertyBlock(p));
  return card;
}

function buildEffectsCard(props: PropEntry[]): HTMLElement {
  if (!props.length) return buildCard('Effects', null, true);
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Effects'));
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

  // Drag from header
  attachDrag(panel, hdr);

  panel.appendChild(createEl('div', 'divider'));

  // Strip — five cards always rendered (with "—" empty state for missing categories)
  const strip = createEl('div', 'strip');

  const typoProps = props.filter((p) => TYPO_HINTS.includes(p.hint));
  const spacingProps = props.filter((p) => p.hint === 'spacing');
  const colorProps = props.filter((p) => p.hint === 'color');
  const borderProps = props.filter((p) => BORDER_HINTS.includes(p.hint));
  const effectsProps = props.filter((p) => EFFECT_HINTS.includes(p.hint));
  const gapProp = spacingProps.find((p) => p.prop === 'gap');
  const sideSpacing = spacingProps.filter((p) => p.prop !== 'gap');

  strip.appendChild(buildTypographyCard(typoProps));
  strip.appendChild(buildColorCard(colorProps));
  strip.appendChild(buildSpacingCard(sideSpacing, gapProp));
  strip.appendChild(buildBorderCard(borderProps));
  strip.appendChild(buildEffectsCard(effectsProps));

  panel.appendChild(strip);

  return panel;
}

function buildGapEditPanel(gap: GapTarget): HTMLElement {
  const panel = createEl('div');
  panel.id = PANEL_ID;

  // Header
  const hdr = createEl('div', 'hdr');
  const title = createEl('div');
  const axisGlyph = gap.axis === 'vertical' ? '↕' : '↔';
  title.appendChild(createEl('div', 'hdr-tag', `${axisGlyph} gap`));
  const sourceLabel = gap.source.kind === 'parentGap' ? 'parent gap' : gap.source.prop;
  title.appendChild(createEl('div', 'hdr-sub', `${gap.source.value} · ${sourceLabel}`));
  const close = createEl('button', 'hdr-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close edit panel');
  close.addEventListener('click', removeEditPanel);
  hdr.appendChild(title);
  hdr.appendChild(close);
  panel.appendChild(hdr);
  attachDrag(panel, hdr);
  panel.appendChild(createEl('div', 'divider'));

  const strip = createEl('div', 'strip');
  strip.appendChild(buildCard('Typography', null, true));
  strip.appendChild(buildCard('Color', null, true));
  strip.appendChild(buildGapSpacingCard(gap));
  strip.appendChild(buildCard('Border', null, true));
  strip.appendChild(buildCard('Effects', null, true));

  panel.appendChild(strip);
  return panel;
}

function buildGapSpacingCard(gap: GapTarget): HTMLElement {
  const card = createEl('section', 'card');
  card.appendChild(createEl('div', 'card-label', 'Spacing'));

  const utility = findUtilityForProp(gap.source.el, gap.source.prop);
  const loc = readSourceLoc(gap.source.el);

  if (!utility || !loc) {
    const reason = !utility
      ? `No Tailwind utility found on element for ${gap.source.prop}`
      : 'No data-loc on element (Vite plugin not active?)';
    const empty = createEl('div', 'card-empty', reason);
    card.appendChild(empty);
    return card;
  }

  // Single property block: shows current utility, stepper cycles spacing scale.
  const block = createEl('div', 'prop-block');
  const row = createEl('div', 'prow');
  row.appendChild(createEl('span', 'prow-label', 'Class'));
  const valueEl = createEl('span', 'prow-value', utility.full);
  row.appendChild(valueEl);

  const stepper = createEl('div', 'stepper');
  const name = createEl('button', 'stepper-name');
  name.type = 'button';
  name.textContent = `spacing.${utility.scale}`;
  const arrows = createEl('div', 'stepper-arrows');
  const prev = createEl('button', 'stepper-arr stepper-arr-prev');
  prev.type = 'button';
  prev.innerHTML = CHEVRON_LEFT;
  prev.setAttribute('aria-label', 'Previous spacing');
  const next = createEl('button', 'stepper-arr stepper-arr-next');
  next.type = 'button';
  next.innerHTML = CHEVRON_RIGHT;
  next.setAttribute('aria-label', 'Next spacing');
  arrows.appendChild(prev);
  arrows.appendChild(next);
  stepper.appendChild(name);
  stepper.appendChild(arrows);
  row.appendChild(stepper);
  block.appendChild(row);
  card.appendChild(block);

  const scale = spacingTokensSorted();
  if (scale.length === 0) {
    prev.disabled = true;
    next.disabled = true;
    return card;
  }
  // Current index in the spacing scale (matches by path[1] = scale key).
  let index = scale.findIndex((t) => t.path[1] === utility.scale);
  // If current utility isn't on the scale, start at -1; first step lands on 0.

  function refresh() {
    prev.disabled = index <= 0;
    next.disabled = index >= scale.length - 1;
    if (index >= 0) {
      const t = scale[index]!;
      name.textContent = `spacing.${t.path[1]}`;
    }
  }
  refresh();

  let currentClass = utility.full;

  function applyIndex(nextIdx: number) {
    if (nextIdx < 0 || nextIdx >= scale.length) return;
    if (nextIdx === index) return;
    const target = scale[nextIdx]!;
    const newClass = `${utility!.prefix}${target.path[1]}`;
    // Optimistic swap on the live DOM so spacing updates immediately, before
    // the server-side file write + Vite HMR catches up.
    gap.source.el.classList.remove(currentClass);
    gap.source.el.classList.add(newClass);
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send(
        JSON.stringify({
          type: 'swap-utility',
          file: loc!.file,
          line: loc!.line,
          col: loc!.col,
          oldClass: currentClass,
          newClass,
        }),
      );
    }
    currentClass = newClass;
    valueEl.textContent = newClass;
    index = nextIdx;
    refresh();
    // Re-measure the gap rect so the overlay tracks the new spacing.
    requestAnimationFrame(() => {
      if (!selectedGap) return;
      const fresh = recomputeGapRect(selectedGap);
      if (fresh) {
        selectedGap = fresh;
        hoverGap = fresh;
        placeGapOverlay(fresh);
      }
    });
  }

  prev.addEventListener('click', () => applyIndex(index - 1));
  next.addEventListener('click', () => applyIndex(index + 1));

  // Expose for the keyboard handler. The card will be torn down when the
  // panel closes; we clear the ref in removeEditPanel.
  activeStepperRef = { step: (delta: number) => applyIndex(index + delta) };

  return card;
}

// ── Drag ──────────────────────────────────────────────────────────────────
function attachDrag(panel: HTMLElement, handle: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let panelTop = 0;
  let panelLeft = 0;
  let panelWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    // Don't initiate drag from interactive controls inside the header.
    const target = e.target as Element | null;
    if (target?.closest('button, input, select')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    panelTop = r.top;
    panelLeft = r.left;
    panelWidth = r.width;
    // Lock the panel size and convert from bottom-anchored to top/left.
    panel.style.top = `${panelTop}px`;
    panel.style.left = `${panelLeft}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${panelWidth}px`;
    // Panel no longer docks the bottom — release the reserved page space.
    releaseBottomSpace();
    startX = e.clientX;
    startY = e.clientY;
    panel.classList.add('is-dragging');

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const pr = panel.getBoundingClientRect();
      let top = panelTop + dy;
      let left = panelLeft + dx;
      if (top < 8) top = 8;
      const maxTop = window.innerHeight - pr.height - 8;
      if (maxTop > 8 && top > maxTop) top = maxTop;
      if (left < 8) left = 8;
      const maxLeft = window.innerWidth - pr.width - 8;
      if (maxLeft > 8 && left > maxLeft) left = maxLeft;
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    }
    function onUp() {
      panel.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  });
}

// ── Edit panel ─────────────────────────────────────────────────────────────
let savedPaddingBottom: string | null = null;
let panelResizeObserver: ResizeObserver | null = null;

function reserveBottomSpace(panel: HTMLElement): void {
  if (savedPaddingBottom === null) {
    savedPaddingBottom = document.body.style.paddingBottom;
  }
  const update = () => {
    if (!panel.isConnected) return;
    const r = panel.getBoundingClientRect();
    if (r.height === 0) return;
    document.body.style.paddingBottom = `${Math.ceil(r.height) + 24}px`;
  };
  update();
  if (typeof ResizeObserver !== 'undefined') {
    panelResizeObserver?.disconnect();
    panelResizeObserver = new ResizeObserver(update);
    panelResizeObserver.observe(panel);
  }
}

function releaseBottomSpace(): void {
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  if (savedPaddingBottom !== null) {
    if (savedPaddingBottom === '') {
      document.body.style.paddingBottom = '';
    } else {
      document.body.style.paddingBottom = savedPaddingBottom;
    }
    savedPaddingBottom = null;
  }
}

function showEditPanel(el: Element): void {
  closeDropdown();
  releaseBottomSpace();
  editPanel?.remove();
  editPanel = null;
  removePropertyPopover();

  ensureEditStyles();
  hoverEl = el;
  selectedEl = el;
  selectedGap = null;
  hoverGap = null;
  placeOverlay(el);

  // Element editing now lives entirely in the contextual popover; the
  // bottom panel is suppressed for elements (still used for gaps for now).
  showPropertyPopover(el);
}

// ── Property popover ─────────────────────────────────────────────────────
function removePropertyPopover(): void {
  propertyPopover?.remove();
  propertyPopover = null;
  // If the active stepper was driven by the popover, clear it.
  // (The gap card sets its own and is responsible for clearing it on close.)
  if (!selectedGap) activeStepperRef = null;
  // Restore the selection outline (it may have been hidden by focusRow).
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.style.opacity = '1';
}

function showPropertyPopover(el: Element): void {
  removePropertyPopover();
  const matches = findCategoryMatches(el);
  if (matches.length === 0) return;
  const loc = readSourceLoc(el);
  if (!loc) return; // Without source loc we can't swap.

  const pop = createEl('div');
  pop.id = POPOVER_ID;

  type RowState = {
    row: HTMLElement;
    valueEl: HTMLElement;
    tokenEl: HTMLElement;
    match: CategoryMatch;
    currentClass: string;
    index: number;
  };
  const states: RowState[] = [];
  let focusedIdx = -1;

  function focusRow(i: number) {
    focusedIdx = i;
    states.forEach((s, idx) => s.row.classList.toggle('is-focused', idx === i));
    activeStepperRef = i >= 0 ? { step: (delta) => stepRow(states[i]!, delta) } : null;
    // Hide the selection outline while a row is focused so the user can see
    // the live edit clearly. Restore when no row is focused.
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.style.opacity = i >= 0 ? '0' : '1';
  }

  function stepRow(s: RowState, delta: number) {
    let nextIdx: number;
    if (s.index < 0) {
      // Current utility is unmapped (e.g., `px-5` with no spacing.5 token).
      // First step lands on the lowest (↑) or highest (↓) token in scale.
      nextIdx = delta > 0 ? 0 : s.match.scale.length - 1;
    } else {
      nextIdx = s.index + delta;
      if (nextIdx < 0 || nextIdx >= s.match.scale.length) return;
    }
    const target = s.match.scale[nextIdx]!;
    const newScaleKey = String(target.path.at(-1));
    const newClass = `${s.match.utility.prefix}${newScaleKey}`;
    el.classList.remove(s.currentClass);
    el.classList.add(newClass);
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send(
        JSON.stringify({
          type: 'swap-utility',
          file: loc!.file,
          line: loc!.line,
          col: loc!.col,
          oldClass: s.currentClass,
          newClass,
        }),
      );
    }
    s.currentClass = newClass;
    s.index = nextIdx;
    s.valueEl.textContent = newClass;
    s.tokenEl.textContent = newScaleKey;
    // Re-anchor in case the element's bbox moved.
    requestAnimationFrame(() => positionPopover(pop, el));
  }

  for (const m of matches) {
    const row = createEl('div', 'pp-row');
    row.appendChild(createEl('span', 'pp-label', m.cat.label));
    const valueEl = createEl('span', 'pp-value', m.utility.full);
    row.appendChild(valueEl);
    const tokenEl = createEl('span', 'pp-token', m.utility.scale);
    row.appendChild(tokenEl);
    const state: RowState = {
      row,
      valueEl,
      tokenEl,
      match: m,
      currentClass: m.utility.full,
      index: m.scaleIndex >= 0 ? m.scaleIndex : 0,
    };
    states.push(state);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      focusRow(states.indexOf(state));
    });
    pop.appendChild(row);
  }

  document.body.appendChild(pop);
  propertyPopover = pop;
  positionPopover(pop, el);
}

function positionPopover(pop: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.left;
  if (top + pr.height > window.innerHeight - 8) {
    // Try anchoring above; if still doesn't fit, clamp inside viewport.
    top = r.top - pr.height - 6;
    if (top < 8) top = Math.max(8, window.innerHeight - pr.height - 8);
  }
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  if (left < 8) left = 8;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function showEditPanelForGap(gap: GapTarget): void {
  closeDropdown();
  releaseBottomSpace();
  editPanel?.remove();
  editPanel = null;
  removePropertyPopover();

  selectedGap = gap;
  selectedEl = null;
  hoverGap = gap;
  hoverEl = null;
  placeGapOverlay(gap);

  // No bottom panel for gaps anymore — selection overlay + keyboard arrows.
  setupGapStepper(gap);
}

function setupGapStepper(gap: GapTarget): void {
  const utility = findUtilityForProp(gap.source.el, gap.source.prop);
  const loc = readSourceLoc(gap.source.el);
  if (!utility || !loc) {
    activeStepperRef = null;
    removeGapLabel();
    detachGapResizeObserver();
    return;
  }
  const scale = spacingTokensSorted();
  if (scale.length === 0) {
    activeStepperRef = null;
    removeGapLabel();
    detachGapResizeObserver();
    return;
  }
  let index = scale.findIndex((t) => t.path[1] === utility.scale);
  let currentClass = utility.full;

  // Show the utility class (e.g. `pb-6`, `mt-4`, `gap-3`) rather than the
  // abstract token path — it tells the user immediately what's being
  // edited (padding vs margin vs gap).
  const labelText = () => currentClass;
  placeGapLabel(gap, labelText());

  // Re-measure whenever the source element or its parent changes size —
  // covers Tailwind v4 JIT + Vite HMR latency where the class is on the
  // element before the matching CSS arrives.
  const refresh = () => {
    if (!selectedGap) return;
    const fresh = recomputeGapRect(selectedGap);
    if (fresh) {
      // If detection picked a different source/parent, re-attach the
      // observer onto the new element.
      if (fresh.source.el !== selectedGap.source.el || fresh.parent !== selectedGap.parent) {
        attachGapResizeObserver(fresh, refresh);
      }
      selectedGap = fresh;
      hoverGap = fresh;
      placeGapOverlay(fresh);
      placeGapLabel(fresh, labelText());
    }
  };
  gapResizeRefresh = refresh;
  attachGapResizeObserver(gap, refresh);

  function step(delta: number) {
    let nextIdx: number;
    if (index < 0) {
      nextIdx = delta > 0 ? 0 : scale.length - 1;
    } else {
      nextIdx = index + delta;
      if (nextIdx < 0 || nextIdx >= scale.length) return;
    }
    const target = scale[nextIdx]!;
    const newClass = `${utility!.prefix}${target.path[1]}`;
    gap.source.el.classList.remove(currentClass);
    gap.source.el.classList.add(newClass);
    if (activeWs && activeWs.readyState === activeWs.OPEN) {
      activeWs.send(
        JSON.stringify({
          type: 'swap-utility',
          file: loc!.file,
          line: loc!.line,
          col: loc!.col,
          oldClass: currentClass,
          newClass,
        }),
      );
    }
    currentClass = newClass;
    index = nextIdx;
    // Update the label immediately; ResizeObserver + scheduled refreshes
    // catch the overlay up once Tailwind JIT + Vite HMR settle the CSS.
    placeGapLabel(selectedGap ?? gap, labelText());
    requestAnimationFrame(refresh);
    setTimeout(refresh, 100);
    setTimeout(refresh, 300);
  }

  activeStepperRef = { step };
}

function attachGapResizeObserver(gap: GapTarget, onResize: () => void): void {
  detachGapResizeObserver();
  if (typeof ResizeObserver === 'undefined') return;
  gapResizeObserver = new ResizeObserver(() => onResize());
  gapResizeObserver.observe(gap.source.el);
  if (gap.parent !== gap.source.el) gapResizeObserver.observe(gap.parent);
}

function detachGapResizeObserver(): void {
  gapResizeObserver?.disconnect();
  gapResizeObserver = null;
  gapResizeRefresh = null;
}

function removeEditPanel(): void {
  closeDropdown();
  releaseBottomSpace();
  editPanel?.remove();
  editPanel = null;
  removePropertyPopover();
  removeGapLabel();
  detachGapResizeObserver();
  selectedEl = null;
  selectedGap = null;
  hoverEl = null;
  hoverGap = null;
  activeStepperRef = null;
  removeOverlay();
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
    selectedEl = null;
    hoverGap = null;
    selectedGap = null;
    removeOverlay();
    removeGapLabel();
    removeEditPanel();
  }
}

function isAgentNode(el: Element | null): boolean {
  if (!el) return false;
  let cur: Element | null = el;
  while (cur) {
    const id = cur.id;
    if (
      id === OVERLAY_ID ||
      id === PANEL_ID ||
      id === DROPDOWN_ID ||
      id === POPOVER_ID ||
      id === GAP_LABEL_ID
    )
      return true;
    cur = cur.parentElement;
  }
  return false;
}

function onMouseMove(e: MouseEvent): void {
  if (!inspectMode) return;
  const target = e.target as Element | null;
  // Cursor on our own UI: keep the overlay anchored on the current selection.
  if (!target || isAgentNode(target)) {
    if (selectedGap) {
      if (!hoverGap || !sameGap(hoverGap, selectedGap)) {
        hoverGap = selectedGap;
        hoverEl = null;
        placeGapOverlay(selectedGap);
      }
    } else if (selectedEl && hoverEl !== selectedEl) {
      hoverEl = selectedEl;
      hoverGap = null;
      placeOverlay(selectedEl);
    }
    return;
  }
  // Gap detection takes precedence when the cursor is in empty space:
  //   1. between two siblings of `target` (inter-children gap)
  //   2. in `target`'s top or bottom padding (leading/trailing gap)
  const gap =
    findGapInChildren(target, e.clientX, e.clientY) ??
    findTrailingGapV(target, e.clientX, e.clientY) ??
    findLeadingGapV(target, e.clientX, e.clientY);
  if (gap) {
    if (hoverGap && sameGap(hoverGap, gap)) return;
    hoverGap = gap;
    hoverEl = null;
    placeGapOverlay(gap);
    return;
  }
  if (target === hoverEl && !hoverGap) return;
  hoverEl = target;
  hoverGap = null;
  placeOverlay(target);
}

function onClick(e: MouseEvent): void {
  if (!inspectMode) return;
  const target = e.target as Element | null;
  if (!target || isAgentNode(target)) return;
  e.preventDefault();
  e.stopPropagation();
  if (hoverGap) {
    showEditPanelForGap(hoverGap);
  } else {
    showEditPanel(target);
  }
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
    return;
  }
  // Arrow keys cycle the gap stepper while a gap is selected. Skip when a
  // form control is focused so typing in inputs still works.
  if (activeStepperRef && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const t = e.target as Element | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    activeStepperRef.step(e.key === 'ArrowUp' ? 1 : -1);
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

import type { TokenKind } from '@designmd-live/core';

let probe: HTMLDivElement | null = null;

function getProbe(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!probe) {
    probe = document.createElement('div');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  return probe;
}

export function isValidColor(value: string): boolean {
  const el = getProbe();
  if (!el) return true;
  el.style.color = '';
  el.style.color = value;
  return el.style.color !== '';
}

export function isValidDimension(value: string): boolean {
  const el = getProbe();
  if (!el) return true;
  el.style.width = '';
  el.style.width = value;
  return el.style.width !== '';
}

export function isValidDuration(value: string): boolean {
  const el = getProbe();
  if (!el) return true;
  el.style.transitionDuration = '';
  el.style.transitionDuration = value;
  return el.style.transitionDuration !== '';
}

export function isValidShadow(value: string): boolean {
  const el = getProbe();
  if (!el) return true;
  el.style.boxShadow = '';
  el.style.boxShadow = value;
  return el.style.boxShadow !== '';
}

export function validateValue(kind: TokenKind, value: string): string | null {
  if (!value.trim()) return 'Value cannot be empty';

  switch (kind) {
    case 'color':
      return isValidColor(value) ? null : 'Not a valid CSS color';
    case 'dimension':
    case 'fontSize':
    case 'lineHeight':
    case 'letterSpacing':
      return isValidDimension(value) ? null : 'Not a valid CSS dimension';
    case 'duration':
      return isValidDuration(value) ? null : 'Not a valid CSS duration (e.g. 200ms)';
    case 'shadow':
      return isValidShadow(value) ? null : 'Not a valid CSS box-shadow';
    case 'opacity': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 1
        ? null
        : 'Opacity must be a number between 0 and 1';
    }
    case 'fontWeight': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 100 && n <= 900 ? null : 'Font weight should be 100–900';
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? null : 'Must be a number';
    }
    default:
      return null;
  }
}

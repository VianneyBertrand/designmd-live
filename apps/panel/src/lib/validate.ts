/**
 * Best-effort value validators for DTCG token values.
 * Uses the browser's CSS parser (a stash <div>) to verify that a
 * string is accepted by the engine — quick and accurate.
 */

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
  if (!el) return true; // SSR / no DOM: don't block
  el.style.color = '';
  el.style.color = value;
  return el.style.color !== '';
}

export function isValidDimension(value: string): boolean {
  // Accept rem, em, px, %, and CSS function calls. Leverage the parser too.
  const el = getProbe();
  if (!el) return true;
  el.style.width = '';
  el.style.width = value;
  return el.style.width !== '';
}

export function validateValue(
  type: 'color' | 'dimension' | 'fontFamily' | 'unknown',
  value: string,
): string | null {
  if (!value.trim()) return 'Value cannot be empty';
  if (type === 'color' && !isValidColor(value)) return 'Not a valid CSS color';
  if (type === 'dimension' && !isValidDimension(value)) return 'Not a valid CSS dimension';
  return null;
}

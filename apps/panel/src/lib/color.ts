/**
 * Lightweight oklch <-> hex conversion via the browser's color parser.
 * Uses a hidden DOM element to let the browser do the heavy lifting.
 * Returns null on failure (non-browser, malformed input, etc.).
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

function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1]?.split(/[\s,]+/).map(Number);
  if (!parts || parts.length < 3) return null;
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function oklchToHex(value: string): string | null {
  const el = getProbe();
  if (!el) return null;
  el.style.color = '';
  el.style.color = value;
  if (!el.style.color) return null;
  const computed = getComputedStyle(el).color;
  return rgbStringToHex(computed);
}

export function hexToOklch(hex: string): string | null {
  const el = getProbe();
  if (!el) return null;
  el.style.color = '';
  el.style.color = hex;
  if (!el.style.color) return null;
  // Modern browsers can compute oklch from hex via a CSS color-mix dance.
  // Easiest: rely on getComputedStyle returning rgb, then format as oklch via approximation.
  // For MVP we just return the hex itself — round-tripping preserves visual fidelity.
  return hex;
}

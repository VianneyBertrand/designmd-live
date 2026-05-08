import type { DesignTokens, TokenLeaf } from './schema.ts';

/**
 * Anything we can render visually. `unknown` falls back to a plain
 * mono string preview.
 */
export type TokenKind =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'shadow'
  | 'opacity'
  | 'duration'
  | 'cubicBezier'
  | 'number'
  | 'unknown';

export type TokenValue = string | string[] | number | Record<string, unknown>;

export interface FlatToken {
  /** Full path inside the YAML tree, e.g. `['color', 'brand', '500']`. */
  path: string[];
  /** First segment of the path — natural grouping for the UI. */
  category: string;
  /** Resolved kind. Comes from `$type` first, then a path-based heuristic. */
  kind: TokenKind;
  value: TokenValue;
  description?: string;
}

const TYPE_ALIASES: Record<string, TokenKind> = {
  color: 'color',
  dimension: 'dimension',
  spacing: 'dimension',
  size: 'dimension',
  borderRadius: 'dimension',
  borderWidth: 'dimension',
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  shadow: 'shadow',
  boxShadow: 'shadow',
  opacity: 'opacity',
  duration: 'duration',
  cubicBezier: 'cubicBezier',
  number: 'number',
};

/** Last-resort inference from the top-level group when $type is missing. */
const PATH_KIND: Record<string, TokenKind> = {
  color: 'color',
  spacing: 'dimension',
  radius: 'dimension',
  borderRadius: 'dimension',
  border: 'dimension',
  size: 'dimension',
  shadow: 'shadow',
  shadows: 'shadow',
  elevation: 'shadow',
  opacity: 'opacity',
  duration: 'duration',
  motion: 'duration',
  zIndex: 'number',
};

function isLeaf(node: unknown): node is TokenLeaf {
  return typeof node === 'object' && node !== null && '$value' in node;
}

function inferKind(token: TokenLeaf, path: string[]): TokenKind {
  if (token.$type && token.$type in TYPE_ALIASES) {
    return TYPE_ALIASES[token.$type] ?? 'unknown';
  }
  // Special-case typography sub-groups (e.g. typography.size.lg)
  if (path[0] === 'typography') {
    if (path[1] === 'family') return 'fontFamily';
    if (path[1] === 'size' || path[1] === 'sizes') return 'fontSize';
    if (path[1] === 'weight' || path[1] === 'weights') return 'fontWeight';
    if (path[1] === 'lineHeight' || path[1] === 'leading') return 'lineHeight';
    if (path[1] === 'letterSpacing' || path[1] === 'tracking') return 'letterSpacing';
    return 'unknown';
  }
  const head = path[0];
  if (head && head in PATH_KIND) {
    return PATH_KIND[head] ?? 'unknown';
  }
  return 'unknown';
}

function asTokenValue(raw: unknown): TokenValue {
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return String(raw ?? '');
}

export function flattenTokens(tokens: DesignTokens): FlatToken[] {
  const out: FlatToken[] = [];
  walk(tokens, [], out);
  return out;
}

function walk(node: unknown, path: string[], out: FlatToken[]): void {
  if (isLeaf(node)) {
    out.push({
      path,
      category: path[0] ?? 'misc',
      kind: inferKind(node, path),
      value: asTokenValue(node.$value),
      description: node.$description,
    });
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, [...path, key], out);
    }
  }
}

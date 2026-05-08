import yaml from 'js-yaml';
import type { DesignMd, DesignTokens } from './schema.ts';

export function serializeDesignMd(doc: DesignMd): string {
  const yamlBody = yaml.dump(doc.tokens, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
  const prose = doc.prose.trim();
  return `---\n${yamlBody}---\n\n${prose}\n`;
}

export function setTokenAtPath(
  tokens: DesignTokens,
  path: string[],
  value: string | string[],
): DesignTokens {
  if (path.length === 0) return tokens;
  return setIn(tokens as Record<string, unknown>, path, value) as DesignTokens;
}

function setIn(
  obj: Record<string, unknown>,
  path: string[],
  value: string | string[],
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return obj;

  if (rest.length === 0) {
    const leaf = obj[head];
    if (isLeaf(leaf)) {
      return { ...obj, [head]: { ...leaf, $value: value } };
    }
    return { ...obj, [head]: { $value: value } };
  }

  const next = obj[head];
  const child = typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : {};
  return { ...obj, [head]: setIn(child, rest, value) };
}

function isLeaf(value: unknown): value is { $value: unknown } {
  return typeof value === 'object' && value !== null && '$value' in value;
}

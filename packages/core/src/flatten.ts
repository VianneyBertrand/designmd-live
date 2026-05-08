import type { DesignTokens } from './schema.ts';

export interface FlatToken {
  path: string[];
  category: 'color' | 'typography' | 'spacing' | 'radius';
  type: 'color' | 'dimension' | 'fontFamily' | 'unknown';
  value: string | string[];
  description?: string;
}

const CATEGORY_TYPE: Record<string, FlatToken['type']> = {
  color: 'color',
  typography: 'fontFamily',
  spacing: 'dimension',
  radius: 'dimension',
};

function isLeaf(node: unknown): node is { $value: string | string[]; $type?: string; $description?: string } {
  return typeof node === 'object' && node !== null && '$value' in node;
}

export function flattenTokens(tokens: DesignTokens): FlatToken[] {
  const result: FlatToken[] = [];
  const categories: Array<FlatToken['category']> = ['color', 'typography', 'spacing', 'radius'];

  for (const category of categories) {
    const group = tokens[category];
    if (!group) continue;
    walk(group, [category], category, result);
  }
  return result;
}

function walk(
  node: unknown,
  path: string[],
  category: FlatToken['category'],
  out: FlatToken[],
): void {
  if (isLeaf(node)) {
    const explicitType = (node as { $type?: string }).$type;
    const inferred = explicitType
      ? (explicitType as FlatToken['type'])
      : (CATEGORY_TYPE[category] ?? 'unknown');
    out.push({
      path,
      category,
      type: inferred,
      value: node.$value,
      description: node.$description,
    });
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      walk(child, [...path, key], category, out);
    }
  }
}

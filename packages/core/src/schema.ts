import { z } from 'zod';

/**
 * DTCG-shaped token leaf. $value must be present *and* be one of the
 * concrete allowed shapes — otherwise z.union below would happily
 * match an empty group as a leaf, strip its keys, and silently
 * collapse the whole document to {}.
 */
const TokenValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

const TokenLeafSchema = z.object({
  $value: TokenValueSchema,
  $type: z.string().optional(),
  $description: z.string().optional(),
});

export type TokenLeaf = z.infer<typeof TokenLeafSchema>;

export interface TokenGroup {
  [k: string]: TokenLeaf | TokenGroup;
}

const TokenGroupSchema: z.ZodType<TokenGroup> = z.lazy(() =>
  z.record(z.union([TokenLeafSchema, TokenGroupSchema])),
);

export const DesignTokensSchema = TokenGroupSchema;
export type DesignTokens = TokenGroup;

export const DesignMdSchema = z.object({
  tokens: DesignTokensSchema,
  prose: z.string(),
});

export type DesignMd = z.infer<typeof DesignMdSchema>;

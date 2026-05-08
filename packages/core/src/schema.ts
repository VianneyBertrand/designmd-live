import { z } from 'zod';

/**
 * DTCG-shaped token leaf. We accept the full breadth of $value types
 * (string for color/dimension, array for fontFamily/cubic-bezier,
 * number for opacity/zIndex, object for shadow/typography composites)
 * and let the renderer fall back to a textual sample when the type is
 * unknown.
 */
const TokenLeafSchema = z.object({
  $value: z.unknown(),
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

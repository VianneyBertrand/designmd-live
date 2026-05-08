import { z } from 'zod';

const ColorTokenSchema = z.object({
  $value: z.string(),
  $type: z.literal('color').optional(),
  $description: z.string().optional(),
});

const DimensionTokenSchema = z.object({
  $value: z.string(),
  $type: z.literal('dimension').optional(),
  $description: z.string().optional(),
});

const FontFamilyTokenSchema = z.object({
  $value: z.union([z.string(), z.array(z.string())]),
  $type: z.literal('fontFamily').optional(),
  $description: z.string().optional(),
});

const TokenGroupSchema: z.ZodType<TokenGroup> = z.lazy(() =>
  z.record(z.union([ColorTokenSchema, DimensionTokenSchema, FontFamilyTokenSchema, TokenGroupSchema])),
);

type Token =
  | z.infer<typeof ColorTokenSchema>
  | z.infer<typeof DimensionTokenSchema>
  | z.infer<typeof FontFamilyTokenSchema>;

type TokenGroup = { [k: string]: Token | TokenGroup };

export const DesignTokensSchema = z.object({
  color: TokenGroupSchema.optional(),
  typography: TokenGroupSchema.optional(),
  spacing: TokenGroupSchema.optional(),
  radius: TokenGroupSchema.optional(),
});

export type DesignTokens = z.infer<typeof DesignTokensSchema>;

export const DesignMdSchema = z.object({
  tokens: DesignTokensSchema,
  prose: z.string(),
});

export type DesignMd = z.infer<typeof DesignMdSchema>;

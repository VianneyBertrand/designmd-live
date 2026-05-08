import yaml from 'js-yaml';
import { DesignMdSchema, type DesignMd } from './schema.ts';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseDesignMd(raw: string): DesignMd {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    throw new Error('DESIGN.md must start with YAML front matter delimited by ---');
  }
  const [, frontMatter, prose] = match;
  const tokens = yaml.load(frontMatter ?? '') ?? {};
  return DesignMdSchema.parse({ tokens, prose: prose ?? '' });
}

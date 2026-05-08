import { flattenTokens, parseDesignMd, type DesignMd, type FlatToken } from '@designmd-live/core';
import { create } from 'zustand';

interface DesignState {
  raw: string | null;
  parsed: DesignMd | null;
  tokens: FlatToken[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: () => Promise<void>;
}

export const useDesign = create<DesignState>((set) => ({
  raw: null,
  parsed: null,
  tokens: [],
  status: 'idle',
  error: null,

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const res = await fetch('/api/design-md');
      if (!res.ok) throw new Error(`Failed to load DESIGN.md (${res.status})`);
      const { raw } = (await res.json()) as { raw: string };
      const parsed = parseDesignMd(raw);
      const tokens = flattenTokens(parsed.tokens);
      set({ raw, parsed, tokens, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: (err as Error).message });
    }
  },
}));

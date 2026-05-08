import {
  flattenTokens,
  parseDesignMd,
  serializeDesignMd,
  setTokenAtPath,
  type DesignMd,
  type FlatToken,
} from '@designmd-live/core';
import { create } from 'zustand';
import { broadcast } from './lib/ws.ts';

interface DesignState {
  parsed: DesignMd | null;
  tokens: FlatToken[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  dirty: boolean;
  error: string | null;
  load: () => Promise<void>;
  setTokenValue: (path: string[], value: string | string[]) => void;
  save: () => Promise<void>;
}

export const useDesign = create<DesignState>((set, get) => ({
  parsed: null,
  tokens: [],
  status: 'idle',
  saveStatus: 'idle',
  dirty: false,
  error: null,

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const res = await fetch('/api/design-md');
      if (!res.ok) throw new Error(`Failed to load DESIGN.md (${res.status})`);
      const { raw } = (await res.json()) as { raw: string };
      const parsed = parseDesignMd(raw);
      const tokens = flattenTokens(parsed.tokens);
      set({ parsed, tokens, status: 'ready', dirty: false, saveStatus: 'idle' });
      broadcast({
        type: 'snapshot',
        tokens: tokens.map((t) => ({ path: t.path, value: t.value })),
      });
    } catch (err) {
      set({ status: 'error', error: (err as Error).message });
    }
  },

  setTokenValue: (path, value) => {
    const { parsed } = get();
    if (!parsed) return;
    const nextTokens = setTokenAtPath(parsed.tokens, path, value);
    const nextParsed: DesignMd = { ...parsed, tokens: nextTokens };
    set({
      parsed: nextParsed,
      tokens: flattenTokens(nextTokens),
      dirty: true,
      saveStatus: 'idle',
    });
    broadcast({ type: 'token-update', path, value });
  },

  save: async () => {
    const { parsed } = get();
    if (!parsed) return;
    set({ saveStatus: 'saving' });
    try {
      const raw = serializeDesignMd(parsed);
      const res = await fetch('/api/design-md', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      set({ saveStatus: 'saved', dirty: false });
      setTimeout(() => {
        if (get().saveStatus === 'saved') set({ saveStatus: 'idle' });
      }, 1500);
    } catch (err) {
      set({ saveStatus: 'error', error: (err as Error).message });
    }
  },
}));

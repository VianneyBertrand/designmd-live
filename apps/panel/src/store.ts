import {
  type DesignMd,
  type FlatToken,
  flattenTokens,
  parseDesignMd,
  serializeDesignMd,
  setTokenAtPath,
  type TokenValue,
} from '@designmd-live/core';
import { create } from 'zustand';
import { broadcast, type Incoming, onWsMessage } from './lib/ws.ts';

interface DesignState {
  parsed: DesignMd | null;
  tokens: FlatToken[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  dirty: boolean;
  externalChange: boolean;
  error: string | null;
  inspectMode: boolean;
  highlightedPaths: string[]; // joined paths to highlight after a click
  load: () => Promise<void>;
  setTokenValue: (path: string[], value: TokenValue) => void;
  save: () => Promise<void>;
  dismissExternalChange: () => void;
  toggleInspectMode: () => void;
  clearHighlights: () => void;
}

export const useDesign = create<DesignState>((set, get) => ({
  parsed: null,
  tokens: [],
  status: 'idle',
  saveStatus: 'idle',
  dirty: false,
  externalChange: false,
  error: null,
  inspectMode: false,
  highlightedPaths: [],

  dismissExternalChange: () => set({ externalChange: false }),

  toggleInspectMode: () => {
    const next = !get().inspectMode;
    set({ inspectMode: next, highlightedPaths: [] });
    broadcast({ type: 'inspect-mode', enabled: next });
  },

  clearHighlights: () => set({ highlightedPaths: [] }),

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

// React to external file edits surfaced by the CLI watcher.
onWsMessage((msg: Incoming) => {
  if (msg.type === 'snapshot' && msg.source === 'watcher') {
    const state = useDesign.getState();
    if (state.dirty) {
      useDesign.setState({ externalChange: true });
      return;
    }
    void state.load();
    return;
  }
  if (msg.type === 'inspect-mode') {
    useDesign.setState({ inspectMode: msg.enabled });
    return;
  }
  if (msg.type === 'inspect-select') {
    const paths = msg.items.map((i) => i.path.join('.'));
    useDesign.setState({ highlightedPaths: paths });
    requestAnimationFrame(() => {
      const first = paths[0];
      if (!first) return;
      const el = document.querySelector(`[data-token="${cssEscape(first)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return;
  }
  if (msg.type === 'token-update') {
    // Edits made from the in-iframe popup. Update local parsed state so the
    // panel reflects the change and Save persists it.
    const state = useDesign.getState();
    if (!state.parsed) return;
    const nextTokens = setTokenAtPath(state.parsed.tokens, msg.path, msg.value);
    const nextParsed: DesignMd = { ...state.parsed, tokens: nextTokens };
    useDesign.setState({
      parsed: nextParsed,
      tokens: flattenTokens(nextTokens),
      dirty: true,
      saveStatus: 'idle',
    });
  }
});

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(["\\\\])/g, '\\\\$1');
}

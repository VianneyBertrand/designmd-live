import type { FlatToken, TokenValue } from '@designmd-live/core';

export type Outgoing =
  | { type: 'hello'; role: 'panel' }
  | { type: 'token-update'; path: string[]; value: TokenValue }
  | { type: 'snapshot'; tokens: Pick<FlatToken, 'path' | 'value'>[] }
  | { type: 'reset' }
  | { type: 'inspect-mode'; enabled: boolean };

export interface InspectSelectItem {
  property: string;
  path: string[];
}

export type Incoming =
  | { type: 'snapshot'; tokens: Pick<FlatToken, 'path' | 'value'>[]; source?: string }
  | { type: 'token-update'; path: string[]; value: TokenValue }
  | { type: 'reset' }
  | { type: 'inspect-mode'; enabled: boolean }
  | { type: 'inspect-select'; items: InspectSelectItem[] };

export type WsStatus = 'connecting' | 'open' | 'closed';

type StatusListener = (s: WsStatus) => void;
type MessageListener = (m: Incoming) => void;

let socket: WebSocket | null = null;
let queue: Outgoing[] = [];
let retry = 0;
let status: WsStatus = 'closed';
const statusListeners = new Set<StatusListener>();
const messageListeners = new Set<MessageListener>();

function setStatus(next: WsStatus) {
  if (next === status) return;
  status = next;
  for (const fn of statusListeners) fn(next);
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In Vite dev, panel is on :5173 but the broker is on the CLI (:3030).
  // In CLI-served prod, panel and CLI share window.location.host.
  const host = window.location.port === '5173' ? 'localhost:3030' : window.location.host;
  return `${proto}//${host}/ws`;
}

function flush() {
  if (!socket || socket.readyState !== socket.OPEN) return;
  for (const msg of queue) socket.send(JSON.stringify(msg));
  queue = [];
}

function connect() {
  setStatus('connecting');
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    schedule();
    return;
  }
  socket.addEventListener('open', () => {
    retry = 0;
    setStatus('open');
    queue.unshift({ type: 'hello', role: 'panel' });
    flush();
  });
  socket.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data) as Incoming;
      for (const fn of messageListeners) fn(msg);
    } catch {
      /* ignore malformed */
    }
  });
  socket.addEventListener('close', () => {
    setStatus('closed');
    schedule();
  });
  socket.addEventListener('error', () => {
    try {
      socket?.close();
    } catch {
      /* noop */
    }
  });
}

function schedule() {
  retry = Math.min(retry + 1, 10);
  setTimeout(connect, 250 * retry);
}

export function startWs() {
  if (socket) return;
  connect();
}

export function broadcast(msg: Outgoing) {
  queue.push(msg);
  flush();
}

export function getWsStatus(): WsStatus {
  return status;
}

export function onWsStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function onWsMessage(fn: MessageListener): () => void {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

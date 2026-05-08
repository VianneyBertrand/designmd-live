import type { FlatToken } from '@designmd-live/core';

type Outgoing =
  | { type: 'hello'; role: 'panel' }
  | { type: 'token-update'; path: string[]; value: string | string[] }
  | { type: 'snapshot'; tokens: Pick<FlatToken, 'path' | 'value'>[] }
  | { type: 'reset' };

let socket: WebSocket | null = null;
let queue: Outgoing[] = [];
let retry = 0;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In Vite dev, panel is on :5173 but the broker is on the CLI (:3030).
  // In CLI-served prod, panel is on the CLI port → window.location.host works.
  const host =
    window.location.port === '5173' ? 'localhost:3030' : window.location.host;
  return `${proto}//${host}/ws`;
}

function flush() {
  if (!socket || socket.readyState !== socket.OPEN) return;
  for (const msg of queue) socket.send(JSON.stringify(msg));
  queue = [];
}

function connect() {
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    schedule();
    return;
  }
  socket.addEventListener('open', () => {
    retry = 0;
    queue.unshift({ type: 'hello', role: 'panel' });
    flush();
  });
  socket.addEventListener('close', schedule);
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

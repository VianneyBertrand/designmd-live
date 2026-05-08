import { useEffect, useState } from 'react';
import { onWsStatus, type WsStatus } from '../lib/ws.ts';

const COPY: Record<WsStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  closed: 'Disconnected',
};

const COLOR: Record<WsStatus, string> = {
  open: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  closed: 'bg-rose-500',
};

export function ConnectionDot() {
  const [status, setStatus] = useState<WsStatus>('connecting');

  useEffect(() => onWsStatus(setStatus), []);

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={`WebSocket: ${COPY[status]}`}
    >
      <span className={`inline-block size-2 rounded-full ${COLOR[status]}`} aria-hidden="true" />
      <span className="hidden sm:inline">{COPY[status]}</span>
    </span>
  );
}

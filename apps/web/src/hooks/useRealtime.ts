import { useEffect, useRef, useState } from 'react';
import type { RealtimeEvent } from '@videostudio/shared';

export function useRealtimeEvents(onEvent: (event: RealtimeEvent) => void): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        heartbeatTimer = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25_000);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as { type?: string };
          if (parsed.type === 'connected' || parsed.type === 'pong') return;
          handlerRef.current(parsed as RealtimeEvent);
        } catch {
          // Ignore malformed event
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (heartbeatTimer) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      ws?.close();
    };
  }, []);

  return { connected };
}

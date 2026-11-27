import type { WebSocket } from 'ws';
import type { RealtimeEvent } from '@videostudio/shared';

interface ClientEntry {
  socket: WebSocket;
  projectId?: string;
}

export class RealtimeHub {
  private readonly clients = new Set<ClientEntry>();

  register(socket: WebSocket, projectId?: string): void {
    const entry: ClientEntry = { socket, projectId };
    this.clients.add(entry);

    socket.on('close', () => {
      this.clients.delete(entry);
    });

    socket.on('error', () => {
      this.clients.delete(entry);
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; projectId?: string };
        if (msg.type === 'subscribe') {
          entry.projectId = msg.projectId || undefined;
        } else if (msg.type === 'ping') {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        }
      } catch {
        // Ignore non-JSON client messages
      }
    });
  }

  broadcast(event: RealtimeEvent): void {
    const serialized = JSON.stringify(event);
    for (const entry of this.clients) {
      if (entry.socket.readyState !== entry.socket.OPEN) {
        this.clients.delete(entry);
        continue;
      }

      // If a client scoped its subscription to a single project, still forward global events
      if (entry.projectId) {
        const eventProjectId = this.extractProjectId(event);
        if (eventProjectId && eventProjectId !== entry.projectId) {
          continue;
        }
      }

      try {
        entry.socket.send(serialized);
      } catch {
        this.clients.delete(entry);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private extractProjectId(event: RealtimeEvent): string | null {
    switch (event.type) {
      case 'asset.created':
      case 'asset.updated':
      case 'asset.deleted':
      case 'job.updated':
      case 'annotation.changed':
      case 'stage3.changed':
        return event.payload.projectId;
      case 'activity.logged':
      case 'rules.changed':
        return event.payload.projectId;
      case 'project.created':
      case 'project.updated':
      case 'project.deleted':
      case 'library.changed':
        return null;
    }
  }
}

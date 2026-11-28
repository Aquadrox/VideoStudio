import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { MediaService } from '../services/media.service.js';
import type { RealtimeHub } from '../services/realtime.service.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    pool: pg.Pool;
    media: MediaService;
    realtime: RealtimeHub;
    getInFlightRequests?: () => number;
  },
): void {
  app.get('/api/health', async (_request, reply) => {
    let dbOk = false;
    try {
      await deps.pool.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const ffmpegOk = await deps.media.checkFfmpegAvailable();
    const status = dbOk ? 'ok' : 'degraded';
    // Exclude this health check itself from inFlightRequests so draining sees 0 when idle
    const inFlightRequests = Math.max(0, (deps.getInFlightRequests?.() ?? 0));

    return reply.code(dbOk ? 200 : 503).send({
      status,
      version: '0.8.1',
      slot: process.env.DEPLOY_SLOT || 'standalone',
      inFlightRequests,
      services: {
        database: dbOk ? 'up' : 'down',
        ffmpeg: ffmpegOk ? 'available' : 'unavailable',
        websocketClients: deps.realtime.clientCount,
        mcpEndpoint: '/mcp',
        mcpMode: 'stateless',
      },
      timestamp: new Date().toISOString(),
    });
  });
}

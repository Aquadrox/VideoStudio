import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { registerActivityAndRefRoutes } from './routes/activity.routes.js';
import { registerAssetRoutes } from './routes/assets.routes.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerMcpRoutes } from './routes/mcp.routes.js';
import { registerMediaRoutes } from './routes/media.routes.js';
import { registerProjectRoutes } from './routes/projects.routes.js';
import { MediaService } from './services/media.service.js';
import { RealtimeHub } from './services/realtime.service.js';
import { StudioService } from './services/studio.service.js';

export interface BuildAppDeps {
  config: AppConfig;
  db: Database;
  pool: pg.Pool;
}

export async function buildApp(deps: BuildAppDeps): Promise<{
  app: FastifyInstance;
  studio: StudioService;
  realtime: RealtimeHub;
}> {
  const app = Fastify({
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
    },
    bodyLimit: Math.min(deps.config.maxUploadBytes, 100 * 1024 * 1024), // JSON limit up to 100MB for base64 MCP ingest
  });

  await app.register(cors, {
    origin: deps.config.corsOrigin === '*' ? true : deps.config.corsOrigin.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: deps.config.maxUploadBytes,
      files: 1,
    },
  });

  await app.register(websocket);

  const media = new MediaService(deps.config);
  await media.ensureStorageRoot();

  const realtime = new RealtimeHub();
  const studio = new StudioService(deps.db, media, realtime);

  // Realtime WebSocket endpoint
  app.get<{ Querystring: { projectId?: string } }>(
    '/ws',
    { websocket: true },
    (socket, request) => {
      realtime.register(socket, request.query.projectId);
      socket.send(
        JSON.stringify({
          type: 'connected',
          ts: Date.now(),
        }),
      );
    },
  );

  // REST + Media + MCP Routes
  registerHealthRoutes(app, { pool: deps.pool, media, realtime });
  registerProjectRoutes(app, studio);
  registerAssetRoutes(app, studio, media);
  registerMediaRoutes(app, studio, media);
  registerActivityAndRefRoutes(app, studio);
  registerMcpRoutes(app, { config: deps.config, studio, media });

  return { app, studio, realtime };
}

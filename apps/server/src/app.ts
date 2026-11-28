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
import { registerSketchRoutes } from './routes/sketch.routes.js';
import { registerStage2Routes } from './routes/stage2.routes.js';
import { registerStage3Routes } from './routes/stage3.routes.js';
import { registerStage4Routes } from './routes/stage4.routes.js';
import { registerStage5Routes } from './routes/stage5.routes.js';
import { MediaService } from './services/media.service.js';
import { OpsService } from './services/ops.service.js';
import { ProjectGitService } from './services/project-git.service.js';
import { RealtimeHub } from './services/realtime.service.js';
import { SketchService } from './services/sketch.service.js';
import { SkillsSyncService } from './services/skills-sync.service.js';
import { Stage2Service } from './services/stage2.service.js';
import { Stage3Service } from './services/stage3.service.js';
import { Stage4Service } from './services/stage4.service.js';
import { StudioService } from './services/studio.service.js';
import { WatchFolderService } from './services/watch-folder.service.js';
import { WebhookService } from './services/webhook.service.js';
import { YouTubeUploadService } from './services/youtube-upload.service.js';

export interface BuildAppDeps {
  config: AppConfig;
  db: Database;
  pool: pg.Pool;
}

export async function buildApp(deps: BuildAppDeps): Promise<{
  app: FastifyInstance;
  studio: StudioService;
  sketches: SketchService;
  stage2: Stage2Service;
  stage3: Stage3Service;
  stage4: Stage4Service;
  ops: OpsService;
  watchFolders: WatchFolderService;
  webhooks: WebhookService;
  youtubeUpload: YouTubeUploadService;
  realtime: RealtimeHub;
}> {
  const app = Fastify({
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
    },
    bodyLimit: Math.min(deps.config.maxUploadBytes, 100 * 1024 * 1024), // JSON limit up to 100MB for base64 MCP ingest
  });

  // Track active non-health HTTP & hijacked MCP requests so Blue/Green updates drain safely
  let inFlightRequests = 0;
  app.addHook('onRequest', async (request, reply) => {
    const urlPath = request.url.split('?')[0] ?? '';
    if (urlPath === '/api/health' || urlPath === '/ws') {
      return;
    }
    inFlightRequests += 1;
    let decremented = false;
    const done = () => {
      if (!decremented) {
        decremented = true;
        inFlightRequests = Math.max(0, inFlightRequests - 1);
      }
    };
    reply.raw.once('finish', done);
    reply.raw.once('close', done);
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
  const webhooks = new WebhookService(deps.db, deps.config);
  const studio = new StudioService(deps.db, media, realtime, deps.config.comfyuiBaseUrl);
  studio.setWebhookService(webhooks);
  const sketches = new SketchService(deps.db, studio, realtime);
  const skillsSync = new SkillsSyncService(deps.config);
  const stage2 = new Stage2Service(deps.db, studio, realtime, skillsSync);
  stage2.setWebhookService(webhooks);
  const projectGit = new ProjectGitService(deps.config);
  const stage3 = new Stage3Service(deps.config, deps.db, studio, stage2, media, projectGit, realtime);
  const stage4 = new Stage4Service(deps.config, deps.db, studio, stage3, media, realtime);
  stage4.setWebhookService(webhooks);
  const watchFolders = new WatchFolderService(deps.db, studio, media, realtime);
  const ops = new OpsService(deps.config, deps.db, deps.pool, studio, media, realtime, webhooks);
  const youtubeUpload = new YouTubeUploadService(deps.config, studio, stage3, media);

  if (deps.config.nodeEnv !== 'test') {
    watchFolders.startPolling();
  }
  app.addHook('onClose', async () => {
    watchFolders.stopPolling();
  });

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

  // REST + Media + Stage 2 + Stage 3 + Stage 4 + Stage 5 + Sketches + MCP Routes
  const getInFlightRequests = () => inFlightRequests;
  registerHealthRoutes(app, {
    pool: deps.pool,
    media,
    realtime,
    getInFlightRequests,
  });
  registerProjectRoutes(app, studio);
  registerAssetRoutes(app, studio, media);
  registerMediaRoutes(app, studio, media);
  registerActivityAndRefRoutes(app, studio);
  registerSketchRoutes(app, sketches);
  registerStage2Routes(app, stage2);
  registerStage3Routes(app, stage3);
  registerStage4Routes(app, stage4);
  registerStage5Routes(app, {
    ops,
    watchFolders,
    webhooks,
    youtubeUpload,
    getInFlightRequests,
  });
  registerMcpRoutes(app, {
    config: deps.config,
    studio,
    media,
    stage2,
    stage3,
    stage4,
    stage5: {
      ops,
      watchFolders,
      webhooks,
      youtubeUpload,
      getInFlightRequests,
    },
    sketches,
  });

  return {
    app,
    studio,
    sketches,
    stage2,
    stage3,
    stage4,
    ops,
    watchFolders,
    webhooks,
    youtubeUpload,
    realtime,
  };
}

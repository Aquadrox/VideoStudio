import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import {
  CleanupFilterInputSchema,
  CreateBackupInputSchema,
  CreateWatchFolderInputSchema,
  CreateWebhookInputSchema,
  UpdateWatchFolderInputSchema,
  UpdateWebhookInputSchema,
  UploadYouTubeDraftInputSchema,
} from '@videostudio/shared';
import type { OpsService } from '../services/ops.service.js';
import type { WatchFolderService } from '../services/watch-folder.service.js';
import type { WebhookService } from '../services/webhook.service.js';
import type { YouTubeUploadService } from '../services/youtube-upload.service.js';

export interface Stage5RouteDeps {
  ops: OpsService;
  watchFolders: WatchFolderService;
  webhooks: WebhookService;
  youtubeUpload: YouTubeUploadService;
  getInFlightRequests?: () => number;
}

export function registerStage5Routes(app: FastifyInstance, deps: Stage5RouteDeps): void {
  // --- System Monitoring ---

  app.get('/api/ops/metrics', async () => {
    const metrics = await deps.ops.getSystemMetrics(deps.getInFlightRequests?.() ?? 0);
    return { metrics };
  });

  // --- Disk Usage & Selective Cleanup ---

  app.get('/api/ops/disk', async () => {
    const disk = await deps.ops.getDiskUsageSummary();
    return { disk };
  });

  app.post('/api/ops/cleanup/preview', async (request, reply) => {
    const parsed = CleanupFilterInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid cleanup filter', issues: parsed.error.issues });
    }
    const result = await deps.ops.previewCleanup(parsed.data);
    return { result };
  });

  app.post('/api/ops/cleanup/run', async (request, reply) => {
    const parsed = CleanupFilterInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid cleanup filter', issues: parsed.error.issues });
    }
    const result = await deps.ops.runCleanup(parsed.data);
    return { result };
  });

  // --- Automated Backups ---

  app.get('/api/ops/backups', async () => {
    const backups = await deps.ops.listBackups();
    return { backups };
  });

  app.post('/api/ops/backups', async (request, reply) => {
    const parsed = CreateBackupInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid backup request', issues: parsed.error.issues });
    }
    try {
      const backup = await deps.ops.createBackup(parsed.data.notes);
      return reply.code(201).send({ backup });
    } catch (err) {
      return reply.code(500).send({
        error: err instanceof Error ? err.message : 'Failed to create backup',
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/ops/backups/:id/download', async (request, reply) => {
    const file = await deps.ops.getBackupFile(request.params.id);
    if (!file) {
      return reply.code(404).send({ error: 'Backup file not found' });
    }

    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Length', String(file.sizeBytes));
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return reply.send(fs.createReadStream(file.absPath));
  });

  app.delete<{ Params: { id: string } }>('/api/ops/backups/:id', async (request, reply) => {
    const deleted = await deps.ops.deleteBackup(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Backup not found' });
    }
    return reply.code(204).send();
  });

  // --- Watch Folders (ComfyUI -> VideoStudio auto-ingest) ---

  app.get<{ Querystring: { projectId?: string } }>('/api/ops/watch-folders', async (request) => {
    const watchFolders = await deps.watchFolders.listWatchFolders(request.query.projectId);
    return { watchFolders };
  });

  app.post('/api/ops/watch-folders', async (request, reply) => {
    const parsed = CreateWatchFolderInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid watch folder payload', issues: parsed.error.issues });
    }
    try {
      const watchFolder = await deps.watchFolders.createWatchFolder(parsed.data);
      return reply.code(201).send({ watchFolder });
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to create watch folder',
      });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/ops/watch-folders/:id', async (request, reply) => {
    const parsed = UpdateWatchFolderInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid watch folder update', issues: parsed.error.issues });
    }
    const watchFolder = await deps.watchFolders.updateWatchFolder(request.params.id, parsed.data);
    if (!watchFolder) {
      return reply.code(404).send({ error: 'Watch folder not found' });
    }
    return { watchFolder };
  });

  app.delete<{ Params: { id: string } }>('/api/ops/watch-folders/:id', async (request, reply) => {
    const deleted = await deps.watchFolders.deleteWatchFolder(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Watch folder not found' });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/ops/watch-folders/:id/scan', async (request, reply) => {
    try {
      const result = await deps.watchFolders.scanWatchFolder(request.params.id, {
        requireSettled: false,
      });
      if (!result) {
        return reply.code(404).send({ error: 'Watch folder not found' });
      }
      return { result };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Watch folder scan failed',
      });
    }
  });

  // --- Outgoing Webhooks ---

  app.get<{ Querystring: { projectId?: string } }>('/api/ops/webhooks', async (request) => {
    const webhooks = await deps.webhooks.listWebhooks(request.query.projectId);
    return { webhooks };
  });

  app.post('/api/ops/webhooks', async (request, reply) => {
    const parsed = CreateWebhookInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid webhook payload', issues: parsed.error.issues });
    }
    try {
      const webhook = await deps.webhooks.createWebhook(parsed.data);
      return reply.code(201).send({ webhook });
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to create webhook',
      });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/ops/webhooks/:id', async (request, reply) => {
    const parsed = UpdateWebhookInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid webhook update', issues: parsed.error.issues });
    }
    try {
      const webhook = await deps.webhooks.updateWebhook(request.params.id, parsed.data);
      if (!webhook) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }
      return { webhook };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to update webhook',
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/ops/webhooks/:id', async (request, reply) => {
    const deleted = await deps.webhooks.deleteWebhook(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Webhook not found' });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/ops/webhooks/:id/test', async (request, reply) => {
    const result = await deps.webhooks.testWebhook(request.params.id);
    if (!result) {
      return reply.code(404).send({ error: 'Webhook not found' });
    }
    return result;
  });

  // --- Optional YouTube Data API v3 Draft Upload ---

  app.get('/api/youtube/upload/status', async () => {
    return deps.youtubeUpload.getStatus();
  });

  app.post<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug/youtube/upload-draft',
    async (request, reply) => {
      const parsed = UploadYouTubeDraftInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid YouTube draft upload payload', issues: parsed.error.issues });
      }
      try {
        const upload = await deps.youtubeUpload.uploadDraftVideo(
          request.params.idOrSlug,
          parsed.data,
        );
        return reply.code(201).send({ upload });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'YouTube draft upload failed';
        const statusCode = message.includes('not configured')
          ? 503
          : message.includes('not found') || message.includes('No video asset')
            ? 404
            : 502;
        return reply.code(statusCode).send({ error: message });
      }
    },
  );
}

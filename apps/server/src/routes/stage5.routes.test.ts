import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { OpsService } from '../services/ops.service.js';
import type { WatchFolderService } from '../services/watch-folder.service.js';
import type { WebhookService } from '../services/webhook.service.js';
import type { YouTubeUploadService } from '../services/youtube-upload.service.js';
import { registerStage5Routes } from './stage5.routes.js';

describe('Stage 5 REST routes (/api/ops/* & /api/youtube/upload/*)', () => {
  it('serves system metrics, disk summary, and cleanup dry-run preview', async () => {
    const app = Fastify({ logger: false });

    const ops = {
      getSystemMetrics: vi.fn().mockResolvedValue({
        version: '0.11.0',
        slot: 'blue',
        uptimeSec: 120,
        inFlightRequests: 1,
        websocketClients: 2,
        database: 'up',
        ffmpeg: 'available',
        cpuLoad1m: 0.42,
        cpuCores: 8,
        memoryUsedBytes: 2_000_000_000,
        memoryTotalBytes: 16_000_000_000,
        processRssBytes: 120_000_000,
        diskFreeBytes: 50_000_000_000,
        diskTotalBytes: 200_000_000_000,
        activeWatchFolders: 1,
        activeWebhooks: 2,
        backupsCount: 3,
        youtubeApiConfigured: false,
        timestamp: new Date().toISOString(),
      }),
      getDiskUsageSummary: vi.fn().mockResolvedValue({
        dataDir: '/data',
        totalManagedBytes: 1024,
        originalsBytes: 512,
        proxiesBytes: 256,
        thumbnailsBytes: 128,
        tempBytes: 128,
        backupsBytes: 2048,
        filesystemTotalBytes: 200_000_000_000,
        filesystemFreeBytes: 50_000_000_000,
        projects: [],
      }),
      previewCleanup: vi.fn().mockResolvedValue({
        dryRun: true,
        candidatesCount: 1,
        deletedAssetsCount: 0,
        freedAssetBytes: 4096,
        freedTempBytes: 512,
        totalFreedBytes: 4608,
        candidates: [],
      }),
      runCleanup: vi.fn(),
      listBackups: vi.fn().mockResolvedValue([]),
      createBackup: vi.fn(),
      getBackupFile: vi.fn(),
      deleteBackup: vi.fn(),
    } as unknown as OpsService;

    const watchFolders = {
      listWatchFolders: vi.fn().mockResolvedValue([]),
      createWatchFolder: vi.fn(),
      updateWatchFolder: vi.fn(),
      deleteWatchFolder: vi.fn(),
      scanWatchFolder: vi.fn(),
    } as unknown as WatchFolderService;

    const webhooks = {
      listWebhooks: vi.fn().mockResolvedValue([]),
      createWebhook: vi.fn(),
      updateWebhook: vi.fn(),
      deleteWebhook: vi.fn(),
      testWebhook: vi.fn(),
    } as unknown as WebhookService;

    const youtubeUpload = {
      getStatus: vi.fn().mockReturnValue({
        configured: false,
        missingEnvVars: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
      }),
      uploadDraftVideo: vi.fn().mockRejectedValue(
        new Error('YouTube Data API v3 is not configured. Missing env vars: YOUTUBE_CLIENT_ID'),
      ),
    } as unknown as YouTubeUploadService;

    registerStage5Routes(app, {
      ops,
      watchFolders,
      webhooks,
      youtubeUpload,
      getInFlightRequests: () => 1,
    });

    const metricsRes = await app.inject({ method: 'GET', url: '/api/ops/metrics' });
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.json().metrics.version).toBe('0.11.0');

    const diskRes = await app.inject({ method: 'GET', url: '/api/ops/disk' });
    expect(diskRes.statusCode).toBe(200);
    expect(diskRes.json().disk.totalManagedBytes).toBe(1024);

    const previewRes = await app.inject({
      method: 'POST',
      url: '/api/ops/cleanup/preview',
      payload: { olderThanDays: 14 },
    });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json().result.dryRun).toBe(true);
    expect(previewRes.json().result.totalFreedBytes).toBe(4608);

    const ytStatusRes = await app.inject({ method: 'GET', url: '/api/youtube/upload/status' });
    expect(ytStatusRes.statusCode).toBe(200);
    expect(ytStatusRes.json().configured).toBe(false);

    const ytUploadRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/youtube/upload-draft',
      payload: { privacyStatus: 'private' },
    });
    expect(ytUploadRes.statusCode).toBe(503);

    await app.close();
  });

  it('validates webhook and watch folder payloads and returns 400 on invalid input', async () => {
    const app = Fastify({ logger: false });
    registerStage5Routes(app, {
      ops: {} as OpsService,
      watchFolders: {
        createWatchFolder: vi.fn().mockRejectedValue(new Error('Path is outside allowed ingest roots')),
      } as unknown as WatchFolderService,
      webhooks: {
        createWebhook: vi.fn().mockRejectedValue(new Error('Blocked unsafe host')),
      } as unknown as WebhookService,
      youtubeUpload: {} as YouTubeUploadService,
    });

    const badWebhook = await app.inject({
      method: 'POST',
      url: '/api/ops/webhooks',
      payload: { name: 'Bad', url: 'not-a-url', events: ['asset.created'] },
    });
    expect(badWebhook.statusCode).toBe(400);

    const blockedWebhook = await app.inject({
      method: 'POST',
      url: '/api/ops/webhooks',
      payload: {
        name: 'Metadata',
        url: 'http://169.254.169.254/meta',
        events: ['asset.created'],
      },
    });
    expect(blockedWebhook.statusCode).toBe(400);

    const badWatch = await app.inject({
      method: 'POST',
      url: '/api/ops/watch-folders',
      payload: { projectId: 'demo', relativeDir: '/etc/passwd' },
    });
    expect(badWatch.statusCode).toBe(400);

    await app.close();
  });
});

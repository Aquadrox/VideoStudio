import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { MediaService } from './media.service.js';
import type { Stage3Service } from './stage3.service.js';
import type { StudioService } from './studio.service.js';
import { signWebhookPayload, WebhookService } from './webhook.service.js';
import { YouTubeUploadService } from './youtube-upload.service.js';

function makeConfig(root: string, withYouTube = false): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    mcpAuthToken: 'unit-test-token-123456',
    corsOrigin: '*',
    dataDir: path.join(root, 'data'),
    ingestAllowedDir: path.join(root, 'ingest'),
    ingestExtraDirs: [],
    skillsSyncDir: path.join(root, 'skills'),
    backupDir: path.join(root, 'backups'),
    maxUploadBytes: 50 * 1024 * 1024,
    allowedFetchHosts: [],
    comfyuiBaseUrl: null,
    youtubeOAuth: withYouTube
      ? {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          refreshToken: 'test-refresh-token',
        }
      : null,
  };
}

describe('WebhookService & YouTubeUploadService', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videostudio-stage5-svc-'));
    await fs.mkdir(path.join(tmpRoot, 'data'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('computes deterministic HMAC-SHA256 webhook signatures', () => {
    const body = JSON.stringify({ event: 'asset.created', data: { id: '1' } });
    const secret = 'my-signing-secret';
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    expect(signWebhookPayload(body, secret)).toBe(expected);
  });

  it('blocks link-local / cloud metadata URLs when creating webhooks', async () => {
    const service = new WebhookService({} as Database, makeConfig(tmpRoot));

    await expect(
      service.createWebhook({
        name: 'SSRF attempt',
        url: 'http://169.254.169.254/latest/meta-data/',
        events: ['asset.created'],
        enabled: true,
      }),
    ).rejects.toThrow(/Blocked unsafe/i);
  });

  it('reports missing env vars when YouTube OAuth is unconfigured', () => {
    const cfg = makeConfig(tmpRoot, false);
    const service = new YouTubeUploadService(
      cfg,
      {} as StudioService,
      {} as Stage3Service,
      new MediaService(cfg),
    );
    const status = service.getStatus();
    expect(status.configured).toBe(false);
    expect(status.missingEnvVars).toEqual([
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET',
      'YOUTUBE_REFRESH_TOKEN',
    ]);
  });

  it('uploads a private YouTube draft video + optional thumbnail via OAuth2 resumable upload', async () => {
    const cfg = makeConfig(tmpRoot, true);
    const media = new MediaService(cfg);
    await fs.mkdir(path.join(cfg.dataDir, 'projects', 'demo', 'originals'), { recursive: true });
    await fs.writeFile(
      path.join(cfg.dataDir, 'projects', 'demo', 'originals', 'cut.mp4'),
      Buffer.from('fake-mp4-video-bytes'),
    );
    await fs.writeFile(
      path.join(cfg.dataDir, 'projects', 'demo', 'originals', 'thumb.jpg'),
      Buffer.from('fake-jpg-thumb-bytes'),
    );

    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method, headers });

      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-access-token' }), { status: 200 });
      }
      if (url.includes('upload/youtube/v3/videos')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example.test/resumable-session-123' },
        });
      }
      if (url.includes('resumable-session-123')) {
        return new Response(JSON.stringify({ id: 'yt_video_999' }), { status: 200 });
      }
      if (url.includes('thumbnails/set')) {
        return new Response(JSON.stringify({ kind: 'youtube#thumbnailSetResponse' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const projectId = '11111111-1111-4111-8111-111111111111';
    const videoId = '22222222-2222-4222-8222-222222222222';
    const thumbId = '33333333-3333-4333-8333-333333333333';

    const studio = {
      getProjectByIdOrSlug: vi.fn().mockResolvedValue({
        id: projectId,
        slug: 'demo',
        name: 'Demo Film',
      }),
      getAssetById: vi.fn().mockImplementation(async (id: string) => {
        if (id === videoId) {
          return {
            asset: { id: videoId, type: 'video', mimeType: 'video/mp4', handle: '@vid-001' },
            raw: { filePath: 'projects/demo/originals/cut.mp4' },
          };
        }
        if (id === thumbId) {
          return {
            asset: { id: thumbId, type: 'image', mimeType: 'image/jpeg', handle: '@img-001' },
            raw: { filePath: 'projects/demo/originals/thumb.jpg' },
          };
        }
        return null;
      }),
      logActivity: vi.fn().mockResolvedValue({}),
    } as unknown as StudioService;

    const stage3 = {
      getYouTubePackage: vi.fn().mockResolvedValue({
        titles: ['Titre A Optimisé', 'Titre B'],
        description: 'Description principale',
        tags: ['ai', 'cinema'],
        hashtags: ['VideoStudio'],
        language: 'fr',
        aiDisclosure: true,
        thumbnailAssetIds: [thumbId],
        chapters: [{ timecodeSec: 0, title: 'Intro' }],
      }),
    } as unknown as Stage3Service;

    const service = new YouTubeUploadService(cfg, studio, stage3, media, mockFetch);
    const result = await service.uploadDraftVideo('demo', {
      videoAssetId: videoId,
      titleIndex: 0,
      thumbnailIndex: 0,
      privacyStatus: 'private',
    });

    expect(result.videoId).toBe('yt_video_999');
    expect(result.privacyStatus).toBe('private');
    expect(result.thumbnailUploaded).toBe(true);
    expect(result.studioUrl).toBe('https://studio.youtube.com/video/yt_video_999/edit');
    expect(calls.length).toBe(4);
    expect(calls[1]?.headers.Authorization).toBe('Bearer mock-access-token');
  });
});

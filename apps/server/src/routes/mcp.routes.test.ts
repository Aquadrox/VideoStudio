import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import type { MediaService } from '../services/media.service.js';
import type { OpsService } from '../services/ops.service.js';
import type { SketchService } from '../services/sketch.service.js';
import type { Stage2Service } from '../services/stage2.service.js';
import type { Stage3Service } from '../services/stage3.service.js';
import type { Stage4Service } from '../services/stage4.service.js';
import type { StudioService } from '../services/studio.service.js';
import type { WatchFolderService } from '../services/watch-folder.service.js';
import type { WebhookService } from '../services/webhook.service.js';
import type { YouTubeUploadService } from '../services/youtube-upload.service.js';
import { registerMcpRoutes } from './mcp.routes.js';

function createTestConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    mcpAuthToken: 'unit-test-token-123456',
    corsOrigin: '*',
    dataDir: '/tmp/videostudio-test-data',
    ingestAllowedDir: '/tmp/videostudio-test-ingest',
    ingestExtraDirs: [],
    skillsSyncDir: '/tmp/videostudio-test-skills',
    backupDir: '/tmp/videostudio-test-backups',
    maxUploadBytes: 10 * 1024 * 1024,
    allowedFetchHosts: [],
    comfyuiBaseUrl: null,
    youtubeOAuth: null,
  };
}

describe('MCP Streamable HTTP route', () => {
  it('rejects requests without a valid Bearer token with 401', async () => {
    const app = Fastify({ logger: false });
    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
      stage4: {} as Stage4Service,
    });

    const missingAuth = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(missingAuth.statusCode).toBe(401);

    const wrongAuth = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer wrong-secret' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(wrongAuth.statusCode).toBe(401);

    await app.close();
  });

  it('responds to authenticated MCP initialize and tools/list requests including Stage 2-5 tools', async () => {
    const app = Fastify({ logger: false });
    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
      stage4: {} as Stage4Service,
      stage5: {
        ops: {} as OpsService,
        watchFolders: {} as WatchFolderService,
        webhooks: {} as WebhookService,
        youtubeUpload: {} as YouTubeUploadService,
      },
      sketches: {} as SketchService,
    });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const initRes = await fetch(`${address}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer unit-test-token-123456',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'vitest-client', version: '1.0.0' },
          },
        }),
      });

      expect(initRes.status).toBe(200);
      const initText = await initRes.text();
      expect(initText).toContain('"name":"videostudio"');

      const toolsRes = await fetch(`${address}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer unit-test-token-123456',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(toolsRes.status).toBe(200);
      const toolsText = await toolsRes.text();
      // Stage 1 + v0.4.0 DAM / QC / Batch
      expect(toolsText).toContain('register_asset');
      expect(toolsText).toContain('delete_asset');
      expect(toolsText).toContain('delete_assets_batch');
      expect(toolsText).toContain('ingest_folder');
      expect(toolsText).toContain('get_asset');
      expect(toolsText).toContain('record_qc');
      expect(toolsText).toContain('get_frame');
      expect(toolsText).toContain('contact_sheet');
      expect(toolsText).toContain('resolve_reference');
      expect(toolsText).toContain('update_project');
      expect(toolsText).toContain('list_media_folders');
      expect(toolsText).toContain('create_media_folder');
      expect(toolsText).toContain('sync_agent_tasks');
      expect(toolsText).toContain('update_agent_task');
      expect(toolsText).toContain('list_agent_tasks');
      expect(toolsText).toContain('clear_agent_tasks');
      // Stage 2
      expect(toolsText).toContain('get_pending_feedback');
      expect(toolsText).toContain('get_active_rules');
      expect(toolsText).toContain('update_rule');
      expect(toolsText).toContain('delete_rule');
      expect(toolsText).toContain('save_skill');
      // Stage 3 + v0.4.0 Storyboard / Audio
      expect(toolsText).toContain('update_script');
      expect(toolsText).toContain('upsert_bible_entity');
      expect(toolsText).toContain('upsert_storyboard');
      expect(toolsText).toContain('compose_prompt');
      expect(toolsText).toContain('create_shot');
      expect(toolsText).toContain('upsert_audio_track');
      expect(toolsText).toContain('import_suno_alignment');
      expect(toolsText).toContain('update_youtube_package');
      expect(toolsText).toContain('prepare_youtube_pack');
      expect(toolsText).toContain('init_project_git_repo');
      expect(toolsText).toContain('sync_and_commit_project_repo');
      // Stage 4 (Timeline, Animatic, Render & NLE Export)
      expect(toolsText).toContain('get_timeline');
      expect(toolsText).toContain('save_timeline');
      expect(toolsText).toContain('build_animatic_from_storyboard');
      expect(toolsText).toContain('switch_timeline_quality');
      expect(toolsText).toContain('render_timeline');
      expect(toolsText).toContain('export_nle');
      // Stage 5 (Ops, Cleanup, Backups, Watch Folders, Webhooks, YouTube Draft Upload)
      expect(toolsText).toContain('get_system_health_and_disk');
      expect(toolsText).toContain('preview_disk_cleanup');
      expect(toolsText).toContain('run_disk_cleanup');
      expect(toolsText).toContain('create_backup');
      expect(toolsText).toContain('list_watch_folders');
      expect(toolsText).toContain('create_watch_folder');
      expect(toolsText).toContain('list_webhooks');
      expect(toolsText).toContain('create_webhook');
      expect(toolsText).toContain('upload_youtube_draft');
      // Stage 6 (Scene Blocking Plans & Storyboard Sketches)
      expect(toolsText).toContain('list_sketches');
      expect(toolsText).toContain('get_sketch');
      expect(toolsText).toContain('save_sketch');
      expect(toolsText).toContain('get_sketch_storyboard');
      // Text Document Assets (.md, .txt, .log, etc.)
      expect(toolsText).toContain('read_text_asset');
      expect(toolsText).toContain('save_text_asset');
    } finally {
      await app.close();
    }
  });

  it('executes delete_asset and delete_assets_batch with protection for approved/winner/final_master assets', async () => {
    const app = Fastify({ logger: false });
    const deletedIds: string[] = [];

    const mockAssets: Record<string, {
      id: string;
      handle: string;
      title: string;
      projectSlug: string;
      folderPath: string;
      status: string;
      qualityTier: string;
    }> = {
      '@img-001': {
        id: '11111111-1111-4111-8111-111111111111',
        handle: '@img-001',
        title: 'Test draft',
        projectSlug: 'demo',
        folderPath: 'drafts',
        status: 'needs_revision',
        qualityTier: 'test',
      },
      '@img-002': {
        id: '22222222-2222-4222-8222-222222222222',
        handle: '@img-002',
        title: 'Approved keyframe',
        projectSlug: 'demo',
        folderPath: 'finals',
        status: 'approved',
        qualityTier: 'hq_upscale',
      },
    };

    const studio = {
      resolveReference: async (ref: string) => {
        const asset = mockAssets[ref];
        return asset ? { entityType: 'asset', asset } : null;
      },
      deleteAsset: async (id: string) => {
        deletedIds.push(id);
        return true;
      },
    } as unknown as StudioService;

    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio,
      media: {} as MediaService,
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
      stage4: {} as Stage4Service,
    });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
      const res = await fetch(`${address}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer unit-test-token-123456',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      expect(res.status).toBe(200);
      return res.text();
    };

    try {
      // 1. Protected asset blocked when force=false
      const blockedText = await callTool(10, 'delete_asset', { ref: '@img-002' });
      expect(blockedText).toContain('Refused to delete protected asset @img-002');
      expect(deletedIds).toEqual([]);

      // 2. Normal test asset deleted cleanly
      const okText = await callTool(11, 'delete_asset', { ref: '@img-001' });
      expect(okText).toContain('\\"deleted\\": true');
      expect(deletedIds).toEqual(['11111111-1111-4111-8111-111111111111']);

      // 3. Batch delete skips protected and reports missing refs
      const batchText = await callTool(12, 'delete_assets_batch', {
        refs: ['@img-001', '@img-002', '@img-999'],
      });
      expect(batchText).toContain('skippedProtected');
      expect(batchText).toContain('@img-002');
      expect(batchText).toContain('@img-999');

      // 4. Protected asset deleted when force=true
      const forcedText = await callTool(13, 'delete_asset', { ref: '@img-002', force: true });
      expect(forcedText).toContain('\\"deleted\\": true');
      expect(deletedIds).toContain('22222222-2222-4222-8222-222222222222');
    } finally {
      await app.close();
    }
  });
});

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import type { DossierService } from '../services/dossier.service.js';
import type { EffectsService } from '../services/effects.service.js';
import type { KnowledgeService } from '../services/knowledge.service.js';
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

  it('responds to authenticated MCP initialize and tools/list requests including Stage 2-9 tools', async () => {
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
      dossier: {} as DossierService,
      knowledge: {} as KnowledgeService,
      effects: {} as EffectsService,
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
      expect(initText).toContain('"version":"0.12.0"');

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
      // Stage 7 (v0.9.0 Subtitles & Production Dossier)
      expect(toolsText).toContain('get_subtitles');
      expect(toolsText).toContain('save_subtitles');
      expect(toolsText).toContain('export_subtitles_srt');
      expect(toolsText).toContain('export_production_dossier');
      // Stage 8 (v0.10.0 Shared Studio Knowledge & AI Memory)
      expect(toolsText).toContain('recall_project_playbook');
      expect(toolsText).toContain('learn_studio_knowledge');
      expect(toolsText).toContain('list_studio_knowledge');
      expect(toolsText).toContain('update_studio_knowledge');
      expect(toolsText).toContain('delete_studio_knowledge');
      // Stage 9 (v0.11.0 CapCut Surgical Montage, WYSIWYG AMV FX, Range Preview & Custom AI Video Effects)
      expect(toolsText).toContain('patch_timeline_clips');
      expect(toolsText).toContain('render_timeline_range');
      expect(toolsText).toContain('add_timeline_clip');
      expect(toolsText).toContain('update_timeline_clip');
      expect(toolsText).toContain('split_timeline_clip');
      expect(toolsText).toContain('delete_timeline_clip');
      expect(toolsText).toContain('clear_timeline_render_cache');
      expect(toolsText).toContain('list_video_effects');
      expect(toolsText).toContain('create_video_effect');
      expect(toolsText).toContain('update_video_effect');
      expect(toolsText).toContain('delete_video_effect');
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

  it('executes CapCut surgical montage & custom AI effect MCP tools end-to-end', async () => {
    const app = Fastify({ logger: false });
    const calls: string[] = [];

    const stage4 = {
      addClip: async (project: string, input: Record<string, unknown>, actor: string) => {
        calls.push(`add:${project}:${actor}:${String(input.title)}`);
        return { clip: { id: '33333333-3333-4333-8333-333333333333', title: input.title }, timeline: { tracks: [] } };
      },
      splitClip: async (project: string, clipId: string, splitAtSec: number, actor: string) => {
        calls.push(`split:${project}:${actor}:${clipId}:${splitAtSec}`);
        return { leftClip: { id: clipId }, rightClip: { id: '44444444-4444-4444-8444-444444444444' }, timeline: { tracks: [] } };
      },
      updateClip: async (project: string, clipId: string, patch: Record<string, unknown>, actor: string) => {
        calls.push(`update:${project}:${actor}:${clipId}:${String(patch.speed)}`);
        return { clip: { id: clipId, ...patch }, timeline: { tracks: [] } };
      },
      deleteClip: async (project: string, clipId: string, opts: { ripple?: boolean }, actor: string) => {
        calls.push(`delete:${project}:${actor}:${clipId}:${Boolean(opts.ripple)}`);
        return { deletedClipId: clipId, timeline: { tracks: [] } };
      },
      clearRenderCache: async (project: string) => {
        calls.push(`clearCache:${project}`);
        return { clearedFiles: 7 };
      },
      patchTimelineClips: async (project: string, input: { operations: Array<{ op: string }> }, actor: string) => {
        calls.push(`patch:${project}:${actor}:${input.operations.map((o) => o.op).join('+')}`);
        return { appliedCount: input.operations.length, modifiedClipIds: ['33333333-3333-4333-8333-333333333333'], summary: ['ok'], timeline: { tracks: [] } };
      },
      startRangeRender: async (project: string, input: { startSec: number; endSec: number; resolution?: string }, actor: string) => {
        calls.push(`range:${project}:${actor}:${input.startSec}-${input.endSec}:${input.resolution}`);
        return { jobId: 'job-range-1', startSec: input.startSec, endSec: input.endSec, clipCount: 2, render: { id: 'r-range-1', status: 'rendering' } };
      },
    } as unknown as Stage4Service;

    const effects = {
      createEffect: async (input: { name: string; ffmpegFilterTemplate: string }, createdBy: string) => {
        if (input.ffmpegFilterTemplate.includes('movie=')) {
          throw new Error('Filtre interdit');
        }
        calls.push(`createFx:${createdBy}:${input.name}`);
        return { id: '55555555-5555-4555-8555-555555555555', slug: 'ai-bloom', createdBy, ...input };
      },
      listEffects: async () => [{ slug: 'ai-bloom', name: 'AI Bloom', createdBy: 'claude' }],
    } as unknown as EffectsService;

    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
      stage4,
      effects,
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
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      });
      expect(res.status).toBe(200);
      return res.text();
    };

    try {
      // 1. Claude creates a custom AI effect
      const fxRes = await callTool(20, 'create_video_effect', {
        name: 'AI Bloom',
        category: 'video_fx',
        ffmpegFilterTemplate: 'gblur=sigma={{sigma}},eq=brightness=0.05',
        cssPreviewFilter: 'blur({{sigma}}px)',
        paramsSchema: [{ key: 'sigma', label: 'Flou', type: 'number', min: 0.5, max: 6, default: 2 }],
      });
      expect(fxRes).toContain('ai-bloom');

      // 2. Malicious FFmpeg effect rejected with isError: true
      const evilRes = await callTool(21, 'create_video_effect', {
        name: 'Evil',
        ffmpegFilterTemplate: 'movie=/etc/passwd',
      });
      expect(evilRes).toContain('"isError":true');
      expect(evilRes).toContain('Filtre interdit');

      // 3. Claude drops clip with structured AMV FX & camera/cinemascope, splits it, patches, range-renders, clears cache
      const addRes = await callTool(22, 'add_timeline_clip', {
        project: 'demo',
        trackType: 'video',
        assetRef: '@vid-001',
        title: 'Intro Shot',
        durationSec: 6,
        camera: { mode: 'power_pullback', z0: 1.34, z1: 1.0, beatPulseAmp: 0.035, rotDeg: 2, shakeAmp: 0.3 },
        cinemascope: { bar0: 0.25, bar1: 0.125 },
        fx: {
          mangaBlink: true,
          radialSpeedLines: { color: '#FFFFFF', intensity: 0.9, count: 48 },
          particles: { color: '#F5B942', count: 32, intensity: 0.85 },
          flashIn: { alpha: 0.85, color: '#FFFFFF', frames: 6 },
        },
        effects: [{ effectSlug: 'ai-bloom', enabled: true, intensity: 1, params: { sigma: 2 } }],
      });
      expect(addRes).toContain('33333333-3333-4333-8333-333333333333');

      const splitRes = await callTool(23, 'split_timeline_clip', {
        project: 'demo',
        clipId: '33333333-3333-4333-8333-333333333333',
        splitAtSec: 3,
      });
      expect(splitRes).toContain('44444444-4444-4444-8444-444444444444');

      await callTool(24, 'update_timeline_clip', {
        project: 'demo',
        clipId: '44444444-4444-4444-8444-444444444444',
        speed: 1.5,
      });

      const patchRes = await callTool(27, 'patch_timeline_clips', {
        project: 'demo',
        operations: [
          { op: 'replace_asset', title: 'Intro Shot', assetRef: '@vid-002' },
          { op: 'reorder', titles: ['Intro Shot'], ripple: true },
        ],
      });
      expect(patchRes).toContain('appliedCount');

      const rangeRes = await callTool(28, 'render_timeline_range', {
        project: 'demo',
        startSec: 140,
        endSec: 170,
        resolution: '1280x720',
      });
      expect(rangeRes).toContain('job-range-1');

      await callTool(25, 'delete_timeline_clip', {
        project: 'demo',
        clipId: '44444444-4444-4444-8444-444444444444',
        ripple: true,
      });

      const cacheRes = await callTool(26, 'clear_timeline_render_cache', { project: 'demo' });
      expect(cacheRes).toContain('7');

      expect(calls).toEqual([
        'createFx:claude:AI Bloom',
        'add:demo:claude:Intro Shot',
        'split:demo:claude:33333333-3333-4333-8333-333333333333:3',
        'update:demo:claude:44444444-4444-4444-8444-444444444444:1.5',
        'patch:demo:claude:replace_asset+reorder',
        'range:demo:claude:140-170:1280x720',
        'delete:demo:claude:44444444-4444-4444-8444-444444444444:true',
        'clearCache:demo',
      ]);
    } finally {
      await app.close();
    }
  });
});

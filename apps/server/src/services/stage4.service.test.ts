import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_VIDEO_EFFECTS,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  type TimelineClipDto,
  type TimelineDto,
  type VideoEffectDto,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import type { EffectsService } from './effects.service.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { Stage3Service } from './stage3.service.js';
import { Stage4Service } from './stage4.service.js';
import type { StudioService } from './studio.service.js';

function makeConfig(dataDir: string): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    mcpAuthToken: 'test-token',
    corsOrigin: '*',
    dataDir,
    ingestAllowedDir: path.join(dataDir, 'ingest'),
    ingestExtraDirs: [],
    skillsSyncDir: path.join(dataDir, 'skills'),
    backupDir: path.join(dataDir, 'backups'),
    maxUploadBytes: 50 * 1024 * 1024,
    allowedFetchHosts: [],
    comfyuiBaseUrl: null,
    youtubeOAuth: null,
  };
}

function makeClip(overrides: Partial<TimelineClipDto> & { id: string; title: string }): TimelineClipDto {
  return {
    trackId: '00000000-0000-4000-8000-000000000101',
    projectId: '00000000-0000-4000-8000-000000000001',
    assetId: '00000000-0000-4000-8000-000000000201',
    assetRef: '@vid-001',
    assetTitle: overrides.title,
    assetType: 'video',
    assetQualityTier: 'draft_lowres',
    startSec: 0,
    durationSec: 4,
    inSec: 0,
    outSec: null,
    speed: 1,
    transition: 'cut',
    transitionDurationSec: 0,
    volume: 1,
    fadeInSec: 0,
    fadeOutSec: 0,
    muted: false,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST },
    effects: [],
    keyframes: [],
    textOverlay: null,
    notes: '',
    sortOrder: 0,
    ...overrides,
  };
}

function makeBuiltinCatalog(): Map<string, VideoEffectDto> {
  const map = new Map<string, VideoEffectDto>();
  for (const seed of BUILTIN_VIDEO_EFFECTS) {
    map.set(seed.slug, {
      id: `fx-${seed.slug}`,
      slug: seed.slug,
      name: seed.name,
      category: seed.category ?? 'video_fx',
      description: seed.description ?? '',
      icon: seed.icon ?? '✨',
      ffmpegFilterTemplate: seed.ffmpegFilterTemplate,
      cssPreviewFilter: seed.cssPreviewFilter ?? '',
      paramsSchema: seed.paramsSchema ?? [],
      defaultParams: seed.defaultParams ?? {},
      createdBy: 'system',
      isBuiltin: true,
      tags: seed.tags ?? [],
      usageCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  }
  return map;
}

describe('Stage4Service — Incremental Render Cache & CapCut FFmpeg Pipeline', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-stage4-test-'));
    await fs.mkdir(path.join(tmpRoot, 'media'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  function createHarness(options: {
    assetFiles: Record<string, { type: 'video' | 'image' | 'audio'; relPath: string; updatedAt?: string }>;
    ffmpegImpl?: (args: string[]) => Promise<void>;
    subtitlesCues?: Array<{ id: string; startSec: number; endSec: number; text: string; speaker: string }>;
    audioTracks?: Array<{
      id: string;
      title: string;
      bpm?: number | null;
      markers?: Array<{ timeSec: number; label: string; kind?: string }>;
    }>;
  }) {
    const ffmpegCalls: string[][] = [];
    const jobUpdates: Array<Record<string, unknown>> = [];
    const renderUpdates: Array<Record<string, unknown>> = [];
    const incrementedSlugs: string[][] = [];
    const ingestedAssets: Array<Record<string, unknown>> = [];

    const db = {
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => ({
          returning: vi.fn().mockResolvedValue([
            {
              id: '00000000-0000-4000-8000-000000007777',
              createdAt: new Date('2026-01-01T00:00:00Z'),
              ...vals,
            },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          renderUpdates.push(vals);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    } as unknown as Database;

    const studio = {
      getProjectByIdOrSlug: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'test-film',
        name: 'Test Film',
        fps: 24,
        targetResolution: '1920x1080',
      }),
      getAssetById: vi.fn(async (id: string) => {
        const entry = options.assetFiles[id];
        if (!entry) return null;
        return {
          asset: {
            id,
            type: entry.type,
            title: id,
            handle: `@ref-${id.slice(-3)}`,
            updatedAt: entry.updatedAt ?? '2026-01-01T00:00:00Z',
          },
          raw: { filePath: entry.relPath, proxyPath: null },
        };
      }),
      startJob: vi.fn(async () => ({ id: 'job-auto-1' })),
      updateJob: vi.fn(async (_jobId: string, patch: Record<string, unknown>) => {
        jobUpdates.push(patch);
      }),
      ingestAssetFromBuffer: vi.fn(async (payload: Record<string, unknown>) => {
        ingestedAssets.push(payload);
        return {
          id: '00000000-0000-4000-8000-000000009999',
          handle: '@vid-099',
          durationSec: 12,
        };
      }),
    } as unknown as StudioService;

    const stage3 = {
      listAudioTracks: vi.fn(async () => options.audioTracks ?? []),
    } as unknown as Stage3Service;

    const media = {
      resolveMediaFile: vi.fn((relPath: string) => path.join(tmpRoot, relPath)),
      executeFfmpeg: vi.fn(async (args: string[]) => {
        ffmpegCalls.push(args);
        if (options.ffmpegImpl) {
          await options.ffmpegImpl(args);
          return;
        }
        // Write deterministic dummy MP4 output at the last argument path
        const outPath = args[args.length - 1]!;
        await fs.writeFile(outPath, Buffer.from(`MP4:${outPath}`), 'utf8');
      }),
    } as unknown as MediaService;

    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeHub;

    const effects = {
      getEffectsCatalogMap: vi.fn().mockResolvedValue(makeBuiltinCatalog()),
      incrementUsage: vi.fn(async (slugs: string[]) => {
        incrementedSlugs.push(slugs);
      }),
    } as unknown as EffectsService;

    const svc = new Stage4Service(
      makeConfig(tmpRoot),
      db,
      studio,
      stage3,
      media,
      realtime,
    );
    svc.setEffectsService(effects);

    if (options.subtitlesCues) {
      vi.spyOn(svc, 'getSubtitles').mockResolvedValue({
        projectId: '00000000-0000-4000-8000-000000000001',
        language: 'fr',
        cues: options.subtitlesCues,
        style: {
          fontSize: 24,
          position: 'bottom',
          color: '#FFFFFF',
          outlineColor: '#000000',
          backgroundOpacity: 0.55,
        },
        updatedAt: '2026-01-01T00:00:00Z',
      });
    }

    return { svc, ffmpegCalls, jobUpdates, renderUpdates, incrementedSlugs, ingestedAssets, studio };
  }

  it('caches unchanged video segments by SHA-256 and only re-encodes the single edited clip on re-render', async () => {
    const a1 = '00000000-0000-4000-8000-000000000201';
    const a2 = '00000000-0000-4000-8000-000000000202';
    const a3 = '00000000-0000-4000-8000-000000000203';
    await fs.writeFile(path.join(tmpRoot, 'media', 'c1.mp4'), 'video-one');
    await fs.writeFile(path.join(tmpRoot, 'media', 'c2.mp4'), 'video-two');
    await fs.writeFile(path.join(tmpRoot, 'media', 'c3.mp4'), 'video-three');

    const { svc, ffmpegCalls, jobUpdates } = createHarness({
      assetFiles: {
        [a1]: { type: 'video', relPath: 'media/c1.mp4' },
        [a2]: { type: 'video', relPath: 'media/c2.mp4' },
        [a3]: { type: 'video', relPath: 'media/c3.mp4' },
      },
    });

    const clip1 = makeClip({ id: 'c1', assetId: a1, title: 'Clip 1', startSec: 0, durationSec: 4 });
    const clip2 = makeClip({ id: 'c2', assetId: a2, title: 'Clip 2', startSec: 4, durationSec: 4 });
    const clip3 = makeClip({ id: 'c3', assetId: a3, title: 'Clip 3', startSec: 8, durationSec: 4 });

    const baseTimeline: TimelineDto = {
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      fps: 24,
      resolution: '1280x720',
      qualityMode: 'draft_proxy',
      totalDurationSec: 12,
      renders: [],
      tracks: [
        {
          id: 't-v1',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 0,
          clips: [clip1, clip2, clip3],
        },
      ],
    };

    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);

    // RENDER #1 (Cold cache): 3 segments + 1 fast concat = 4 FFmpeg calls
    await runPipeline({
      renderId: 'r1',
      jobId: 'j1',
      projectId: baseTimeline.projectId,
      projectSlug: 'test-film',
      timeline: baseTimeline,
      videoClips: [clip1, clip2, clip3],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    expect(ffmpegCalls).toHaveLength(4);
    expect(String(jobUpdates[jobUpdates.length - 1]?.message)).toContain('0/3 segment(s) du cache');

    // RENDER #2 (Edit ONLY clip 2 with Glitch RGB effect): 1 segment encoded + 1 concat = ONLY 2 FFmpeg calls!
    ffmpegCalls.length = 0;
    jobUpdates.length = 0;
    const clip2Edited = {
      ...clip2,
      effects: [{ effectSlug: 'glitch-rgb', enabled: true, intensity: 1, params: { shiftX: 14 } }],
    };

    await runPipeline({
      renderId: 'r2',
      jobId: 'j2',
      projectId: baseTimeline.projectId,
      projectSlug: 'test-film',
      timeline: baseTimeline,
      videoClips: [clip1, clip2Edited, clip3],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls[0]!.join(' ')).toContain('rgbashift=rh=14');
    expect(String(jobUpdates[jobUpdates.length - 1]?.message)).toContain('2/3 segment(s) du cache');

    // RENDER #3 (bypassCache: true): forces re-encoding all 3 segments + 1 concat = 4 calls
    ffmpegCalls.length = 0;
    await runPipeline({
      renderId: 'r3',
      jobId: 'j3',
      projectId: baseTimeline.projectId,
      projectSlug: 'test-film',
      timeline: baseTimeline,
      videoClips: [clip1, clip2Edited, clip3],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      bypassCache: true,
      actor: 'user',
    });
    expect(ffmpegCalls).toHaveLength(4);

    // Clear render cache deletes all cached .mp4 segments (4 unique hashes across renders)
    const cleared = await svc.clearRenderCache('test-film');
    expect(cleared).toEqual({ clearedFiles: 4 });
    const clearedAgain = await svc.clearRenderCache('test-film');
    expect(clearedAgain).toEqual({ clearedFiles: 0 });
  });

  it('builds FFmpeg filter_complex with xfade transitions, overlay PiP, timed drawtext, multi-track audio amix, and subtitle burn-in', async () => {
    const v1 = '00000000-0000-4000-8000-000000000301';
    const v2 = '00000000-0000-4000-8000-000000000302';
    const ov1 = '00000000-0000-4000-8000-000000000303';
    const aud1 = '00000000-0000-4000-8000-000000000304';
    const aud2 = '00000000-0000-4000-8000-000000000305';

    await fs.writeFile(path.join(tmpRoot, 'media', 'v1.mp4'), 'v1');
    await fs.writeFile(path.join(tmpRoot, 'media', 'v2.png'), 'v2');
    await fs.writeFile(path.join(tmpRoot, 'media', 'logo.png'), 'logo');
    await fs.writeFile(path.join(tmpRoot, 'media', 'music.mp3'), 'music');
    await fs.writeFile(path.join(tmpRoot, 'media', 'sfx.wav'), 'sfx');

    const { svc, ffmpegCalls, incrementedSlugs } = createHarness({
      assetFiles: {
        [v1]: { type: 'video', relPath: 'media/v1.mp4' },
        [v2]: { type: 'image', relPath: 'media/v2.png' },
        [ov1]: { type: 'image', relPath: 'media/logo.png' },
        [aud1]: { type: 'audio', relPath: 'media/music.mp3' },
        [aud2]: { type: 'audio', relPath: 'media/sfx.wav' },
      },
      subtitlesCues: [{ id: 's1', startSec: 0.5, endSec: 3.0, text: 'Bienvenue au studio', speaker: '' }],
    });

    const clip1 = makeClip({
      id: 'v1',
      assetId: v1,
      title: 'Intro',
      startSec: 0,
      durationSec: 4,
      effects: [{ effectSlug: 'cinema-teal-orange', enabled: true, intensity: 1, params: {} }],
    });
    const clip2 = makeClip({
      id: 'v2',
      assetId: v2,
      assetType: 'image',
      title: 'Plan 2',
      startSec: 4,
      durationSec: 4,
      transition: 'wipe_left',
      transitionDurationSec: 0.8,
    });

    const timeline: TimelineDto = {
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      fps: 24,
      resolution: '1920x1080',
      qualityMode: 'hq_master',
      totalDurationSec: 8,
      renders: [],
      tracks: [
        {
          id: 'tr-v',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 0,
          clips: [clip1, clip2],
        },
        {
          id: 'tr-ov',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'OV1',
          type: 'overlay',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 1,
          clips: [
            makeClip({
              id: 'ov1',
              trackId: 'tr-ov',
              assetId: ov1,
              assetType: 'image',
              title: 'Logo PiP',
              startSec: 1,
              durationSec: 3,
              transform: { ...DEFAULT_CLIP_TRANSFORM, scale: 0.5, x: 0.5, y: -0.4, opacity: 0.85 },
            }),
          ],
        },
        {
          id: 'tr-txt',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'T1',
          type: 'text',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 2,
          clips: [
            makeClip({
              id: 'txt1',
              trackId: 'tr-txt',
              assetId: null,
              title: 'Titre',
              startSec: 0.5,
              durationSec: 2.5,
              textOverlay: {
                text: 'CHAPITRE 01',
                fontSize: 56,
                color: '#FFFFFF',
                bgColor: '#000000',
                bgOpacity: 0.5,
                x: 50,
                y: 80,
                bold: true,
                animation: 'fade',
              },
            }),
          ],
        },
        {
          id: 'tr-a1',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'A1 Musique',
          type: 'audio',
          muted: false,
          locked: false,
          volume: 0.8,
          sortOrder: 3,
          clips: [
            makeClip({
              id: 'a1',
              trackId: 'tr-a1',
              assetId: aud1,
              assetType: 'audio',
              title: 'Theme',
              startSec: 0,
              durationSec: 8,
              fadeInSec: 0.5,
            }),
          ],
        },
        {
          id: 'tr-a2',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'A2 SFX',
          type: 'audio',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 4,
          clips: [
            makeClip({
              id: 'a2',
              trackId: 'tr-a2',
              assetId: aud2,
              assetType: 'audio',
              title: 'Whoosh',
              startSec: 3.5,
              durationSec: 1.5,
              effects: [{ effectSlug: 'audio-radio-voice', enabled: true, intensity: 1, params: {} }],
            }),
          ],
        },
      ],
    };

    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);

    await runPipeline({
      renderId: 'r-complex',
      jobId: 'j-complex',
      projectId: timeline.projectId,
      projectSlug: 'test-film',
      timeline,
      videoClips: [clip1, clip2],
      qualityMode: 'hq_master',
      resolution: '1920x1080',
      fps: 24,
      burnSubtitles: true,
      actor: 'user',
    });

    // 2 segments + 1 final complex assembly
    expect(ffmpegCalls).toHaveLength(3);
    const assemblyArgs = ffmpegCalls[2]!;
    const fcIdx = assemblyArgs.indexOf('-filter_complex');
    expect(fcIdx).toBeGreaterThan(-1);
    const fc = assemblyArgs[fcIdx + 1]!;

    expect(fc).toContain('xfade=transition=wipeleft:duration=0.8:offset=3.2');
    expect(fc).toContain("overlay=x=(W-w)/2+(0.5)*(W/2):y=(H-h)/2+(-0.4)*(H/2):enable='between(t,1.000,4.000)'");
    expect(fc).toContain("drawtext=text='CHAPITRE 01'");
    expect(fc).toContain("enable='between(t,0.500,3.000)'");
    expect(fc).toContain('subtitles=');
    expect(fc).toContain('highpass=f=320');
    expect(fc).toContain('adelay=3500|3500');
    expect(fc).toContain('amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[amixed]');
    expect(incrementedSlugs[0]).toEqual(expect.arrayContaining(['cinema-teal-orange', 'audio-radio-voice']));
  });

  it('marks render and job as failed cleanly when FFmpeg throws', async () => {
    const a1 = '00000000-0000-4000-8000-000000000401';
    await fs.writeFile(path.join(tmpRoot, 'media', 'bad.mp4'), 'corrupt');

    const { svc, jobUpdates, renderUpdates } = createHarness({
      assetFiles: { [a1]: { type: 'video', relPath: 'media/bad.mp4' } },
      ffmpegImpl: async () => {
        throw new Error('FFmpeg exited with code 1: Invalid data');
      },
    });

    const clip1 = makeClip({ id: 'c-bad', assetId: a1, title: 'Bad Clip' });
    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);

    await runPipeline({
      renderId: 'r-fail',
      jobId: 'j-fail',
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      timeline: {
        projectId: '00000000-0000-4000-8000-000000000001',
        projectSlug: 'test-film',
        fps: 24,
        resolution: '1280x720',
        qualityMode: 'draft_proxy',
        totalDurationSec: 4,
        tracks: [],
        renders: [],
      },
      videoClips: [clip1],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'user',
    });

    expect(renderUpdates[renderUpdates.length - 1]).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringContaining('Invalid data'),
    });
    expect(jobUpdates[jobUpdates.length - 1]).toMatchObject({
      status: 'failed',
      etaSeconds: 0,
    });
  });

  it('stores per-clip SHA-256 segments under projects/<slug>/cache/timeline_segments/<sha256>.mp4 and invalidates when assetUpdatedAt changes', async () => {
    const a1 = '00000000-0000-4000-8000-000000000501';
    await fs.writeFile(path.join(tmpRoot, 'media', 'v1.mp4'), 'content-v1');

    const assetMap = {
      [a1]: { type: 'video' as const, relPath: 'media/v1.mp4', updatedAt: '2026-01-01T10:00:00Z' },
    };
    const { svc, ffmpegCalls } = createHarness({ assetFiles: assetMap });

    const clip1 = makeClip({ id: 'c-hash', assetId: a1, title: 'Shot Hash', startSec: 0, durationSec: 4 });
    const tl: TimelineDto = {
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      fps: 24,
      resolution: '1280x720',
      qualityMode: 'draft_proxy',
      totalDurationSec: 4,
      renders: [],
      tracks: [
        {
          id: 't-v1',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 0,
          clips: [clip1],
        },
      ],
    };

    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);

    await runPipeline({
      renderId: 'r-h1',
      jobId: 'j-h1',
      projectId: tl.projectId,
      projectSlug: 'test-film',
      timeline: tl,
      videoClips: [clip1],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    const expectedCacheDir = path.join(tmpRoot, 'projects', 'test-film', 'cache', 'timeline_segments');
    const cachedFiles1 = await fs.readdir(expectedCacheDir);
    expect(cachedFiles1).toHaveLength(1);
    expect(cachedFiles1[0]).toMatch(/^[0-9a-f]{64}\.mp4$/);

    // Mutate assetUpdatedAt -> cache must miss and produce a second distinct sha256 segment
    assetMap[a1]!.updatedAt = '2026-01-02T12:00:00Z';
    ffmpegCalls.length = 0;

    await runPipeline({
      renderId: 'r-h2',
      jobId: 'j-h2',
      projectId: tl.projectId,
      projectSlug: 'test-film',
      timeline: tl,
      videoClips: [clip1],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    const cachedFiles2 = await fs.readdir(expectedCacheDir);
    expect(cachedFiles2).toHaveLength(2);
    expect(ffmpegCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('compiles beat-synced camera (power_pullback + beatPulseAmp + rotDeg), animated cinemascope, and structured AMV FX from stage3 audio markers', async () => {
    const a1 = '00000000-0000-4000-8000-000000000601';
    await fs.writeFile(path.join(tmpRoot, 'media', 'amv.mp4'), 'amv-clip');

    const { svc, ffmpegCalls } = createHarness({
      assetFiles: { [a1]: { type: 'video', relPath: 'media/amv.mp4' } },
      audioTracks: [
        {
          id: 'aud-1',
          title: 'OST Drop',
          bpm: 120,
          markers: [
            { timeSec: 10.5, label: 'Downbeat 1', kind: 'beat' },
            { timeSec: 12.0, label: 'Drop Impact', kind: 'section' },
          ],
        },
      ],
    });

    const clip1 = makeClip({
      id: 'c-amv',
      assetId: a1,
      title: 'Elara Power Cut',
      startSec: 10,
      durationSec: 4,
      camera: {
        mode: 'power_pullback',
        z0: 1.34,
        z1: 1.0,
        cx0: 0.5,
        cx1: 0.5,
        cy0: 0.5,
        cy1: 0.5,
        rotDeg: 3,
        beatPulseAmp: 0.04,
        shakeAmp: 0.5,
        tremorAmp: 0.25,
      },
      cinemascope: { bar0: 0.25, bar1: 0.125 },
      fx: {
        mangaBlink: true,
        radialSpeedLines: { color: '#FFFFFF', intensity: 0.9, count: 48 },
        flashIn: { alpha: 0.85, color: '#F5B942', frames: 6 },
        fadeOutBlack: { durationSec: 0.5 },
      },
    });

    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);

    await runPipeline({
      renderId: 'r-amv',
      jobId: 'j-amv',
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      timeline: {
        projectId: '00000000-0000-4000-8000-000000000001',
        projectSlug: 'test-film',
        fps: 24,
        resolution: '1280x720',
        qualityMode: 'draft_proxy',
        totalDurationSec: 14,
        tracks: [],
        renders: [],
      },
      videoClips: [clip1],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    const segArgs = ffmpegCalls[0]!;
    const vfIdx = segArgs.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    const vf = segArgs[vfIdx + 1]!;
    // Beat markers relative to clip startSec=10 -> 0.5s and 2s
    expect(vf).toContain('gte(t,0.5)');
    expect(vf).toContain('gte(t,2)');
    expect(vf).toContain('rotate=');
    expect(vf).toContain("negate=enable='eq(mod(floor(n/2),2),1)'");
    expect(vf).toContain('fade=t=in:st=0:d=0.25:color=0xF5B942');
    expect(vf).toContain('fade=t=out:st=3.5:d=0.5:color=black');
    expect(vf).toContain('geq=');
  });

  it('executes startRangeRender (render_timeline_range) slicing [4s, 10s], reusing cached interior segments and saving to renders/previews', async () => {
    const a1 = '00000000-0000-4000-8000-000000000701';
    const a2 = '00000000-0000-4000-8000-000000000702';
    const a3 = '00000000-0000-4000-8000-000000000703';
    await fs.writeFile(path.join(tmpRoot, 'media', 'r1.mp4'), 'range-1');
    await fs.writeFile(path.join(tmpRoot, 'media', 'r2.mp4'), 'range-2');
    await fs.writeFile(path.join(tmpRoot, 'media', 'r3.mp4'), 'range-3');

    const { svc, ffmpegCalls, ingestedAssets } = createHarness({
      assetFiles: {
        [a1]: { type: 'video', relPath: 'media/r1.mp4' },
        [a2]: { type: 'video', relPath: 'media/r2.mp4' },
        [a3]: { type: 'video', relPath: 'media/r3.mp4' },
      },
    });

    const clip1 = makeClip({ id: 'rc1', assetId: a1, title: 'Shot 1', startSec: 0, durationSec: 4 });
    const clip2 = makeClip({ id: 'rc2', assetId: a2, title: 'Shot 2', startSec: 4, durationSec: 4 });
    const clip3 = makeClip({ id: 'rc3', assetId: a3, title: 'Shot 3', startSec: 8, durationSec: 4 });

    const fullTimeline: TimelineDto = {
      projectId: '00000000-0000-4000-8000-000000000001',
      projectSlug: 'test-film',
      fps: 24,
      resolution: '1280x720',
      qualityMode: 'draft_proxy',
      totalDurationSec: 12,
      renders: [],
      tracks: [
        {
          id: 't-v1',
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 0,
          clips: [clip1, clip2, clip3],
        },
      ],
    };

    vi.spyOn(svc, 'getTimeline').mockResolvedValue(fullTimeline);

    // Pre-populate cache via full render first
    const runPipeline = (svc as unknown as {
      runFfmpegRenderPipeline: (p: Record<string, unknown>) => Promise<void>;
    }).runFfmpegRenderPipeline.bind(svc);
    await runPipeline({
      renderId: 'r-full',
      jobId: 'j-full',
      projectId: fullTimeline.projectId,
      projectSlug: 'test-film',
      timeline: fullTimeline,
      videoClips: [clip1, clip2, clip3],
      qualityMode: 'draft_proxy',
      resolution: '1280x720',
      fps: 24,
      actor: 'claude',
    });

    ffmpegCalls.length = 0;
    ingestedAssets.length = 0;

    // Now render ONLY [4s -> 10s]: clip2 (4..8s) is 100% cache hit, clip3 (8..10s trimmed) renders 1 segment!
    const res = await svc.startRangeRender(
      'test-film',
      { startSec: 4, endSec: 10, resolution: '1280x720' },
      'claude',
    );
    expect(res).not.toBeNull();
    expect(res!.clipCount).toBe(2);

    // Wait briefly for background async pipeline to finish
    await new Promise((r) => setTimeout(r, 80));

    // Only 1 new segment encoded (trimmed clip3) + 1 concat = 2 FFmpeg calls (clip2 reused cache!)
    expect(ffmpegCalls).toHaveLength(2);
    expect(ingestedAssets[0]).toMatchObject({
      folderPath: 'renders/previews',
      tags: expect.arrayContaining(['preview', 'range']),
    });
  });
});

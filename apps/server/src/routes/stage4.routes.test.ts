import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineDto, TimelineRenderDto } from '@videostudio/shared';
import type { Stage4Service } from '../services/stage4.service.js';
import { registerStage4Routes } from './stage4.routes.js';

const SAMPLE_TIMELINE: TimelineDto = {
  projectId: '00000000-0000-4000-8000-000000000010',
  projectSlug: 'demo-film',
  fps: 24,
  resolution: '1920x1080',
  qualityMode: 'draft_proxy',
  totalDurationSec: 8,
  tracks: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      projectId: '00000000-0000-4000-8000-000000000010',
      name: 'V1 · Animatique',
      type: 'video',
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: 0,
      clips: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          trackId: '00000000-0000-4000-8000-000000000201',
          projectId: '00000000-0000-4000-8000-000000000010',
          assetId: '00000000-0000-4000-8000-000000000401',
          assetRef: '@img-001',
          assetTitle: 'Plan 01',
          assetType: 'image',
          assetQualityTier: 'draft_lowres',
          title: 'S01 · Ouverture',
          startSec: 0,
          durationSec: 4,
          inSec: 0,
          outSec: null,
          transition: 'cut',
          transitionDurationSec: 0,
          volume: 1,
          muted: false,
          notes: '',
          sortOrder: 0,
        },
      ],
    },
  ],
  renders: [],
};

const SAMPLE_RENDER: TimelineRenderDto = {
  id: '00000000-0000-4000-8000-000000000501',
  projectId: SAMPLE_TIMELINE.projectId,
  qualityMode: 'draft_proxy',
  resolution: '1280x720',
  fps: 24,
  status: 'rendering',
  progress: 5,
  outputAssetId: null,
  outputAssetHandle: null,
  durationSec: 8,
  errorMessage: null,
  createdAt: '2026-11-27T12:00:00.000Z',
  completedAt: null,
};

describe('Stage 4 Timeline & NLE Export REST routes', () => {
  it('supports get, save, build from storyboard, quality swap, render, and NLE export', async () => {
    const app = Fastify({ logger: false });
    const stage4Mock = {
      getTimeline: vi.fn().mockResolvedValue(SAMPLE_TIMELINE),
      saveTimeline: vi.fn().mockResolvedValue(SAMPLE_TIMELINE),
      buildTimelineFromStoryboard: vi.fn().mockResolvedValue(SAMPLE_TIMELINE),
      swapTimelineQualityMode: vi.fn().mockResolvedValue({
        timeline: { ...SAMPLE_TIMELINE, qualityMode: 'hq_master' },
        swappedCount: 1,
      }),
      startServerRender: vi.fn().mockResolvedValue({
        render: SAMPLE_RENDER,
        jobId: '00000000-0000-4000-8000-000000000601',
      }),
      exportNle: vi.fn().mockResolvedValue({
        filename: 'demo-film-timeline.otio',
        mimeType: 'application/json; charset=utf-8',
        content: '{"OTIO_SCHEMA":"Timeline.1"}',
      }),
    } as unknown as Stage4Service;

    registerStage4Routes(app, stage4Mock);

    const getRes = await app.inject({ method: 'GET', url: '/api/projects/demo-film/timeline' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().timeline.projectSlug).toBe('demo-film');

    const saveRes = await app.inject({
      method: 'PUT',
      url: '/api/projects/demo-film/timeline',
      payload: {
        qualityMode: 'draft_proxy',
        tracks: [
          {
            name: 'V1',
            type: 'video',
            clips: [{ title: 'S01', startSec: 0, durationSec: 4 }],
          },
        ],
      },
    });
    expect(saveRes.statusCode).toBe(200);

    const buildRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/timeline/from-storyboard',
      payload: { includeAudio: true },
    });
    expect(buildRes.statusCode).toBe(201);

    const swapRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/timeline/quality-mode',
      payload: { mode: 'hq_master' },
    });
    expect(swapRes.statusCode).toBe(200);
    expect(swapRes.json().swappedCount).toBe(1);

    const renderRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/timeline/render',
      payload: { qualityMode: 'draft_proxy' },
    });
    expect(renderRes.statusCode).toBe(202);
    expect(renderRes.json().render.status).toBe('rendering');

    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo-film/timeline/export?format=otio&download=1',
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.headers['content-disposition']).toContain('demo-film-timeline.otio');
    expect(exportRes.body).toContain('Timeline.1');

    const badFormat = await app.inject({
      method: 'GET',
      url: '/api/projects/demo-film/timeline/export?format=invalid',
    });
    expect(badFormat.statusCode).toBe(400);

    await app.close();
  });

  it('supports synchronized subtitles get, save, import, export, and burnSubtitles render flag', async () => {
    const app = Fastify({ logger: false });
    const sampleSubs = {
      projectId: SAMPLE_TIMELINE.projectId,
      language: 'fr',
      cues: [{ id: 'c1', startSec: 1, endSec: 3.5, text: 'Bonjour la taverne', speaker: 'Elara' }],
      style: {
        fontSize: 24,
        position: 'bottom' as const,
        color: '#FFFFFF',
        outlineColor: '#000000',
        backgroundOpacity: 0.55,
      },
      updatedAt: '2026-11-28T10:00:00.000Z',
    };

    const stage4Mock = {
      getSubtitles: vi.fn().mockResolvedValue(sampleSubs),
      saveSubtitles: vi.fn().mockResolvedValue(sampleSubs),
      importSubtitles: vi.fn().mockResolvedValue({ subtitles: sampleSubs, importedCount: 1 }),
      exportSubtitles: vi.fn().mockResolvedValue({
        filename: 'demo-film-fr.srt',
        mimeType: 'application/x-subrip; charset=utf-8',
        content: '1\n00:00:01,000 --> 00:00:03,500\nElara: Bonjour la taverne',
      }),
      saveSubtitlesAsset: vi.fn().mockResolvedValue({
        filename: 'demo-film-fr.srt',
        asset: { id: 'a-sub', handle: '@doc-005' },
      }),
      startServerRender: vi.fn().mockResolvedValue({
        render: SAMPLE_RENDER,
        jobId: '00000000-0000-4000-8000-000000000602',
      }),
    } as unknown as Stage4Service;

    registerStage4Routes(app, stage4Mock);

    const getRes = await app.inject({ method: 'GET', url: '/api/projects/demo-film/subtitles' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().subtitles.cues).toHaveLength(1);

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/projects/demo-film/subtitles',
      payload: { language: 'fr', cues: sampleSubs.cues },
    });
    expect(putRes.statusCode).toBe(200);

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/subtitles/import',
      payload: { source: 'storyboard', replace: true },
    });
    expect(importRes.statusCode).toBe(201);
    expect(importRes.json().importedCount).toBe(1);

    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo-film/subtitles/export?format=srt&download=1',
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.body).toContain('00:00:01,000 --> 00:00:03,500');

    const saveAssetRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/subtitles/save-asset',
      payload: { format: 'srt' },
    });
    expect(saveAssetRes.statusCode).toBe(201);
    expect(saveAssetRes.json().asset.handle).toBe('@doc-005');

    const burnRenderRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/timeline/render',
      payload: { qualityMode: 'hq_master', burnSubtitles: true },
    });
    expect(burnRenderRes.statusCode).toBe(202);
    expect(stage4Mock.startServerRender).toHaveBeenCalledWith(
      'demo-film',
      { qualityMode: 'hq_master', burnSubtitles: true },
      'user',
    );

    await app.close();
  });

  it('supports CapCut surgical clip add, patch, split, ripple delete, and render cache clear', async () => {
    const app = Fastify({ logger: false });
    const sampleClip = SAMPLE_TIMELINE.tracks[0]!.clips[0]!;
    const stage4Mock = {
      addClip: vi.fn().mockResolvedValue({ timeline: SAMPLE_TIMELINE, clip: sampleClip }),
      updateClip: vi.fn().mockResolvedValue({
        timeline: SAMPLE_TIMELINE,
        clip: { ...sampleClip, speed: 1.5, transition: 'wipe_left' },
      }),
      splitClip: vi.fn().mockResolvedValue({
        timeline: SAMPLE_TIMELINE,
        leftClip: { ...sampleClip, durationSec: 2 },
        rightClip: { ...sampleClip, id: '00000000-0000-4000-8000-000000000302', startSec: 2, durationSec: 2 },
      }),
      deleteClip: vi.fn().mockResolvedValue({
        timeline: SAMPLE_TIMELINE,
        deletedClipId: sampleClip.id,
      }),
      clearRenderCache: vi.fn().mockResolvedValue({ clearedFiles: 5 }),
    } as unknown as Stage4Service;

    registerStage4Routes(app, stage4Mock);

    const addRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo-film/timeline/clips',
      payload: {
        trackType: 'video',
        assetRef: '@img-001',
        title: 'S01 · Ouverture',
        durationSec: 4,
        effects: [{ effectSlug: 'cinema-teal-orange', enabled: true, intensity: 1, params: {} }],
      },
    });
    expect(addRes.statusCode).toBe(201);
    expect(addRes.json().clip.title).toBe('S01 · Ouverture');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/projects/demo-film/timeline/clips/${sampleClip.id}`,
      payload: { speed: 1.5, transition: 'wipe_left', transitionDurationSec: 0.6 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().clip.speed).toBe(1.5);

    const splitRes = await app.inject({
      method: 'POST',
      url: `/api/projects/demo-film/timeline/clips/${sampleClip.id}/split`,
      payload: { splitAtSec: 2 },
    });
    expect(splitRes.statusCode).toBe(200);
    expect(splitRes.json().leftClip.durationSec).toBe(2);
    expect(splitRes.json().rightClip.startSec).toBe(2);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/projects/demo-film/timeline/clips/${sampleClip.id}?ripple=true`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(stage4Mock.deleteClip).toHaveBeenCalledWith(
      'demo-film',
      sampleClip.id,
      { ripple: true },
      'user',
    );

    const clearCacheRes = await app.inject({
      method: 'DELETE',
      url: '/api/projects/demo-film/timeline/render-cache',
    });
    expect(clearCacheRes.statusCode).toBe(200);
    expect(clearCacheRes.json().clearedFiles).toBe(5);

    await app.close();
  });
});

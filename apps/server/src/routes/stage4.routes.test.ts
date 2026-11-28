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
});

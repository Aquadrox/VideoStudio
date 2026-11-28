import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createEmptySketchScene, type SketchDto } from '@videostudio/shared';
import type { SketchService } from '../services/sketch.service.js';
import { registerSketchRoutes } from './sketch.routes.js';

function makeSampleSketch(overrides: Partial<SketchDto> = {}): SketchDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    assetId: '33333333-3333-4333-8333-333333333333',
    assetRef: '@img-007',
    assetHandle: 'demo/@img-007',
    assetUrl: '/api/assets/33333333-3333-4333-8333-333333333333/file',
    assetThumbnailUrl: '/api/assets/33333333-3333-4333-8333-333333333333/thumb',
    shotId: null,
    shotTitle: null,
    shotHandle: null,
    sceneId: null,
    inSketchBoard: true,
    boardOrder: 0,
    durationSec: 3,
    caption: 'Entrée du héros',
    title: 'Plan S01 — Entrée taverne',
    mode: 'scene_plan',
    aspectRatio: '16:9',
    folderPath: 'plans',
    sceneData: createEmptySketchScene('scene_plan'),
    aiDirectorBrief: '[BRIEF RÉALISATION — PLAN DE SCÈNE (BLOCKING) | Format 16:9]',
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('Sketch & Sketch Storyboard REST routes', () => {
  it('lists, creates, fetches by asset, updates, reorders board, links shot, syncs storyboard, and deletes cleanly', async () => {
    const sample = makeSampleSketch();
    const linked = makeSampleSketch({
      shotId: '44444444-4444-4444-8444-444444444444',
      shotTitle: 'Plan S01 — Entrée taverne',
      shotHandle: '@shot-001',
      sceneId: '55555555-5555-4555-8555-555555555555',
    });

    const mockService = {
      listSketches: vi.fn(async () => [sample]),
      getSketchById: vi.fn(async (id: string) => (id === sample.id ? sample : null)),
      getSketchByAssetId: vi.fn(async (assetId: string) =>
        assetId === sample.assetId ? sample : null,
      ),
      createSketch: vi.fn(async () => sample),
      updateSketch: vi.fn(async (id: string) =>
        id === sample.id ? { ...sample, title: 'Plan S01 v2' } : null,
      ),
      reorderSketchBoard: vi.fn(async () => [{ ...sample, boardOrder: 2, durationSec: 4.5 }]),
      linkSketchToShot: vi.fn(async (id: string) => (id === sample.id ? linked : null)),
      syncSketchBoardToStoryboard: vi.fn(async () => ({
        sceneId: '55555555-5555-4555-8555-555555555555',
        sceneTitle: 'Storyboard Croquis',
        createdCount: 1,
        updatedCount: 0,
        sketches: [linked],
      })),
      deleteSketch: vi.fn(async (id: string) => id === sample.id),
    } as unknown as SketchService;

    const app = Fastify({ logger: false });
    registerSketchRoutes(app, mockService);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/sketches',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().sketches).toHaveLength(1);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/sketches',
      payload: {
        title: 'Plan S01 — Entrée taverne',
        mode: 'scene_plan',
        aspectRatio: '16:9',
        inSketchBoard: true,
        durationSec: 3,
        caption: 'Entrée du héros',
        sceneData: createEmptySketchScene('scene_plan'),
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().sketch.assetRef).toBe('@img-007');

    const badCreateRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/sketches',
      payload: { title: '' },
    });
    expect(badCreateRes.statusCode).toBe(400);

    const reorderRes = await app.inject({
      method: 'PATCH',
      url: '/api/projects/demo/sketches/board-order',
      payload: {
        items: [{ sketchId: sample.id, boardOrder: 2, durationSec: 4.5, inSketchBoard: true }],
      },
    });
    expect(reorderRes.statusCode).toBe(200);
    expect(reorderRes.json().sketches[0].boardOrder).toBe(2);

    const linkRes = await app.inject({
      method: 'POST',
      url: `/api/sketches/${sample.id}/link-shot`,
      payload: {
        newSceneTitle: 'Scène 1',
        syncKeyframe: true,
        syncBrief: true,
      },
    });
    expect(linkRes.statusCode).toBe(200);
    expect(linkRes.json().sketch.shotHandle).toBe('@shot-001');

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/sketches/sync-to-storyboard',
      payload: { newSceneTitle: 'Storyboard Croquis' },
    });
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.json().createdCount).toBe(1);

    const byAssetRes = await app.inject({
      method: 'GET',
      url: `/api/assets/${sample.assetId}/sketch`,
    });
    expect(byAssetRes.statusCode).toBe(200);
    expect(byAssetRes.json().sketch.id).toBe(sample.id);

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/sketches/${sample.id}`,
      payload: {
        title: 'Plan S01 v2',
        mode: 'scene_plan',
        aspectRatio: '16:9',
        sceneData: createEmptySketchScene('scene_plan'),
        saveMode: 'new_version',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().sketch.title).toBe('Plan S01 v2');

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/sketches/${sample.id}?deleteAsset=false`,
    });
    expect(delRes.statusCode).toBe(204);

    await app.close();
  });
});

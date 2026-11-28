import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { VideoEffectDto } from '@videostudio/shared';
import { registerEffectsRoutes } from './effects.routes.js';
import type { EffectsService } from '../services/effects.service.js';

function makeEffect(overrides: Partial<VideoEffectDto> = {}): VideoEffectDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'retro-neon-pulse',
    name: 'Retro Neon Pulse',
    category: 'video_fx',
    description: 'Effet custom néon créé par IA',
    icon: '⚡',
    ffmpegFilterTemplate: 'rgbashift=rh={{shift}}:bh=-{{shift}},eq=saturation=1.4',
    cssPreviewFilter: 'saturate(1.4) contrast(1.15)',
    paramsSchema: [
      { key: 'shift', label: 'RGB Shift', type: 'number', min: 1, max: 20, step: 1, default: 6 },
    ],
    defaultParams: { shift: 6 },
    createdBy: 'claude',
    isBuiltin: false,
    tags: ['neon', 'custom'],
    usageCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('effects.routes', () => {
  it('lists, creates, updates, and deletes custom effects', async () => {
    const app = Fastify();
    const effect = makeEffect();
    const mockService = {
      listEffects: vi.fn().mockResolvedValue([effect]),
      getEffectByIdOrSlug: vi.fn().mockResolvedValue(effect),
      createEffect: vi.fn().mockResolvedValue(effect),
      updateEffect: vi.fn().mockResolvedValue({ ...effect, name: 'Retro Neon v2' }),
      deleteEffect: vi.fn().mockResolvedValue(true),
    } as unknown as EffectsService;

    registerEffectsRoutes(app, mockService);

    const listRes = await app.inject({ method: 'GET', url: '/api/effects?category=video_fx' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().effects).toHaveLength(1);
    expect(mockService.listEffects).toHaveBeenCalledWith({
      category: 'video_fx',
      query: undefined,
      createdBy: undefined,
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/effects',
      payload: {
        name: 'Retro Neon Pulse',
        category: 'video_fx',
        ffmpegFilterTemplate: 'rgbashift=rh={{shift}}:bh=-{{shift}}',
        paramsSchema: [{ key: 'shift', label: 'RGB Shift', type: 'number', min: 1, max: 20, default: 6 }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().effect.slug).toBe('retro-neon-pulse');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/effects/retro-neon-pulse',
      payload: { name: 'Retro Neon v2' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().effect.name).toBe('Retro Neon v2');

    const delRes = await app.inject({ method: 'DELETE', url: '/api/effects/retro-neon-pulse' });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });

    await app.close();
  });

  it('returns 400 when EffectsService rejects an unsafe FFmpeg template', async () => {
    const app = Fastify();
    const mockService = {
      createEffect: vi.fn().mockRejectedValue(new Error('Filtre FFmpeg interdit')),
    } as unknown as EffectsService;

    registerEffectsRoutes(app, mockService);

    const res = await app.inject({
      method: 'POST',
      url: '/api/effects',
      payload: {
        name: 'Evil FX',
        ffmpegFilterTemplate: 'movie=/etc/passwd',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('interdit');

    await app.close();
  });
});

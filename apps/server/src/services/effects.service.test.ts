import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/index.js';
import { EffectsService } from './effects.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { StudioService } from './studio.service.js';

function makeDbRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'neon-pulse',
    name: 'Neon Pulse',
    category: 'video_fx',
    description: 'Effet néon IA',
    icon: '⚡',
    ffmpegFilterTemplate: 'rgbashift=rh={{shift}}:bh=-{{shift}}',
    cssPreviewFilter: 'saturate(1.4)',
    paramsSchema: [
      { key: 'shift', label: 'Shift', type: 'number', min: 1, max: 20, step: 1, default: 6 },
    ],
    defaultParams: { shift: 6 },
    createdBy: 'claude',
    isBuiltin: false,
    tags: ['neon', 'ai'],
    usageCount: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('EffectsService — Custom AI/User Effects Security & Lifecycle', () => {
  it('rejects unsafe FFmpeg filter templates on create and update before touching DB', async () => {
    const db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    } as unknown as Database;
    const studio = { logActivity: vi.fn() } as unknown as StudioService;
    const realtime = { broadcast: vi.fn() } as unknown as RealtimeHub;
    const service = new EffectsService(db, studio, realtime);

    await expect(
      service.createEffect(
        {
          name: 'Malicious',
          category: 'video_fx',
          description: '',
          icon: '💀',
          ffmpegFilterTemplate: 'movie=/etc/passwd',
          cssPreviewFilter: '',
          paramsSchema: [],
          defaultParams: {},
          tags: [],
        },
        'claude',
      ),
    ).rejects.toThrow(/sécurité|autorisé/i);

    expect(db.insert).not.toHaveBeenCalled();

    // Update with dangerous payload must also throw
    vi.spyOn(service, 'getEffectByIdOrSlug').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'neon-pulse',
      name: 'Neon Pulse',
      category: 'video_fx',
      description: '',
      icon: '⚡',
      ffmpegFilterTemplate: 'eq=contrast=1.2',
      cssPreviewFilter: '',
      paramsSchema: [],
      defaultParams: {},
      createdBy: 'claude',
      isBuiltin: false,
      tags: [],
      usageCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await expect(
      service.updateEffect('neon-pulse', { ffmpegFilterTemplate: 'eq=contrast=1.2; sendcmd=f=x' }, 'claude'),
    ).rejects.toThrow(/interdits/i);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('deduplicates slugs, merges defaultParams from paramsSchema, broadcasts WS event, and logs actor', async () => {
    let selectCalls = 0;
    const insertedValues: Array<Record<string, unknown>> = [];

    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              selectCalls += 1;
              // First check finds collision for 'neon-pulse', second check is free for 'neon-pulse-2'
              return selectCalls === 1 ? [{ id: 'existing' }] : [];
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => {
          insertedValues.push(vals);
          return {
            returning: vi.fn(async () => [
              makeDbRow({
                slug: vals.slug,
                defaultParams: vals.defaultParams,
                createdBy: vals.createdBy,
                isBuiltin: vals.isBuiltin,
              }),
            ]),
          };
        }),
      })),
    } as unknown as Database;

    const studio = { logActivity: vi.fn().mockResolvedValue(undefined) } as unknown as StudioService;
    const realtime = { broadcast: vi.fn() } as unknown as RealtimeHub;
    const service = new EffectsService(db, studio, realtime);

    const created = await service.createEffect(
      {
        name: 'Neon Pulse',
        category: 'video_fx',
        description: 'Effet IA',
        icon: '⚡',
        ffmpegFilterTemplate: 'rgbashift=rh={{shift}}:bh=-{{shift}}',
        cssPreviewFilter: 'saturate(1.4)',
        paramsSchema: [{ key: 'shift', label: 'Shift', type: 'number', min: 1, max: 20, default: 8 }],
        defaultParams: {},
        tags: ['neon'],
      },
      'claude',
    );

    expect(created.slug).toBe('neon-pulse-2');
    expect(insertedValues[0]?.defaultParams).toEqual({ shift: 8 });
    expect(insertedValues[0]?.createdBy).toBe('claude');
    expect(insertedValues[0]?.isBuiltin).toBe(false);
    expect(realtime.broadcast).toHaveBeenCalledWith({
      type: 'effects.changed',
      payload: { effectId: created.id, slug: 'neon-pulse-2' },
    });
    expect(studio.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'claude', action: 'effect.created' }),
    );
  });

  it('protects builtin effects from deletion while allowing custom effect deletion', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      delete: vi.fn(() => ({ where: deleteWhere })),
    } as unknown as Database;
    const studio = { logActivity: vi.fn().mockResolvedValue(undefined) } as unknown as StudioService;
    const realtime = { broadcast: vi.fn() } as unknown as RealtimeHub;
    const service = new EffectsService(db, studio, realtime);

    vi.spyOn(service, 'getEffectByIdOrSlug').mockResolvedValueOnce({
      id: 'b1',
      slug: 'cinema-teal-orange',
      name: 'Cinéma Teal & Orange',
      category: 'color_grade',
      description: '',
      icon: '🎬',
      ffmpegFilterTemplate: 'eq=contrast=1.1',
      cssPreviewFilter: '',
      paramsSchema: [],
      defaultParams: {},
      createdBy: 'system',
      isBuiltin: true,
      tags: [],
      usageCount: 10,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await expect(service.deleteEffect('cinema-teal-orange', 'user')).rejects.toThrow(/intégré/i);
    expect(deleteWhere).not.toHaveBeenCalled();

    vi.spyOn(service, 'getEffectByIdOrSlug').mockResolvedValueOnce({
      id: 'c1',
      slug: 'my-custom-fx',
      name: 'My Custom FX',
      category: 'video_fx',
      description: '',
      icon: '✨',
      ffmpegFilterTemplate: 'eq=contrast=1.2',
      cssPreviewFilter: '',
      paramsSchema: [],
      defaultParams: {},
      createdBy: 'user',
      isBuiltin: false,
      tags: [],
      usageCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const deleted = await service.deleteEffect('my-custom-fx', 'user');
    expect(deleted).toBe(true);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(realtime.broadcast).toHaveBeenCalledWith({
      type: 'effects.changed',
      payload: { effectId: 'c1', slug: 'my-custom-fx' },
    });
  });

  it('filters effects by category, createdBy, and free-text query', async () => {
    const rows = [
      makeDbRow({ id: '1', slug: 'vhs-retro', name: 'VHS Rétro', category: 'video_fx', createdBy: 'system', isBuiltin: true, tags: ['analog'] }),
      makeDbRow({ id: '2', slug: 'ai-cyber', name: 'Cyber Pulse', category: 'color_grade', createdBy: 'claude', tags: ['cyberpunk'] }),
      makeDbRow({ id: '3', slug: 'user-echo', name: 'Mon Écho', category: 'audio_fx', createdBy: 'user', tags: ['voice'] }),
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue(rows),
        })),
      })),
    } as unknown as Database;

    const service = new EffectsService(db, {} as StudioService, {} as RealtimeHub);

    expect(await service.listEffects({ createdBy: 'claude' })).toHaveLength(1);
    expect(await service.listEffects({ category: 'audio_fx' })).toHaveLength(1);
    expect(await service.listEffects({ query: 'cyberpunk' })).toHaveLength(1);
    expect(await service.listEffects({ query: 'nonexistent' })).toHaveLength(0);
  });
});

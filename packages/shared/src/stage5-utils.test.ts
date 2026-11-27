import { describe, expect, it } from 'vitest';
import { filterCommandPaletteItems, isAssetEligibleForCleanup } from './stage5-utils.js';

describe('isAssetEligibleForCleanup safety invariants', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  const tenDaysAgo = '2026-11-17T12:00:00.000Z';
  const oneDayAgo = '2026-11-26T12:00:00.000Z';

  const defaultPolicy = {
    olderThanDays: 7,
    statuses: ['needs_revision', 'archived'] as Array<'needs_revision' | 'archived'>,
    qualityTiers: ['test', 'draft_lowres'] as Array<'test' | 'draft_lowres'>,
  };

  it('allows old rejected test assets stored in data/', () => {
    expect(
      isAssetEligibleForCleanup(
        {
          status: 'needs_revision',
          qualityTier: 'test',
          filePath: 'projects/demo/originals/test.png',
          createdAt: tenDaysAgo,
        },
        defaultPolicy,
        now,
      ),
    ).toBe(true);
  });

  it('NEVER allows approved, winner, final_master, or referenced ingest:// files', () => {
    const aggressivePolicy = {
      olderThanDays: 0,
      statuses: ['approved', 'winner', 'needs_revision', 'archived'] as Array<
        'approved' | 'winner' | 'needs_revision' | 'archived'
      >,
      qualityTiers: ['test', 'draft_lowres', 'hq_upscale', 'final_master'] as Array<
        'test' | 'draft_lowres' | 'hq_upscale' | 'final_master'
      >,
    };

    expect(
      isAssetEligibleForCleanup(
        { status: 'approved', qualityTier: 'test', filePath: 'projects/p/a.png', createdAt: tenDaysAgo },
        aggressivePolicy,
        now,
      ),
    ).toBe(false);

    expect(
      isAssetEligibleForCleanup(
        { status: 'winner', qualityTier: 'test', filePath: 'projects/p/a.png', createdAt: tenDaysAgo },
        aggressivePolicy,
        now,
      ),
    ).toBe(false);

    expect(
      isAssetEligibleForCleanup(
        { status: 'archived', qualityTier: 'final_master', filePath: 'projects/p/a.mp4', createdAt: tenDaysAgo },
        aggressivePolicy,
        now,
      ),
    ).toBe(false);

    expect(
      isAssetEligibleForCleanup(
        { status: 'archived', qualityTier: 'test', filePath: 'ingest://batch/a.png', createdAt: tenDaysAgo },
        aggressivePolicy,
        now,
      ),
    ).toBe(false);

    expect(
      isAssetEligibleForCleanup(
        { status: 'archived', qualityTier: 'test', filePath: 'ingest-root://1/a.png', createdAt: tenDaysAgo },
        aggressivePolicy,
        now,
      ),
    ).toBe(false);
  });

  it('respects olderThanDays cutoff', () => {
    expect(
      isAssetEligibleForCleanup(
        {
          status: 'needs_revision',
          qualityTier: 'test',
          filePath: 'projects/demo/originals/recent.png',
          createdAt: oneDayAgo,
        },
        defaultPolicy,
        now,
      ),
    ).toBe(false);
  });
});

describe('filterCommandPaletteItems', () => {
  const items = [
    { id: 'tab-timeline', label: 'Ouvrir Timeline', category: 'Navigation', keywords: ['nle', 'animatique'] },
    { id: 'asset-1', label: 'Plan 04 pluie', subtitle: '@img-004', category: 'Média', keywords: ['keyframe'] },
    { id: 'ops-backup', label: 'Créer une sauvegarde', category: 'Exploitation', keywords: ['backup', 'pg_dump'] },
  ];

  it('matches by label, subtitle handle, and keywords', () => {
    expect(filterCommandPaletteItems(items, '@img-004').map((i) => i.id)).toEqual(['asset-1']);
    expect(filterCommandPaletteItems(items, 'animatique').map((i) => i.id)).toEqual(['tab-timeline']);
    expect(filterCommandPaletteItems(items, 'backup').map((i) => i.id)).toEqual(['ops-backup']);
  });
});

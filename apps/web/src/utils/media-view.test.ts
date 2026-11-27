import { describe, expect, it } from 'vitest';
import {
  countRecentAssets,
  getAssetChangeKind,
  isAssetWithinRecentWindow,
  sortMediaAssets,
} from './media-view';

const NOW = new Date('2026-11-27T12:00:00Z').getTime();

function makeItem(overrides: Partial<{
  title: string;
  createdAt: string;
  updatedAt: string;
  rating: number;
  fileSize: number;
}> = {}) {
  return {
    title: 'Shot 01',
    createdAt: '2026-11-27T11:30:00Z',
    updatedAt: '2026-11-27T11:30:00Z',
    rating: 0,
    fileSize: 1000,
    ...overrides,
  };
}

describe('media-view utilities (view modes, sorting & recent changes)', () => {
  it('distinguishes newly added vs subsequently modified assets', () => {
    const added = makeItem({
      createdAt: '2026-11-27T11:00:00Z',
      updatedAt: '2026-11-27T11:00:10Z',
    });
    const modified = makeItem({
      createdAt: '2026-11-26T10:00:00Z',
      updatedAt: '2026-11-27T11:55:00Z',
    });

    expect(getAssetChangeKind(added)).toBe('added');
    expect(getAssetChangeKind(modified)).toBe('modified');
  });

  it('filters and counts assets within 1h, 24h, and 7d recent windows', () => {
    const halfHourAgo = makeItem({
      createdAt: '2026-11-27T11:30:00Z',
      updatedAt: '2026-11-27T11:30:00Z',
    });
    const tenHoursAgo = makeItem({
      createdAt: '2026-11-27T02:00:00Z',
      updatedAt: '2026-11-27T02:00:00Z',
    });
    const threeDaysAgo = makeItem({
      createdAt: '2026-11-24T12:00:00Z',
      updatedAt: '2026-11-24T12:00:00Z',
    });
    const oldModifiedRecently = makeItem({
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-27T11:45:00Z',
    });
    const veryOld = makeItem({
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    const list = [halfHourAgo, tenHoursAgo, threeDaysAgo, oldModifiedRecently, veryOld];

    expect(countRecentAssets(list, '1h', NOW)).toBe(2);
    expect(countRecentAssets(list, '24h', NOW)).toBe(3);
    expect(countRecentAssets(list, '7d', NOW)).toBe(4);
    expect(isAssetWithinRecentWindow(veryOld, 'off', NOW)).toBe(true);
    expect(isAssetWithinRecentWindow(veryOld, '7d', NOW)).toBe(false);
  });

  it('sorts assets accurately by updated, created, title, rating, and size', () => {
    const a = makeItem({
      title: 'Shot 10',
      createdAt: '2026-11-27T10:00:00Z',
      updatedAt: '2026-11-27T11:50:00Z',
      rating: 3,
      fileSize: 500,
    });
    const b = makeItem({
      title: 'Shot 2',
      createdAt: '2026-11-27T11:40:00Z',
      updatedAt: '2026-11-27T11:40:00Z',
      rating: 5,
      fileSize: 2000,
    });
    const c = makeItem({
      title: 'Alpha',
      createdAt: '2026-11-26T09:00:00Z',
      updatedAt: '2026-11-26T09:00:00Z',
      rating: 1,
      fileSize: 5000,
    });

    expect(sortMediaAssets([c, b, a], 'updated_desc').map((x) => x.title)).toEqual([
      'Shot 10',
      'Shot 2',
      'Alpha',
    ]);
    expect(sortMediaAssets([c, a, b], 'created_desc').map((x) => x.title)).toEqual([
      'Shot 2',
      'Shot 10',
      'Alpha',
    ]);
    expect(sortMediaAssets([a, b, c], 'title_asc').map((x) => x.title)).toEqual([
      'Alpha',
      'Shot 2',
      'Shot 10',
    ]);
    expect(sortMediaAssets([a, c, b], 'rating_desc').map((x) => x.title)).toEqual([
      'Shot 2',
      'Shot 10',
      'Alpha',
    ]);
    expect(sortMediaAssets([a, b, c], 'size_desc').map((x) => x.title)).toEqual([
      'Alpha',
      'Shot 2',
      'Shot 10',
    ]);
  });
});

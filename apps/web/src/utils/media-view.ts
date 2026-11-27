import type { AssetDto } from '@videostudio/shared';

export type MediaViewMode = 'grid' | 'large' | 'list' | 'details';
export type MediaSortBy = 'updated_desc' | 'created_desc' | 'title_asc' | 'rating_desc' | 'size_desc';
export type RecentWindow = 'off' | '1h' | '24h' | '7d';

export const RECENT_WINDOW_MS: Record<Exclude<RecentWindow, 'off'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export const RECENT_WINDOW_LABELS: Record<Exclude<RecentWindow, 'off'>, string> = {
  '1h': 'Dernière heure',
  '24h': 'Dernières 24 h',
  '7d': '7 derniers jours',
};

export function getAssetActivityTimestamp(asset: Pick<AssetDto, 'createdAt' | 'updatedAt'>): number {
  const createdMs = new Date(asset.createdAt).getTime();
  const updatedMs = new Date(asset.updatedAt).getTime();
  return Math.max(
    Number.isFinite(createdMs) ? createdMs : 0,
    Number.isFinite(updatedMs) ? updatedMs : 0,
  );
}

/**
 * Distinguishes newly added assets from assets modified after creation (> 30s delta).
 */
export function getAssetChangeKind(
  asset: Pick<AssetDto, 'createdAt' | 'updatedAt'>,
): 'added' | 'modified' {
  const createdMs = new Date(asset.createdAt).getTime();
  const updatedMs = new Date(asset.updatedAt).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(updatedMs)) return 'added';
  return updatedMs - createdMs > 30_000 ? 'modified' : 'added';
}

export function isAssetWithinRecentWindow(
  asset: Pick<AssetDto, 'createdAt' | 'updatedAt'>,
  window: RecentWindow,
  nowMs: number = Date.now(),
): boolean {
  if (window === 'off') return true;
  const maxAgeMs = RECENT_WINDOW_MS[window];
  const activityMs = getAssetActivityTimestamp(asset);
  return nowMs - activityMs <= maxAgeMs;
}

export function countRecentAssets(
  assets: Array<Pick<AssetDto, 'createdAt' | 'updatedAt'>>,
  window: Exclude<RecentWindow, 'off'> = '24h',
  nowMs: number = Date.now(),
): number {
  let count = 0;
  for (const asset of assets) {
    if (isAssetWithinRecentWindow(asset, window, nowMs)) {
      count += 1;
    }
  }
  return count;
}

export function sortMediaAssets<T extends Pick<AssetDto, 'title' | 'createdAt' | 'updatedAt' | 'rating' | 'fileSize'>>(
  items: T[],
  sortBy: MediaSortBy,
): T[] {
  const copy = [...items];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'updated_desc': {
        const diff = getAssetActivityTimestamp(b) - getAssetActivityTimestamp(a);
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title, 'fr');
      }
      case 'created_desc': {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title, 'fr');
      }
      case 'title_asc':
        return a.title.localeCompare(b.title, 'fr', { numeric: true, sensitivity: 'base' });
      case 'rating_desc': {
        const diff = b.rating - a.rating;
        if (diff !== 0) return diff;
        return getAssetActivityTimestamp(b) - getAssetActivityTimestamp(a);
      }
      case 'size_desc': {
        const diff = b.fileSize - a.fileSize;
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title, 'fr');
      }
    }
  });
  return copy;
}

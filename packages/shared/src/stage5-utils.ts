import type { AssetStatus, QualityTier } from './schemas.js';

export interface CleanupEligibilityAsset {
  status: AssetStatus;
  qualityTier: QualityTier;
  filePath: string;
  createdAt: string | Date;
}

export interface CleanupEligibilityPolicy {
  olderThanDays: number;
  statuses: AssetStatus[];
  qualityTiers: QualityTier[];
}

const PROTECTED_STATUSES = new Set<AssetStatus>(['approved', 'winner']);
const PROTECTED_TIERS = new Set<QualityTier>(['final_master']);

/**
 * Pure safety gate for selective disk cleanup.
 * Guarantees that approved/winner assets, final_master renders, and read-only
 * referenced files (`ingest://`, `ingest-root://`) are NEVER eligible for deletion.
 */
export function isAssetEligibleForCleanup(
  asset: CleanupEligibilityAsset,
  policy: CleanupEligibilityPolicy,
  nowMs = Date.now(),
): boolean {
  if (PROTECTED_STATUSES.has(asset.status)) return false;
  if (PROTECTED_TIERS.has(asset.qualityTier)) return false;
  if (asset.filePath.startsWith('ingest://') || asset.filePath.startsWith('ingest-root://')) {
    return false;
  }

  if (policy.statuses.length > 0 && !policy.statuses.includes(asset.status)) {
    return false;
  }
  if (policy.qualityTiers.length > 0 && !policy.qualityTiers.includes(asset.qualityTier)) {
    return false;
  }

  const createdMs =
    asset.createdAt instanceof Date ? asset.createdAt.getTime() : Date.parse(asset.createdAt);
  if (Number.isNaN(createdMs)) return false;

  const cutoffMs = nowMs - Math.max(0, policy.olderThanDays) * 24 * 60 * 60 * 1000;
  return createdMs <= cutoffMs;
}

export interface CommandPaletteSearchItem {
  id: string;
  label: string;
  subtitle?: string;
  keywords?: string[];
  category: string;
}

/**
 * Ranks and filters command palette entries (`Cmd/Ctrl+K`) by case-insensitive token match.
 */
export function filterCommandPaletteItems<T extends CommandPaletteSearchItem>(
  items: T[],
  rawQuery: string,
  limit = 20,
): T[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return items.slice(0, limit);

  const tokens = query.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const haystack = [
      item.label,
      item.subtitle ?? '',
      item.category,
      ...(item.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();

    if (!tokens.every((t) => haystack.includes(t))) continue;

    let score = 0;
    const lowerLabel = item.label.toLowerCase();
    if (lowerLabel === query) score += 100;
    else if (lowerLabel.startsWith(query)) score += 60;
    else if (lowerLabel.includes(query)) score += 30;
    else score += 10;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((s) => s.item);
}

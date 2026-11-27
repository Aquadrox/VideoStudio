import type { AssetStatus, ProjectStatus, ProjectType, QualityTier } from '@videostudio/shared';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pre_production: 'Pré-production',
  production: 'Production',
  editing: 'Montage',
  youtube_ready: 'Prêt YouTube',
  published: 'Publié',
  archived: 'Archivé',
};

export const STATUS_LABELS: Record<AssetStatus, string> = {
  new: 'Nouveau',
  in_review: 'En revue',
  needs_revision: 'À refaire',
  approved: 'Approuvé',
  winner: 'Retenu (Winner)',
  archived: 'Archivé',
};

export const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  test: 'Test',
  draft_lowres: 'Draft Basse Rés.',
  hq_upscale: 'Haute Rés. / Upscale',
  final_master: 'Final Master',
};

export const QUALITY_TIER_SHORT: Record<QualityTier, string> = {
  test: 'TEST',
  draft_lowres: 'DRAFT',
  hq_upscale: 'HQ',
  final_master: 'FINAL',
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  youtube_long: 'YouTube Long (16:9)',
  youtube_short: 'YouTube Short (9:16)',
  music_video: 'Clip Musical',
  animation: 'Animation',
  commercial: 'Pub / Promo',
  experimental: 'Expérimental',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatRelativeTime(isoDate: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (diffSec < 10) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `il y a ${diffHr} h`;
  const diffDays = Math.floor(diffHr / 24);
  return `il y a ${diffDays} j`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for plain HTTP LAN access where navigator.clipboard may be restricted
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

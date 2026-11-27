import type { AssetType } from './schemas.js';

export interface ParsedStudioRef {
  raw: string;
  projectSlug?: string;
  entityType: 'project' | 'asset';
  refCode: string;
}

const ASSET_PREFIX_MAP: Record<AssetType, string> = {
  image: 'img',
  video: 'vid',
  audio: 'aud',
  document: 'doc',
};

export function slugifyProjectName(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized.length > 0 ? normalized : 'project';
}

export function formatAssetRefCode(type: AssetType, sequenceNumber: number, versionNumber = 1): string {
  const prefix = ASSET_PREFIX_MAP[type];
  const padded = String(sequenceNumber).padStart(3, '0');
  return versionNumber > 1 ? `${prefix}-${padded}-v${versionNumber}` : `${prefix}-${padded}`;
}

export function buildAssetHandle(refCode: string): string {
  return refCode.startsWith('@') ? refCode : `@${refCode}`;
}

export function buildStudioUri(projectSlug: string, entityType: 'project' | 'asset', refCode?: string): string {
  if (entityType === 'project') {
    return `studio://projects/${projectSlug}`;
  }
  return `studio://projects/${projectSlug}/assets/${refCode ?? ''}`;
}

/**
 * Parses a human or Claude-provided studio reference:
 * - "studio://projects/cyberpunk/assets/img-001"
 * - "studio://projects/cyberpunk"
 * - "@cyberpunk/img-001" or "cyberpunk/img-001"
 * - "@img-001" or "img-001"
 * - "@proj-cyberpunk"
 */
export function parseStudioRef(input: string): ParsedStudioRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Canonical URI: studio://projects/<slug>/assets/<refCode>
  const uriAssetMatch = /^studio:\/\/projects\/([a-z0-9-]+)\/assets\/([a-z0-9-]+)$/i.exec(trimmed);
  if (uriAssetMatch && uriAssetMatch[1] && uriAssetMatch[2]) {
    return {
      raw: trimmed,
      projectSlug: uriAssetMatch[1].toLowerCase(),
      entityType: 'asset',
      refCode: uriAssetMatch[2].toLowerCase(),
    };
  }

  // Canonical URI: studio://projects/<slug>
  const uriProjectMatch = /^studio:\/\/projects\/([a-z0-9-]+)$/i.exec(trimmed);
  if (uriProjectMatch && uriProjectMatch[1]) {
    return {
      raw: trimmed,
      projectSlug: uriProjectMatch[1].toLowerCase(),
      entityType: 'project',
      refCode: uriProjectMatch[1].toLowerCase(),
    };
  }

  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;

  // Project shorthand: proj-<slug>
  const projMatch = /^proj-([a-z0-9-]+)$/i.exec(withoutAt);
  if (projMatch && projMatch[1]) {
    return {
      raw: trimmed,
      projectSlug: projMatch[1].toLowerCase(),
      entityType: 'project',
      refCode: projMatch[1].toLowerCase(),
    };
  }

  // Scoped asset shorthand: <projectSlug>/<refCode>
  const scopedMatch = /^([a-z0-9-]+)\/([a-z0-9-]+)$/i.exec(withoutAt);
  if (scopedMatch && scopedMatch[1] && scopedMatch[2]) {
    return {
      raw: trimmed,
      projectSlug: scopedMatch[1].toLowerCase(),
      entityType: 'asset',
      refCode: scopedMatch[2].toLowerCase(),
    };
  }

  // Unscoped asset shorthand: img-001, vid-004-v2, aud-010, doc-002
  const assetMatch = /^((?:img|vid|aud|doc)-[0-9]{1,6}(?:-v[0-9]+)?)$/i.exec(withoutAt);
  if (assetMatch && assetMatch[1]) {
    return {
      raw: trimmed,
      entityType: 'asset',
      refCode: assetMatch[1].toLowerCase(),
    };
  }

  return null;
}

import { describe, expect, it } from 'vitest';
import {
  buildAssetHandle,
  buildStudioUri,
  formatAssetRefCode,
  parseStudioRef,
  slugifyProjectName,
} from './refs.js';

describe('studio ref helpers', () => {
  it('slugifies accented and spaced project names cleanly', () => {
    expect(slugifyProjectName('Épisode 01 : Cyber Café!')).toBe('episode-01-cyber-cafe');
    expect(slugifyProjectName('   ')).toBe('project');
  });

  it('formats asset reference codes with optional version suffix', () => {
    expect(formatAssetRefCode('image', 1)).toBe('img-001');
    expect(formatAssetRefCode('video', 12, 3)).toBe('vid-012-v3');
    expect(buildAssetHandle('img-001')).toBe('@img-001');
    expect(buildAssetHandle('@img-001')).toBe('@img-001');
  });

  it('builds and parses canonical studio:// URIs and @handles', () => {
    const uri = buildStudioUri('cyber-cafe', 'asset', 'img-004-v2');
    expect(uri).toBe('studio://projects/cyber-cafe/assets/img-004-v2');

    expect(parseStudioRef(uri)).toEqual({
      raw: uri,
      projectSlug: 'cyber-cafe',
      entityType: 'asset',
      refCode: 'img-004-v2',
    });

    expect(parseStudioRef('@img-004-v2')).toEqual({
      raw: '@img-004-v2',
      entityType: 'asset',
      refCode: 'img-004-v2',
    });

    expect(parseStudioRef('@cyber-cafe/vid-009')).toEqual({
      raw: '@cyber-cafe/vid-009',
      projectSlug: 'cyber-cafe',
      entityType: 'asset',
      refCode: 'vid-009',
    });

    expect(parseStudioRef('@proj-cyber-cafe')).toEqual({
      raw: '@proj-cyber-cafe',
      projectSlug: 'cyber-cafe',
      entityType: 'project',
      refCode: 'cyber-cafe',
    });

    expect(parseStudioRef('not a valid ref!!!')).toBeNull();
  });
});

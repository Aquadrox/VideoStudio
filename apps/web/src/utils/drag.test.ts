import { describe, expect, it } from 'vitest';
import {
  ASSET_DRAG_MIME,
  extractDraggedAssetId,
  getParentFolder,
  isExternalFileDrag,
} from './drag';

describe('drag helpers for moving assets into folders', () => {
  it('distinguishes external OS file drags from internal asset drags', () => {
    expect(isExternalFileDrag({ types: ['Files'] }, null)).toBe(true);
    expect(isExternalFileDrag({ types: ['Files'] }, 'asset-123')).toBe(false);
    expect(isExternalFileDrag({ types: [ASSET_DRAG_MIME, 'text/plain'] }, null)).toBe(false);
    expect(isExternalFileDrag({ types: [ASSET_DRAG_MIME, 'Files'] }, null)).toBe(false);
    expect(isExternalFileDrag({ types: ['text/plain'] }, null)).toBe(false);
  });

  it('extracts dragged asset id from DataTransfer with state fallback', () => {
    const dt = {
      getData: (type: string) => (type === ASSET_DRAG_MIME ? 'uuid-1' : ''),
    };
    expect(extractDraggedAssetId(dt, 'uuid-fallback')).toBe('uuid-1');
    expect(extractDraggedAssetId({ getData: () => '' }, 'uuid-fallback')).toBe('uuid-fallback');
    expect(extractDraggedAssetId(null, null)).toBeNull();
  });

  it('computes parent folder paths accurately', () => {
    expect(getParentFolder('')).toBe('');
    expect(getParentFolder('personnages')).toBe('');
    expect(getParentFolder('sc01/drafts')).toBe('sc01');
    expect(getParentFolder('/sc01/drafts/v2/')).toBe('sc01/drafts');
  });
});

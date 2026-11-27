import { describe, expect, it } from 'vitest';
import {
  ASSET_DRAG_MIME,
  ASSET_LIST_DRAG_MIME,
  computeMultiSelection,
  extractDraggedAssetId,
  extractDraggedAssetIds,
  getParentFolder,
  isExternalFileDrag,
  resolveDragAssetIds,
} from './drag';

describe('drag & multi-selection helpers for moving assets into folders', () => {
  it('distinguishes external OS file drags from internal single or multi-asset drags', () => {
    expect(isExternalFileDrag({ types: ['Files'] }, [])).toBe(true);
    expect(isExternalFileDrag({ types: ['Files'] }, ['asset-1'])).toBe(false);
    expect(isExternalFileDrag({ types: [ASSET_DRAG_MIME, 'text/plain'] }, [])).toBe(false);
    expect(isExternalFileDrag({ types: [ASSET_LIST_DRAG_MIME, 'Files'] }, [])).toBe(false);
    expect(isExternalFileDrag({ types: ['text/plain'] }, [])).toBe(false);
  });

  it('moves all selected assets when dragging a selected card, or only the card otherwise', () => {
    expect(resolveDragAssetIds('a2', ['a1', 'a2', 'a3'])).toEqual(['a1', 'a2', 'a3']);
    expect(resolveDragAssetIds('a9', ['a1', 'a2', 'a3'])).toEqual(['a9']);
    expect(resolveDragAssetIds('a1', [])).toEqual(['a1']);
  });

  it('extracts multi-asset and single-asset IDs from DataTransfer with fallback', () => {
    const multiDt = {
      getData: (type: string) =>
        type === ASSET_LIST_DRAG_MIME ? JSON.stringify(['id-1', 'id-2', 'id-1']) : '',
    };
    expect(extractDraggedAssetIds(multiDt, [])).toEqual(['id-1', 'id-2']);

    const singleDt = {
      getData: (type: string) => (type === ASSET_DRAG_MIME ? 'uuid-1' : ''),
    };
    expect(extractDraggedAssetIds(singleDt, ['fallback'])).toEqual(['uuid-1']);
    expect(extractDraggedAssetId(singleDt, 'fallback')).toBe('uuid-1');
    expect(extractDraggedAssetIds({ getData: () => '' }, ['fb-1', 'fb-2'])).toEqual([
      'fb-1',
      'fb-2',
    ]);
  });

  it('computes toggle and Shift+click range selections accurately', () => {
    const ordered = ['a1', 'a2', 'a3', 'a4', 'a5'];

    const afterToggle = computeMultiSelection({
      orderedIds: ordered,
      currentSelectedIds: ['a1'],
      clickedId: 'a3',
      anchorId: 'a1',
      mode: 'toggle',
    });
    expect(afterToggle).toEqual(['a1', 'a3']);

    const afterUntoggle = computeMultiSelection({
      orderedIds: ordered,
      currentSelectedIds: ['a1', 'a3'],
      clickedId: 'a1',
      anchorId: 'a3',
      mode: 'toggle',
    });
    expect(afterUntoggle).toEqual(['a3']);

    const afterRange = computeMultiSelection({
      orderedIds: ordered,
      currentSelectedIds: ['a2'],
      clickedId: 'a4',
      anchorId: 'a2',
      mode: 'range',
    });
    expect(afterRange).toEqual(['a2', 'a3', 'a4']);
  });

  it('computes parent folder paths accurately', () => {
    expect(getParentFolder('')).toBe('');
    expect(getParentFolder('personnages')).toBe('');
    expect(getParentFolder('sc01/drafts')).toBe('sc01');
    expect(getParentFolder('/sc01/drafts/v2/')).toBe('sc01/drafts');
  });
});

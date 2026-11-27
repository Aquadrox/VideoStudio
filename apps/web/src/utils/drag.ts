export const ASSET_DRAG_MIME = 'application/x-videostudio-asset-id';
export const ASSET_LIST_DRAG_MIME = 'application/x-videostudio-asset-ids';

export interface DataTransferLike {
  types?: ArrayLike<string>;
  getData?: (format: string) => string;
}

/**
 * Returns true only when the drag operation carries external OS files and is NOT
 * an internal VideoStudio asset drag.
 */
export function isExternalFileDrag(
  dataTransfer: DataTransferLike | null | undefined,
  draggingAssetIds: string[] | string | null,
): boolean {
  const hasDragging = Array.isArray(draggingAssetIds)
    ? draggingAssetIds.length > 0
    : Boolean(draggingAssetIds);
  if (hasDragging) return false;
  if (!dataTransfer?.types) return false;

  const types = Array.from(dataTransfer.types);
  if (types.includes(ASSET_DRAG_MIME) || types.includes(ASSET_LIST_DRAG_MIME)) return false;
  return types.includes('Files');
}

/**
 * Returns the list of asset IDs that should move together when dragging `draggedId`.
 * If `draggedId` is part of an active multi-selection, all selected IDs move together.
 */
export function resolveDragAssetIds(draggedId: string, selectedIds: string[]): string[] {
  if (selectedIds.length > 1 && selectedIds.includes(draggedId)) {
    return Array.from(new Set(selectedIds));
  }
  return [draggedId];
}

/**
 * Extracts one or more dragged internal asset UUIDs from DataTransfer or React state fallback.
 */
export function extractDraggedAssetIds(
  dataTransfer: DataTransferLike | null | undefined,
  fallbackAssetIds: string[] = [],
): string[] {
  const rawList = dataTransfer?.getData?.(ASSET_LIST_DRAG_MIME)?.trim();
  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        );
        if (clean.length > 0) return Array.from(new Set(clean));
      }
    } catch {
      // Fall through to single-ID MIME
    }
  }

  const single = dataTransfer?.getData?.(ASSET_DRAG_MIME)?.trim();
  if (single) return [single];

  return Array.from(new Set(fallbackAssetIds.filter(Boolean)));
}

/**
 * Backwards-compatible helper returning the first dragged asset ID or null.
 */
export function extractDraggedAssetId(
  dataTransfer: DataTransferLike | null | undefined,
  fallbackAssetId: string | null,
): string | null {
  const ids = extractDraggedAssetIds(dataTransfer, fallbackAssetId ? [fallbackAssetId] : []);
  return ids[0] ?? null;
}

/**
 * Computes the next multi-selection list for checkbox toggle or Shift+click range selection.
 */
export function computeMultiSelection(params: {
  orderedIds: string[];
  currentSelectedIds: string[];
  clickedId: string;
  anchorId: string | null;
  mode: 'toggle' | 'range';
}): string[] {
  const { orderedIds, currentSelectedIds, clickedId, anchorId, mode } = params;

  if (mode === 'range' && anchorId) {
    const startIdx = orderedIds.indexOf(anchorId);
    const endIdx = orderedIds.indexOf(clickedId);
    if (startIdx !== -1 && endIdx !== -1) {
      const low = Math.min(startIdx, endIdx);
      const high = Math.max(startIdx, endIdx);
      const rangeIds = orderedIds.slice(low, high + 1);
      return Array.from(new Set([...currentSelectedIds, ...rangeIds]));
    }
  }

  if (currentSelectedIds.includes(clickedId)) {
    return currentSelectedIds.filter((id) => id !== clickedId);
  }
  return [...currentSelectedIds, clickedId];
}

/**
 * Returns the parent folder path for a normalized folder path (empty string for root).
 */
export function getParentFolder(folderPath: string): string {
  const clean = folderPath.replace(/^\/+|\/+$/g, '');
  if (!clean) return '';
  const parts = clean.split('/');
  return parts.slice(0, -1).join('/');
}

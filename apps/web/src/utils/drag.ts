export const ASSET_DRAG_MIME = 'application/x-videostudio-asset-id';

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
  draggingAssetId: string | null,
): boolean {
  if (draggingAssetId) return false;
  if (!dataTransfer?.types) return false;

  const types = Array.from(dataTransfer.types);
  if (types.includes(ASSET_DRAG_MIME)) return false;
  return types.includes('Files');
}

/**
 * Extracts the dragged internal asset UUID from DataTransfer or falls back to
 * React state (useful on browsers that restrict getData during dragover).
 */
export function extractDraggedAssetId(
  dataTransfer: DataTransferLike | null | undefined,
  fallbackAssetId: string | null,
): string | null {
  const fromTransfer = dataTransfer?.getData?.(ASSET_DRAG_MIME)?.trim();
  if (fromTransfer) return fromTransfer;
  return fallbackAssetId;
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

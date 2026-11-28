export type UploadItemStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadQueueItem {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  folderPath: string;
  status: UploadItemStatus;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  startedAt: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  assetId: string | null;
  assetHandle: string | null;
  errorMessage: string | null;
}

export interface UploadQueueSummary {
  totalCount: number;
  queuedCount: number;
  activeCount: number;
  doneCount: number;
  errorCount: number;
  cancelledCount: number;
  isBusy: boolean;
  overallPercent: number;
  totalBytes: number;
  uploadedBytes: number;
}

export function createUploadQueueItem(file: File, folderPath: string): UploadQueueItem {
  const size = Math.max(0, file.size || 0);
  return {
    id: `upl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    filename: file.name,
    fileSize: size,
    mimeType: file.type || '',
    folderPath,
    status: 'queued',
    loadedBytes: 0,
    totalBytes: size,
    percent: 0,
    startedAt: null,
    speedBytesPerSec: null,
    etaSeconds: null,
    assetId: null,
    assetHandle: null,
    errorMessage: null,
  };
}

/**
 * Computes weighted overall progress across all non-cancelled upload items.
 * Uploading bytes account for 0..90% per item, server processing (FFmpeg/Sharp) = 95%, done = 100%.
 */
export function computeUploadQueueSummary(items: UploadQueueItem[]): UploadQueueSummary {
  let queuedCount = 0;
  let activeCount = 0;
  let doneCount = 0;
  let errorCount = 0;
  let cancelledCount = 0;
  let totalBytes = 0;
  let uploadedBytes = 0;
  let weightedSum = 0;
  let weightTotal = 0;

  for (const item of items) {
    if (item.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }
    if (item.status === 'queued') queuedCount += 1;
    else if (item.status === 'uploading' || item.status === 'processing') activeCount += 1;
    else if (item.status === 'done') doneCount += 1;
    else if (item.status === 'error') errorCount += 1;

    const itemWeight = Math.max(1, item.totalBytes || item.fileSize || 1);
    totalBytes += item.totalBytes || item.fileSize;

    if (item.status === 'done') {
      uploadedBytes += item.totalBytes || item.fileSize;
      weightedSum += itemWeight * 100;
    } else if (item.status === 'processing') {
      uploadedBytes += item.totalBytes || item.fileSize;
      weightedSum += itemWeight * 95;
    } else if (item.status === 'uploading') {
      const clampedLoaded = Math.min(item.totalBytes || item.fileSize, Math.max(0, item.loadedBytes));
      uploadedBytes += clampedLoaded;
      const bytePct = Math.max(0, Math.min(100, item.percent));
      weightedSum += itemWeight * (bytePct * 0.9);
    } else if (item.status === 'error') {
      weightedSum += itemWeight * 100;
    }
    weightTotal += itemWeight;
  }

  const effectiveCount = items.length - cancelledCount;
  const overallPercent =
    weightTotal > 0 ? Math.max(0, Math.min(100, Math.round(weightedSum / weightTotal))) : 0;

  return {
    totalCount: effectiveCount,
    queuedCount,
    activeCount,
    doneCount,
    errorCount,
    cancelledCount,
    isBusy: queuedCount > 0 || activeCount > 0,
    overallPercent,
    totalBytes,
    uploadedBytes,
  };
}

export function formatTransferSpeed(bytesPerSec: number | null): string {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} Mo/s`;
  }
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} Ko/s`;
}

export function formatEtaShort(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return '';
  const rounded = Math.ceil(etaSeconds);
  if (rounded < 60) return `~${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `~${mins}m${String(secs).padStart(2, '0')}s`;
}

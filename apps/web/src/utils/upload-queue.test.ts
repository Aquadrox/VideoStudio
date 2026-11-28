import { describe, expect, it } from 'vitest';
import {
  computeUploadQueueSummary,
  formatEtaShort,
  formatTransferSpeed,
  type UploadQueueItem,
} from './upload-queue';

function makeItem(overrides: Partial<UploadQueueItem> = {}): UploadQueueItem {
  return {
    id: 'u1',
    filename: 'clip.mp4',
    fileSize: 1000,
    mimeType: 'video/mp4',
    folderPath: 'rushs',
    status: 'queued',
    loadedBytes: 0,
    totalBytes: 1000,
    percent: 0,
    startedAt: null,
    speedBytesPerSec: null,
    etaSeconds: null,
    assetId: null,
    assetHandle: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('upload-queue', () => {
  it('computes weighted progress across queued, uploading, processing, and done items', () => {
    const summary = computeUploadQueueSummary([
      makeItem({ id: '1', status: 'done', totalBytes: 1000, loadedBytes: 1000, percent: 100 }),
      makeItem({ id: '2', status: 'uploading', totalBytes: 1000, loadedBytes: 500, percent: 50 }),
      makeItem({ id: '3', status: 'queued', totalBytes: 2000, loadedBytes: 0, percent: 0 }),
    ]);

    expect(summary.totalCount).toBe(3);
    expect(summary.doneCount).toBe(1);
    expect(summary.activeCount).toBe(1);
    expect(summary.queuedCount).toBe(1);
    expect(summary.isBusy).toBe(true);
    // (1000*100 + 1000*45 + 2000*0) / 4000 = 36.25 -> 36%
    expect(summary.overallPercent).toBe(36);
  });

  it('ignores cancelled items in overall progress and formats speed/ETA cleanly', () => {
    const summary = computeUploadQueueSummary([
      makeItem({ id: '1', status: 'processing', totalBytes: 1000, loadedBytes: 1000, percent: 100 }),
      makeItem({ id: '2', status: 'cancelled', totalBytes: 5000 }),
    ]);
    expect(summary.totalCount).toBe(1);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.overallPercent).toBe(95);

    expect(formatTransferSpeed(5 * 1024 * 1024)).toBe('5.0 Mo/s');
    expect(formatTransferSpeed(512 * 1024)).toBe('512 Ko/s');
    expect(formatEtaShort(12)).toBe('~12s');
    expect(formatEtaShort(125)).toBe('~2m05s');
  });
});

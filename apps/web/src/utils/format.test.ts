import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, QUALITY_TIER_SHORT, STATUS_LABELS } from './format';

describe('web format utilities', () => {
  it('formats byte sizes cleanly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats durations cleanly', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(605)).toBe('10:05');
  });

  it('exposes complete status and quality tier labels', () => {
    expect(STATUS_LABELS.approved).toBe('Approuvé');
    expect(QUALITY_TIER_SHORT.draft_lowres).toBe('DRAFT');
    expect(QUALITY_TIER_SHORT.hq_upscale).toBe('HQ');
  });
});

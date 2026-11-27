import { describe, expect, it } from 'vitest';
import { normalizeMediaCoordinates, timecodeToFrame } from './annotations';

describe('annotation geometry helpers', () => {
  it('normalizes and clamps pointer coordinates to [0..1]', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(normalizeMediaCoordinates(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeMediaCoordinates(50, 10, rect)).toEqual({ x: 0, y: 0 });
    expect(normalizeMediaCoordinates(900, 900, rect)).toEqual({ x: 1, y: 1 });
  });

  it('converts video timecodes to frame numbers using asset FPS or 24fps fallback', () => {
    expect(timecodeToFrame(1.5, 24)).toBe(36);
    expect(timecodeToFrame(2.0, 30)).toBe(60);
    expect(timecodeToFrame(1.0, null)).toBe(24);
  });
});

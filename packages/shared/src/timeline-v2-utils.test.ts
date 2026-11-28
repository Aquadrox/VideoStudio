import { describe, expect, it } from 'vitest';
import type { TimelineClipDto, TimelineTrackDto } from './stage4-schemas.js';
import {
  applyClipDragMove,
  applyClipTrimLeft,
  applyClipTrimRight,
  collectTimelineSnapPoints,
  evaluateTimelineTransitionFrame,
  extractTimelineBeatMarkers,
} from './timeline-v2-utils.js';

function makeClip(overrides: Partial<TimelineClipDto> = {}): TimelineClipDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    trackId: '22222222-2222-4222-8222-222222222222',
    projectId: '33333333-3333-4333-8333-333333333333',
    assetId: null,
    assetRef: null,
    assetTitle: null,
    assetType: null,
    assetQualityTier: null,
    title: 'Clip 1',
    startSec: 2,
    durationSec: 4,
    inSec: 0,
    outSec: null,
    transition: 'cut',
    transitionDurationSec: 0,
    volume: 1,
    muted: false,
    notes: '',
    sortOrder: 0,
    ...overrides,
  };
}

describe('timeline-v2-utils', () => {
  it('snaps dragged clips to beat markers and clip boundaries', () => {
    const clipA = makeClip({ id: 'a', startSec: 0, durationSec: 3 });
    const clipB = makeClip({ id: 'b', startSec: 5, durationSec: 2 });
    const track: TimelineTrackDto = {
      id: 't1',
      projectId: clipA.projectId,
      name: 'V1',
      type: 'video',
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: 0,
      clips: [clipA, clipB],
    };

    const points = collectTimelineSnapPoints([track], 1.5, [{ timeSec: 4.0, kind: 'beat', label: 'Beat' }], 'b');
    const moved = applyClipDragMove(clipB, -0.92, points, 0.2, true);
    expect(moved.startSec).toBe(4);
    expect(moved.snappedGuideSec).toBe(4);

    const unsnapped = applyClipDragMove(clipB, -0.92, points, 0.2, false);
    expect(unsnapped.startSec).toBeCloseTo(4.08, 2);
    expect(unsnapped.snappedGuideSec).toBeNull();
  });

  it('trims clip left and right edges while preserving min duration and adjusting inSec', () => {
    const clip = makeClip({ startSec: 2, durationSec: 4, inSec: 1 });
    const left = applyClipTrimLeft(clip, 1.0, [], 0.1, false);
    expect(left.startSec).toBe(3);
    expect(left.durationSec).toBe(3);
    expect(left.inSec).toBe(2);

    const right = applyClipTrimRight(clip, -3.9, [], 0.1, false, 0.25);
    expect(right.durationSec).toBe(0.25);
  });

  it('extracts BPM beats, LRC lyrics, and manual audio markers', () => {
    const markers = extractTimelineBeatMarkers(
      [
        {
          id: 'a1',
          projectId: 'p1',
          assetId: null,
          refCode: 'aud-001',
          handle: '@aud-001',
          title: 'Theme',
          category: 'music',
          bpm: 120,
          musicalKey: 'Am',
          promptUsed: '',
          lyrics: '',
          lrcContent: '[00:01.25] First lyric',
          srtContent: '',
          markers: [{ id: 'm1', timeSec: 2.75, label: 'Drop', type: 'beat' }],
          notes: '',
          audioUrl: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      6,
    );

    expect(markers.some((m) => m.kind === 'beat' && m.timeSec === 0)).toBe(true);
    expect(markers.some((m) => m.kind === 'lyric' && m.timeSec === 1.25)).toBe(true);
    expect(markers.some((m) => m.kind === 'marker' && m.label === 'Drop')).toBe(true);
  });

  it('evaluates crossfade and fade_black transition preview opacities', () => {
    const c1 = makeClip({ id: 'c1', startSec: 0, durationSec: 3 });
    const c2 = makeClip({ id: 'c2', startSec: 3, durationSec: 4, transition: 'crossfade', transitionDurationSec: 1 });
    const c3 = makeClip({ id: 'c3', startSec: 7, durationSec: 4, transition: 'fade_black', transitionDurationSec: 1 });

    const cross = evaluateTimelineTransitionFrame([c1, c2, c3], 3.5);
    expect(cross.activeClip?.id).toBe('c2');
    expect(cross.outgoingClip?.id).toBe('c1');
    expect(cross.activeOpacity).toBeCloseTo(0.5, 2);
    expect(cross.outgoingOpacity).toBeCloseTo(0.5, 2);

    const fade = evaluateTimelineTransitionFrame([c1, c2, c3], 7.25);
    expect(fade.activeClip?.id).toBe('c3');
    expect(fade.blackOverlayOpacity).toBeCloseTo(0.75, 2);
  });
});

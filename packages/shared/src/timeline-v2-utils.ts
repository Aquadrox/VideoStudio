import { parseLrc } from './stage3-utils.js';
import type { AudioTrackDto } from './stage3-schemas.js';
import type { TimelineClipDto, TimelineTrackDto } from './stage4-schemas.js';

export interface TimelineBeatMarker {
  timeSec: number;
  kind: 'beat' | 'lyric' | 'marker';
  label: string;
}

export interface TimelineTransitionFrame {
  activeClip: TimelineClipDto | null;
  outgoingClip: TimelineClipDto | null;
  activeOpacity: number;
  outgoingOpacity: number;
  blackOverlayOpacity: number;
}

function roundTime(sec: number): number {
  return Math.max(0, Math.round(sec * 1000) / 1000);
}

/**
 * Extracts beat grid markers (from BPM), timed LRC lyric timestamps, and manual audio markers
 * from project audio tracks for snapping and visual ruler cues in Timeline NLE v2.
 */
export function extractTimelineBeatMarkers(
  audioTracks: AudioTrackDto[],
  totalDurationSec: number,
  maxBeats = 240,
): TimelineBeatMarker[] {
  const markers: TimelineBeatMarker[] = [];
  const capDuration = Math.max(4, Math.min(totalDurationSec + 4, 1800));

  for (const track of audioTracks) {
    // 1. Explicit audio markers (lip-sync / cue points)
    for (const m of track.markers ?? []) {
      if (m.timeSec >= 0 && m.timeSec <= capDuration) {
        markers.push({
          timeSec: roundTime(m.timeSec),
          kind: 'marker',
          label: m.label || `${track.title}`,
        });
      }
    }

    // 2. Timed lyrics (Suno / LRC)
    if (track.lrcContent?.trim()) {
      const parsed = parseLrc(track.lrcContent);
      for (const line of parsed) {
        if (line.timeSec >= 0 && line.timeSec <= capDuration) {
          markers.push({
            timeSec: roundTime(line.timeSec),
            kind: 'lyric',
            label: line.text.slice(0, 42),
          });
        }
      }
    }

    // 3. Rhythmic beat grid from BPM (music tracks or first BPM track)
    if (track.bpm && track.bpm >= 40 && track.bpm <= 240) {
      const beatSec = 60 / track.bpm;
      let beatIdx = 1;
      for (let t = 0; t <= capDuration && beatIdx <= maxBeats; t += beatSec) {
        // Emphasize downbeats (bar start every 4 beats)
        const isDownbeat = (beatIdx - 1) % 4 === 0;
        if (isDownbeat || beatSec >= 0.45) {
          markers.push({
            timeSec: roundTime(t),
            kind: 'beat',
            label: isDownbeat ? `Mesure ${Math.floor((beatIdx - 1) / 4) + 1}` : `Beat ${beatIdx}`,
          });
        }
        beatIdx += 1;
      }
    }
  }

  return markers.sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Collects snap points from all clips (excluding an optional clip being edited), playhead, and beat markers.
 */
export function collectTimelineSnapPoints(
  tracks: TimelineTrackDto[],
  playheadSec: number,
  beatMarkers: TimelineBeatMarker[] = [],
  excludeClipId?: string,
): number[] {
  const points = new Set<number>([0, roundTime(playheadSec)]);

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      points.add(roundTime(clip.startSec));
      points.add(roundTime(clip.startSec + clip.durationSec));
    }
  }

  for (const m of beatMarkers) {
    points.add(roundTime(m.timeSec));
  }

  return Array.from(points).sort((a, b) => a - b);
}

/**
 * Snaps a raw timestamp to the nearest snap point within thresholdSec, or returns rounded raw time.
 */
export function snapTimelineSec(
  rawSec: number,
  snapPoints: number[],
  thresholdSec: number,
  enabled = true,
): { snappedSec: number; snappedTo: number | null } {
  const clamped = roundTime(rawSec);
  if (!enabled || thresholdSec <= 0 || snapPoints.length === 0) {
    return { snappedSec: clamped, snappedTo: null };
  }

  let bestPoint: number | null = null;
  let bestDist = thresholdSec;

  for (const pt of snapPoints) {
    const dist = Math.abs(pt - clamped);
    if (dist <= bestDist) {
      bestDist = dist;
      bestPoint = pt;
    }
  }

  if (bestPoint !== null) {
    return { snappedSec: bestPoint, snappedTo: bestPoint };
  }
  return { snappedSec: clamped, snappedTo: null };
}

/**
 * Computes new clip startSec when dragging a clip horizontally.
 * Checks snapping on both clip start and clip end edges.
 */
export function applyClipDragMove(
  clip: Pick<TimelineClipDto, 'startSec' | 'durationSec'>,
  deltaSec: number,
  snapPoints: number[],
  thresholdSec: number,
  snapEnabled = true,
): { startSec: number; snappedGuideSec: number | null } {
  const rawStart = Math.max(0, clip.startSec + deltaSec);
  const startSnap = snapTimelineSec(rawStart, snapPoints, thresholdSec, snapEnabled);
  if (startSnap.snappedTo !== null) {
    return { startSec: startSnap.snappedSec, snappedGuideSec: startSnap.snappedTo };
  }

  const rawEnd = rawStart + clip.durationSec;
  const endSnap = snapTimelineSec(rawEnd, snapPoints, thresholdSec, snapEnabled);
  if (endSnap.snappedTo !== null) {
    const adjustedStart = Math.max(0, roundTime(endSnap.snappedSec - clip.durationSec));
    return { startSec: adjustedStart, snappedGuideSec: endSnap.snappedTo };
  }

  return { startSec: roundTime(rawStart), snappedGuideSec: null };
}

/**
 * Computes updated startSec, durationSec, and inSec when trimming the left edge of a clip.
 */
export function applyClipTrimLeft(
  clip: Pick<TimelineClipDto, 'startSec' | 'durationSec' | 'inSec'>,
  deltaSec: number,
  snapPoints: number[],
  thresholdSec: number,
  snapEnabled = true,
  minDurationSec = 0.2,
): { startSec: number; durationSec: number; inSec: number; snappedGuideSec: number | null } {
  const clipEnd = clip.startSec + clip.durationSec;
  const maxStart = Math.max(0, clipEnd - minDurationSec);
  const rawStart = Math.max(0, Math.min(maxStart, clip.startSec + deltaSec));
  const snap = snapTimelineSec(rawStart, snapPoints, thresholdSec, snapEnabled);
  const finalStart = Math.max(0, Math.min(maxStart, snap.snappedSec));
  const appliedDelta = finalStart - clip.startSec;

  const nextDuration = Math.max(minDurationSec, roundTime(clipEnd - finalStart));
  const nextInSec = Math.max(0, roundTime(clip.inSec + appliedDelta));

  return {
    startSec: roundTime(finalStart),
    durationSec: nextDuration,
    inSec: nextInSec,
    snappedGuideSec: snap.snappedTo,
  };
}

/**
 * Computes updated durationSec when trimming the right edge of a clip.
 */
export function applyClipTrimRight(
  clip: Pick<TimelineClipDto, 'startSec' | 'durationSec'>,
  deltaSec: number,
  snapPoints: number[],
  thresholdSec: number,
  snapEnabled = true,
  minDurationSec = 0.2,
): { durationSec: number; snappedGuideSec: number | null } {
  const rawEnd = Math.max(clip.startSec + minDurationSec, clip.startSec + clip.durationSec + deltaSec);
  const snap = snapTimelineSec(rawEnd, snapPoints, thresholdSec, snapEnabled);
  const finalEnd = Math.max(clip.startSec + minDurationSec, snap.snappedSec);

  return {
    durationSec: Math.max(minDurationSec, roundTime(finalEnd - clip.startSec)),
    snappedGuideSec: snap.snappedTo,
  };
}

/**
 * Evaluates live transition visual opacities for the Timeline preview monitor
 * supporting `cut`, `crossfade`, and `fade_black`.
 */
export function evaluateTimelineTransitionFrame(
  videoClips: TimelineClipDto[],
  playheadSec: number,
): TimelineTransitionFrame {
  const sorted = [...videoClips]
    .filter((c) => !c.muted)
    .sort((a, b) => a.startSec - b.startSec);

  const activeIdx = sorted.findIndex(
    (c) => playheadSec >= c.startSec && playheadSec < c.startSec + c.durationSec,
  );
  if (activeIdx < 0) {
    return {
      activeClip: null,
      outgoingClip: null,
      activeOpacity: 1,
      outgoingOpacity: 0,
      blackOverlayOpacity: 0,
    };
  }

  const activeClip = sorted[activeIdx]!;
  const prevClip = activeIdx > 0 ? sorted[activeIdx - 1]! : null;
  const elapsedInClip = Math.max(0, playheadSec - activeClip.startSec);
  const remainingInClip = Math.max(0, activeClip.startSec + activeClip.durationSec - playheadSec);
  const transDur = Math.min(
    Math.max(0, activeClip.transitionDurationSec || 0.6),
    activeClip.durationSec / 2,
  );

  if (activeClip.transition === 'crossfade' && transDur > 0 && elapsedInClip < transDur) {
    const t = Math.max(0, Math.min(1, elapsedInClip / transDur));
    return {
      activeClip,
      outgoingClip: prevClip,
      activeOpacity: t,
      outgoingOpacity: prevClip ? 1 - t : 0,
      blackOverlayOpacity: prevClip ? 0 : 1 - t,
    };
  }

  if (activeClip.transition === 'fade_black' && transDur > 0) {
    if (elapsedInClip < transDur) {
      const t = Math.max(0, Math.min(1, elapsedInClip / transDur));
      return {
        activeClip,
        outgoingClip: null,
        activeOpacity: 1,
        outgoingOpacity: 0,
        blackOverlayOpacity: 1 - t,
      };
    }
    if (remainingInClip < transDur) {
      const t = Math.max(0, Math.min(1, remainingInClip / transDur));
      return {
        activeClip,
        outgoingClip: null,
        activeOpacity: 1,
        outgoingOpacity: 0,
        blackOverlayOpacity: 1 - t,
      };
    }
  }

  return {
    activeClip,
    outgoingClip: null,
    activeOpacity: 1,
    outgoingOpacity: 0,
    blackOverlayOpacity: 0,
  };
}

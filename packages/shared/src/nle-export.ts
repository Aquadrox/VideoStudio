import type { TimelineClipDto, TimelineDto, TimelineQualityMode } from './stage4-schemas.js';

/**
 * Formats seconds into SMPTE non-drop timecode `HH:MM:SS:FF` (starting from optional offset like 01:00:00:00).
 */
export function secondsToSmpte(seconds: number, fps: number, startHour = 0): string {
  const safeFps = Math.max(1, Math.round(fps || 24));
  const totalFrames = Math.max(0, Math.round(seconds * safeFps)) + startHour * 3600 * safeFps;
  const frames = totalFrames % safeFps;
  const totalSecs = Math.floor(totalFrames / safeFps);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  return [
    String(hours).padStart(2, '0'),
    String(mins).padStart(2, '0'),
    String(secs).padStart(2, '0'),
    String(frames).padStart(2, '0'),
  ].join(':');
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeReelName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '').toUpperCase();
  return (cleaned || 'AX').slice(0, 8).padEnd(8, ' ');
}

function buildClipTargetUrl(
  clip: TimelineClipDto,
  assetFileMap?: Map<string, string>,
): string {
  if (clip.assetId && assetFileMap?.has(clip.assetId)) {
    return assetFileMap.get(clip.assetId)!;
  }
  return clip.assetRef ? `${clip.assetRef.replace(/^@/, '')}.mp4` : `${clip.id}.mp4`;
}

/**
 * Generates a valid CMX 3600 EDL (.edl) edit decision list for DaVinci Resolve, Premiere Pro & Avid.
 */
export function generateEdl(
  timeline: TimelineDto,
  projectName: string,
  assetFileMap?: Map<string, string>,
): string {
  const fps = timeline.fps || 24;
  const lines: string[] = [
    `TITLE: ${projectName.toUpperCase()}`,
    'FCM: NON-DROP FRAME',
    '',
  ];

  let eventNum = 1;
  const tracks = [...timeline.tracks].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const track of tracks) {
    if (track.muted) continue;
    const channel = track.type === 'audio' ? 'A' : 'V';
    const clips = [...track.clips].sort((a, b) => a.startSec - b.startSec);

    for (const clip of clips) {
      if (clip.muted) continue;
      const num = String(eventNum).padStart(3, '0');
      const reel = sanitizeReelName(clip.assetRef ?? clip.title);
      const transitionCode =
        clip.transition === 'crossfade' && clip.transitionDurationSec > 0
          ? `D    ${String(Math.round(clip.transitionDurationSec * fps)).padStart(3, '0')}`
          : 'C        ';

      const srcIn = secondsToSmpte(clip.inSec, fps, 0);
      const srcOut = secondsToSmpte(clip.inSec + clip.durationSec, fps, 0);
      const recIn = secondsToSmpte(clip.startSec, fps, 1);
      const recOut = secondsToSmpte(clip.startSec + clip.durationSec, fps, 1);

      lines.push(`${num}  ${reel} ${channel.padEnd(5, ' ')} ${transitionCode} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
      lines.push(`* FROM CLIP NAME: ${clip.title}`);
      const target = buildClipTargetUrl(clip, assetFileMap);
      lines.push(`* SOURCE FILE: ${target}`);
      lines.push('');
      eventNum += 1;
    }
  }

  return lines.join('\n');
}

/**
 * Generates a valid OpenTimelineIO (.otio) JSON timeline directly importable into DaVinci Resolve.
 */
export function generateOtio(
  timeline: TimelineDto,
  projectName: string,
  assetFileMap?: Map<string, string>,
): string {
  const rate = timeline.fps || 24;

  const otioTracks = [...timeline.tracks]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((track) => {
      const sortedClips = [...track.clips].sort((a, b) => a.startSec - b.startSec);
      const children: Array<Record<string, unknown>> = [];
      let cursorSec = 0;

      for (const clip of sortedClips) {
        if (clip.startSec > cursorSec + 0.01) {
          const gapFrames = Math.round((clip.startSec - cursorSec) * rate);
          if (gapFrames > 0) {
            children.push({
              OTIO_SCHEMA: 'Gap.1',
              name: '',
              source_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', rate, value: 0 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', rate, value: gapFrames },
              },
            });
          }
        }

        const durFrames = Math.max(1, Math.round(clip.durationSec * rate));
        const inFrames = Math.max(0, Math.round(clip.inSec * rate));
        const targetUrl = buildClipTargetUrl(clip, assetFileMap);

        children.push({
          OTIO_SCHEMA: 'Clip.2',
          name: clip.title,
          metadata: {
            videostudio: {
              clipId: clip.id,
              assetId: clip.assetId,
              assetRef: clip.assetRef,
              qualityMode: timeline.qualityMode,
              transition: clip.transition,
            },
          },
          source_range: {
            OTIO_SCHEMA: 'TimeRange.1',
            start_time: { OTIO_SCHEMA: 'RationalTime.1', rate, value: inFrames },
            duration: { OTIO_SCHEMA: 'RationalTime.1', rate, value: durFrames },
          },
          media_references: {
            DEFAULT_MEDIA: {
              OTIO_SCHEMA: 'ExternalReference.1',
              name: clip.assetTitle ?? clip.title,
              target_url: targetUrl,
              available_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', rate, value: 0 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', rate, value: inFrames + durFrames },
              },
            },
          },
          active_media_reference_key: 'DEFAULT_MEDIA',
        });

        cursorSec = Math.max(cursorSec, clip.startSec + clip.durationSec);
      }

      return {
        OTIO_SCHEMA: 'Track.1',
        name: track.name,
        kind: track.type === 'audio' ? 'Audio' : 'Video',
        enabled: !track.muted,
        children,
      };
    });

  const doc = {
    OTIO_SCHEMA: 'Timeline.1',
    name: projectName,
    global_start_time: {
      OTIO_SCHEMA: 'RationalTime.1',
      rate,
      value: 0,
    },
    metadata: {
      videostudio: {
        projectSlug: timeline.projectSlug,
        resolution: timeline.resolution,
        qualityMode: timeline.qualityMode,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: otioTracks,
    },
  };

  return JSON.stringify(doc, null, 2);
}

/**
 * Generates a valid FCPXML v1.10 (.fcpxml) file for Final Cut Pro & DaVinci Resolve.
 */
export function generateFcpxml(
  timeline: TimelineDto,
  projectName: string,
  assetFileMap?: Map<string, string>,
): string {
  const fps = Math.max(1, Math.round(timeline.fps || 24));
  const [wStr, hStr] = timeline.resolution.split('x');
  const width = Number(wStr) || 1920;
  const height = Number(hStr) || 1080;

  const toRational = (sec: number): string => {
    const frames = Math.max(0, Math.round(sec * fps));
    return `${frames * 100}/${fps * 100}s`;
  };

  // Collect unique asset references
  const uniqueAssets = new Map<string, { refId: string; name: string; src: string; durationSec: number }>();
  let assetCounter = 1;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const key = clip.assetId ?? clip.id;
      if (!uniqueAssets.has(key)) {
        uniqueAssets.set(key, {
          refId: `r${++assetCounter}`,
          name: clip.assetTitle ?? clip.title,
          src: buildClipTargetUrl(clip, assetFileMap),
          durationSec: Math.max(clip.inSec + clip.durationSec, clip.durationSec),
        });
      }
    }
  }

  const resourcesXml = Array.from(uniqueAssets.values())
    .map(
      (a) =>
        `        <asset id="${a.refId}" name="${escapeXml(a.name)}" start="0s" duration="${toRational(a.durationSec)}" hasVideo="1" hasAudio="1">\n` +
        `            <media-rep kind="original-media" src="file://${escapeXml(a.src)}" />\n` +
        `        </asset>`,
    )
    .join('\n');

  const videoTracks = timeline.tracks.filter((t) => t.type !== 'audio');
  const audioTracks = timeline.tracks.filter((t) => t.type === 'audio');

  const primaryClips = [...(videoTracks[0]?.clips ?? [])].sort((a, b) => a.startSec - b.startSec);
  const spineItems: string[] = [];

  for (const clip of primaryClips) {
    const assetEntry = uniqueAssets.get(clip.assetId ?? clip.id);
    const refId = assetEntry?.refId ?? 'r2';
    spineItems.push(
      `                        <asset-clip ref="${refId}" offset="${toRational(clip.startSec)}" name="${escapeXml(clip.title)}" start="${toRational(clip.inSec)}" duration="${toRational(clip.durationSec)}" />`,
    );
  }

  // Secondary audio tracks attached as connected lanes (-1, -2, ...)
  audioTracks.forEach((track, idx) => {
    const lane = -(idx + 1);
    for (const clip of [...track.clips].sort((a, b) => a.startSec - b.startSec)) {
      const assetEntry = uniqueAssets.get(clip.assetId ?? clip.id);
      const refId = assetEntry?.refId ?? 'r2';
      spineItems.push(
        `                        <asset-clip ref="${refId}" lane="${lane}" offset="${toRational(clip.startSec)}" name="${escapeXml(clip.title)}" start="${toRational(clip.inSec)}" duration="${toRational(clip.durationSec)}" />`,
      );
    }
  });

  const totalDur = toRational(Math.max(1, timeline.totalDurationSec));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '    <resources>',
    `        <format id="r1" name="FFVideoFormat${height}p${fps}" frameDuration="100/${fps * 100}s" width="${width}" height="${height}" />`,
    resourcesXml,
    '    </resources>',
    '    <library>',
    `        <event name="${escapeXml(projectName)}">`,
    `            <project name="${escapeXml(projectName)}">`,
    `                <sequence format="r1" duration="${totalDur}" tcStart="0s" tcFormat="NDF">`,
    '                    <spine>',
    ...spineItems,
    '                    </spine>',
    '                </sequence>',
    '            </project>',
    '        </event>',
    '    </library>',
    '</fcpxml>',
    '',
  ].join('\n');
}

/**
 * Selects the best playback URL for a timeline clip given the current Draft <-> HQ quality mode.
 */
export function selectTimelinePlaybackUrl(
  assetUrls: { original: string; proxy: string | null; thumbnail: string | null },
  assetType: 'image' | 'video' | 'audio' | 'document',
  qualityMode: TimelineQualityMode,
): string {
  if (assetType === 'audio') return assetUrls.original;
  if (qualityMode === 'draft_proxy') {
    return assetUrls.proxy ?? assetUrls.original;
  }
  return assetUrls.original;
}

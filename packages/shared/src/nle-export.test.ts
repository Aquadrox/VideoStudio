import { describe, expect, it } from 'vitest';
import {
  generateEdl,
  generateFcpxml,
  generateOtio,
  secondsToSmpte,
  selectTimelinePlaybackUrl,
} from './nle-export.js';
import type { TimelineDto } from './stage4-schemas.js';

const SAMPLE_TIMELINE: TimelineDto = {
  projectId: '00000000-0000-4000-8000-000000000001',
  projectSlug: 'neo-tokyo',
  fps: 24,
  resolution: '1920x1080',
  qualityMode: 'hq_master',
  totalDurationSec: 12,
  renders: [],
  tracks: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      projectId: '00000000-0000-4000-8000-000000000001',
      name: 'V1 · Principal',
      type: 'video',
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: 0,
      clips: [
        {
          id: '00000000-0000-4000-8000-000000000201',
          trackId: '00000000-0000-4000-8000-000000000101',
          projectId: '00000000-0000-4000-8000-000000000001',
          assetId: '00000000-0000-4000-8000-000000000301',
          assetRef: '@vid-001',
          assetTitle: 'Intro Rain',
          assetType: 'video',
          assetQualityTier: 'hq_upscale',
          title: 'Plan 01 — Intro & Rain',
          startSec: 0,
          durationSec: 5,
          inSec: 0,
          outSec: 5,
          transition: 'cut',
          transitionDurationSec: 0,
          volume: 1,
          muted: false,
          notes: '',
          sortOrder: 0,
        },
        {
          id: '00000000-0000-4000-8000-000000000202',
          trackId: '00000000-0000-4000-8000-000000000101',
          projectId: '00000000-0000-4000-8000-000000000001',
          assetId: '00000000-0000-4000-8000-000000000302',
          assetRef: '@img-002',
          assetTitle: 'Hero Close-Up',
          assetType: 'image',
          assetQualityTier: 'final_master',
          title: 'Plan 02 — Hero',
          startSec: 6,
          durationSec: 6,
          inSec: 0,
          outSec: 6,
          transition: 'crossfade',
          transitionDurationSec: 1,
          volume: 1,
          muted: false,
          notes: '',
          sortOrder: 1,
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      projectId: '00000000-0000-4000-8000-000000000001',
      name: 'A1 · Musique',
      type: 'audio',
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: 1,
      clips: [
        {
          id: '00000000-0000-4000-8000-000000000203',
          trackId: '00000000-0000-4000-8000-000000000102',
          projectId: '00000000-0000-4000-8000-000000000001',
          assetId: '00000000-0000-4000-8000-000000000303',
          assetRef: '@aud-001',
          assetTitle: 'Main Theme',
          assetType: 'audio',
          assetQualityTier: 'final_master',
          title: 'Main Theme',
          startSec: 0,
          durationSec: 12,
          inSec: 0,
          outSec: 12,
          transition: 'cut',
          transitionDurationSec: 0,
          volume: 0.85,
          muted: false,
          notes: '',
          sortOrder: 0,
        },
      ],
    },
  ],
};

describe('NLE Exporters (OTIO, FCPXML, EDL) & SMPTE', () => {
  it('converts seconds into accurate SMPTE HH:MM:SS:FF timecodes', () => {
    expect(secondsToSmpte(0, 24)).toBe('00:00:00:00');
    expect(secondsToSmpte(4.5, 24)).toBe('00:00:04:12');
    expect(secondsToSmpte(65, 24, 1)).toBe('01:01:05:00');
  });

  it('generates valid CMX 3600 EDL with transitions and clip names', () => {
    const edl = generateEdl(SAMPLE_TIMELINE, 'Neo Tokyo');
    expect(edl).toContain('TITLE: NEO TOKYO');
    expect(edl).toContain('FCM: NON-DROP FRAME');
    expect(edl).toContain('* FROM CLIP NAME: Plan 01 — Intro & Rain');
    expect(edl).toContain('D    024'); // 1s crossfade at 24fps
    expect(edl).toContain('003  AUD001');
  });

  it('generates valid OpenTimelineIO (.otio) JSON with gaps and tracks', () => {
    const raw = generateOtio(SAMPLE_TIMELINE, 'Neo Tokyo');
    const parsed = JSON.parse(raw) as {
      OTIO_SCHEMA: string;
      tracks: { children: Array<{ kind: string; children: Array<{ OTIO_SCHEMA: string }> }> };
    };
    expect(parsed.OTIO_SCHEMA).toBe('Timeline.1');
    expect(parsed.tracks.children).toHaveLength(2);
    // Video track has Clip 1 (0..5s) + Gap (5..6s) + Clip 2 (6..12s)
    expect(parsed.tracks.children[0]?.children.map((c) => c.OTIO_SCHEMA)).toEqual([
      'Clip.2',
      'Gap.1',
      'Clip.2',
    ]);
    expect(parsed.tracks.children[1]?.kind).toBe('Audio');
  });

  it('generates valid XML-escaped FCPXML v1.10 with video spine and audio lane', () => {
    const xml = generateFcpxml(SAMPLE_TIMELINE, 'Neo & Tokyo');
    expect(xml).toContain('<fcpxml version="1.10">');
    expect(xml).toContain('name="Neo &amp; Tokyo"');
    expect(xml).toContain('Plan 01 — Intro &amp; Rain');
    expect(xml).toContain('lane="-1"');
  });

  it('selects proxy in draft_proxy mode and original in hq_master mode', () => {
    const urls = { original: '/api/media/1/original', proxy: '/api/media/1/proxy', thumbnail: null };
    expect(selectTimelinePlaybackUrl(urls, 'video', 'draft_proxy')).toBe('/api/media/1/proxy');
    expect(selectTimelinePlaybackUrl(urls, 'video', 'hq_master')).toBe('/api/media/1/original');
    expect(selectTimelinePlaybackUrl(urls, 'audio', 'draft_proxy')).toBe('/api/media/1/original');
  });

  it('remains backward-compatible when exporting CapCut multi-layer timelines (overlay/text tracks, wipe_left, camera & structured fx)', () => {
    const capcutTimeline: TimelineDto = {
      ...SAMPLE_TIMELINE,
      tracks: [
        {
          ...SAMPLE_TIMELINE.tracks[0]!,
          clips: [
            {
              ...SAMPLE_TIMELINE.tracks[0]!.clips[0]!,
              transition: 'wipe_left',
              transitionDurationSec: 0.6,
              camera: {
                mode: 'power_pullback',
                z0: 1.34,
                z1: 1.0,
                cx0: 0.5,
                cx1: 0.5,
                cy0: 0.5,
                cy1: 0.5,
                rotDeg: 2,
                beatPulseAmp: 0.035,
                shakeAmp: 0.2,
                tremorAmp: 0,
              },
              cinemascope: { bar0: 0.25, bar1: 0.125 },
              fx: { mangaBlink: true, flashIn: { alpha: 0.8, color: '#FFFFFF', frames: 6 } },
            },
          ],
        },
        {
          id: '00000000-0000-4000-8000-000000000103',
          projectId: SAMPLE_TIMELINE.projectId,
          name: 'T1 · Titres',
          type: 'text',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 2,
          clips: [
            {
              ...SAMPLE_TIMELINE.tracks[0]!.clips[0]!,
              id: '00000000-0000-4000-8000-000000000209',
              trackId: '00000000-0000-4000-8000-000000000103',
              assetId: null,
              assetRef: null,
              assetType: null,
              title: 'Titre Principal',
              textOverlay: {
                text: 'NEO TOKYO',
                subtitle: 'Chapitre 1',
                fontSize: 64,
                color: '#FFFFFF',
                bgColor: '#000000',
                bgOpacity: 0,
                x: 50,
                y: 50,
                bold: true,
                animation: 'fade',
              },
            },
          ],
        },
        SAMPLE_TIMELINE.tracks[1]!,
      ],
    };

    const otio = JSON.parse(generateOtio(capcutTimeline, 'CapCut AMV')) as { OTIO_SCHEMA: string };
    expect(otio.OTIO_SCHEMA).toBe('Timeline.1');
    expect(generateFcpxml(capcutTimeline, 'CapCut AMV')).toContain('<fcpxml version="1.10">');
    expect(generateEdl(capcutTimeline, 'CapCut AMV')).toContain('TITLE: CAPCUT AMV');
  });
});

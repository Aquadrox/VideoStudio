import { describe, expect, it } from 'vitest';
import {
  BUILTIN_VIDEO_EFFECTS,
  compileClipCssPreview,
  evaluateCinemascopeBar,
  evaluateClipCameraFrame,
  evaluateFlashInState,
  evaluateMangaBlinkState,
  extractDownbeatTimesForClip,
  generateFloatingParticles,
  generateHorizSpeedLines,
  generateRadialSpeedLines,
  normalizeClipFx,
  sliceTimelineForRange,
  type TimelineDto,
  type VideoEffectDto,
} from '@videostudio/shared';

function buildCatalog(): Map<string, VideoEffectDto> {
  const map = new Map<string, VideoEffectDto>();
  for (const seed of BUILTIN_VIDEO_EFFECTS) {
    map.set(seed.slug, {
      id: `fx-${seed.slug}`,
      slug: seed.slug,
      name: seed.name,
      category: seed.category ?? 'video_fx',
      description: seed.description ?? '',
      icon: seed.icon ?? '✨',
      ffmpegFilterTemplate: seed.ffmpegFilterTemplate,
      cssPreviewFilter: seed.cssPreviewFilter ?? '',
      paramsSchema: seed.paramsSchema ?? [],
      defaultParams: seed.defaultParams ?? {},
      createdBy: 'system',
      isBuiltin: true,
      tags: seed.tags ?? [],
      usageCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  }
  return map;
}

describe('Web WYSIWYG Timeline Preview — Camera, Beat-Sync, Cinemascope & Structured AMV FX', () => {
  it('evaluates live WYSIWYG frame identically for Web Canvas and CSS preview', () => {
    const catalog = buildCatalog();
    const downbeats = extractDownbeatTimesForClip(
      [
        { timeSec: 10.0, label: 'Downbeat 1', kind: 'beat' },
        { timeSec: 11.0, label: 'Downbeat 2', kind: 'beat' },
        { timeSec: 12.0, label: 'Drop Impact', kind: 'marker' },
      ],
      10,
      4,
    );
    expect(downbeats).toEqual([0, 1, 2]);

    const clip = {
      id: 'amv-shot-07',
      startSec: 10,
      durationSec: 4,
      fadeInSec: 0,
      fadeOutSec: 0,
      camera: {
        mode: 'power_pullback' as const,
        z0: 1.34,
        z1: 1.0,
        cx0: 0.5,
        cx1: 0.5,
        cy0: 0.5,
        cy1: 0.5,
        rotDeg: 3,
        beatPulseAmp: 0.04,
        shakeAmp: 0.4,
        tremorAmp: 0.25,
      },
      cinemascope: { bar0: 0.25, bar1: 0.125 },
      fx: {
        mangaBlink: true,
        radialSpeedLines: { color: '#FFFFFF', intensity: 0.9, count: 48 },
        horizSpeedLines: { color: '#F5B942', direction: 'diag_up' as const, intensity: 0.7 },
        particles: { color: '#F5B942', count: 30, intensity: 0.85 },
        flashIn: { alpha: 0.9, color: '#FFFFFF', frames: 6 },
        fadeOutBlack: { durationSec: 0.6 },
      },
      flashIn: 0,
    };

    // Frame 2 (t = 2/24s = 0.0833s): mangaBlink inverted = true, flashIn still glowing, cinemascope near 0.25
    const t = 10 + 2 / 24;
    const css = compileClipCssPreview(clip, t, catalog, downbeats, 24);
    expect(css.filter).toContain('grayscale(1)');
    expect(css.filter).toContain('invert(1)');
    expect(css.flashOverlayOpacity).toBeGreaterThan(0.3);
    expect(css.cinemascopeBarFraction).toBeGreaterThan(0.24);

    // Verify procedural generators used by <TimelinePreviewCanvas>
    const nfx = normalizeClipFx(clip.fx, clip.flashIn);
    expect(evaluateMangaBlinkState(nfx, 2)).toEqual({ active: true, inverted: true });
    expect(evaluateFlashInState(nfx, 2 / 24, 24).alpha).toBeGreaterThan(0.3);
    expect(evaluateCinemascopeBar(clip.cinemascope, 2, 4)).toBeCloseTo(0.1875, 4);
    expect(generateRadialSpeedLines(clip.id, 2, nfx.radialSpeedLines!)).toHaveLength(48);
    expect(generateHorizSpeedLines(clip.id, 2, nfx.horizSpeedLines!).length).toBeGreaterThan(10);
    expect(generateFloatingParticles(clip.id, 1.5, nfx.particles!)).toHaveLength(30);

    // Verify beat pulse spike strictly on downbeat t=11.01s (local 1.01s)
    const camBeat = evaluateClipCameraFrame({
      clipId: clip.id,
      camera: clip.camera,
      fx: clip.fx,
      localTimeSec: 1.01,
      durationSec: 4,
      fps: 24,
      beatTimesInClip: downbeats,
    });
    expect(camBeat.beatPulse).toBeGreaterThan(0.025);
  });

  it('preserves range slicing invariants for the Range Preview button in TimelinePanel', () => {
    const timeline: TimelineDto = {
      projectId: 'p1',
      projectSlug: 'amv-demo',
      fps: 24,
      resolution: '1920x1080',
      qualityMode: 'draft_proxy',
      totalDurationSec: 20,
      renders: [],
      tracks: [
        {
          id: 't1',
          projectId: 'p1',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          volume: 1,
          sortOrder: 0,
          clips: [
            {
              id: 'c1',
              trackId: 't1',
              projectId: 'p1',
              assetId: 'a1',
              assetRef: '@vid-001',
              assetTitle: 'Shot 1',
              assetType: 'video',
              assetQualityTier: 'draft_lowres',
              title: 'Shot 1',
              startSec: 0,
              durationSec: 10,
              inSec: 0,
              outSec: 10,
              speed: 1,
              transition: 'cut',
              transitionDurationSec: 0,
              volume: 1,
              muted: false,
              notes: '',
              sortOrder: 0,
            },
            {
              id: 'c2',
              trackId: 't1',
              projectId: 'p1',
              assetId: 'a2',
              assetRef: '@vid-002',
              assetTitle: 'Shot 2',
              assetType: 'video',
              assetQualityTier: 'draft_lowres',
              title: 'Shot 2',
              startSec: 10,
              durationSec: 10,
              inSec: 0,
              outSec: 10,
              speed: 1,
              transition: 'cut',
              transitionDurationSec: 0,
              volume: 1,
              muted: false,
              notes: '',
              sortOrder: 1,
            },
          ],
        },
      ],
    };

    const previewSlice = sliceTimelineForRange(timeline, 8, 16);
    expect(previewSlice.totalDurationSec).toBe(8);
    expect(previewSlice.tracks[0]!.clips).toHaveLength(2);
    expect(previewSlice.tracks[0]!.clips[0]!.inSec).toBe(8);
    expect(previewSlice.tracks[0]!.clips[0]!.durationSec).toBe(2);
    expect(previewSlice.tracks[0]!.clips[1]!.startSec).toBe(2);
    expect(previewSlice.tracks[0]!.clips[1]!.durationSec).toBe(6);
  });
});

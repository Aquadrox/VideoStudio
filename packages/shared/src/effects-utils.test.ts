import { describe, expect, it } from 'vitest';
import {
  BUILTIN_VIDEO_EFFECTS,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  buildAtempoChain,
  buildClipSegmentCacheSignature,
  compileClipAudioFilterChain,
  compileClipCssPreview,
  compileClipVideoFilterChain,
  compileEffectFfmpegFilter,
  computeXfadeChainPlan,
  evaluateClipTransformAtTime,
  splitClipAtTime,
  validateFfmpegFilterTemplate,
  type VideoEffectDto,
} from './index.js';

function makeEffectDto(seed: (typeof BUILTIN_VIDEO_EFFECTS)[number]): VideoEffectDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
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
  };
}

describe('effects-utils (CapCut engine & custom AI effects)', () => {
  it('validates all 12 built-in effects as safe FFmpeg filter templates', () => {
    expect(BUILTIN_VIDEO_EFFECTS.length).toBeGreaterThanOrEqual(12);
    for (const fx of BUILTIN_VIDEO_EFFECTS) {
      const res = validateFfmpegFilterTemplate(fx.ffmpegFilterTemplate);
      expect(res.valid, `${fx.slug} failed: ${res.reason}`).toBe(true);
    }
  });

  it('rejects dangerous FFmpeg filters and injection payloads', () => {
    expect(validateFfmpegFilterTemplate('').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('movie=/etc/passwd').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('eq=contrast=1.2; [0:v]movie=evil.mp4').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('eq=contrast=1.2`id`').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('eq=contrast=1.2\nwhoami').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('lavfi=testsrc').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('lut3d=file=../../secret.cube').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('sendcmd=f=cmd.txt').valid).toBe(false);
  });

  it('compiles parameterized custom effects with clamped values', () => {
    const tealOrange = makeEffectDto(BUILTIN_VIDEO_EFFECTS[0]!);
    const compiled = compileEffectFfmpegFilter(tealOrange, {
      enabled: true,
      intensity: 1,
      params: { warmth: 9.9, contrast: 1.4 }, // warmth should clamp to max 0.4
    });
    expect(compiled).toContain('rs=0.4');
    expect(compiled).toContain('contrast=1.4');
    expect(compiled).toContain('saturation=1.2');

    // Disabled effect returns null
    expect(compileEffectFfmpegFilter(tealOrange, { enabled: false, intensity: 1, params: {} })).toBeNull();
  });

  it('builds complete clip video filter chain with speed, flip, color, custom FX, fades and drawtext', () => {
    const catalog = new Map<string, VideoEffectDto>();
    for (const seed of BUILTIN_VIDEO_EFFECTS) catalog.set(seed.slug, makeEffectDto(seed));

    const vf = compileClipVideoFilterChain(
      {
        durationSec: 4,
        speed: 2,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
        transform: { ...DEFAULT_CLIP_TRANSFORM, scale: 1.2, flipH: true, rotation: 5 },
        colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST, contrast: 1.2, blur: 1.5, vignette: 0.5 },
        effects: [{ effectSlug: 'glitch-rgb', enabled: true, intensity: 1, params: { shiftX: 12 } }],
        textOverlay: {
          text: "Scene 1: L'aube 100%",
          fontSize: 48,
          color: '#FFFFFF',
          bgColor: '#000000',
          bgOpacity: 0.5,
          x: 50,
          y: 80,
          bold: true,
          animation: 'fade',
        },
      },
      { width: 1280, height: 720, fps: 24, isImage: false, effectCatalog: catalog },
    );

    expect(vf).toContain('setpts=0.5*PTS');
    expect(vf).toContain('hflip');
    expect(vf).toContain('crop=1280:720');
    expect(vf).toContain('rotate=');
    expect(vf).toContain('eq=brightness=0:contrast=1.2');
    expect(vf).toContain('gblur=sigma=1.5');
    expect(vf).toContain('vignette=');
    expect(vf).toContain('rgbashift=rh=12');
    expect(vf).toContain('fade=t=in:st=0:d=0.5');
    expect(vf).toContain('fade=t=out:st=3.5:d=0.5');
    expect(vf).toContain('drawtext=');
    expect(vf).toContain('fps=24,format=yuv420p');
  });

  it('chains atempo accurately for 0.25x and 4x speeds and builds audio filter chain with adelay', () => {
    expect(buildAtempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(buildAtempoChain(4)).toEqual(['atempo=2.0', 'atempo=2']);
    expect(buildAtempoChain(1)).toEqual([]);

    const catalog = new Map<string, VideoEffectDto>();
    for (const seed of BUILTIN_VIDEO_EFFECTS) catalog.set(seed.slug, makeEffectDto(seed));

    const af = compileClipAudioFilterChain(
      {
        startSec: 2.5,
        durationSec: 4,
        inSec: 1,
        speed: 1.5,
        volume: 0.8,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
        effects: [{ effectSlug: 'audio-radio-voice', enabled: true, intensity: 1, params: {} }],
      },
      1.0,
      catalog,
    );
    expect(af).toContain('atrim=start=1:duration=6');
    expect(af).toContain('atempo=1.5');
    expect(af).toContain('highpass=f=320');
    expect(af).toContain('adelay=2500|2500');
  });

  it('computes accurate chained xfade offsets for multi-clip transitions', () => {
    const planCut = computeXfadeChainPlan([
      { durationSec: 4, transition: 'cut', transitionDurationSec: 0 },
      { durationSec: 3, transition: 'cut', transitionDurationSec: 0 },
    ]);
    expect(planCut.hasTransitions).toBe(false);
    expect(planCut.totalDurationSec).toBe(7);

    const planFade = computeXfadeChainPlan([
      { durationSec: 4, transition: 'cut', transitionDurationSec: 0 },
      { durationSec: 4, transition: 'crossfade', transitionDurationSec: 1 },
      { durationSec: 4, transition: 'wipe_left', transitionDurationSec: 0.5 },
    ]);
    expect(planFade.hasTransitions).toBe(true);
    expect(planFade.steps).toHaveLength(2);
    expect(planFade.steps[0]).toMatchObject({ transition: 'fade', durationSec: 1, offsetSec: 3 });
    expect(planFade.steps[1]).toMatchObject({ transition: 'wipeleft', durationSec: 0.5, offsetSec: 6.5 });
    expect(planFade.totalDurationSec).toBe(10.5);
  });

  it('interpolates keyframes and builds real-time CSS preview styles', () => {
    const tr = evaluateClipTransformAtTime(
      DEFAULT_CLIP_TRANSFORM,
      [
        { id: 'k1', timeOffsetSec: 0, property: 'scale', value: 1, easing: 'linear' },
        { id: 'k2', timeOffsetSec: 4, property: 'scale', value: 1.4, easing: 'linear' },
      ],
      2,
    );
    expect(tr.scale).toBeCloseTo(1.2, 3);

    const catalog = new Map<string, VideoEffectDto>();
    for (const seed of BUILTIN_VIDEO_EFFECTS) catalog.set(seed.slug, makeEffectDto(seed));

    const css = compileClipCssPreview(
      {
        startSec: 0,
        durationSec: 4,
        fadeInSec: 1,
        fadeOutSec: 0,
        transform: DEFAULT_CLIP_TRANSFORM,
        colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST, contrast: 1.2 },
        effects: [{ effectSlug: 'film-noir-bw', enabled: true, intensity: 1, params: {} }],
        keyframes: [
          { id: 'k1', timeOffsetSec: 0, property: 'scale', value: 1, easing: 'linear' },
          { id: 'k2', timeOffsetSec: 4, property: 'scale', value: 2, easing: 'linear' },
        ],
      },
      0.5,
      catalog,
    );
    expect(css.opacity).toBeCloseTo(0.5, 2);
    expect(css.filter).toContain('grayscale(1)');
    expect(css.transform).toContain('scale(1.125, 1.125)');
  });

  it('splits a clip cleanly at playhead advancing inSec by speed and splitting keyframes', () => {
    const split = splitClipAtTime(
      {
        title: 'Plan A',
        startSec: 2,
        durationSec: 6,
        inSec: 1,
        outSec: 13,
        speed: 2,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
        transition: 'crossfade' as const,
        transitionDurationSec: 0.5,
        keyframes: [
          { id: 'k1', timeOffsetSec: 1, property: 'scale' as const, value: 1, easing: 'linear' as const },
          { id: 'k2', timeOffsetSec: 4, property: 'scale' as const, value: 1.5, easing: 'linear' as const },
        ],
      },
      4,
    );
    expect(split).not.toBeNull();
    expect(split!.left.durationSec).toBe(2);
    expect(split!.left.inSec).toBe(1);
    expect(split!.left.keyframes).toHaveLength(1);
    expect(split!.right.startSec).toBe(4);
    expect(split!.right.durationSec).toBe(4);
    expect(split!.right.inSec).toBe(5); // 1 + 2 * 2x
    expect(split!.right.keyframes[0]?.timeOffsetSec).toBe(2);
    expect(split!.right.transition).toBe('cut');

    // Too close to edge -> null
    expect(splitClipAtTime(split!.left, 2.05)).toBeNull();
  });

  it('produces deterministic segment cache signatures that invalidate on single-property edits', () => {
    const baseClip = {
      inSec: 0,
      durationSec: 4,
      speed: 1,
      fadeInSec: 0,
      fadeOutSec: 0,
      transform: DEFAULT_CLIP_TRANSFORM,
      colorAdjust: DEFAULT_CLIP_COLOR_ADJUST,
      effects: [],
      textOverlay: null,
    };
    const sigA = buildClipSegmentCacheSignature({
      sourceFingerprint: 'asset1:1024:1700000',
      clip: baseClip,
      width: 1280,
      height: 720,
      fps: 24,
      qualityMode: 'draft_proxy',
      compiledVideoFilter: 'scale=1280:720',
    });
    const sigB = buildClipSegmentCacheSignature({
      sourceFingerprint: 'asset1:1024:1700000',
      clip: baseClip,
      width: 1280,
      height: 720,
      fps: 24,
      qualityMode: 'draft_proxy',
      compiledVideoFilter: 'scale=1280:720',
    });
    const sigChanged = buildClipSegmentCacheSignature({
      sourceFingerprint: 'asset1:1024:1700000',
      clip: { ...baseClip, speed: 1.5 },
      width: 1280,
      height: 720,
      fps: 24,
      qualityMode: 'draft_proxy',
      compiledVideoFilter: 'setpts=0.6667*PTS,scale=1280:720',
    });
    expect(sigA).toBe(sigB);
    expect(sigA).not.toBe(sigChanged);
  });
});

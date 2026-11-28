import { describe, expect, it } from 'vitest';
import {
  BUILTIN_VIDEO_EFFECTS,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  buildAtempoChain,
  buildClipSegmentCacheSignature,
  buildDrawtextFilter,
  compileAmvFxFilters,
  compileCameraFilter,
  compileCinemascopeFilter,
  compileClipAudioFilterChain,
  compileClipCssPreview,
  compileClipVideoFilterChain,
  compileEffectFfmpegFilter,
  computeXfadeChainPlan,
  evaluateClipTransformAtTime,
  extractDownbeatTimesForClip,
  rippleTrackClips,
  sliceTimelineForRange,
  splitClipAtTime,
  validateFfmpegFilterTemplate,
  type TimelineDto,
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

  it('blocks uppercase/file-reading bypasses while permitting legitimate nested filter expressions', () => {
    expect(validateFfmpegFilterTemplate('MOVIE=/etc/shadow').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('amovie=secret.wav').valid).toBe(false);
    expect(validateFfmpegFilterTemplate("drawtext=text='hi':fontfile=/etc/passwd").valid).toBe(false);
    expect(validateFfmpegFilterTemplate("drawtext=textfile=/etc/hosts").valid).toBe(false);
    expect(validateFfmpegFilterTemplate('frei0r=pixeliz0r').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('ladspa=f=evil').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('zmq=b=tcp://127.0.0.1:5555').valid).toBe(false);
    expect(validateFfmpegFilterTemplate('eq=contrast=1'.repeat(120)).valid).toBe(false);

    // Legitimate FFmpeg expressions with parentheses and commas inside expressions
    expect(
      validateFfmpegFilterTemplate('scale=iw/4:ih/4:flags=neighbor,scale=iw*4:ih*4:flags=neighbor').valid,
    ).toBe(true);
    expect(
      validateFfmpegFilterTemplate("eq=brightness='if(gt(t,1),0.1,0)'").valid,
    ).toBe(true);
  });

  it('handles zoom-out padding (scale < 1), flipV, ignores setpts on still images, and skips audio_fx on video chain', () => {
    const catalog = new Map<string, VideoEffectDto>();
    for (const seed of BUILTIN_VIDEO_EFFECTS) catalog.set(seed.slug, makeEffectDto(seed));

    const vf = compileClipVideoFilterChain(
      {
        durationSec: 4,
        speed: 2,
        fadeInSec: 0,
        fadeOutSec: 0,
        transform: { ...DEFAULT_CLIP_TRANSFORM, scale: 0.5, flipV: true },
        colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST },
        effects: [{ effectSlug: 'audio-radio-voice', enabled: true, intensity: 1, params: {} }],
        textOverlay: null,
      },
      { width: 1280, height: 720, fps: 24, isImage: true, effectCatalog: catalog },
    );

    expect(vf).not.toContain('setpts='); // still image must not apply setpts
    expect(vf).toContain('vflip');
    expect(vf).toContain('scale=640:360,pad=1280:720');
    expect(vf).not.toContain('highpass'); // audio_fx must not bleed into -vf
  });

  it('interpolates ease_in, ease_out, ease_in_out keyframes and clamps before/after bounds', () => {
    const kfs = [
      { id: 'k1', timeOffsetSec: 1, property: 'opacity' as const, value: 0, easing: 'linear' as const },
      { id: 'k2', timeOffsetSec: 3, property: 'opacity' as const, value: 1, easing: 'ease_in' as const },
    ];
    // Before first keyframe -> clamped to 0
    expect(evaluateClipTransformAtTime(DEFAULT_CLIP_TRANSFORM, kfs, 0).opacity).toBe(0);
    // Midpoint with ease_in (t=0.5 -> 0.5^2 = 0.25)
    expect(evaluateClipTransformAtTime(DEFAULT_CLIP_TRANSFORM, kfs, 2).opacity).toBeCloseTo(0.25, 3);
    // After last keyframe -> clamped to 1
    expect(evaluateClipTransformAtTime(DEFAULT_CLIP_TRANSFORM, kfs, 5).opacity).toBe(1);
  });

  it('avoids duplicate (2) suffixes and clears internal fades on repeated splits', () => {
    const split = splitClipAtTime(
      {
        title: 'Plan A (2)',
        startSec: 0,
        durationSec: 4,
        inSec: 0,
        outSec: null,
        speed: 1,
        fadeInSec: 1,
        fadeOutSec: 1,
        transition: 'fade_black' as const,
        transitionDurationSec: 0.5,
        keyframes: [],
      },
      2,
    );
    expect(split).not.toBeNull();
    expect(split!.right.title).toBe('Plan A (2)');
    expect(split!.left.fadeInSec).toBe(1);
    expect(split!.left.fadeOutSec).toBe(0);
    expect(split!.right.fadeInSec).toBe(0);
    expect(split!.right.fadeOutSec).toBe(1);
  });

  it('compiles camera modes (power_pullback, crash_zoom, p05_vertigo) with downbeat beatPulseAmp, rotDeg, shakeAmp & tremorAmp', () => {
    const vf = compileCameraFilter(
      {
        mode: 'power_pullback',
        z0: 1.34,
        z1: 1.0,
        rotDeg: 3.5,
        beatPulseAmp: 0.04,
        shakeAmp: 0.5,
        tremorAmp: 0.3,
      },
      4,
      1280,
      720,
      [0.5, 1.5, 2.5],
    );
    expect(vf).not.toBeNull();
    expect(vf!).toContain('gte(t,0.5)');
    expect(vf!).toContain('gte(t,1.5)');
    expect(vf!).toContain('exp(-7*t)');
    expect(vf!).toContain('rotate=');

    const staticNull = compileCameraFilter({ mode: 'static', z0: 1, z1: 1 }, 4, 1280, 720);
    expect(staticNull).toBeNull();
  });

  it('compiles static Cinemascope bars via fast drawbox and animated bars via ease-in-out geq', () => {
    const staticScope = compileCinemascopeFilter({ bar0: 0.125, bar1: 0.125 }, 4, 1280, 720);
    expect(staticScope).toContain('drawbox=x=0:y=0:w=iw:h=90:color=black:t=fill');
    expect(staticScope).toContain('drawbox=x=0:y=ih-90:w=iw:h=90:color=black:t=fill');

    const animScope = compileCinemascopeFilter({ bar0: 0.25, bar1: 0.125 }, 4, 1280, 720);
    expect(animScope).toContain('geq=');
    expect(animScope).toContain('0.25');
  });

  it('compiles both legacy AMV tag arrays and structured ClipAmvFxObject into FFmpeg filters & rich drawtext', () => {
    const fromTags = compileAmvFxFilters(['shake', 'manga_ink_blink', 'flash_gold'], 0.8, 4, 1280, 720, 24);
    expect(fromTags.some((f) => f.includes('negate=enable='))).toBe(true);
    expect(fromTags.some((f) => f.includes('0xF5B942'))).toBe(true);

    const fromObj = compileAmvFxFilters(
      {
        mangaBlink: true,
        radialSpeedLines: { color: '#FFFFFF', intensity: 0.9, count: 48 },
        particles: { color: '#F5B942', count: 32, intensity: 0.85 },
        flashIn: { alpha: 0.9, color: '#FFFFFF', frames: 6 },
        fadeOutBlack: { durationSec: 0.75 },
      },
      0,
      4,
      1280,
      720,
      24,
    );
    expect(fromObj.some((f) => f.includes('negate=enable='))).toBe(true);
    expect(fromObj.some((f) => f.includes('fade=t=in:st=0:d=0.25:color=0xFFFFFF'))).toBe(true);
    expect(fromObj.some((f) => f.includes('fade=t=out:st=3.25:d=0.75:color=black'))).toBe(true);

    const txt = buildDrawtextFilter(
      {
        text: 'ACTE I',
        subtitle: 'Le Réveil',
        fontSize: 60,
        color: '#FFFFFF',
        strokeColor: '#111111',
        glowColor: '#F5B942',
        bgColor: '#000000',
        bgOpacity: 0,
        x: 50,
        y: 50,
        bold: true,
        fadeInSec: 0.3,
        fadeOutSec: 0.4,
        animation: 'fade',
      },
      1280,
      720,
      4,
    );
    expect(txt).toContain("text='ACTE I'");
    expect(txt).toContain("text='Le Réveil'");
    expect(txt).toContain('bordercolor=0x111111@0.85');
    expect(txt).toContain('shadowcolor=0xF5B942@0.75');
    expect(txt).toContain("alpha='min(");
  });

  it('extracts deduplicated local downbeats, ripples track startSec, and slices range preserving interior cache hits', () => {
    const beats = extractDownbeatTimesForClip(
      [
        { timeSec: 9.5, label: 'Beat', kind: 'beat' },
        { timeSec: 10.5, label: 'Downbeat 1', kind: 'beat' },
        { timeSec: 10.52, label: 'Duplicate', kind: 'beat' },
        { timeSec: 12.0, label: 'Drop Impact', kind: 'marker' },
        { timeSec: 15.0, label: 'Outside', kind: 'beat' },
      ],
      10,
      4,
    );
    expect(beats).toEqual([0.5, 2]);

    const rippled = rippleTrackClips([
      { id: 'a', startSec: 12, durationSec: 3.5 },
      { id: 'b', startSec: 99, durationSec: 2.25 },
      { id: 'c', startSec: 0, durationSec: 4 },
    ]);
    expect(rippled.map((c) => c.startSec)).toEqual([0, 3.5, 5.75]);

    const tl: TimelineDto = {
      projectId: 'p1',
      projectSlug: 'demo',
      fps: 24,
      resolution: '1280x720',
      qualityMode: 'draft_proxy',
      totalDurationSec: 12,
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
              assetTitle: 'C1',
              assetType: 'video',
              assetQualityTier: 'draft_lowres',
              title: 'C1',
              startSec: 0,
              durationSec: 4,
              inSec: 0,
              outSec: 4,
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
              assetTitle: 'C2',
              assetType: 'video',
              assetQualityTier: 'draft_lowres',
              title: 'C2',
              startSec: 4,
              durationSec: 4,
              inSec: 1,
              outSec: 5,
              speed: 1,
              transition: 'crossfade',
              transitionDurationSec: 0.5,
              volume: 1,
              muted: false,
              notes: '',
              sortOrder: 1,
            },
            {
              id: 'c3',
              trackId: 't1',
              projectId: 'p1',
              assetId: 'a3',
              assetRef: '@vid-003',
              assetTitle: 'C3',
              assetType: 'video',
              assetQualityTier: 'draft_lowres',
              title: 'C3',
              startSec: 8,
              durationSec: 4,
              inSec: 0,
              outSec: 4,
              speed: 1,
              transition: 'cut',
              transitionDurationSec: 0,
              volume: 1,
              muted: false,
              notes: '',
              sortOrder: 2,
            },
          ],
        },
      ],
    };

    const sliced = sliceTimelineForRange(tl, 2, 10);
    const clips = sliced.tracks[0]!.clips;
    expect(clips).toHaveLength(3);
    // Edge clip c1 trimmed from 2..4 -> inSec=2, dur=2, startSec=0
    expect(clips[0]!.startSec).toBe(0);
    expect(clips[0]!.inSec).toBe(2);
    expect(clips[0]!.durationSec).toBe(2);
    // Interior clip c2 keeps EXACT inSec=1, outSec=5, durationSec=4 -> 100% cache hit!
    expect(clips[1]!.startSec).toBe(2);
    expect(clips[1]!.inSec).toBe(1);
    expect(clips[1]!.outSec).toBe(5);
    expect(clips[1]!.durationSec).toBe(4);
    // Edge clip c3 trimmed from 8..10 -> inSec=0, dur=2, startSec=6
    expect(clips[2]!.startSec).toBe(6);
    expect(clips[2]!.durationSec).toBe(2);
  });
});

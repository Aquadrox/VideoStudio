import {
  type AmvFxTag,
  type ClipAmvFxObject,
  type ClipCamera,
  type ClipCinemascope,
  type ClipFx,
  type ClipTextOverlay,
  type FadeOutBlackFx,
  type FlashInFx,
  type HorizSpeedLinesFx,
  type ParticlesFx,
  type RadialSpeedLinesFx,
  DEFAULT_CLIP_CAMERA,
} from './effects-schemas.js';

// ============================================================================
// Shared Deterministic WYSIWYG AMV Camera, Cinemascope & FX Engine
// Used identically by Web UI `<TimelinePreviewCanvas>` AND Server Render Engine
// ============================================================================

/**
 * Deterministic 32-bit FNV-1a hash (exact match to Python implementation using `& 0xFFFFFFFF`).
 */
export function hashString32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic Mulberry32 PRNG returning floats in `[0, 1)`.
 * Uses pure 32-bit unsigned integer ops so JS and Python produce the exact same sequence.
 */
export function createDeterministicRng(seedStr: string): () => number {
  let state = hashString32(seedStr);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0;
    t = (t + (Math.imul(t ^ (t >>> 7), 61 | t) >>> 0)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard cubic ease-in-out curve `p ∈ [0, 1] -> [0, 1]`.
 */
export function easeInOutCubic(rawP: number): number {
  const p = Math.max(0, Math.min(1, rawP));
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export interface NormalizedClipFx {
  mangaBlink: boolean;
  radialSpeedLines: RadialSpeedLinesFx | null;
  horizSpeedLines: HorizSpeedLinesFx | null;
  particles: ParticlesFx | null;
  flashIn: FlashInFx | null;
  fadeOutBlack: FadeOutBlackFx | null;
  /** Implicit shake amplitude added when legacy tag `"shake"` is present */
  legacyShakeAmp: number;
  /** Implicit tremor amplitude added when legacy tag `"power_tremor"` is present */
  legacyTremorAmp: number;
}

/**
 * Normalizes EITHER legacy AMV FX tag arrays (`["shake", "manga_ink_blink", "flash_gold"]`)
 * OR structured AMV FX objects (`{ mangaBlink, radialSpeedLines, horizSpeedLines, particles, flashIn, fadeOutBlack }`)
 * plus legacy scalar `flashIn` (`0..1`) into ONE canonical `NormalizedClipFx` structure.
 */
export function normalizeClipFx(
  fx?: ClipFx | null,
  legacyFlashIn?: number | null,
): NormalizedClipFx {
  const out: NormalizedClipFx = {
    mangaBlink: false,
    radialSpeedLines: null,
    horizSpeedLines: null,
    particles: null,
    flashIn: null,
    fadeOutBlack: null,
    legacyShakeAmp: 0,
    legacyTremorAmp: 0,
  };

  if (Array.isArray(fx)) {
    const tags = new Set<AmvFxTag>(fx);
    if (tags.has('shake')) out.legacyShakeAmp = 0.35;
    if (tags.has('power_tremor')) out.legacyTremorAmp = 0.55;
    if (tags.has('manga_ink_blink')) out.mangaBlink = true;
    if (tags.has('radial_speed_lines')) {
      out.radialSpeedLines = { color: '#FFFFFF', intensity: 0.85, count: 48 };
    }
    if (tags.has('horiz_speed_lines')) {
      out.horizSpeedLines = { color: '#FFFFFF', direction: 'left', intensity: 0.8 };
    }
    if (tags.has('particles_gold')) {
      out.particles = { color: '#F5B942', count: 36, intensity: 0.9 };
    }
    if (tags.has('flash_gold')) {
      const alpha = legacyFlashIn && legacyFlashIn > 0 ? Math.min(1, legacyFlashIn) : 0.85;
      out.flashIn = { alpha, color: '#F5B942', frames: 7 };
    } else if (tags.has('flash_white')) {
      const alpha = legacyFlashIn && legacyFlashIn > 0 ? Math.min(1, legacyFlashIn) : 0.85;
      out.flashIn = { alpha, color: '#FFFFFF', frames: 6 };
    }
  } else if (fx && typeof fx === 'object') {
    const obj = fx as ClipAmvFxObject;
    if (obj.mangaBlink) out.mangaBlink = true;
    if (obj.radialSpeedLines && obj.radialSpeedLines.intensity > 0) {
      out.radialSpeedLines = {
        color: obj.radialSpeedLines.color || '#FFFFFF',
        intensity: obj.radialSpeedLines.intensity,
        count: obj.radialSpeedLines.count ?? 48,
      };
    }
    if (obj.horizSpeedLines && obj.horizSpeedLines.intensity > 0) {
      out.horizSpeedLines = {
        color: obj.horizSpeedLines.color || '#FFFFFF',
        direction: obj.horizSpeedLines.direction || 'left',
        intensity: obj.horizSpeedLines.intensity,
      };
    }
    if (obj.particles && obj.particles.count > 0 && (obj.particles.intensity ?? 0.85) > 0) {
      out.particles = {
        color: obj.particles.color || '#F5B942',
        count: obj.particles.count,
        intensity: obj.particles.intensity ?? 0.85,
      };
    }
    if (obj.flashIn && obj.flashIn.alpha > 0) {
      out.flashIn = {
        alpha: Math.max(0, Math.min(1, obj.flashIn.alpha)),
        color: obj.flashIn.color || '#FFFFFF',
        frames: Math.max(1, Math.round(obj.flashIn.frames ?? 6)),
      };
    }
    if (obj.fadeOutBlack && obj.fadeOutBlack.durationSec > 0) {
      out.fadeOutBlack = { durationSec: obj.fadeOutBlack.durationSec };
    }
  }

  if (!out.flashIn && legacyFlashIn && legacyFlashIn > 0.02) {
    out.flashIn = {
      alpha: Math.max(0, Math.min(1, legacyFlashIn)),
      color: '#FFFFFF',
      frames: Math.max(3, Math.round(4 + legacyFlashIn * 6)),
    };
  }

  return out;
}

/**
 * Resolves full camera configuration from mode defaults + explicit overrides.
 */
export function resolveClipCamera(camera?: Partial<ClipCamera> | null): ClipCamera | null {
  if (!camera) return null;
  const mode = camera.mode ?? 'static';
  const modeDefaults: Record<ClipCamera['mode'], Partial<ClipCamera>> = {
    static: { z0: 1, z1: 1, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    push: { z0: 1.0, z1: 1.18, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    ease: { z0: 1.0, z1: 1.14, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    pull_back: { z0: 1.2, z1: 1.0, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    power_pullback: { z0: 1.34, z1: 1.0, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    crash_zoom: { z0: 1.0, z1: 1.45, cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 },
    p05_vertigo: { z0: 1.05, z1: 1.32, cx0: 0.5, cx1: 0.5, cy0: 0.48, cy1: 0.52 },
    pan: { z0: 1.15, z1: 1.15, cx0: 0.35, cx1: 0.65, cy0: 0.5, cy1: 0.5 },
  };
  return {
    ...DEFAULT_CLIP_CAMERA,
    ...modeDefaults[mode],
    ...camera,
    mode,
  };
}

/**
 * Returns true if the clip uses rich procedural AMV FX or camera jitter/rotation
 * that benefit from the pixel-exact Python Pillow/NumPy renderer when available on the server.
 */
export function hasProceduralAmvFx(
  camera?: Partial<ClipCamera> | null,
  cinemascope?: Partial<ClipCinemascope> | null,
  fx?: ClipFx | null,
  legacyFlashIn?: number | null,
): boolean {
  const nfx = normalizeClipFx(fx, legacyFlashIn);
  if (
    nfx.mangaBlink ||
    nfx.radialSpeedLines ||
    nfx.horizSpeedLines ||
    nfx.particles ||
    nfx.flashIn ||
    nfx.fadeOutBlack ||
    nfx.legacyShakeAmp > 0 ||
    nfx.legacyTremorAmp > 0
  ) {
    return true;
  }
  const cam = resolveClipCamera(camera);
  if (
    cam &&
    (Math.abs(cam.rotDeg) > 0.05 ||
      cam.shakeAmp > 0.005 ||
      cam.tremorAmp > 0.005 ||
      cam.beatPulseAmp > 0.005 ||
      cam.mode !== 'static')
  ) {
    return true;
  }
  if (cinemascope && ((cinemascope.bar0 ?? 0) > 0.002 || (cinemascope.bar1 ?? 0) > 0.002)) {
    return true;
  }
  return false;
}

export interface EvaluatedCameraFrame {
  /** Total zoom factor (including beat pulse) */
  z: number;
  /** Focal center X in normalized frame coords `[0..1]` */
  cx: number;
  /** Focal center Y in normalized frame coords `[0..1]` */
  cy: number;
  /** Deterministic horizontal displacement in normalized frame width (`-0.1 .. +0.1`) from shake/tremor */
  dx: number;
  /** Deterministic vertical displacement in normalized frame height (`-0.1 .. +0.1`) from shake/tremor */
  dy: number;
  /** Rotation in degrees */
  rotDeg: number;
  /** Extra zoom contribution from beat pulse */
  beatPulse: number;
}

/**
 * Evaluates exact deterministic `(z, cx, cy, dx, dy, rotDeg)` for a clip at `localTimeSec` / `frameIndex`.
 * Uses `createDeterministicRng(clipId + ":" + frameIndex)` so Web `<canvas>` and Server render are frame-identical.
 */
export function evaluateClipCameraFrame(params: {
  clipId: string;
  camera?: Partial<ClipCamera> | null;
  fx?: ClipFx | null;
  legacyFlashIn?: number | null;
  localTimeSec: number;
  durationSec: number;
  fps: number;
  beatTimesInClip?: number[];
}): EvaluatedCameraFrame {
  const cam = resolveClipCamera(params.camera);
  const nfx = normalizeClipFx(params.fx, params.legacyFlashIn);
  const dur = Math.max(0.05, params.durationSec);
  const t = Math.max(0, Math.min(dur, params.localTimeSec));
  const fps = Math.max(1, params.fps || 24);
  const frameIndex = Math.max(0, Math.floor(t * fps + 1e-6));
  const p = Math.max(0, Math.min(1, t / dur));

  let z = 1;
  let cx = 0.5;
  let cy = 0.5;
  let rotDeg = 0;
  let beatPulse = 0;

  if (cam) {
    let curve = p;
    if (cam.mode === 'crash_zoom') {
      curve = Math.pow(p, 2.4);
    } else if (cam.mode === 'power_pullback') {
      // Fast explosive launch then smooth settle (easeOutExpo-like)
      curve = 1 - Math.pow(1 - p, 3);
    } else if (
      cam.mode === 'ease' ||
      cam.mode === 'push' ||
      cam.mode === 'pull_back' ||
      cam.mode === 'pan' ||
      cam.mode === 'p05_vertigo'
    ) {
      curve = easeInOutCubic(p);
    }

    z = cam.z0 + (cam.z1 - cam.z0) * curve;
    cx = cam.cx0 + (cam.cx1 - cam.cx0) * curve;
    cy = cam.cy0 + (cam.cy1 - cam.cy0) * curve;
    rotDeg = cam.rotDeg * (cam.mode === 'p05_vertigo' ? Math.sin(p * Math.PI) : curve);

    if (cam.mode === 'p05_vertigo') {
      z += 0.04 * Math.sin(t * Math.PI);
    }

    if (cam.beatPulseAmp > 0.002) {
      const beats = params.beatTimesInClip ?? [];
      if (beats.length > 0) {
        for (const bt of beats) {
          if (t >= bt) {
            beatPulse += cam.beatPulseAmp * Math.exp(-16 * (t - bt));
          }
        }
      } else {
        beatPulse += cam.beatPulseAmp * Math.exp(-14 * (t % 0.5));
      }
      z += beatPulse;
    }
  }

  const shakeAmp = Math.max(cam?.shakeAmp ?? 0, nfx.legacyShakeAmp);
  const tremorAmp = Math.max(cam?.tremorAmp ?? 0, nfx.legacyTremorAmp);

  let dx = 0;
  let dy = 0;

  if (shakeAmp > 0.001 || tremorAmp > 0.001) {
    const rng = createDeterministicRng(`${params.clipId}:cam:${frameIndex}`);
    const rx = rng() * 2 - 1;
    const ry = rng() * 2 - 1;
    const rRot = rng() * 2 - 1;

    if (shakeAmp > 0.001) {
      const decay = Math.exp(-7 * t);
      const amp = shakeAmp * 0.035 * decay;
      dx += rx * amp;
      dy += ry * amp;
      rotDeg += rRot * shakeAmp * 2.2 * decay;
      // Slight overscan zoom to hide edges during shake
      z = Math.max(z, 1 + shakeAmp * 0.08 * decay);
    }

    if (tremorAmp > 0.001) {
      const amp = tremorAmp * 0.022;
      dx += rx * amp;
      dy += ry * amp;
      rotDeg += rRot * tremorAmp * 1.4;
      z = Math.max(z, 1 + tremorAmp * 0.07);
    }
  }

  return {
    z: Math.max(0.5, z),
    cx: Math.max(0, Math.min(1, cx)),
    cy: Math.max(0, Math.min(1, cy)),
    dx,
    dy,
    rotDeg,
    beatPulse,
  };
}

/**
 * Evaluates exact Cinemascope letterbox bar fraction (`0..0.45`) using `easeInOutCubic`.
 */
export function evaluateCinemascopeBar(
  cinemascope: Partial<ClipCinemascope> | null | undefined,
  localTimeSec: number,
  durationSec: number,
): number {
  if (!cinemascope) return 0;
  const bar0 = Math.max(0, Math.min(0.45, cinemascope.bar0 ?? 0));
  const bar1 = Math.max(0, Math.min(0.45, cinemascope.bar1 ?? bar0));
  if (bar0 < 0.001 && bar1 < 0.001) return 0;
  const p = Math.max(0, Math.min(1, localTimeSec / Math.max(0.05, durationSec)));
  return bar0 + (bar1 - bar0) * easeInOutCubic(p);
}

/**
 * Evaluates Manga Ink Blink state: B&W high-contrast ink filter + inversion every 2 frames.
 */
export function evaluateMangaBlinkState(
  fx: NormalizedClipFx,
  frameIndex: number,
): { active: boolean; inverted: boolean } {
  if (!fx.mangaBlink) return { active: false, inverted: false };
  const inverted = Math.floor(Math.max(0, frameIndex) / 2) % 2 === 1;
  return { active: true, inverted };
}

/**
 * Evaluates Flash-In overlay alpha & color at cut entry (`frames` frames).
 */
export function evaluateFlashInState(
  fx: NormalizedClipFx,
  localTimeSec: number,
  fps: number,
): { alpha: number; color: string } {
  if (!fx.flashIn || fx.flashIn.alpha <= 0) return { alpha: 0, color: '#FFFFFF' };
  const flashDurSec = Math.max(1 / Math.max(1, fps), fx.flashIn.frames / Math.max(1, fps));
  if (localTimeSec < 0 || localTimeSec >= flashDurSec) {
    return { alpha: 0, color: fx.flashIn.color };
  }
  const tNorm = localTimeSec / flashDurSec;
  const alpha = fx.flashIn.alpha * Math.pow(1 - tNorm, 1.5);
  return { alpha: Math.max(0, Math.min(1, alpha)), color: fx.flashIn.color };
}

/**
 * Evaluates Fade-Out-to-Black alpha at the end of the clip (from `fx.fadeOutBlack` or `clip.fadeOutSec`).
 */
export function evaluateFadeOutBlackAlpha(
  fx: NormalizedClipFx,
  clipFadeOutSec: number | undefined,
  localTimeSec: number,
  durationSec: number,
): number {
  const fadeDur = Math.max(fx.fadeOutBlack?.durationSec ?? 0, clipFadeOutSec ?? 0);
  if (fadeDur <= 0.01) return 0;
  const remaining = durationSec - localTimeSec;
  if (remaining >= fadeDur) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, remaining) / fadeDur));
}

export interface RadialSpeedLineSpec {
  angleRad: number;
  innerRadiusFrac: number;
  outerRadiusFrac: number;
  lineWidthFrac: number;
  alpha: number;
}

/**
 * Generates deterministic radial anime speed lines for `(clipId, frameIndex)`.
 */
export function generateRadialSpeedLines(
  clipId: string,
  frameIndex: number,
  config: RadialSpeedLinesFx,
): RadialSpeedLineSpec[] {
  const count = Math.max(4, Math.min(200, Math.round(config.count ?? 48)));
  const intensity = Math.max(0, Math.min(2, config.intensity));
  if (intensity <= 0.01) return [];

  // Step every 2 frames for classic anime snappy motion
  const stepIdx = Math.floor(Math.max(0, frameIndex) / 2);
  const rng = createDeterministicRng(`${clipId}:radial:${stepIdx}`);
  const lines: RadialSpeedLineSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const baseAngle = (i / count) * Math.PI * 2;
    const jitter = (rng() - 0.5) * ((Math.PI * 2) / count) * 0.85;
    const innerRadiusFrac = 0.24 + rng() * 0.28;
    const outerRadiusFrac = 0.72 + rng() * 0.28;
    const lineWidthFrac = (0.0014 + rng() * 0.0038) * Math.min(1.4, 0.7 + intensity * 0.4);
    const alpha = Math.min(1, (0.28 + rng() * 0.55) * intensity);
    lines.push({
      angleRad: baseAngle + jitter,
      innerRadiusFrac,
      outerRadiusFrac,
      lineWidthFrac,
      alpha,
    });
  }
  return lines;
}

export interface HorizSpeedLineSpec {
  xFrac: number;
  yFrac: number;
  lengthFrac: number;
  widthFrac: number;
  alpha: number;
  dxDir: number;
  dyDir: number;
}

/**
 * Generates deterministic directional anime speed lines (`left`, `right`, `diag_up`, `vert_down`).
 */
export function generateHorizSpeedLines(
  clipId: string,
  frameIndex: number,
  config: HorizSpeedLinesFx,
): HorizSpeedLineSpec[] {
  const intensity = Math.max(0, Math.min(2, config.intensity));
  if (intensity <= 0.01) return [];

  const count = Math.max(12, Math.min(90, Math.round(32 * intensity)));
  const stepIdx = Math.floor(Math.max(0, frameIndex) / 2);
  const rng = createDeterministicRng(`${clipId}:hspeed:${config.direction}:${stepIdx}`);

  let dxDir = -1;
  let dyDir = 0;
  if (config.direction === 'right') {
    dxDir = 1;
    dyDir = 0;
  } else if (config.direction === 'diag_up') {
    dxDir = 0.866;
    dyDir = -0.5;
  } else if (config.direction === 'vert_down') {
    dxDir = 0;
    dyDir = 1;
  }

  const lines: HorizSpeedLineSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    lines.push({
      xFrac: rng(),
      yFrac: rng(),
      lengthFrac: 0.14 + rng() * 0.32,
      widthFrac: (0.0012 + rng() * 0.0032) * Math.min(1.4, 0.75 + intensity * 0.35),
      alpha: Math.min(1, (0.22 + rng() * 0.52) * intensity),
      dxDir,
      dyDir,
    });
  }
  return lines;
}

export interface ParticleOrbSpec {
  xFrac: number;
  yFrac: number;
  radiusFrac: number;
  alpha: number;
}

/**
 * Generates deterministic glowing floating orbs (additive light particles) smoothly animated over `localTimeSec`.
 */
export function generateFloatingParticles(
  clipId: string,
  localTimeSec: number,
  config: ParticlesFx,
): ParticleOrbSpec[] {
  const count = Math.max(1, Math.min(200, Math.round(config.count)));
  const intensity = Math.max(0, Math.min(2, config.intensity ?? 0.85));
  if (intensity <= 0.01) return [];

  const rng = createDeterministicRng(`${clipId}:particles:init`);
  const orbs: ParticleOrbSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const x0 = rng();
    const y0 = rng();
    const speedY = 0.06 + rng() * 0.16;
    const driftAmp = 0.015 + rng() * 0.035;
    const driftFreq = 0.8 + rng() * 2.2;
    const phase = rng() * Math.PI * 2;
    const radiusFrac = 0.0035 + rng() * 0.011;
    const baseAlpha = 0.35 + rng() * 0.55;

    const rawY = (y0 - localTimeSec * speedY) % 1;
    const yFrac = rawY < 0 ? rawY + 1 : rawY;
    const rawX = (x0 + Math.sin(localTimeSec * driftFreq + phase) * driftAmp) % 1;
    const xFrac = rawX < 0 ? rawX + 1 : rawX;
    const twinkle = 0.65 + 0.35 * Math.sin(localTimeSec * (2.5 + driftFreq) + phase);

    orbs.push({
      xFrac,
      yFrac,
      radiusFrac,
      alpha: Math.min(1, baseAlpha * twinkle * intensity),
    });
  }
  return orbs;
}

/**
 * Computes opacity `[0..1]` of a `textOverlay` clip at `localTimeSec` with `fadeInSec` / `fadeOutSec`.
 */
export function evaluateTextOverlayOpacity(
  overlay: ClipTextOverlay,
  localTimeSec: number,
  durationSec: number,
): number {
  const dur = Math.max(0.05, durationSec);
  const t = Math.max(0, Math.min(dur, localTimeSec));
  const fadeIn = overlay.fadeInSec ?? (overlay.animation === 'fade' ? 0.25 : 0);
  const fadeOut = overlay.fadeOutSec ?? (overlay.animation === 'fade' ? 0.25 : 0);

  let alpha = 1;
  if (fadeIn > 0.01 && t < fadeIn) {
    alpha = Math.min(alpha, t / fadeIn);
  }
  if (fadeOut > 0.01 && dur - t < fadeOut) {
    alpha = Math.min(alpha, Math.max(0, dur - t) / fadeOut);
  }
  return Math.max(0, Math.min(1, alpha));
}

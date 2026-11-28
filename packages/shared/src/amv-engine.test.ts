import { describe, expect, it } from 'vitest';
import {
  createDeterministicRng,
  easeInOutCubic,
  evaluateCinemascopeBar,
  evaluateClipCameraFrame,
  evaluateFadeOutBlackAlpha,
  evaluateFlashInState,
  evaluateMangaBlinkState,
  evaluateTextOverlayOpacity,
  generateFloatingParticles,
  generateHorizSpeedLines,
  generateRadialSpeedLines,
  hasProceduralAmvFx,
  hashString32,
  normalizeClipFx,
  resolveClipCamera,
} from './amv-engine.js';

describe('amv-engine — Shared Deterministic WYSIWYG Camera, Cinemascope & AMV FX', () => {
  it('produces identical deterministic FNV-1a hashes and Mulberry32 sequences for the same seed', () => {
    const h1 = hashString32('clip-42:cam:12');
    const h2 = hashString32('clip-42:cam:12');
    const h3 = hashString32('clip-42:cam:13');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);

    const rngA = createDeterministicRng('clip-42:cam:12');
    const rngB = createDeterministicRng('clip-42:cam:12');
    const seqA = [rngA(), rngA(), rngA(), rngA()];
    const seqB = [rngB(), rngB(), rngB(), rngB()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('normalizes both legacy AMV FX tag arrays and rich structured ClipAmvFxObject identically', () => {
    const fromTags = normalizeClipFx(
      ['shake', 'power_tremor', 'manga_ink_blink', 'radial_speed_lines', 'horiz_speed_lines', 'particles_gold', 'flash_gold'],
      0.7,
    );
    expect(fromTags.legacyShakeAmp).toBeGreaterThan(0);
    expect(fromTags.legacyTremorAmp).toBeGreaterThan(0);
    expect(fromTags.mangaBlink).toBe(true);
    expect(fromTags.radialSpeedLines?.count).toBe(48);
    expect(fromTags.horizSpeedLines?.direction).toBe('left');
    expect(fromTags.particles?.color).toBe('#F5B942');
    expect(fromTags.flashIn?.color).toBe('#F5B942');
    expect(fromTags.flashIn?.alpha).toBeCloseTo(0.7, 2);

    const fromObj = normalizeClipFx({
      mangaBlink: true,
      radialSpeedLines: { color: '#00E5FF', intensity: 1.2, count: 64 },
      horizSpeedLines: { color: '#FF0066', direction: 'diag_up', intensity: 0.9 },
      particles: { color: '#FFD700', count: 50, intensity: 1.1 },
      flashIn: { alpha: 0.9, color: '#FFFFFF', frames: 8 },
      fadeOutBlack: { durationSec: 0.8 },
    });
    expect(fromObj.mangaBlink).toBe(true);
    expect(fromObj.radialSpeedLines).toEqual({ color: '#00E5FF', intensity: 1.2, count: 64 });
    expect(fromObj.horizSpeedLines).toEqual({ color: '#FF0066', direction: 'diag_up', intensity: 0.9 });
    expect(fromObj.particles).toEqual({ color: '#FFD700', count: 50, intensity: 1.1 });
    expect(fromObj.flashIn).toEqual({ alpha: 0.9, color: '#FFFFFF', frames: 8 });
    expect(fromObj.fadeOutBlack).toEqual({ durationSec: 0.8 });
  });

  it('evaluates camera modes (push, power_pullback, crash_zoom, p05_vertigo), beatPulseAmp, shakeAmp, tremorAmp & rotDeg deterministically', () => {
    const startFrame = evaluateClipCameraFrame({
      clipId: 'clip-1',
      camera: { mode: 'power_pullback', z0: 1.34, z1: 1.0, rotDeg: 4, beatPulseAmp: 0.05 },
      localTimeSec: 0,
      durationSec: 4,
      fps: 24,
      beatTimesInClip: [1.0, 2.0],
    });
    const beatHitFrame = evaluateClipCameraFrame({
      clipId: 'clip-1',
      camera: { mode: 'power_pullback', z0: 1.34, z1: 1.0, rotDeg: 4, beatPulseAmp: 0.05 },
      localTimeSec: 1.01,
      durationSec: 4,
      fps: 24,
      beatTimesInClip: [1.0, 2.0],
    });
    const endFrame = evaluateClipCameraFrame({
      clipId: 'clip-1',
      camera: { mode: 'power_pullback', z0: 1.34, z1: 1.0, rotDeg: 4, beatPulseAmp: 0.05 },
      localTimeSec: 4.0,
      durationSec: 4,
      fps: 24,
      beatTimesInClip: [1.0, 2.0],
    });

    expect(startFrame.z).toBeCloseTo(1.34, 2);
    expect(startFrame.rotDeg).toBeCloseTo(0, 2);
    expect(beatHitFrame.beatPulse).toBeGreaterThan(0.03);
    expect(endFrame.z).toBeCloseTo(1.0, 2);
    expect(endFrame.rotDeg).toBeCloseTo(4, 2);

    // Shake decays over time, tremor stays sustained, and PRNG is 100% deterministic
    const shakeEarlyA = evaluateClipCameraFrame({
      clipId: 'elara-321',
      camera: { mode: 'static', z0: 1, z1: 1, shakeAmp: 0.8 },
      localTimeSec: 0.04,
      durationSec: 3,
      fps: 24,
    });
    const shakeEarlyB = evaluateClipCameraFrame({
      clipId: 'elara-321',
      camera: { mode: 'static', z0: 1, z1: 1, shakeAmp: 0.8 },
      localTimeSec: 0.04,
      durationSec: 3,
      fps: 24,
    });
    const shakeLate = evaluateClipCameraFrame({
      clipId: 'elara-321',
      camera: { mode: 'static', z0: 1, z1: 1, shakeAmp: 0.8 },
      localTimeSec: 1.5,
      durationSec: 3,
      fps: 24,
    });
    expect(shakeEarlyA).toEqual(shakeEarlyB);
    expect(Math.hypot(shakeEarlyA.dx, shakeEarlyA.dy)).toBeGreaterThan(Math.hypot(shakeLate.dx, shakeLate.dy));

    const tremorLate = evaluateClipCameraFrame({
      clipId: 'elara-321',
      camera: { mode: 'static', z0: 1, z1: 1, tremorAmp: 0.7 },
      localTimeSec: 2.5,
      durationSec: 3,
      fps: 24,
    });
    expect(Math.hypot(tremorLate.dx, tremorLate.dy)).toBeGreaterThan(0.001);
  });

  it('interpolates Cinemascope bars using easeInOutCubic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOutCubic(1)).toBe(1);

    expect(evaluateCinemascopeBar({ bar0: 0.25, bar1: 0.125 }, 0, 4)).toBeCloseTo(0.25, 4);
    expect(evaluateCinemascopeBar({ bar0: 0.25, bar1: 0.125 }, 2, 4)).toBeCloseTo(0.1875, 4);
    expect(evaluateCinemascopeBar({ bar0: 0.25, bar1: 0.125 }, 4, 4)).toBeCloseTo(0.125, 4);
    expect(evaluateCinemascopeBar(null, 2, 4)).toBe(0);
  });

  it('toggles mangaBlink inversion every 2 frames and fades flashIn & fadeOutBlack accurately', () => {
    const nfx = normalizeClipFx({
      mangaBlink: true,
      flashIn: { alpha: 0.8, color: '#F5B942', frames: 6 },
      fadeOutBlack: { durationSec: 1.0 },
    });

    expect(evaluateMangaBlinkState(nfx, 0)).toEqual({ active: true, inverted: false });
    expect(evaluateMangaBlinkState(nfx, 1)).toEqual({ active: true, inverted: false });
    expect(evaluateMangaBlinkState(nfx, 2)).toEqual({ active: true, inverted: true });
    expect(evaluateMangaBlinkState(nfx, 3)).toEqual({ active: true, inverted: true });
    expect(evaluateMangaBlinkState(nfx, 4)).toEqual({ active: true, inverted: false });

    const flash0 = evaluateFlashInState(nfx, 0, 24);
    const flashEnd = evaluateFlashInState(nfx, 0.3, 24);
    expect(flash0.alpha).toBeCloseTo(0.8, 2);
    expect(flash0.color).toBe('#F5B942');
    expect(flashEnd.alpha).toBe(0);

    expect(evaluateFadeOutBlackAlpha(nfx, 0, 2.0, 4.0)).toBe(0);
    expect(evaluateFadeOutBlackAlpha(nfx, 0, 3.5, 4.0)).toBeCloseTo(0.5, 2);
    expect(evaluateFadeOutBlackAlpha(nfx, 0, 4.0, 4.0)).toBeCloseTo(1.0, 2);
  });

  it('generates deterministic speed lines, particles, and text overlay fades', () => {
    const radA = generateRadialSpeedLines('c1', 4, { color: '#FFFFFF', intensity: 0.9, count: 24 });
    const radB = generateRadialSpeedLines('c1', 5, { color: '#FFFFFF', intensity: 0.9, count: 24 });
    const radC = generateRadialSpeedLines('c1', 6, { color: '#FFFFFF', intensity: 0.9, count: 24 });
    expect(radA).toHaveLength(24);
    expect(radA).toEqual(radB); // 2-frame anime step
    expect(radA).not.toEqual(radC);

    const hDiag = generateHorizSpeedLines('c1', 2, { color: '#FF0000', direction: 'diag_up', intensity: 1 });
    expect(hDiag.length).toBeGreaterThan(10);
    expect(hDiag[0]!.dyDir).toBeLessThan(0);

    const orbs = generateFloatingParticles('c1', 1.2, { color: '#F5B942', count: 20, intensity: 0.9 });
    expect(orbs).toHaveLength(20);
    expect(orbs[0]!.yFrac).toBeGreaterThanOrEqual(0);
    expect(orbs[0]!.yFrac).toBeLessThanOrEqual(1);

    const txtAlphaIn = evaluateTextOverlayOpacity(
      { text: 'ÉPISODE 1', fontSize: 56, color: '#FFFFFF', bgColor: '#000000', bgOpacity: 0, x: 50, y: 50, bold: true, animation: 'fade', fadeInSec: 0.5, fadeOutSec: 0.5 },
      0.25,
      4.0,
    );
    expect(txtAlphaIn).toBeCloseTo(0.5, 2);

    expect(resolveClipCamera({ mode: 'power_pullback' })?.z0).toBe(1.34);
    expect(hasProceduralAmvFx(null, null, null, 0)).toBe(false);
    expect(hasProceduralAmvFx(null, { bar0: 0.125, bar1: 0.125 }, null, 0)).toBe(true);
  });
});

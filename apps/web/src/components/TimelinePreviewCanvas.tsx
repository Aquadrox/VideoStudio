import { useEffect, useRef } from 'react';
import {
  DEFAULT_CLIP_COLOR_ADJUST,
  compileClipCssPreview,
  evaluateCinemascopeBar,
  evaluateClipCameraFrame,
  evaluateClipTransformAtTime,
  evaluateFadeOutBlackAlpha,
  evaluateFlashInState,
  evaluateMangaBlinkState,
  evaluateTextOverlayOpacity,
  extractDownbeatTimesForClip,
  generateFloatingParticles,
  generateHorizSpeedLines,
  generateRadialSpeedLines,
  normalizeClipFx,
  selectTimelinePlaybackUrl,
  type AssetDto,
  type ClipTextOverlay,
  type SubtitleCue,
  type SubtitleStyle,
  type TimelineBeatMarker,
  type TimelineClipDto,
  type TimelineQualityMode,
  type TimelineTransitionFrame,
  type VideoEffectDto,
} from '@videostudio/shared';

export interface ActiveTextOverlayEntry {
  id: string;
  overlay: ClipTextOverlay;
  startSec: number;
  durationSec: number;
}

export interface TimelinePreviewCanvasProps {
  playheadSec: number;
  fps: number;
  playing: boolean;
  fxPreviewEnabled: boolean;
  qualityMode: TimelineQualityMode;
  activeVideoClip: TimelineClipDto | null;
  activeVideoAsset: AssetDto | null;
  outgoingVideoAsset: AssetDto | null;
  transitionFrame: TimelineTransitionFrame;
  activeOverlayClips: TimelineClipDto[];
  activeTextOverlays: ActiveTextOverlayEntry[];
  assetMap: Map<string, AssetDto>;
  effectCatalog: Map<string, VideoEffectDto>;
  beatMarkers: TimelineBeatMarker[];
  activeSubtitleCues: SubtitleCue[];
  subtitleStyle: SubtitleStyle;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  activeAudioClipStartSec?: number;
  activeAudioClipInSec?: number;
}

const CANVAS_W = 960;
const CANVAS_H = 540;

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#FFFFFF').trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = Number.parseInt(full.slice(0, 2), 16) || 255;
  const g = Number.parseInt(full.slice(2, 4), 16) || 255;
  const b = Number.parseInt(full.slice(4, 6), 16) || 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function drawFittedMedia(
  ctx: CanvasRenderingContext2D,
  media: HTMLImageElement | HTMLVideoElement,
  targetW: number,
  targetH: number,
): void {
  const srcW = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const srcH = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!srcW || !srcH) return;
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const x = (targetW - drawW) / 2;
  const y = (targetH - drawH) / 2;
  ctx.drawImage(media, x, y, drawW, drawH);
}

/**
 * Real-time WYSIWYG 16:9 HTML5 `<canvas>` Timeline Preview Player.
 * Renders camera motion (push/ease/crash_zoom/power_pullback/p05_vertigo/pan + beatPulseAmp + shakeAmp + tremorAmp),
 * mangaBlink (B&W + 2-frame invert), additive radial/directional speed lines, glowing particles, flashIn,
 * PiP overlays, text tracks (title + subtitle + stroke + glow), subtitles, and Cinemascope bars (drawn last).
 */
export function TimelinePreviewCanvas(props: TimelinePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const overlayVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const latestPropsRef = useRef<TimelinePreviewCanvasProps>(props);
  latestPropsRef.current = props;

  const activePlaybackUrl =
    props.activeVideoAsset
      ? selectTimelinePlaybackUrl(
          props.activeVideoAsset.urls,
          props.activeVideoAsset.type,
          props.qualityMode,
        )
      : null;

  const outgoingPlaybackUrl =
    props.outgoingVideoAsset
      ? props.outgoingVideoAsset.urls.thumbnail ||
        selectTimelinePlaybackUrl(
          props.outgoingVideoAsset.urls,
          props.outgoingVideoAsset.type,
          props.qualityMode,
        )
      : null;

  // Keep image cache warm for active, outgoing, and PiP image assets
  const getOrLoadImage = (url: string, onLoadTrigger?: () => void): HTMLImageElement | null => {
    const cache = imageCacheRef.current;
    const existing = cache.get(url);
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      onLoadTrigger?.();
    };
    img.src = url;
    cache.set(url, img);
    // Keep cache bounded
    if (cache.size > 60) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    return null;
  };

  // Sync hidden <video> element time and play/pause state with timeline playhead
  useEffect(() => {
    const vid = videoElRef.current;
    if (!vid || !props.activeVideoClip || props.activeVideoAsset?.type !== 'video') return;
    const speed = Math.max(0.25, Math.min(4, props.activeVideoClip.speed ?? 1));
    const localTime = Math.max(
      0,
      props.activeVideoClip.inSec + (props.playheadSec - props.activeVideoClip.startSec) * speed,
    );
    if (Math.abs(vid.playbackRate - speed) > 0.02) {
      vid.playbackRate = speed;
    }
    if (Math.abs(vid.currentTime - localTime) > 0.3) {
      try {
        vid.currentTime = localTime;
      } catch {
        // Ignore seek before metadata ready
      }
    }
    if (props.playing) {
      void vid.play().catch(() => undefined);
    } else {
      vid.pause();
    }
  }, [
    props.activeVideoClip?.id,
    props.activeVideoClip?.inSec,
    props.activeVideoClip?.startSec,
    props.activeVideoClip?.speed,
    props.activeVideoAsset?.type,
    activePlaybackUrl,
    props.playheadSec,
    props.playing,
  ]);

  // Core synchronous frame renderer (called every rAF while playing, and immediately on scrub/edit)
  const renderFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = latestPropsRef.current;
    const fps = Math.max(1, p.fps || 24);
    // Use exact audio time while playing if audio element is active for jitter-free beat sync
    let currentT = p.playheadSec;
    if (
      p.playing &&
      p.audioRef.current &&
      !p.audioRef.current.paused &&
      p.activeAudioClipStartSec !== undefined
    ) {
      const audioT =
        p.activeAudioClipStartSec +
        Math.max(0, p.audioRef.current.currentTime - (p.activeAudioClipInSec ?? 0));
      if (Math.abs(audioT - p.playheadSec) < 0.6) {
        currentT = audioT;
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#09090d';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 0. Outgoing clip layer for crossfade/transition preview
    if (outgoingPlaybackUrl && p.transitionFrame.outgoingOpacity > 0.01) {
      const outImg = getOrLoadImage(outgoingPlaybackUrl, renderFrame);
      if (outImg) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.transitionFrame.outgoingOpacity));
        drawFittedMedia(ctx, outImg, CANVAS_W, CANVAS_H);
        ctx.restore();
      }
    }

    const clip = p.activeVideoClip;
    const asset = p.activeVideoAsset;

    if (clip && asset && activePlaybackUrl) {
      const localTime = Math.max(0, Math.min(clip.durationSec, currentT - clip.startSec));
      const frameIndex = Math.max(0, Math.floor(localTime * fps + 1e-6));
      const beatTimesInClip = extractDownbeatTimesForClip(
        p.beatMarkers,
        clip.startSec,
        clip.durationSec,
      );
      const nfx = normalizeClipFx(clip.fx, clip.flashIn);
      const tr = evaluateClipTransformAtTime(clip.transform, clip.keyframes, localTime);
      const color = { ...DEFAULT_CLIP_COLOR_ADJUST, ...(clip.colorAdjust ?? {}) };

      // 1. Deterministic Camera Frame
      const camFrame = p.fxPreviewEnabled
        ? evaluateClipCameraFrame({
            clipId: clip.id,
            camera: clip.camera,
            fx: clip.fx,
            legacyFlashIn: clip.flashIn,
            localTimeSec: localTime,
            durationSec: clip.durationSec,
            fps,
            beatTimesInClip,
          })
        : { z: 1, cx: 0.5, cy: 0.5, dx: 0, dy: 0, rotDeg: 0, beatPulse: 0 };

      // 2. Build CSS Canvas Filter (colorAdjust + custom effects + mangaBlink)
      let filterStr = 'none';
      if (p.fxPreviewEnabled) {
        const cssPreview = compileClipCssPreview(clip, currentT, p.effectCatalog, beatTimesInClip, fps);
        const parts: string[] = [];
        if (cssPreview.filter && cssPreview.filter !== 'none') {
          parts.push(cssPreview.filter);
        }
        // Manga Blink uses exact 2-frame cadence (already included in cssPreview, ensure explicit parity)
        const manga = evaluateMangaBlinkState(nfx, frameIndex);
        if (manga.active && !cssPreview.filter.includes('grayscale')) {
          parts.push(
            manga.inverted
              ? 'grayscale(1) contrast(2.25) invert(1)'
              : 'grayscale(1) contrast(2.25)',
          );
        }
        filterStr = parts.join(' ') || 'none';
      }

      // Compute opacity (transform + fadeIn + transition)
      let alpha = Math.max(0, Math.min(1, tr.opacity * p.transitionFrame.activeOpacity));
      const fadeIn = clip.fadeInSec ?? 0;
      if (p.fxPreviewEnabled && fadeIn > 0.02 && localTime < fadeIn) {
        alpha *= Math.max(0, localTime / fadeIn);
      }

      // Draw V1 media with camera zoom/focal-point/shake/tremor/rotation + user transform
      let mediaEl: HTMLImageElement | HTMLVideoElement | null = null;
      if (asset.type === 'video') {
        const vid = videoElRef.current;
        if (vid && vid.readyState >= 2) {
          mediaEl = vid;
        }
      } else {
        mediaEl = getOrLoadImage(activePlaybackUrl, renderFrame);
      }

      if (mediaEl) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = filterStr;

        const totalScale = tr.scale * camFrame.z;
        const flipX = tr.flipH ? -1 : 1;
        const flipY = tr.flipV ? -1 : 1;
        const totalRotRad = ((tr.rotation + camFrame.rotDeg) * Math.PI) / 180;
        const panX = (0.5 - camFrame.cx) * CANVAS_W * camFrame.z + camFrame.dx * CANVAS_W + tr.x * (CANVAS_W / 2);
        const panY = (0.5 - camFrame.cy) * CANVAS_H * camFrame.z + camFrame.dy * CANVAS_H + tr.y * (CANVAS_H / 2);

        ctx.translate(CANVAS_W / 2 + panX, CANVAS_H / 2 + panY);
        if (Math.abs(totalRotRad) > 0.0005) {
          ctx.rotate(totalRotRad);
        }
        ctx.scale(totalScale * flipX, totalScale * flipY);
        ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);

        drawFittedMedia(ctx, mediaEl, CANVAS_W, CANVAS_H);
        ctx.restore();
      }

      // 3. Radial Vignette
      if (p.fxPreviewEnabled && color.vignette > 0.02) {
        ctx.save();
        const grad = ctx.createRadialGradient(
          CANVAS_W / 2,
          CANVAS_H / 2,
          CANVAS_H * 0.25,
          CANVAS_W / 2,
          CANVAS_H / 2,
          CANVAS_W * 0.65,
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, color.vignette * 0.9)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
      }

      // 4. Additive AMV FX (`globalCompositeOperation = 'lighter'`): Speed Lines, Particles, FlashIn
      if (p.fxPreviewEnabled) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // 4a. Radial Speed Lines
        if (nfx.radialSpeedLines && nfx.radialSpeedLines.intensity > 0.01) {
          const lines = generateRadialSpeedLines(clip.id, frameIndex, nfx.radialSpeedLines);
          const cxPx = CANVAS_W / 2;
          const cyPx = CANVAS_H / 2;
          const maxR = Math.hypot(cxPx, cyPx);
          ctx.lineCap = 'round';
          for (const line of lines) {
            ctx.strokeStyle = hexToRgba(nfx.radialSpeedLines.color, line.alpha);
            ctx.lineWidth = Math.max(1, line.lineWidthFrac * CANVAS_W);
            ctx.beginPath();
            ctx.moveTo(
              cxPx + Math.cos(line.angleRad) * line.innerRadiusFrac * maxR,
              cyPx + Math.sin(line.angleRad) * line.innerRadiusFrac * maxR,
            );
            ctx.lineTo(
              cxPx + Math.cos(line.angleRad) * line.outerRadiusFrac * maxR,
              cyPx + Math.sin(line.angleRad) * line.outerRadiusFrac * maxR,
            );
            ctx.stroke();
          }
        }

        // 4b. Directional / Horizontal Speed Lines
        if (nfx.horizSpeedLines && nfx.horizSpeedLines.intensity > 0.01) {
          const lines = generateHorizSpeedLines(clip.id, frameIndex, nfx.horizSpeedLines);
          const diag = Math.hypot(CANVAS_W, CANVAS_H);
          ctx.lineCap = 'round';
          for (const line of lines) {
            const x0 = line.xFrac * CANVAS_W;
            const y0 = line.yFrac * CANVAS_H;
            const len = line.lengthFrac * diag;
            ctx.strokeStyle = hexToRgba(nfx.horizSpeedLines.color, line.alpha);
            ctx.lineWidth = Math.max(1, line.widthFrac * CANVAS_W);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + line.dxDir * len, y0 + line.dyDir * len);
            ctx.stroke();
          }
        }

        // 4c. Floating Glowing Orbs (Particles)
        if (nfx.particles && nfx.particles.count > 0) {
          const orbs = generateFloatingParticles(clip.id, localTime, nfx.particles);
          for (const orb of orbs) {
            const ox = orb.xFrac * CANVAS_W;
            const oy = orb.yFrac * CANVAS_H;
            const r = Math.max(2, orb.radiusFrac * CANVAS_W);
            const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 2.2);
            g.addColorStop(0, hexToRgba(nfx.particles.color, orb.alpha));
            g.addColorStop(0.45, hexToRgba(nfx.particles.color, orb.alpha * 0.45));
            g.addColorStop(1, hexToRgba(nfx.particles.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(ox, oy, r * 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 4d. Flash-In Wash
        const flash = evaluateFlashInState(nfx, localTime, fps);
        if (flash.alpha > 0.01) {
          ctx.fillStyle = hexToRgba(flash.color, flash.alpha);
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        ctx.restore();

        // 4e. Fade-Out-to-Black
        const fadeOutAlpha = evaluateFadeOutBlackAlpha(nfx, clip.fadeOutSec, localTime, clip.durationSec);
        if (fadeOutAlpha > 0.01) {
          ctx.save();
          ctx.fillStyle = `rgba(0, 0, 0, ${fadeOutAlpha.toFixed(3)})`;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
          ctx.restore();
        }
      }
    }

    // 5. PiP / Overlay Track Clips (V2+)
    for (const ovClip of p.activeOverlayClips) {
      const ovAsset = ovClip.assetId ? p.assetMap.get(ovClip.assetId) : null;
      if (!ovAsset) continue;
      const ovUrl = selectTimelinePlaybackUrl(ovAsset.urls, ovAsset.type, p.qualityMode);
      if (!ovUrl) continue;
      const ovLocal = Math.max(0, currentT - ovClip.startSec);
      const tr = evaluateClipTransformAtTime(ovClip.transform, ovClip.keyframes, ovLocal);

      let ovEl: HTMLImageElement | HTMLVideoElement | null = null;
      if (ovAsset.type === 'image') {
        ovEl = getOrLoadImage(ovUrl, renderFrame);
      } else {
        let ovVid = overlayVideosRef.current.get(ovUrl);
        if (!ovVid) {
          ovVid = document.createElement('video');
          ovVid.src = ovUrl;
          ovVid.muted = true;
          ovVid.playsInline = true;
          overlayVideosRef.current.set(ovUrl, ovVid);
        }
        if (Math.abs(ovVid.currentTime - (ovClip.inSec + ovLocal)) > 0.35) {
          try {
            ovVid.currentTime = ovClip.inSec + ovLocal;
          } catch {
            // ignore
          }
        }
        if (p.playing && ovVid.paused) void ovVid.play().catch(() => undefined);
        if (!p.playing && !ovVid.paused) ovVid.pause();
        if (ovVid.readyState >= 2) ovEl = ovVid;
      }

      if (ovEl) {
        const boxW = Math.max(80, Math.min(CANVAS_W * 0.95, CANVAS_W * 0.45 * tr.scale));
        const boxH = (boxW * 9) / 16;
        const cx = CANVAS_W * (0.5 + tr.x * 0.5);
        const cy = CANVAS_H * (0.5 + tr.y * 0.5);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity));
        ctx.translate(cx, cy);
        if (Math.abs(tr.rotation) > 0.1) ctx.rotate((tr.rotation * Math.PI) / 180);
        ctx.translate(-boxW / 2, -boxH / 2);
        drawFittedMedia(ctx, ovEl, boxW, boxH);
        ctx.restore();
      }
    }

    // 6. Text Track & Inline Text Overlays (title, subtitle, stroke, glow, fadeIn/fadeOut)
    for (const item of p.activeTextOverlays) {
      const ov = item.overlay;
      if (!ov.text.trim()) continue;
      const localT = Math.max(0, currentT - item.startSec);
      const alpha = p.fxPreviewEnabled
        ? evaluateTextOverlayOpacity(ov, localT, item.durationSec)
        : 1;
      if (alpha <= 0.01) continue;

      const fontSizePx = Math.max(14, Math.round((ov.fontSize * CANVAS_H) / 720));
      const fontFamily = ov.fontFamily?.trim() || 'Inter, system-ui, sans-serif';
      const xNorm = ov.x > 0 && ov.x <= 1 ? ov.x : ov.x / 100;
      const yNorm = ov.y > 0 && ov.y <= 1 ? ov.y : ov.y / 100;
      const tx = CANVAS_W * xNorm;
      const ty = CANVAS_H * yNorm;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${ov.bold ? '700' : '400'} ${fontSizePx}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const mainText = ov.text.trim();
      const subText = ov.subtitle?.trim() || '';
      const metrics = ctx.measureText(mainText);
      const boxW = metrics.width + 28;
      const boxH = fontSizePx * (subText ? 2.05 : 1.35);

      if (ov.bgOpacity > 0.02) {
        ctx.fillStyle = hexToRgba(ov.bgColor || '#000000', ov.bgOpacity);
        const rx = tx - boxW / 2;
        const ry = ty - (subText ? fontSizePx * 0.7 : boxH / 2);
        ctx.beginPath();
        ctx.roundRect(rx, ry, boxW, boxH, 8);
        ctx.fill();
      }

      if (ov.glowColor) {
        ctx.shadowColor = ov.glowColor;
        ctx.shadowBlur = Math.max(10, fontSizePx * 0.45);
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = 6;
      }

      if (ov.strokeColor) {
        ctx.strokeStyle = ov.strokeColor;
        ctx.lineWidth = Math.max(2, fontSizePx * 0.08);
        ctx.lineJoin = 'round';
        ctx.strokeText(mainText, tx, ty);
      }

      ctx.fillStyle = ov.color || '#FFFFFF';
      ctx.fillText(mainText, tx, ty);

      if (subText) {
        const subSize = Math.max(12, Math.round(fontSizePx * 0.58));
        ctx.font = `500 ${subSize}px ${fontFamily}`;
        if (ov.strokeColor) {
          ctx.lineWidth = Math.max(1.5, subSize * 0.08);
          ctx.strokeText(subText, tx, ty + fontSizePx * 0.85);
        }
        ctx.fillStyle = hexToRgba(ov.color || '#FFFFFF', 0.92);
        ctx.fillText(subText, tx, ty + fontSizePx * 0.85);
      }
      ctx.restore();
    }

    // 7. Transition Fade-to-Black Overlay
    if (p.transitionFrame.blackOverlayOpacity > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, p.transitionFrame.blackOverlayOpacity).toFixed(3)})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }

    // 8. Cinemascope Bars Drawn LAST On Top of Everything (`bar0 -> bar1` in easeInOutCubic)
    if (p.fxPreviewEnabled && clip?.cinemascope) {
      const localT = Math.max(0, Math.min(clip.durationSec, currentT - clip.startSec));
      const barFrac = evaluateCinemascopeBar(clip.cinemascope, localT, clip.durationSec);
      if (barFrac > 0.001) {
        const barPx = Math.round(CANVAS_H * barFrac);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, barPx);
        ctx.fillRect(0, CANVAS_H - barPx, CANVAS_W, barPx);
      }
    }

    // 9. Live Cinema Subtitles Overlay
    if (p.activeSubtitleCues.length > 0) {
      const stSize = Math.max(14, Math.round((p.subtitleStyle.fontSize * CANVAS_H) / 720));
      const baseY =
        p.subtitleStyle.position === 'top'
          ? 44
          : p.subtitleStyle.position === 'middle'
            ? CANVAS_H / 2
            : CANVAS_H - 38;
      ctx.save();
      ctx.font = `600 ${stSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      p.activeSubtitleCues.forEach((cue, idx) => {
        const line = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
        const y = baseY - (p.activeSubtitleCues.length - 1 - idx) * (stSize + 10);
        const w = ctx.measureText(line).width + 24;
        const h = stSize + 12;
        ctx.fillStyle = `rgba(0, 0, 0, ${p.subtitleStyle.backgroundOpacity})`;
        ctx.beginPath();
        ctx.roundRect(CANVAS_W / 2 - w / 2, y - h / 2, w, h, 6);
        ctx.fill();
        ctx.fillStyle = p.subtitleStyle.color || '#FFFFFF';
        ctx.fillText(line, CANVAS_W / 2, y);
      });
      ctx.restore();
    }

    ctx.restore();
  };

  // Continuous 60fps rAF loop while playing; immediate single draw on scrub / clip edits
  useEffect(() => {
    renderFrame();
    if (!props.playing) return;
    let rafId = 0;
    const loop = () => {
      renderFrame();
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    props.playing,
    props.playheadSec,
    props.fxPreviewEnabled,
    props.activeVideoClip,
    props.activeVideoAsset?.id,
    props.outgoingVideoAsset?.id,
    props.transitionFrame.activeOpacity,
    props.transitionFrame.outgoingOpacity,
    props.transitionFrame.blackOverlayOpacity,
    props.activeOverlayClips,
    props.activeTextOverlays,
    props.activeSubtitleCues,
    props.beatMarkers,
    props.effectCatalog,
    props.qualityMode,
  ]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Hidden hardware-decoded video source sampled into the WYSIWYG canvas */}
      {props.activeVideoAsset?.type === 'video' && activePlaybackUrl && (
        <video
          ref={videoElRef}
          key={activePlaybackUrl}
          src={activePlaybackUrl}
          muted
          playsInline
          crossOrigin="anonymous"
          preload="auto"
          onLoadedData={() => renderFrame()}
          onSeeked={() => renderFrame()}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        aria-label="Lecteur WYSIWYG Timeline 16:9"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'contain',
          background: '#09090d',
        }}
      />
    </div>
  );
}

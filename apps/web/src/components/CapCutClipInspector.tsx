import { useState } from 'react';
import {
  Copy,
  Diamond,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Volume2,
} from 'lucide-react';
import {
  DEFAULT_CLIP_CAMERA,
  DEFAULT_CLIP_CINEMASCOPE,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_TEXT_OVERLAY,
  normalizeClipFx,
  TIMELINE_TRANSITION_META,
  type ClipAmvFxObject,
  type ClipAppliedEffect,
  type ClipCamera,
  type ClipCameraMode,
  type ClipCinemascope,
  type ClipColorAdjust,
  type ClipKeyframe,
  type ClipTextOverlay,
  type ClipTransform,
  type HorizSpeedLinesDirection,
  type KeyframeProperty,
  type TimelineClipDto,
  type TimelineTrackDto,
  type TimelineTransition,
  type VideoEffectDto,
} from '@videostudio/shared';

type InspectorTab = 'video' | 'color' | 'effects' | 'audio' | 'text' | 'keyframes';

interface CapCutClipInspectorProps {
  track: TimelineTrackDto;
  clip: TimelineClipDto;
  playheadSec: number;
  effectCatalog: Map<string, VideoEffectDto>;
  saving: boolean;
  onPatchClip: (patch: Partial<TimelineClipDto>) => void;
  onCommit: () => void;
  onSplitAtPlayhead: () => void;
  onDuplicateClip: () => void;
  onDeleteClip: (ripple: boolean) => void;
}

export function CapCutClipInspector({
  track,
  clip,
  playheadSec,
  effectCatalog,
  saving,
  onPatchClip,
  onCommit,
  onSplitAtPlayhead,
  onDuplicateClip,
  onDeleteClip,
}: CapCutClipInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>(
    track.type === 'text' ? 'text' : track.type === 'audio' ? 'audio' : 'video',
  );

  const transform: ClipTransform = { ...DEFAULT_CLIP_TRANSFORM, ...(clip.transform ?? {}) };
  const color: ClipColorAdjust = { ...DEFAULT_CLIP_COLOR_ADJUST, ...(clip.colorAdjust ?? {}) };
  const effects: ClipAppliedEffect[] = clip.effects ?? [];
  const keyframes: ClipKeyframe[] = clip.keyframes ?? [];
  const speed = clip.speed ?? 1;
  const fadeInSec = clip.fadeInSec ?? 0;
  const fadeOutSec = clip.fadeOutSec ?? 0;

  const localPlayhead = Math.max(0, Math.min(clip.durationSec, playheadSec - clip.startSec));
  const canSplitAtPlayhead =
    playheadSec > clip.startSec + 0.15 && playheadSec < clip.startSec + clip.durationSec - 0.15;

  const updateTransform = (partial: Partial<ClipTransform>) => {
    onPatchClip({ transform: { ...transform, ...partial } });
  };

  const updateColor = (partial: Partial<ClipColorAdjust>) => {
    onPatchClip({ colorAdjust: { ...color, ...partial } });
  };

  const updateEffectAt = (idx: number, patch: Partial<ClipAppliedEffect>) => {
    onPatchClip({
      effects: effects.map((fx, i) => (i === idx ? { ...fx, ...patch } : fx)),
    });
  };

  const removeEffectAt = (idx: number) => {
    onPatchClip({
      effects: effects.filter((_, i) => i !== idx),
    });
  };

  const addKeyframe = (property: KeyframeProperty) => {
    const currentValue =
      property === 'scale'
        ? transform.scale
        : property === 'x'
          ? transform.x
          : property === 'y'
            ? transform.y
            : property === 'rotation'
              ? transform.rotation
              : transform.opacity;
    const kf: ClipKeyframe = {
      id: crypto.randomUUID(),
      timeOffsetSec: Math.round(localPlayhead * 100) / 100,
      property,
      value: currentValue,
      easing: 'ease_in_out',
    };
    onPatchClip({ keyframes: [...keyframes, kf] });
  };

  const removeKeyframe = (id: string) => {
    onPatchClip({ keyframes: keyframes.filter((k) => k.id !== id) });
  };

  const textOverlay: ClipTextOverlay | null = clip.textOverlay ?? null;

  return (
    <div className="capcut-inspector">
      {/* Header + Quick CapCut Actions */}
      <div className="capcut-inspector-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--accent-amber)', fontWeight: 600 }}>
            {track.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={clip.title}
          >
            {clip.title}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!canSplitAtPlayhead}
            onClick={onSplitAtPlayhead}
            title="Couper ce clip à la position du curseur (Raccourci: S)"
            style={{ padding: '4px 6px' }}
          >
            <Scissors size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDuplicateClip}
            title="Dupliquer ce clip"
            style={{ padding: '4px 6px' }}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => onDeleteClip(false)}
            title="Supprimer ce clip"
            style={{ padding: '4px 6px' }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* CapCut Inspector Tabs */}
      <div className="capcut-inspector-tabs">
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'video' ? 'active' : ''}`}
          onClick={() => setTab('video')}
          title="Timing, Transform, Vitesse & Transition"
        >
          <Sliders size={12} /> Base
        </button>
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'color' ? 'active' : ''}`}
          onClick={() => setTab('color')}
          title="Étalonnage couleur"
        >
          <Palette size={12} /> Coul.
        </button>
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'effects' ? 'active' : ''}`}
          onClick={() => setTab('effects')}
          title="Effets appliqués"
        >
          <Sparkles size={12} /> FX{effects.length > 0 ? ` (${effects.length})` : ''}
        </button>
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'audio' ? 'active' : ''}`}
          onClick={() => setTab('audio')}
          title="Volume & Fondus Audio"
        >
          <Volume2 size={12} /> Audio
        </button>
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'text' ? 'active' : ''}`}
          onClick={() => setTab('text')}
          title="Incrustation Texte / Titre"
        >
          <Type size={12} /> Texte
        </button>
        <button
          type="button"
          className={`capcut-insp-tab ${tab === 'keyframes' ? 'active' : ''}`}
          onClick={() => setTab('keyframes')}
          title="Images-clés animées"
        >
          <Diamond size={12} /> KF{keyframes.length > 0 ? ` (${keyframes.length})` : ''}
        </button>
      </div>

      {/* Inspector Body */}
      <div className="capcut-inspector-body">
        {tab === 'video' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field">
              <label>Titre du clip</label>
              <input
                className="input"
                value={clip.title}
                onChange={(e) => onPatchClip({ title: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div className="field">
                <label>Début (s)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={clip.startSec}
                  onChange={(e) => onPatchClip({ startSec: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="field">
                <label>Durée (s)</label>
                <input
                  className="input"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={clip.durationSec}
                  onChange={(e) => onPatchClip({ durationSec: Math.max(0.1, Number(e.target.value) || 0.1) })}
                />
              </div>
              <div className="field">
                <label>Trim In (s)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={clip.inSec}
                  onChange={(e) => onPatchClip({ inSec: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>

            {/* Speed */}
            <div className="capcut-slider-row">
              <label>
                <Gauge size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Vitesse <strong>{speed.toFixed(2)}×</strong>
              </label>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={speed}
                onChange={(e) => onPatchClip({ speed: Number(e.target.value) })}
              />
            </div>

            {/* Transitions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 6 }}>
              <div className="field">
                <label>Transition entrée</label>
                <select
                  className="select"
                  value={clip.transition}
                  onChange={(e) => {
                    const nextTrans = e.target.value as TimelineTransition;
                    onPatchClip({
                      transition: nextTrans,
                      transitionDurationSec: nextTrans === 'cut' ? 0 : clip.transitionDurationSec || 0.6,
                    });
                  }}
                >
                  {(Object.keys(TIMELINE_TRANSITION_META) as TimelineTransition[]).map((key) => (
                    <option key={key} value={key}>
                      {TIMELINE_TRANSITION_META[key].icon} {TIMELINE_TRANSITION_META[key].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Durée (s)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  disabled={clip.transition === 'cut'}
                  value={clip.transitionDurationSec}
                  onChange={(e) =>
                    onPatchClip({
                      transitionDurationSec: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            </div>

            {/* Transform */}
            <div className="capcut-subhead">
              <span>Transform & Cadrage</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onPatchClip({ transform: { ...DEFAULT_CLIP_TRANSFORM } })}
                style={{ padding: '2px 6px', fontSize: 10.5 }}
              >
                <RotateCcw size={10} /> Reset
              </button>
            </div>

            <div className="capcut-slider-row">
              <label>Zoom / Échelle <strong>{Math.round(transform.scale * 100)}%</strong></label>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={transform.scale}
                onChange={(e) => updateTransform({ scale: Number(e.target.value) })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div className="capcut-slider-row">
                <label>Pos X <strong>{Math.round(transform.x * 100)}%</strong></label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.02}
                  value={transform.x}
                  onChange={(e) => updateTransform({ x: Number(e.target.value) })}
                />
              </div>
              <div className="capcut-slider-row">
                <label>Pos Y <strong>{Math.round(transform.y * 100)}%</strong></label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.02}
                  value={transform.y}
                  onChange={(e) => updateTransform({ y: Number(e.target.value) })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div className="capcut-slider-row">
                <label>Rotation <strong>{Math.round(transform.rotation)}°</strong></label>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={transform.rotation}
                  onChange={(e) => updateTransform({ rotation: Number(e.target.value) })}
                />
              </div>
              <div className="capcut-slider-row">
                <label>Opacité <strong>{Math.round(transform.opacity * 100)}%</strong></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={transform.opacity}
                  onChange={(e) => updateTransform({ opacity: Number(e.target.value) })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`chip ${transform.flipH ? 'active' : ''}`}
                onClick={() => updateTransform({ flipH: !transform.flipH })}
              >
                <FlipHorizontal2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Miroir H
              </button>
              <button
                type="button"
                className={`chip ${transform.flipV ? 'active' : ''}`}
                onClick={() => updateTransform({ flipV: !transform.flipV })}
              >
                <FlipVertical2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Miroir V
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDeleteClip(true)}
                title="Supprimer ce clip et resserrer automatiquement les suivants (Ripple Delete)"
                style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--accent-red)' }}
              >
                Ripple Suppr.
              </button>
            </div>
          </div>
        )}

        {tab === 'color' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="capcut-subhead">
              <span>Étalonnage & Correction</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onPatchClip({ colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST } })}
                style={{ padding: '2px 6px', fontSize: 10.5 }}
              >
                <RotateCcw size={10} /> Reset
              </button>
            </div>

            <div className="capcut-slider-row">
              <label>Luminosité <strong>{color.brightness.toFixed(2)}</strong></label>
              <input
                type="range"
                min={-0.6}
                max={0.6}
                step={0.02}
                value={color.brightness}
                onChange={(e) => updateColor({ brightness: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Contraste <strong>{color.contrast.toFixed(2)}</strong></label>
              <input
                type="range"
                min={0.3}
                max={2.2}
                step={0.05}
                value={color.contrast}
                onChange={(e) => updateColor({ contrast: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Saturation <strong>{color.saturation.toFixed(2)}</strong></label>
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.05}
                value={color.saturation}
                onChange={(e) => updateColor({ saturation: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Gamma <strong>{color.gamma.toFixed(2)}</strong></label>
              <input
                type="range"
                min={0.4}
                max={2.2}
                step={0.05}
                value={color.gamma}
                onChange={(e) => updateColor({ gamma: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Flou (Blur) <strong>{color.blur.toFixed(1)} px</strong></label>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={color.blur}
                onChange={(e) => updateColor({ blur: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Netteté (Sharpen) <strong>{color.sharpen.toFixed(1)}</strong></label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={color.sharpen}
                onChange={(e) => updateColor({ sharpen: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Vignette <strong>{Math.round(color.vignette * 100)}%</strong></label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={color.vignette}
                onChange={(e) => updateColor({ vignette: Number(e.target.value) })}
              />
            </div>
          </div>
        )}

        {tab === 'effects' && (() => {
          const nfx = normalizeClipFx(clip.fx, clip.flashIn);
          const cam: ClipCamera = { ...DEFAULT_CLIP_CAMERA, ...(clip.camera ?? {}) };
          const updateCam = (patch: Partial<ClipCamera>) => {
            onPatchClip({ camera: { ...cam, ...patch } });
          };
          const patchStructuredFx = (patch: Partial<ClipAmvFxObject>) => {
            const currentObj: ClipAmvFxObject = {
              mangaBlink: nfx.mangaBlink || undefined,
              radialSpeedLines: nfx.radialSpeedLines,
              horizSpeedLines: nfx.horizSpeedLines,
              particles: nfx.particles,
              flashIn: nfx.flashIn,
              fadeOutBlack: nfx.fadeOutBlack,
            };
            onPatchClip({
              fx: { ...currentObj, ...patch },
              flashIn: patch.flashIn !== undefined ? (patch.flashIn?.alpha ?? 0) : (clip.flashIn ?? 0),
            });
          };

          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Native Camera Motion (AMV / Beat-Sync / Shake / Tremor / Rotation) */}
            <div className="capcut-applied-fx-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 11.5 }}>🎥 Caméra dynamique (Beat-Sync)</strong>
                {clip.camera && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '1px 5px', fontSize: 10 }}
                    onClick={() => onPatchClip({ camera: null })}
                  >
                    Reset
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 56px', gap: 5 }}>
                <select
                  className="select"
                  value={cam.mode}
                  onChange={(e) => updateCam({ mode: e.target.value as ClipCameraMode })}
                >
                  <option value="static">Statique</option>
                  <option value="push">Push-in</option>
                  <option value="ease">Ease (Doux)</option>
                  <option value="pull_back">Pull-back</option>
                  <option value="power_pullback">Power Pullback</option>
                  <option value="crash_zoom">Crash Zoom</option>
                  <option value="p05_vertigo">Vertigo P05</option>
                  <option value="pan">Panoramique</option>
                </select>
                <input
                  className="input"
                  type="number"
                  step={0.05}
                  min={0.5}
                  max={4}
                  title="Zoom initial z0"
                  value={cam.z0}
                  onChange={(e) => updateCam({ z0: Number(e.target.value) || 1 })}
                />
                <input
                  className="input"
                  type="number"
                  step={0.05}
                  min={0.5}
                  max={4}
                  title="Zoom final z1"
                  value={cam.z1}
                  onChange={(e) => updateCam({ z1: Number(e.target.value) || 1 })}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div className="capcut-slider-row">
                  <label>Beat Pulse <strong>{Math.round(cam.beatPulseAmp * 100)}%</strong></label>
                  <input
                    type="range"
                    min={0}
                    max={0.35}
                    step={0.005}
                    value={cam.beatPulseAmp}
                    onChange={(e) => updateCam({ beatPulseAmp: Number(e.target.value) })}
                  />
                </div>
                <div className="capcut-slider-row">
                  <label>Rotation <strong>{cam.rotDeg.toFixed(1)}°</strong></label>
                  <input
                    type="range"
                    min={-25}
                    max={25}
                    step={0.5}
                    value={cam.rotDeg}
                    onChange={(e) => updateCam({ rotDeg: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div className="capcut-slider-row">
                  <label>Shake Cut <strong>{Math.round(cam.shakeAmp * 100)}%</strong></label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={cam.shakeAmp}
                    onChange={(e) => updateCam({ shakeAmp: Number(e.target.value) })}
                  />
                </div>
                <div className="capcut-slider-row">
                  <label>Tremor HF <strong>{Math.round(cam.tremorAmp * 100)}%</strong></label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={cam.tremorAmp}
                    onChange={(e) => updateCam({ tremorAmp: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            {/* Native Cinemascope Letterbox Bars */}
            <div className="capcut-applied-fx-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <strong style={{ fontSize: 11.5 }}>🎞️ Cinémascope</strong>
                <div style={{ display: 'flex', gap: 3 }}>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: 9.5, padding: '1px 5px' }}
                    onClick={() => onPatchClip({ cinemascope: null })}
                  >
                    16:9
                  </button>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: 9.5, padding: '1px 5px' }}
                    onClick={() => onPatchClip({ cinemascope: { bar0: 0.125, bar1: 0.125 } })}
                  >
                    2.39:1
                  </button>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: 9.5, padding: '1px 5px' }}
                    onClick={() => onPatchClip({ cinemascope: { bar0: 0.25, bar1: 0.125 } })}
                  >
                    Eye-Slit
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div className="capcut-slider-row">
                  <label>bar0 <strong>{Math.round((clip.cinemascope?.bar0 ?? 0) * 100)}%</strong></label>
                  <input
                    type="range"
                    min={0}
                    max={0.4}
                    step={0.005}
                    value={clip.cinemascope?.bar0 ?? 0}
                    onChange={(e) => {
                      const next: ClipCinemascope = {
                        ...DEFAULT_CLIP_CINEMASCOPE,
                        ...(clip.cinemascope ?? {}),
                        bar0: Number(e.target.value),
                      };
                      onPatchClip({ cinemascope: next });
                    }}
                  />
                </div>
                <div className="capcut-slider-row">
                  <label>bar1 <strong>{Math.round((clip.cinemascope?.bar1 ?? 0) * 100)}%</strong></label>
                  <input
                    type="range"
                    min={0}
                    max={0.4}
                    step={0.005}
                    value={clip.cinemascope?.bar1 ?? 0}
                    onChange={(e) => {
                      const next: ClipCinemascope = {
                        ...DEFAULT_CLIP_CINEMASCOPE,
                        ...(clip.cinemascope ?? {}),
                        bar1: Number(e.target.value),
                      };
                      onPatchClip({ cinemascope: next });
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Structured WYSIWYG AMV FX Inspector */}
            <div className="capcut-applied-fx-card">
              <strong style={{ fontSize: 11.5 }}>⚡ FX AMV (Temps Réel WYSIWYG)</strong>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`chip ${nfx.mangaBlink ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => patchStructuredFx({ mangaBlink: !nfx.mangaBlink })}
                >
                  Manga Blink
                </button>
                <button
                  type="button"
                  className={`chip ${nfx.radialSpeedLines ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() =>
                    patchStructuredFx({
                      radialSpeedLines: nfx.radialSpeedLines
                        ? null
                        : { color: '#FFFFFF', intensity: 0.85, count: 48 },
                    })
                  }
                >
                  Radial Speed
                </button>
                <button
                  type="button"
                  className={`chip ${nfx.horizSpeedLines ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() =>
                    patchStructuredFx({
                      horizSpeedLines: nfx.horizSpeedLines
                        ? null
                        : { color: '#FFFFFF', direction: 'left', intensity: 0.8 },
                    })
                  }
                >
                  Horiz Speed
                </button>
                <button
                  type="button"
                  className={`chip ${nfx.particles ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() =>
                    patchStructuredFx({
                      particles: nfx.particles
                        ? null
                        : { color: '#F5B942', count: 36, intensity: 0.9 },
                    })
                  }
                >
                  Particules
                </button>
                <button
                  type="button"
                  className={`chip ${nfx.flashIn ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() =>
                    patchStructuredFx({
                      flashIn: nfx.flashIn ? null : { alpha: 0.85, color: '#FFFFFF', frames: 6 },
                    })
                  }
                >
                  Flash Entrée
                </button>
                <button
                  type="button"
                  className={`chip ${nfx.fadeOutBlack ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() =>
                    patchStructuredFx({
                      fadeOutBlack: nfx.fadeOutBlack ? null : { durationSec: 0.6 },
                    })
                  }
                >
                  Fondu Noir
                </button>
              </div>

              {nfx.radialSpeedLines && (
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={nfx.radialSpeedLines.color}
                    title="Couleur lignes radiales"
                    onChange={(e) =>
                      patchStructuredFx({
                        radialSpeedLines: { ...nfx.radialSpeedLines!, color: e.target.value },
                      })
                    }
                    style={{ width: 34, height: 24, padding: 1 }}
                  />
                  <div className="capcut-slider-row">
                    <label>Intensité <strong>{nfx.radialSpeedLines.intensity.toFixed(1)}</strong></label>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.1}
                      value={nfx.radialSpeedLines.intensity}
                      onChange={(e) =>
                        patchStructuredFx({
                          radialSpeedLines: { ...nfx.radialSpeedLines!, intensity: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Lignes <strong>{nfx.radialSpeedLines.count}</strong></label>
                    <input
                      type="range"
                      min={12}
                      max={120}
                      step={4}
                      value={nfx.radialSpeedLines.count}
                      onChange={(e) =>
                        patchStructuredFx({
                          radialSpeedLines: { ...nfx.radialSpeedLines!, count: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {nfx.horizSpeedLines && (
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={nfx.horizSpeedLines.color}
                    title="Couleur lignes directionnelles"
                    onChange={(e) =>
                      patchStructuredFx({
                        horizSpeedLines: { ...nfx.horizSpeedLines!, color: e.target.value },
                      })
                    }
                    style={{ width: 34, height: 24, padding: 1 }}
                  />
                  <select
                    className="select"
                    value={nfx.horizSpeedLines.direction}
                    onChange={(e) =>
                      patchStructuredFx({
                        horizSpeedLines: {
                          ...nfx.horizSpeedLines!,
                          direction: e.target.value as HorizSpeedLinesDirection,
                        },
                      })
                    }
                  >
                    <option value="left">← Gauche</option>
                    <option value="right">→ Droite</option>
                    <option value="diag_up">↗ Diag Haut</option>
                    <option value="vert_down">↓ Descente</option>
                  </select>
                  <div className="capcut-slider-row">
                    <label>Int. <strong>{nfx.horizSpeedLines.intensity.toFixed(1)}</strong></label>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.1}
                      value={nfx.horizSpeedLines.intensity}
                      onChange={(e) =>
                        patchStructuredFx({
                          horizSpeedLines: { ...nfx.horizSpeedLines!, intensity: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {nfx.particles && (
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={nfx.particles.color}
                    title="Couleur particules"
                    onChange={(e) =>
                      patchStructuredFx({
                        particles: { ...nfx.particles!, color: e.target.value },
                      })
                    }
                    style={{ width: 34, height: 24, padding: 1 }}
                  />
                  <div className="capcut-slider-row">
                    <label>Orbes <strong>{nfx.particles.count}</strong></label>
                    <input
                      type="range"
                      min={4}
                      max={120}
                      step={2}
                      value={nfx.particles.count}
                      onChange={(e) =>
                        patchStructuredFx({
                          particles: { ...nfx.particles!, count: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Glow <strong>{(nfx.particles.intensity ?? 0.85).toFixed(1)}</strong></label>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.1}
                      value={nfx.particles.intensity ?? 0.85}
                      onChange={(e) =>
                        patchStructuredFx({
                          particles: { ...nfx.particles!, intensity: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {nfx.flashIn && (
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={nfx.flashIn.color}
                    title="Couleur flash"
                    onChange={(e) =>
                      patchStructuredFx({
                        flashIn: { ...nfx.flashIn!, color: e.target.value },
                      })
                    }
                    style={{ width: 34, height: 24, padding: 1 }}
                  />
                  <div className="capcut-slider-row">
                    <label>Alpha <strong>{Math.round(nfx.flashIn.alpha * 100)}%</strong></label>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={nfx.flashIn.alpha}
                      onChange={(e) =>
                        patchStructuredFx({
                          flashIn: { ...nfx.flashIn!, alpha: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Frames <strong>{nfx.flashIn.frames}f</strong></label>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={nfx.flashIn.frames}
                      onChange={(e) =>
                        patchStructuredFx({
                          flashIn: { ...nfx.flashIn!, frames: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {nfx.fadeOutBlack && (
                <div className="capcut-slider-row">
                  <label>Fondu Noir Fin <strong>{nfx.fadeOutBlack.durationSec.toFixed(2)}s</strong></label>
                  <input
                    type="range"
                    min={0.1}
                    max={4}
                    step={0.1}
                    value={nfx.fadeOutBlack.durationSec}
                    onChange={(e) =>
                      patchStructuredFx({
                        fadeOutBlack: { durationSec: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              )}
            </div>

            {/* Custom / Catalog Effects */}
            <div className="capcut-subhead">
              <span>Effets Catalogue & IA ({effects.length})</span>
            </div>
            {effects.length === 0 ? (
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                Ajoute des effets depuis la bibliothèque à gauche (ou via Claude MCP).
              </p>
            ) : (
              effects.map((applied, idx) => {
                const def = effectCatalog.get(applied.effectSlug);
                return (
                  <div key={`${applied.effectSlug}-${idx}`} className="capcut-applied-fx-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={applied.enabled}
                          onChange={(e) => updateEffectAt(idx, { enabled: e.target.checked })}
                        />
                        <span>
                          {def?.icon ?? '✨'} {def?.name ?? applied.effectSlug}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeEffectAt(idx)}
                        style={{ padding: 3, color: 'var(--accent-red)' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {def?.paramsSchema.map((spec) => {
                      const val = applied.params?.[spec.key] ?? def.defaultParams?.[spec.key] ?? spec.default;
                      if (spec.type === 'number') {
                        const numVal = typeof val === 'number' ? val : Number(spec.default) || 0;
                        return (
                          <div key={spec.key} className="capcut-slider-row">
                            <label>
                              {spec.label} <strong>{numVal}</strong>
                            </label>
                            <input
                              type="range"
                              min={spec.min ?? 0}
                              max={spec.max ?? 10}
                              step={spec.step ?? 0.1}
                              value={numVal}
                              onChange={(e) =>
                                updateEffectAt(idx, {
                                  params: { ...(applied.params ?? {}), [spec.key]: Number(e.target.value) },
                                })
                              }
                            />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                );
              })
            )}
          </div>
          );
        })()}

        {tab === 'audio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="capcut-slider-row">
              <label>Volume <strong>{Math.round(clip.volume * 100)}%</strong></label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={clip.volume}
                onChange={(e) => onPatchClip({ volume: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Fondu entrée (Fade In) <strong>{fadeInSec.toFixed(1)}s</strong></label>
              <input
                type="range"
                min={0}
                max={Math.min(10, clip.durationSec / 2)}
                step={0.1}
                value={fadeInSec}
                onChange={(e) => onPatchClip({ fadeInSec: Number(e.target.value) })}
              />
            </div>
            <div className="capcut-slider-row">
              <label>Fondu sortie (Fade Out) <strong>{fadeOutSec.toFixed(1)}s</strong></label>
              <input
                type="range"
                min={0}
                max={Math.min(10, clip.durationSec / 2)}
                step={0.1}
                value={fadeOutSec}
                onChange={(e) => onPatchClip({ fadeOutSec: Number(e.target.value) })}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={clip.muted}
                onChange={(e) => onPatchClip({ muted: e.target.checked })}
              />
              Couper ce clip (Mute)
            </label>
          </div>
        )}

        {tab === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!textOverlay ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onPatchClip({ textOverlay: { ...DEFAULT_TEXT_OVERLAY } })}
              >
                <Plus size={12} /> Ajouter un texte sur ce clip
              </button>
            ) : (
              <>
                <div className="field">
                  <label>Titre / Texte principal</label>
                  <input
                    className="input"
                    value={textOverlay.text}
                    onChange={(e) => onPatchClip({ textOverlay: { ...textOverlay, text: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>Sous-titre / Paroles (optionnel)</label>
                  <input
                    className="input"
                    placeholder="Ex: Score, paroles synchronisées..."
                    value={textOverlay.subtitle ?? ''}
                    onChange={(e) =>
                      onPatchClip({ textOverlay: { ...textOverlay, subtitle: e.target.value } })
                    }
                  />
                </div>
                <div className="field">
                  <label>Police (fontFamily)</label>
                  <select
                    className="select"
                    value={textOverlay.fontFamily ?? 'Inter, system-ui, sans-serif'}
                    onChange={(e) =>
                      onPatchClip({ textOverlay: { ...textOverlay, fontFamily: e.target.value } })
                    }
                  >
                    <option value="Inter, system-ui, sans-serif">Inter / Sans (Cinéma)</option>
                    <option value="Georgia, serif">Georgia / Serif (Dramatique)</option>
                    <option value="'Impact', 'Arial Black', sans-serif">Impact / Manga Bold</option>
                    <option value="'JetBrains Mono', monospace">Monospace / HUD</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px', gap: 5 }}>
                  <div className="field">
                    <label>Taille ({textOverlay.fontSize}px)</label>
                    <input
                      type="range"
                      min={16}
                      max={120}
                      value={textOverlay.fontSize}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, fontSize: Number(e.target.value) } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Texte</label>
                    <input
                      className="input"
                      type="color"
                      value={textOverlay.color}
                      onChange={(e) => onPatchClip({ textOverlay: { ...textOverlay, color: e.target.value } })}
                      style={{ padding: 2, height: 28 }}
                    />
                  </div>
                  <div className="field">
                    <label>Contour</label>
                    <input
                      className="input"
                      type="color"
                      value={textOverlay.strokeColor || '#000000'}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, strokeColor: e.target.value } })
                      }
                      style={{ padding: 2, height: 28 }}
                    />
                  </div>
                  <div className="field">
                    <label>Halo</label>
                    <input
                      className="input"
                      type="color"
                      value={textOverlay.glowColor || '#F5B942'}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, glowColor: e.target.value } })
                      }
                      style={{ padding: 2, height: 28 }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div className="capcut-slider-row">
                    <label>Pos X <strong>{textOverlay.x}%</strong></label>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      value={textOverlay.x}
                      onChange={(e) => onPatchClip({ textOverlay: { ...textOverlay, x: Number(e.target.value) } })}
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Pos Y <strong>{textOverlay.y}%</strong></label>
                    <input
                      type="range"
                      min={8}
                      max={92}
                      value={textOverlay.y}
                      onChange={(e) => onPatchClip({ textOverlay: { ...textOverlay, y: Number(e.target.value) } })}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div className="capcut-slider-row">
                    <label>Fade In <strong>{(textOverlay.fadeInSec ?? 0.25).toFixed(2)}s</strong></label>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.05}
                      value={textOverlay.fadeInSec ?? 0.25}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, fadeInSec: Number(e.target.value) } })
                      }
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Fade Out <strong>{(textOverlay.fadeOutSec ?? 0.25).toFixed(2)}s</strong></label>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.05}
                      value={textOverlay.fadeOutSec ?? 0.25}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, fadeOutSec: Number(e.target.value) } })
                      }
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 6, alignItems: 'center' }}>
                  <div className="field">
                    <label>Fond</label>
                    <input
                      className="input"
                      type="color"
                      value={textOverlay.bgColor}
                      onChange={(e) => onPatchClip({ textOverlay: { ...textOverlay, bgColor: e.target.value } })}
                      style={{ padding: 2, height: 28 }}
                    />
                  </div>
                  <div className="capcut-slider-row">
                    <label>Opacité fond <strong>{Math.round(textOverlay.bgOpacity * 100)}%</strong></label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={textOverlay.bgOpacity}
                      onChange={(e) =>
                        onPatchClip({ textOverlay: { ...textOverlay, bgOpacity: Number(e.target.value) } })
                      }
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onPatchClip({ textOverlay: null })}
                  style={{ color: 'var(--accent-red)', alignSelf: 'flex-start' }}
                >
                  <Trash2 size={11} /> Retirer le texte
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'keyframes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Position locale curseur : <strong>{localPlayhead.toFixed(2)}s</strong> / {clip.durationSec.toFixed(2)}s
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(['scale', 'x', 'y', 'rotation', 'opacity'] as KeyframeProperty[]).map((prop) => (
                <button
                  key={prop}
                  type="button"
                  className="chip"
                  onClick={() => addKeyframe(prop)}
                  title={`Ajouter une image-clé "${prop}" à ${localPlayhead.toFixed(2)}s`}
                >
                  <Diamond size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />+ {prop}
                </button>
              ))}
            </div>
            {keyframes.length === 0 ? (
              <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
                Aucune image-clé. Place le curseur, ajuste Scale/Pos/Opacité dans « Base » et clique sur un losange pour animer (ex: Ken Burns zoom lent).
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {keyframes
                  .slice()
                  .sort((a, b) => a.timeOffsetSec - b.timeOffsetSec)
                  .map((kf) => (
                    <div key={kf.id} className="capcut-kf-row">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        ◆ {kf.timeOffsetSec.toFixed(2)}s
                      </span>
                      <span className="badge">{kf.property}</span>
                      <span style={{ fontSize: 11 }}>{kf.value.toFixed(2)}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeKeyframe(kf.id)}
                        style={{ padding: 2, marginLeft: 'auto', color: 'var(--accent-red)' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Footer */}
      <div className="capcut-inspector-foot">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={onCommit}
          style={{ width: '100%' }}
        >
          <Save size={12} /> {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Link2,
  Pause,
  Play,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { AssetDto } from '@videostudio/shared';
import { QUALITY_TIER_SHORT } from '../utils/format';

interface CompareViewProps {
  assets: AssetDto[];
  initialLeftId?: string | null;
  initialRightId?: string | null;
  onCopyLink?: (url: string) => void;
}

export function CompareView({
  assets,
  initialLeftId,
  initialRightId,
  onCopyLink,
}: CompareViewProps) {
  const comparableAssets = assets.filter((a) => a.type === 'image' || a.type === 'video');

  const [leftId, setLeftId] = useState<string>(
    initialLeftId ?? comparableAssets[1]?.id ?? comparableAssets[0]?.id ?? '',
  );
  const [rightId, setRightId] = useState<string>(
    initialRightId ?? comparableAssets[0]?.id ?? '',
  );
  const [mode, setMode] = useState<'side_by_side' | 'slider'>('side_by_side');
  const [sliderPos, setSliderPos] = useState(50);
  const [playing, setPlaying] = useState(false);

  const videoLeftRef = useRef<HTMLVideoElement | null>(null);
  const videoRightRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (initialLeftId) setLeftId(initialLeftId);
    if (initialRightId) setRightId(initialRightId);
  }, [initialLeftId, initialRightId]);

  const leftAsset = comparableAssets.find((a) => a.id === leftId) ?? null;
  const rightAsset = comparableAssets.find((a) => a.id === rightId) ?? null;

  // Smart auto-suggested comparison pairs from lineage relations (upscale 1080p <-> 4K, rejected <-> revision)
  const suggestedPairs = useMemo(() => {
    const byId = new Map(comparableAssets.map((a) => [a.id, a]));
    const pairs: Array<{ label: string; kind: string; left: AssetDto; right: AssetDto }> = [];
    for (const child of comparableAssets) {
      if (!child.parentAssetId) continue;
      const parent = byId.get(child.parentAssetId);
      if (!parent) continue;
      if (child.relationType === 'upscale' || child.qualityTier === 'hq_upscale' || child.qualityTier === 'final_master') {
        pairs.push({
          label: `${parent.handle} ↔ ${child.handle}`,
          kind: 'Upscale / HQ',
          left: parent,
          right: child,
        });
      } else if (parent.status === 'needs_revision' || child.relationType === 'revision') {
        pairs.push({
          label: `${parent.handle} ↔ ${child.handle}`,
          kind: parent.status === 'needs_revision' ? 'Rejet ↔ Correction' : 'Révision',
          left: parent,
          right: child,
        });
      } else {
        pairs.push({
          label: `${parent.handle} ↔ ${child.handle}`,
          kind: child.relationType,
          left: parent,
          right: child,
        });
      }
    }
    return pairs.slice(0, 6);
  }, [comparableAssets]);

  const bothImages = leftAsset?.type === 'image' && rightAsset?.type === 'image';
  const bothVideos = leftAsset?.type === 'video' && rightAsset?.type === 'video';

  const handleCopyCompareLink = () => {
    if (!leftAsset || !rightAsset) return;
    const url = `${window.location.origin}/compare?left=${encodeURIComponent(leftAsset.handle)}&right=${encodeURIComponent(rightAsset.handle)}`;
    onCopyLink?.(url);
  };

  const toggleSyncedPlayback = () => {
    const v1 = videoLeftRef.current;
    const v2 = videoRightRef.current;
    if (!v1 || !v2) return;
    if (playing) {
      v1.pause();
      v2.pause();
      setPlaying(false);
    } else {
      v2.currentTime = v1.currentTime;
      void v1.play();
      void v2.play();
      setPlaying(true);
    }
  };

  const stepBothVideos = (deltaFrames: number) => {
    const v1 = videoLeftRef.current;
    const v2 = videoRightRef.current;
    if (!v1 || !v2) return;
    v1.pause();
    v2.pause();
    setPlaying(false);
    const fps = leftAsset?.fps && leftAsset.fps > 0 ? leftAsset.fps : 24;
    const next = Math.max(0, v1.currentTime + deltaFrames / fps);
    v1.currentTime = next;
    v2.currentTime = next;
  };

  if (comparableAssets.length < 2) {
    return (
      <div className="empty-state">
        <Columns2 size={34} color="var(--text-muted)" />
        <h2>Comparateur A/B</h2>
        <p>
          Ajoute au moins 2 images ou vidéos (par exemple un Draft basse résolution et son upscale
          HQ) pour les comparer côte à côte ou au curseur Avant/Après.
        </p>
      </div>
    );
  }

  return (
    <div className="compare-layout">
      {suggestedPairs.length > 0 && (
        <div className="compare-suggestions-bar">
          <span className="compare-suggestions-label">
            <Sparkles size={12} /> Paires suggérées :
          </span>
          {suggestedPairs.map((pair) => {
            const isActive = pair.left.id === leftId && pair.right.id === rightId;
            return (
              <button
                key={`${pair.left.id}-${pair.right.id}`}
                type="button"
                className={`chip ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setLeftId(pair.left.id);
                  setRightId(pair.right.id);
                }}
              >
                {pair.kind} · {pair.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="compare-controls-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pill-tag amber">A</span>
            <select
              aria-label="Média A"
              className="select-compact"
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
            >
              {comparableAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.handle} · {a.title} ({QUALITY_TIER_SHORT[a.qualityTier]})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pill-tag blue">B</span>
            <select
              aria-label="Média B"
              className="select-compact"
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
            >
              {comparableAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.handle} · {a.title} ({QUALITY_TIER_SHORT[a.qualityTier]})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {bothVideos && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={toggleSyncedPlayback}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? 'Pause synchro' : 'Lecture synchro'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => stepBothVideos(-1)}
              >
                <ChevronLeft size={13} /> -1f
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => stepBothVideos(1)}
              >
                +1f <ChevronRight size={13} />
              </button>
            </>
          )}

          {leftAsset && rightAsset && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCopyCompareLink}
              title="Copier le lien direct vers cette comparaison A/B"
            >
              <Link2 size={12} /> Copier lien
            </button>
          )}

          <button
            type="button"
            className={`chip ${mode === 'side_by_side' ? 'active' : ''}`}
            onClick={() => setMode('side_by_side')}
          >
            <Columns2 size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Côte à côte
          </button>
          <button
            type="button"
            className={`chip ${mode === 'slider' ? 'active' : ''}`}
            disabled={!bothImages}
            title={bothImages ? 'Curseur Avant/Après' : 'Disponible uniquement entre 2 images'}
            onClick={() => setMode('slider')}
          >
            <SlidersHorizontal size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Curseur A/B
          </button>
        </div>
      </div>

      {mode === 'slider' && bothImages && leftAsset && rightAsset ? (
        <div>
          <div className="slider-stage">
            <img src={rightAsset.urls.proxy ?? rightAsset.urls.original} alt={rightAsset.title} />
            <img
              src={leftAsset.urls.proxy ?? leftAsset.urls.original}
              alt={leftAsset.title}
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            />
            <div className="slider-divider" style={{ left: `${sliderPos}%` }} />
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                display: 'flex',
                gap: 6,
              }}
            >
              <span className="badge">
                A : {leftAsset.handle} ({QUALITY_TIER_SHORT[leftAsset.qualityTier]})
              </span>
            </div>
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                display: 'flex',
                gap: 6,
              }}
            >
              <span className="badge">
                B : {rightAsset.handle} ({QUALITY_TIER_SHORT[rightAsset.qualityTier]})
              </span>
            </div>
          </div>

          <input
            aria-label="Position du curseur de comparaison"
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="slider-range-input"
          />
        </div>
      ) : (
        <div className="compare-side-by-side">
          {[
            { label: 'A', asset: leftAsset, ref: videoLeftRef },
            { label: 'B', asset: rightAsset, ref: videoRightRef },
          ].map(({ label, asset, ref }) => (
            <div key={label} className="compare-pane">
              <div className="compare-pane-header">
                <span>
                  <strong>{label}</strong> · {asset?.handle ?? '—'} {asset?.title ?? ''}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {asset?.width && asset?.height ? `${asset.width}×${asset.height}` : ''} ·{' '}
                  {asset ? QUALITY_TIER_SHORT[asset.qualityTier] : ''}
                </span>
              </div>
              <div className="compare-pane-media">
                {asset?.type === 'image' && (
                  <img src={asset.urls.proxy ?? asset.urls.original} alt={asset.title} />
                )}
                {asset?.type === 'video' && (
                  <video
                    ref={ref}
                    src={asset.urls.proxy ?? asset.urls.original}
                    controls
                    playsInline
                    muted={label === 'B'}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

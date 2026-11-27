import { Copy, FileText, Film, Image as ImageIcon, Music, Star } from 'lucide-react';
import type { AssetDto } from '@videostudio/shared';
import { formatDuration, QUALITY_TIER_SHORT, STATUS_LABELS } from '../utils/format';

interface AssetCardProps {
  asset: AssetDto;
  selected: boolean;
  onSelect: (asset: AssetDto) => void;
  onDoubleClick?: (asset: AssetDto) => void;
  onCopyRef: (text: string) => void;
}

export function AssetCard({
  asset,
  selected,
  onSelect,
  onDoubleClick,
  onCopyRef,
}: AssetCardProps) {
  const thumbUrl = asset.urls.thumbnail ?? asset.urls.proxy ?? asset.urls.original;

  return (
    <article
      className={`asset-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(asset)}
      onDoubleClick={() => onDoubleClick?.(asset)}
      role="button"
      tabIndex={0}
      title="Cliquer pour inspecter · Double-cliquer pour ouvrir en grand"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(asset);
        }
      }}
    >
      <div className="asset-thumb-wrap">
        {asset.type === 'image' ? (
          <img src={thumbUrl} alt={asset.title} loading="lazy" />
        ) : asset.type === 'video' ? (
          asset.urls.thumbnail ? (
            <img src={asset.urls.thumbnail} alt={asset.title} loading="lazy" />
          ) : (
            <video src={asset.urls.proxy ?? asset.urls.original} muted preload="metadata" />
          )
        ) : asset.type === 'audio' ? (
          <div className="asset-thumb-placeholder">
            <Music size={28} />
            <span>{formatDuration(asset.durationSec)}</span>
          </div>
        ) : (
          <div className="asset-thumb-placeholder">
            <FileText size={28} />
            <span>{asset.originalFilename}</span>
          </div>
        )}

        <div className="asset-overlay-top">
          <span className={`badge badge-tier-${asset.qualityTier}`}>
            {QUALITY_TIER_SHORT[asset.qualityTier]}
          </span>
          {asset.versionNumber > 1 && <span className="badge">v{asset.versionNumber}</span>}
        </div>

        <div className="asset-overlay-bottom">
          <span className={`badge badge-status-${asset.status}`}>
            {STATUS_LABELS[asset.status]}
          </span>
          {asset.type === 'video' && (
            <span className="badge">
              <Film size={11} />
              {formatDuration(asset.durationSec)}
            </span>
          )}
          {asset.type === 'image' && asset.width && asset.height && (
            <span className="badge">
              <ImageIcon size={11} />
              {asset.width}×{asset.height}
            </span>
          )}
        </div>
      </div>

      <div className="asset-card-body">
        <div className="asset-card-title" title={asset.title}>
          {asset.title}
        </div>
        {asset.folderPath && (
          <div
            style={{
              fontSize: 10.5,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`/${asset.folderPath}`}
          >
            /{asset.folderPath}
          </div>
        )}

        <div className="asset-card-footer">
          <button
            type="button"
            className="ref-copy-btn"
            title={`Copier la référence ${asset.handle} pour Claude Code`}
            onClick={(e) => {
              e.stopPropagation();
              onCopyRef(asset.handle);
            }}
          >
            <Copy size={11} />
            {asset.handle}
          </button>

          {asset.rating > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11.5,
                color: 'var(--accent-amber)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Star size={12} fill="currentColor" />
              {asset.rating}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

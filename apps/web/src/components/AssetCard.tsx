import type { DragEvent, MouseEvent } from 'react';
import { Check, Copy, FileText, Film, Image as ImageIcon, Music, Star } from 'lucide-react';
import type { AssetDto } from '@videostudio/shared';
import { ASSET_DRAG_MIME, ASSET_LIST_DRAG_MIME } from '../utils/drag';
import {
  formatDuration,
  formatRelativeTime,
  QUALITY_TIER_SHORT,
  STATUS_LABELS,
} from '../utils/format';
import { getAssetChangeKind } from '../utils/media-view';

interface AssetCardProps {
  asset: AssetDto;
  selected: boolean;
  checked?: boolean;
  selectionMode?: boolean;
  dragging?: boolean;
  dragAssetIds?: string[];
  showRecentStamp?: boolean;
  onSelect: (
    asset: AssetDto,
    modifiers?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void;
  onToggleCheck?: (asset: AssetDto, opts: { shiftKey: boolean }) => void;
  onDoubleClick?: (asset: AssetDto) => void;
  onCopyRef: (text: string) => void;
  onNavigateFolder?: (folderPath: string) => void;
  onDragStartAsset?: (asset: AssetDto) => void;
  onDragEndAsset?: () => void;
}

export function AssetCard({
  asset,
  selected,
  checked = false,
  selectionMode = false,
  dragging = false,
  dragAssetIds,
  showRecentStamp = false,
  onSelect,
  onToggleCheck,
  onDoubleClick,
  onCopyRef,
  onNavigateFolder,
  onDragStartAsset,
  onDragEndAsset,
}: AssetCardProps) {
  const thumbUrl = asset.urls.thumbnail ?? asset.urls.proxy ?? asset.urls.original;
  const changeKind = getAssetChangeKind(asset);
  const activityIso = changeKind === 'modified' ? asset.updatedAt : asset.createdAt;

  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    const idsToDrag = dragAssetIds && dragAssetIds.length > 0 ? dragAssetIds : [asset.id];
    e.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
    e.dataTransfer.setData(ASSET_LIST_DRAG_MIME, JSON.stringify(idsToDrag));
    e.dataTransfer.setData(
      'text/plain',
      idsToDrag.length > 1 ? `${idsToDrag.length} médias` : asset.handle,
    );
    e.dataTransfer.effectAllowed = 'move';
    onDragStartAsset?.(asset);
  };

  const handleCardClick = (e: MouseEvent<HTMLElement>) => {
    onSelect(asset, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
  };

  return (
    <article
      className={`asset-card ${selected ? 'selected' : ''} ${checked ? 'multi-selected' : ''} ${
        dragging ? 'dragging' : ''
      }`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => onDragEndAsset?.()}
      onClick={handleCardClick}
      onDoubleClick={() => onDoubleClick?.(asset)}
      role="button"
      tabIndex={0}
      title="Cliquer pour inspecter · Ctrl/Shift+clic ou case pour multi-sélectionner · Glisser vers un dossier pour déplacer"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(asset);
        }
      }}
    >
      <div className="asset-thumb-wrap">
        {onToggleCheck && (
          <button
            type="button"
            className={`asset-select-checkbox ${checked ? 'checked' : ''} ${
              selectionMode ? 'visible' : ''
            }`}
            aria-label={checked ? `Désélectionner ${asset.title}` : `Sélectionner ${asset.title}`}
            aria-pressed={checked}
            title="Sélectionner pour déplacer en lot (Shift+clic pour une plage)"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(asset, { shiftKey: e.shiftKey });
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {checked && <Check size={12} strokeWidth={3} />}
          </button>
        )}

        {asset.type === 'image' ? (
          <img src={thumbUrl} alt={asset.title} loading="lazy" draggable={false} />
        ) : asset.type === 'video' ? (
          asset.urls.thumbnail ? (
            <img src={asset.urls.thumbnail} alt={asset.title} loading="lazy" draggable={false} />
          ) : (
            <video
              src={asset.urls.proxy ?? asset.urls.original}
              muted
              preload="metadata"
              draggable={false}
            />
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
          {asset.relationType && asset.relationType !== 'revision' && (
            <span className="badge badge-relation">{asset.relationType.toUpperCase()}</span>
          )}
          {asset.versionNumber > 1 && <span className="badge">v{asset.versionNumber}</span>}
          {asset.qcStatus && asset.qcStatus !== 'pending' && (
            <span
              className={`badge badge-qc-${asset.qcStatus}`}
              title={
                Object.entries(asset.qcChecks ?? {})
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || `QC ${asset.qcStatus}`
              }
            >
              {asset.qcStatus === 'pass'
                ? 'QC ✓'
                : asset.qcStatus === 'warn'
                  ? 'QC !'
                  : 'QC ✗'}
            </span>
          )}
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
        {showRecentStamp && (
          <div
            className="asset-card-recent-row"
            title={`${changeKind === 'modified' ? 'Modifié' : 'Ajouté'} le ${new Date(activityIso).toLocaleString('fr-FR')}`}
          >
            <span className={`recent-kind-pill kind-${changeKind}`}>
              {changeKind === 'modified' ? 'Modifié' : 'Ajouté'}
            </span>
            <span>{formatRelativeTime(activityIso)}</span>
          </div>
        )}
        {asset.folderPath && (
          <button
            type="button"
            className="folder-chip-link"
            style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
            title={`Ouvrir /${asset.folderPath}`}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateFolder?.(asset.folderPath);
            }}
          >
            /{asset.folderPath}
          </button>
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

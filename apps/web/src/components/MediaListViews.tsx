import type { DragEvent, MouseEvent } from 'react';
import {
  ArrowDown,
  Check,
  Copy,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Star,
} from 'lucide-react';
import type { AssetDto } from '@videostudio/shared';
import { ASSET_DRAG_MIME, ASSET_LIST_DRAG_MIME, resolveDragAssetIds } from '../utils/drag';
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
  QUALITY_TIER_SHORT,
  STATUS_LABELS,
} from '../utils/format';
import { getAssetChangeKind, type MediaSortBy } from '../utils/media-view';

interface SharedMediaListProps {
  assets: AssetDto[];
  selectedAssetId: string | null;
  multiSelectedIds: string[];
  draggingAssetSet: Set<string>;
  sortBy: MediaSortBy;
  onChangeSort?: (sort: MediaSortBy) => void;
  onSelect: (
    asset: AssetDto,
    modifiers?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void;
  onToggleCheck: (asset: AssetDto, opts: { shiftKey: boolean }) => void;
  onToggleSelectAll?: () => void;
  onDoubleClick: (asset: AssetDto) => void;
  onCopyRef: (text: string) => void;
  onNavigateFolder?: (folderPath: string) => void;
  onDragStartAsset: (asset: AssetDto) => void;
  onDragEndAsset: () => void;
}

function renderSmallThumb(asset: AssetDto) {
  const thumbUrl = asset.urls.thumbnail ?? asset.urls.proxy ?? asset.urls.original;
  if (asset.type === 'image') {
    return <img src={thumbUrl} alt={asset.title} loading="lazy" draggable={false} />;
  }
  if (asset.type === 'video') {
    if (asset.urls.thumbnail) {
      return <img src={asset.urls.thumbnail} alt={asset.title} loading="lazy" draggable={false} />;
    }
    return <Film size={16} color="var(--text-muted)" />;
  }
  if (asset.type === 'audio') {
    return <Music size={16} color="var(--accent-amber)" />;
  }
  return <FileText size={16} color="var(--text-muted)" />;
}

function formatMediaSpecs(asset: AssetDto): string {
  if (asset.type === 'image') {
    return asset.width && asset.height ? `${asset.width}×${asset.height}` : 'Image';
  }
  if (asset.type === 'video') {
    const parts: string[] = [];
    if (asset.durationSec != null) parts.push(formatDuration(asset.durationSec));
    if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
    if (asset.fps) parts.push(`${Math.round(asset.fps)}fps`);
    return parts.join(' · ') || 'Vidéo';
  }
  if (asset.type === 'audio') {
    return asset.durationSec != null ? `Audio · ${formatDuration(asset.durationSec)}` : 'Audio';
  }
  return 'Document';
}

function buildDragHandler(
  asset: AssetDto,
  multiSelectedIds: string[],
  onDragStartAsset: (asset: AssetDto) => void,
) {
  return (e: DragEvent<HTMLElement>) => {
    const idsToDrag = resolveDragAssetIds(asset.id, multiSelectedIds);
    e.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
    e.dataTransfer.setData(ASSET_LIST_DRAG_MIME, JSON.stringify(idsToDrag));
    e.dataTransfer.setData(
      'text/plain',
      idsToDrag.length > 1 ? `${idsToDrag.length} médias` : asset.handle,
    );
    e.dataTransfer.effectAllowed = 'move';
    onDragStartAsset(asset);
  };
}

export function MediaListView({
  assets,
  selectedAssetId,
  multiSelectedIds,
  draggingAssetSet,
  onSelect,
  onToggleCheck,
  onDoubleClick,
  onCopyRef,
  onNavigateFolder,
  onDragStartAsset,
  onDragEndAsset,
}: SharedMediaListProps) {
  const multiSelectedSet = new Set(multiSelectedIds);

  return (
    <div className="media-list-view" role="list" aria-label="Liste des médias">
      {assets.map((asset) => {
        const isSelected = asset.id === selectedAssetId;
        const isChecked = multiSelectedSet.has(asset.id);
        const isDragging = draggingAssetSet.has(asset.id);
        const changeKind = getAssetChangeKind(asset);
        const activityIso = changeKind === 'modified' ? asset.updatedAt : asset.createdAt;

        const handleClick = (e: MouseEvent<HTMLElement>) => {
          onSelect(asset, {
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
          });
        };

        return (
          <div
            key={asset.id}
            role="listitem"
            className={`media-list-row ${isSelected ? 'selected' : ''} ${
              isChecked ? 'multi-selected' : ''
            } ${isDragging ? 'dragging' : ''}`}
            draggable
            onDragStart={buildDragHandler(asset, multiSelectedIds, onDragStartAsset)}
            onDragEnd={onDragEndAsset}
            onClick={handleClick}
            onDoubleClick={() => onDoubleClick(asset)}
          >
            <button
              type="button"
              className={`inline-select-checkbox ${isChecked ? 'checked' : ''}`}
              aria-label={isChecked ? `Désélectionner ${asset.title}` : `Sélectionner ${asset.title}`}
              aria-pressed={isChecked}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCheck(asset, { shiftKey: e.shiftKey });
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {isChecked && <Check size={11} strokeWidth={3} />}
            </button>

            <div className="media-row-thumb">{renderSmallThumb(asset)}</div>

            <div className="media-row-main">
              <div className="media-row-title-line">
                <span className="media-row-title" title={asset.title}>
                  {asset.title}
                </span>
                <span className={`recent-kind-pill kind-${changeKind}`}>
                  {changeKind === 'modified' ? 'Modifié' : 'Ajouté'}
                </span>
                {asset.versionNumber > 1 && <span className="badge">v{asset.versionNumber}</span>}
              </div>
              <div className="media-row-sub">
                <button
                  type="button"
                  className="ref-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyRef(asset.handle);
                  }}
                >
                  <Copy size={10} /> {asset.handle}
                </button>
                {asset.folderPath && (
                  <button
                    type="button"
                    className="folder-chip-link"
                    title={`Ouvrir /${asset.folderPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateFolder?.(asset.folderPath);
                    }}
                  >
                    <Folder size={10} /> /{asset.folderPath}
                  </button>
                )}
                <span className="media-row-spec">{formatMediaSpecs(asset)}</span>
              </div>
            </div>

            <div className="media-row-badges">
              <span className={`badge badge-tier-${asset.qualityTier}`}>
                {QUALITY_TIER_SHORT[asset.qualityTier]}
              </span>
              <span className={`badge badge-status-${asset.status}`}>
                {STATUS_LABELS[asset.status]}
              </span>
              {asset.qcStatus && asset.qcStatus !== 'pending' && (
                <span className={`badge badge-qc-${asset.qcStatus}`}>
                  {asset.qcStatus === 'pass'
                    ? 'QC ✓'
                    : asset.qcStatus === 'warn'
                      ? 'QC !'
                      : 'QC ✗'}
                </span>
              )}
              {asset.rating > 0 && (
                <span className="media-row-rating">
                  <Star size={11} fill="currentColor" /> {asset.rating}
                </span>
              )}
            </div>

            <div
              className="media-row-time"
              title={`${changeKind === 'modified' ? 'Modifié' : 'Ajouté'} le ${new Date(activityIso).toLocaleString('fr-FR')}`}
            >
              {formatRelativeTime(activityIso)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MediaDetailsTable({
  assets,
  selectedAssetId,
  multiSelectedIds,
  draggingAssetSet,
  sortBy,
  onChangeSort,
  onSelect,
  onToggleCheck,
  onToggleSelectAll,
  onDoubleClick,
  onCopyRef,
  onNavigateFolder,
  onDragStartAsset,
  onDragEndAsset,
}: SharedMediaListProps) {
  const multiSelectedSet = new Set(multiSelectedIds);
  const allChecked = assets.length > 0 && multiSelectedIds.length === assets.length;

  return (
    <div className="media-details-wrap">
      <table className="media-details-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              {onToggleSelectAll && (
                <button
                  type="button"
                  className={`inline-select-checkbox ${allChecked ? 'checked' : ''}`}
                  aria-label={allChecked ? 'Tout désélectionner' : 'Tout sélectionner'}
                  onClick={onToggleSelectAll}
                >
                  {allChecked && <Check size={11} strokeWidth={3} />}
                </button>
              )}
            </th>
            <th>
              <button
                type="button"
                className={`th-sort-btn ${sortBy === 'title_asc' ? 'active' : ''}`}
                onClick={() => onChangeSort?.('title_asc')}
              >
                Média {sortBy === 'title_asc' && <ArrowDown size={11} />}
              </button>
            </th>
            <th>Réf</th>
            <th>Dossier</th>
            <th>Format</th>
            <th>Qualité</th>
            <th>Statut / QC</th>
            <th>
              <button
                type="button"
                className={`th-sort-btn ${sortBy === 'rating_desc' ? 'active' : ''}`}
                onClick={() => onChangeSort?.('rating_desc')}
              >
                Note {sortBy === 'rating_desc' && <ArrowDown size={11} />}
              </button>
            </th>
            <th>
              <button
                type="button"
                className={`th-sort-btn ${sortBy === 'size_desc' ? 'active' : ''}`}
                onClick={() => onChangeSort?.('size_desc')}
              >
                Taille {sortBy === 'size_desc' && <ArrowDown size={11} />}
              </button>
            </th>
            <th>
              <button
                type="button"
                className={`th-sort-btn ${
                  sortBy === 'updated_desc' || sortBy === 'created_desc' ? 'active' : ''
                }`}
                onClick={() =>
                  onChangeSort?.(sortBy === 'updated_desc' ? 'created_desc' : 'updated_desc')
                }
              >
                {sortBy === 'created_desc' ? 'Ajouté' : 'Activité'}{' '}
                {(sortBy === 'updated_desc' || sortBy === 'created_desc') && (
                  <ArrowDown size={11} />
                )}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const isSelected = asset.id === selectedAssetId;
            const isChecked = multiSelectedSet.has(asset.id);
            const isDragging = draggingAssetSet.has(asset.id);
            const changeKind = getAssetChangeKind(asset);
            const activityIso =
              sortBy === 'created_desc'
                ? asset.createdAt
                : changeKind === 'modified'
                  ? asset.updatedAt
                  : asset.createdAt;

            return (
              <tr
                key={asset.id}
                className={`media-details-row ${isSelected ? 'selected' : ''} ${
                  isChecked ? 'multi-selected' : ''
                } ${isDragging ? 'dragging' : ''}`}
                draggable
                onDragStart={buildDragHandler(asset, multiSelectedIds, onDragStartAsset)}
                onDragEnd={onDragEndAsset}
                onClick={(e) =>
                  onSelect(asset, {
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                  })
                }
                onDoubleClick={() => onDoubleClick(asset)}
              >
                <td>
                  <button
                    type="button"
                    className={`inline-select-checkbox ${isChecked ? 'checked' : ''}`}
                    aria-label={
                      isChecked ? `Désélectionner ${asset.title}` : `Sélectionner ${asset.title}`
                    }
                    aria-pressed={isChecked}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCheck(asset, { shiftKey: e.shiftKey });
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {isChecked && <Check size={11} strokeWidth={3} />}
                  </button>
                </td>
                <td>
                  <div className="media-details-name-cell">
                    <div className="media-row-thumb">{renderSmallThumb(asset)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="media-row-title" title={asset.title}>
                        {asset.title}
                      </div>
                      <div className="media-details-filename" title={asset.originalFilename}>
                        {asset.originalFilename}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyRef(asset.handle);
                    }}
                  >
                    <Copy size={10} /> {asset.handle}
                  </button>
                </td>
                <td>
                  {asset.folderPath ? (
                    <button
                      type="button"
                      className="folder-chip-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateFolder?.(asset.folderPath);
                      }}
                    >
                      <Folder size={10} /> /{asset.folderPath}
                    </button>
                  ) : (
                    <span className="media-muted-dash">/</span>
                  )}
                </td>
                <td>
                  <span className="media-spec-cell">
                    {asset.type === 'image' ? (
                      <ImageIcon size={11} />
                    ) : asset.type === 'video' ? (
                      <Film size={11} />
                    ) : asset.type === 'audio' ? (
                      <Music size={11} />
                    ) : (
                      <FileText size={11} />
                    )}
                    {formatMediaSpecs(asset)}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-tier-${asset.qualityTier}`}>
                    {QUALITY_TIER_SHORT[asset.qualityTier]}
                  </span>
                  {asset.versionNumber > 1 && (
                    <span className="badge" style={{ marginLeft: 4 }}>
                      v{asset.versionNumber}
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <span className={`badge badge-status-${asset.status}`}>
                      {STATUS_LABELS[asset.status]}
                    </span>
                    {asset.qcStatus && asset.qcStatus !== 'pending' && (
                      <span className={`badge badge-qc-${asset.qcStatus}`}>
                        {asset.qcStatus === 'pass'
                          ? 'QC ✓'
                          : asset.qcStatus === 'warn'
                            ? 'QC !'
                            : 'QC ✗'}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {asset.rating > 0 ? (
                    <span className="media-row-rating">
                      <Star size={11} fill="currentColor" /> {asset.rating}
                    </span>
                  ) : (
                    <span className="media-muted-dash">—</span>
                  )}
                </td>
                <td className="media-mono-cell">{formatBytes(asset.fileSize)}</td>
                <td
                  className="media-time-cell"
                  title={`${changeKind === 'modified' ? 'Modifié' : 'Ajouté'} le ${new Date(activityIso).toLocaleString('fr-FR')}`}
                >
                  <span className={`recent-kind-pill kind-${changeKind}`}>
                    {changeKind === 'modified' ? 'Modifié' : 'Ajouté'}
                  </span>
                  <span>{formatRelativeTime(activityIso)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

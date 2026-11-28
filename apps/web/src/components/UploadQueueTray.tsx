import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Upload,
  X,
} from 'lucide-react';
import { formatBytes } from '../utils/format';
import {
  computeUploadQueueSummary,
  formatEtaShort,
  formatTransferSpeed,
  type UploadQueueItem,
} from '../utils/upload-queue';

interface UploadQueueTrayProps {
  items: UploadQueueItem[];
  onCancelItem: (id: string) => void;
  onSelectAsset: (assetId: string) => void;
  onClearFinished: () => void;
  onClose: () => void;
}

function getFileIcon(mimeType: string, filename: string) {
  const lower = filename.toLowerCase();
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/.test(lower)) {
    return <Film size={14} color="var(--accent-amber)" />;
  }
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/.test(lower)) {
    return <ImageIcon size={14} color="#38bdf8" />;
  }
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a)$/.test(lower)) {
    return <Music size={14} color="#34d399" />;
  }
  return <FileText size={14} color="#a78bfa" />;
}

export function UploadQueueTray({
  items,
  onCancelItem,
  onSelectAsset,
  onClearFinished,
  onClose,
}: UploadQueueTrayProps) {
  const [collapsed, setCollapsed] = useState(false);

  const summary = useMemo(() => computeUploadQueueSummary(items), [items]);

  if (items.length === 0) return null;

  const titleText = summary.isBusy
    ? `Import en cours · ${summary.doneCount}/${summary.totalCount} (${summary.overallPercent}%)`
    : summary.errorCount > 0
      ? `Import terminé · ${summary.doneCount} OK, ${summary.errorCount} erreur(s)`
      : `${summary.doneCount} fichier(s) importé(s)`;

  return (
    <aside
      className={`upload-tray ${collapsed ? 'collapsed' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Progression des imports"
    >
      <div className="upload-tray-header" onClick={() => setCollapsed((c) => !c)}>
        <div className="upload-tray-title">
          {summary.isBusy ? (
            <Loader2 size={15} className="task-spin" color="var(--accent-amber)" />
          ) : summary.errorCount > 0 ? (
            <AlertCircle size={15} color="#f87171" />
          ) : (
            <CheckCircle2 size={15} color="#34d399" />
          )}
          <span>{titleText}</span>
        </div>

        <div
          className="upload-tray-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {!summary.isBusy && summary.doneCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={onClearFinished}
              title="Effacer la liste"
            >
              Effacer
            </button>
          )}
          <button
            type="button"
            className="btn-icon"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Développer les détails' : 'Réduire'}
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {!summary.isBusy && (
            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              title="Fermer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Global Weighted Progress Bar */}
      <div className="upload-tray-global-bar">
        <div
          className={`upload-tray-global-fill ${summary.isBusy ? 'busy' : summary.errorCount > 0 ? 'has-error' : 'done'}`}
          style={{ width: `${summary.overallPercent}%` }}
        />
      </div>

      {!collapsed && (
        <div className="upload-tray-list">
          {items.map((item) => {
            const speedStr = formatTransferSpeed(item.speedBytesPerSec);
            const etaStr = formatEtaShort(item.etaSeconds);
            const barWidth =
              item.status === 'done'
                ? 100
                : item.status === 'processing'
                  ? 100
                  : item.status === 'uploading'
                    ? Math.max(2, item.percent)
                    : 0;

            return (
              <div
                key={item.id}
                className={`upload-item status-${item.status} ${item.assetId ? 'clickable' : ''}`}
                onClick={() => {
                  if (item.assetId) onSelectAsset(item.assetId);
                }}
              >
                <div className="upload-item-top">
                  <div className="upload-item-name-wrap">
                    {getFileIcon(item.mimeType, item.filename)}
                    <span className="upload-item-name" title={item.filename}>
                      {item.filename}
                    </span>
                    {item.folderPath && (
                      <span className="upload-item-folder">/{item.folderPath}</span>
                    )}
                  </div>

                  <div className="upload-item-right">
                    {item.status === 'done' && (
                      <span className="upload-badge done">
                        <CheckCircle2 size={11} /> {item.assetHandle ?? 'OK'}
                      </span>
                    )}
                    {item.status === 'queued' && (
                      <span className="upload-badge queued">En attente</span>
                    )}
                    {item.status === 'uploading' && (
                      <span className="upload-badge uploading">{item.percent}%</span>
                    )}
                    {item.status === 'processing' && (
                      <span className="upload-badge processing">
                        <Loader2 size={10} className="task-spin" /> Traitement…
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span className="upload-badge error">Erreur</span>
                    )}
                    {item.status === 'cancelled' && (
                      <span className="upload-badge queued">Annulé</span>
                    )}

                    {(item.status === 'queued' || item.status === 'uploading') && (
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelItem(item.id);
                        }}
                        title="Annuler cet import"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Per-file progress bar */}
                {(item.status === 'uploading' || item.status === 'processing' || item.status === 'queued') && (
                  <div className="upload-item-bar">
                    <div
                      className={`upload-item-bar-fill status-${item.status}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                )}

                {/* Per-file detail line */}
                <div className="upload-item-meta">
                  {item.status === 'uploading' && (
                    <span>
                      <Upload size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      {formatBytes(item.loadedBytes)} / {formatBytes(item.totalBytes)}
                      {speedStr ? ` · ${speedStr}` : ''}
                      {etaStr ? ` · ${etaStr}` : ''}
                    </span>
                  )}
                  {item.status === 'processing' && (
                    <span>
                      {formatBytes(item.totalBytes)} envoyé · Génération vignette, proxy &amp; métadonnées…
                    </span>
                  )}
                  {item.status === 'queued' && (
                    <span>{formatBytes(item.fileSize)} · En file d&apos;attente</span>
                  )}
                  {item.status === 'done' && (
                    <span>{formatBytes(item.fileSize)} · Cliquer pour inspecter</span>
                  )}
                  {item.status === 'error' && (
                    <span className="upload-item-err">{item.errorMessage || "Échec de l'envoi"}</span>
                  )}
                  {item.status === 'cancelled' && <span>Envoi annulé</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

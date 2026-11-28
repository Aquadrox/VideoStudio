import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Music,
  Pencil,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  isEditableTextFile,
  type AssetDto,
  type TextDocumentLanguage,
} from '@videostudio/shared';
import { api } from '../api/client';
import {
  formatBytes,
  formatDuration,
  QUALITY_TIER_LABELS,
  STATUS_LABELS,
} from '../utils/format';
import { TextDocumentPreview } from './TextDocumentEditor';

interface MediaLightboxProps {
  asset: AssetDto;
  assets: AssetDto[];
  onClose: () => void;
  onNavigate: (asset: AssetDto) => void;
  onOpenTextEditor?: (asset: AssetDto) => void;
  onCopyText: (text: string, label?: string) => void;
}

export function MediaLightbox({
  asset,
  assets,
  onClose,
  onNavigate,
  onOpenTextEditor,
  onCopyText,
}: MediaLightboxProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useOriginal, setUseOriginal] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [textDoc, setTextDoc] = useState<{
    content: string;
    language: TextDocumentLanguage;
  } | null>(null);

  const isTextAsset = isEditableTextFile(asset.originalFilename, asset.mimeType);

  const currentIdx = assets.findIndex((a) => a.id === asset.id);
  const prevAsset = currentIdx > 0 ? assets[currentIdx - 1] ?? null : null;
  const nextAsset =
    currentIdx >= 0 && currentIdx < assets.length - 1 ? assets[currentIdx + 1] ?? null : null;

  useEffect(() => {
    setZoomed(false);
    setUseOriginal(asset.type === 'image');
    setTextDoc(null);
    if (isEditableTextFile(asset.originalFilename, asset.mimeType)) {
      let active = true;
      void api
        .getAssetTextContent(asset.id)
        .then((res) => {
          if (active) setTextDoc({ content: res.content, language: res.language });
        })
        .catch(() => {
          if (active) setTextDoc(null);
        });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [asset.id, asset.type, asset.originalFilename, asset.mimeType]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && prevAsset) {
        e.preventDefault();
        onNavigate(prevAsset);
      } else if (e.key === 'ArrowRight' && nextAsset) {
        e.preventDefault();
        onNavigate(nextAsset);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNavigate, prevAsset, nextAsset]);

  const mediaSrc =
    useOriginal || !asset.urls.proxy ? asset.urls.original : asset.urls.proxy;

  const stepFrame = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const fps = asset.fps && asset.fps > 0 ? asset.fps : 24;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta / fps));
  };

  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu de ${asset.title}`}
      onClick={onClose}
    >
      <div className="lightbox-shell" onClick={(e) => e.stopPropagation()}>
        {/* Header Bar */}
        <header className="lightbox-header">
          <div className="lightbox-title-group">
            <strong className="lightbox-title" title={asset.title}>
              {asset.title}
            </strong>
            <button
              type="button"
              className="ref-copy-btn"
              onClick={() => onCopyText(asset.handle, `Référence ${asset.handle}`)}
            >
              <Copy size={11} /> {asset.handle}
            </button>
            <span className="pill-tag">{QUALITY_TIER_LABELS[asset.qualityTier]}</span>
            <span className="pill-tag">{STATUS_LABELS[asset.status]}</span>
            {asset.folderPath && <span className="pill-tag">/{asset.folderPath}</span>}
          </div>

          <div className="lightbox-actions">
            {currentIdx >= 0 && (
              <span className="lightbox-counter">
                {currentIdx + 1} / {assets.length}
              </span>
            )}
            {isTextAsset && onOpenTextEditor && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onOpenTextEditor(asset)}
              >
                <Pencil size={13} /> Éditer
              </button>
            )}
            {asset.type === 'image' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setZoomed((z) => !z)}
                title={zoomed ? 'Ajuster à la fenêtre' : 'Zoom 100%'}
              >
                {zoomed ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
                {zoomed ? 'Ajuster' : '100%'}
              </button>
            )}
            {asset.type === 'video' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepFrame(-1)}
                >
                  <ChevronLeft size={13} /> -1f
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepFrame(1)}
                >
                  +1f <ChevronRight size={13} />
                </button>
              </>
            )}
            {asset.urls.proxy && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setUseOriginal((v) => !v)}
              >
                {useOriginal ? 'Original' : 'Proxy'}
              </button>
            )}
            <a
              href={asset.urls.original}
              download={asset.originalFilename}
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: 'none' }}
            >
              <Download size={13} /> Télécharger
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              aria-label="Fermer l'aperçu"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Center Stage */}
        <div className={`lightbox-stage ${zoomed ? 'zoomed' : ''}`}>
          {prevAsset && (
            <button
              type="button"
              className="lightbox-nav prev"
              onClick={() => onNavigate(prevAsset)}
              aria-label="Média précédent"
              title="Précédent (←)"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {asset.type === 'image' && (
            <img
              src={mediaSrc}
              alt={asset.title}
              className={`lightbox-image ${zoomed ? 'zoomed' : ''}`}
              onClick={() => setZoomed((z) => !z)}
            />
          )}

          {asset.type === 'video' && (
            <video
              ref={videoRef}
              key={mediaSrc}
              src={mediaSrc}
              className="lightbox-video"
              controls
              autoPlay
              playsInline
            />
          )}

          {asset.type === 'audio' && (
            <div className="lightbox-audio-box">
              <Music size={42} color="var(--accent-amber)" />
              <div style={{ fontWeight: 600 }}>{asset.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {formatDuration(asset.durationSec)} · {formatBytes(asset.fileSize)}
              </div>
              <audio src={asset.urls.original} controls autoPlay style={{ width: '100%' }} />
            </div>
          )}

          {asset.type === 'document' && (
            textDoc ? (
              <div className="lightbox-text-doc-box">
                <TextDocumentPreview content={textDoc.content} language={textDoc.language} />
              </div>
            ) : (
              <div className="lightbox-audio-box">
                <FileText size={42} color="var(--text-secondary)" />
                <div style={{ fontWeight: 600 }}>{asset.originalFilename}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatBytes(asset.fileSize)}
                </div>
              </div>
            )
          )}

          {nextAsset && (
            <button
              type="button"
              className="lightbox-nav next"
              onClick={() => onNavigate(nextAsset)}
              aria-label="Média suivant"
              title="Suivant (→)"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>

        {/* Footer Metadata */}
        <footer className="lightbox-footer">
          <div className="lightbox-meta-row">
            <span>{asset.originalFilename}</span>
            {asset.width && asset.height && (
              <span>
                {asset.width}×{asset.height}
              </span>
            )}
            <span>{formatBytes(asset.fileSize)}</span>
            {asset.modelName && <span>Modèle : {asset.modelName}</span>}
            {asset.seed && <span>Seed : {asset.seed}</span>}
          </div>
          {asset.promptUsed && (
            <div className="lightbox-prompt" title={asset.promptUsed}>
              {asset.promptUsed}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

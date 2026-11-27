import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  GitBranch,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import type { AssetDto, AssetStatus, QualityTier } from '@videostudio/shared';
import type { AssetLineage } from '../api/client';
import {
  formatBytes,
  formatDuration,
  QUALITY_TIER_LABELS,
  STATUS_LABELS,
} from '../utils/format';

interface AssetInspectorProps {
  asset: AssetDto | null;
  lineage: AssetLineage | null;
  onUpdate: (
    assetId: string,
    patch: {
      status?: AssetStatus;
      qualityTier?: QualityTier;
      rating?: number;
      notes?: string;
      tags?: string[];
    },
  ) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
  onSelectAsset: (asset: AssetDto) => void;
  onCopyText: (text: string, label?: string) => void;
}

export function AssetInspector({
  asset,
  lineage,
  onUpdate,
  onDelete,
  onSelectAsset,
  onCopyText,
}: AssetInspectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useOriginal, setUseOriginal] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  useEffect(() => {
    setNotesDraft(asset?.notes ?? '');
    setTagsDraft(asset?.tags.join(', ') ?? '');
    setUseOriginal(false);
    setShowRawWorkflow(false);
  }, [asset?.id]);

  if (!asset) {
    return (
      <div className="empty-state" style={{ marginTop: 32 }}>
        <h2>Inspecteur Média</h2>
        <p>
          Sélectionne une image, une vidéo ou un audio dans la grille pour consulter ses
          métadonnées ComfyUI, sa lignée de versions et copier sa référence Claude.
        </p>
      </div>
    );
  }

  const mediaSrc =
    useOriginal || !asset.urls.proxy ? asset.urls.original : asset.urls.proxy;

  const stepVideoFrame = (deltaFrames: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const fps = asset.fps && asset.fps > 0 ? asset.fps : 24;
    const next = Math.max(0, Math.min(video.duration || 0, video.currentTime + deltaFrames / fps));
    video.currentTime = next;
  };

  const handleSaveNotesAndTags = async () => {
    setSavingNotes(true);
    try {
      const parsedTags = tagsDraft
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await onUpdate(asset.id, { notes: notesDraft, tags: parsedTags });
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <>
      {/* Media Preview Stage */}
      <div className="preview-stage">
        <div className="preview-media-box">
          {asset.type === 'image' && <img src={mediaSrc} alt={asset.title} />}
          {asset.type === 'video' && (
            <video
              ref={videoRef}
              key={mediaSrc}
              src={mediaSrc}
              controls
              playsInline
              preload="metadata"
            />
          )}
          {asset.type === 'audio' && (
            <audio
              src={asset.urls.original}
              controls
              style={{ width: '92%', margin: '24px 0' }}
            />
          )}
          {asset.type === 'document' && (
            <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12.5 }}>
              {asset.originalFilename}
            </div>
          )}
        </div>

        <div className="preview-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {asset.type === 'video' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepVideoFrame(-1)}
                  title="Frame précédente"
                >
                  <ChevronLeft size={13} /> -1f
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepVideoFrame(1)}
                  title="Frame suivante"
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
                {useOriginal ? 'Original' : 'Proxy LAN'}
              </button>
            )}
          </div>

          <a
            href={asset.urls.original}
            download={asset.originalFilename}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={13} /> Télécharger
          </a>
        </div>
      </div>

      {/* Reference Copy Section for Claude Code */}
      <div className="inspector-section">
        <div className="section-label">
          <span>Références Claude Code</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>v{asset.versionNumber}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ref-copy-btn"
            onClick={() => onCopyText(asset.handle, `Référence ${asset.handle}`)}
          >
            <Copy size={11} /> {asset.handle}
          </button>
          <button
            type="button"
            className="ref-copy-btn"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => onCopyText(asset.uri, 'URI MCP')}
            title={asset.uri}
          >
            <Copy size={11} /> Copier URI studio://
          </button>
        </div>
      </div>

      {/* Status, Quality Tier & Rating */}
      <div className="inspector-section">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="asset-status-select">Statut</label>
            <select
              id="asset-status-select"
              className="select"
              value={asset.status}
              onChange={(e) => void onUpdate(asset.id, { status: e.target.value as AssetStatus })}
            >
              {(Object.keys(STATUS_LABELS) as AssetStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="asset-tier-select">Niveau qualité</label>
            <select
              id="asset-tier-select"
              className="select"
              value={asset.qualityTier}
              onChange={(e) =>
                void onUpdate(asset.id, { qualityTier: e.target.value as QualityTier })
              }
            >
              {(Object.keys(QUALITY_TIER_LABELS) as QualityTier[]).map((tier) => (
                <option key={tier} value={tier}>
                  {QUALITY_TIER_LABELS[tier]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Note</span>
          <div className="star-row" role="group" aria-label="Notation de l'asset">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star-btn ${asset.rating >= n ? 'filled' : ''}`}
                onClick={() =>
                  void onUpdate(asset.id, { rating: asset.rating === n ? 0 : n })
                }
                title={`${n} étoile(s)`}
              >
                <Star size={15} fill={asset.rating >= n ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lineage (Parent / Derivatives) */}
      {lineage && (lineage.ancestors.length > 0 || lineage.children.length > 0) && (
        <div className="inspector-section">
          <div className="section-label">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <GitBranch size={12} /> Lignée & Versions
            </span>
          </div>
          <div className="lineage-list">
            {lineage.ancestors.map((anc) => (
              <button
                key={anc.id}
                type="button"
                className="lineage-item"
                onClick={() => onSelectAsset(anc)}
              >
                <span>↑ Parent : {anc.title}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                  {anc.handle}
                </span>
              </button>
            ))}
            {lineage.children.map((child) => (
              <button
                key={child.id}
                type="button"
                className="lineage-item"
                onClick={() => onSelectAsset(child)}
              >
                <span>↓ Dérivé : {child.title}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--status-live)' }}>
                  {child.handle}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Technical & ComfyUI Metadata */}
      <div className="inspector-section">
        <div className="section-label">
          <span>Métadonnées {asset.comfyMetadata ? '· ComfyUI détecté' : ''}</span>
        </div>

        <div className="meta-kv-grid">
          <div className="meta-kv">
            <div className="meta-k">Dimensions</div>
            <div className="meta-v">
              {asset.width && asset.height ? `${asset.width}×${asset.height}` : '—'}
            </div>
          </div>
          <div className="meta-kv">
            <div className="meta-k">Poids</div>
            <div className="meta-v">{formatBytes(asset.fileSize)}</div>
          </div>
          {asset.durationSec !== null && (
            <div className="meta-kv">
              <div className="meta-k">Durée / FPS</div>
              <div className="meta-v">
                {formatDuration(asset.durationSec)} {asset.fps ? `· ${asset.fps} fps` : ''}
              </div>
            </div>
          )}
          {asset.modelName && (
            <div className="meta-kv">
              <div className="meta-k">Modèle</div>
              <div className="meta-v" title={asset.modelName}>
                {asset.modelName}
              </div>
            </div>
          )}
          {asset.seed && (
            <div className="meta-kv">
              <div className="meta-k">Seed</div>
              <div className="meta-v">{asset.seed}</div>
            </div>
          )}
          {asset.comfyMetadata?.steps !== undefined && (
            <div className="meta-kv">
              <div className="meta-k">Steps / CFG</div>
              <div className="meta-v">
                {asset.comfyMetadata.steps} / {asset.comfyMetadata.cfg ?? '—'}
              </div>
            </div>
          )}
          {asset.comfyMetadata?.sampler && (
            <div className="meta-kv">
              <div className="meta-k">Sampler</div>
              <div className="meta-v">
                {asset.comfyMetadata.sampler}
                {asset.comfyMetadata.scheduler ? ` (${asset.comfyMetadata.scheduler})` : ''}
              </div>
            </div>
          )}
        </div>

        {asset.promptUsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="section-label">
              <span>Prompt positif</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onCopyText(asset.promptUsed ?? '', 'Prompt positif')}
              >
                <Copy size={11} /> Copier
              </button>
            </div>
            <div className="prompt-box">{asset.promptUsed}</div>
          </div>
        )}

        {asset.negativePrompt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="section-label">
              <span>Prompt négatif</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onCopyText(asset.negativePrompt ?? '', 'Prompt négatif')}
              >
                <Copy size={11} /> Copier
              </button>
            </div>
            <div className="prompt-box">{asset.negativePrompt}</div>
          </div>
        )}

        {asset.comfyMetadata?.rawPromptGraph && (
          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowRawWorkflow((v) => !v)}
            >
              {showRawWorkflow ? 'Masquer JSON ComfyUI' : 'Voir graphe JSON ComfyUI'}
            </button>
            {showRawWorkflow && (
              <div className="prompt-box" style={{ marginTop: 6, maxHeight: 220 }}>
                {JSON.stringify(asset.comfyMetadata.rawPromptGraph, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes & Tags */}
      <div className="inspector-section">
        <div className="field">
          <label htmlFor="asset-tags-input">Tags (séparés par des virgules)</label>
          <input
            id="asset-tags-input"
            className="input"
            value={tagsDraft}
            onChange={(e) => setTagsDraft(e.target.value)}
            placeholder="hero, scene-01, main-5-doigts"
          />
        </div>

        <div className="field">
          <label htmlFor="asset-notes-textarea">Notes / Retours pour Claude</label>
          <textarea
            id="asset-notes-textarea"
            className="textarea"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Ajoute un commentaire ou une consigne d'itération..."
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (window.confirm(`Supprimer définitivement ${asset.handle} ?`)) {
                void onDelete(asset.id);
              }
            }}
          >
            <Trash2 size={13} /> Supprimer
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={savingNotes}
            onClick={() => void handleSaveNotesAndTags()}
          >
            <Save size={13} /> {savingNotes ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </>
  );
}

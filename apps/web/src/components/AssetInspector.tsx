import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  GitBranch,
  MapPin,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  AnnotationDto,
  AssetDto,
  AssetStatus,
  MediaFolderDto,
  QualityTier,
} from '@videostudio/shared';
import { api, type AssetLineage } from '../api/client';
import { normalizeMediaCoordinates, timecodeToFrame } from '../utils/annotations';
import {
  formatBytes,
  formatDuration,
  QUALITY_TIER_LABELS,
  STATUS_LABELS,
} from '../utils/format';

interface AssetInspectorProps {
  asset: AssetDto | null;
  lineage: AssetLineage | null;
  folders: MediaFolderDto[];
  annotationRefreshSignal: number;
  onUpdate: (
    assetId: string,
    patch: {
      folderPath?: string;
      status?: AssetStatus;
      qualityTier?: QualityTier;
      rating?: number;
      notes?: string;
      tags?: string[];
    },
  ) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
  onSelectAsset: (asset: AssetDto) => void;
  onOpenCompare: (asset: AssetDto, compareWith?: AssetDto) => void;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

export function AssetInspector({
  asset,
  lineage,
  folders,
  annotationRefreshSignal,
  onUpdate,
  onDelete,
  onSelectAsset,
  onOpenCompare,
  onCopyText,
  onNotify,
}: AssetInspectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaLayerRef = useRef<HTMLDivElement | null>(null);

  const [useOriginal, setUseOriginal] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  // Visual Annotations state
  const [annotations, setAnnotations] = useState<AnnotationDto[]>([]);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{
    x: number;
    y: number;
    timecodeSec: number | null;
    frameNumber: number | null;
  } | null>(null);
  const [pinComment, setPinComment] = useState('');

  useEffect(() => {
    setNotesDraft(asset?.notes ?? '');
    setTagsDraft(asset?.tags.join(', ') ?? '');
    setUseOriginal(false);
    setShowRawWorkflow(false);
    setAnnotateMode(false);
    setPendingPin(null);
    setPinComment('');
  }, [asset?.id]);

  useEffect(() => {
    if (!asset?.id) {
      setAnnotations([]);
      return;
    }
    void api
      .listAssetAnnotations(asset.id)
      .then(setAnnotations)
      .catch(() => setAnnotations([]));
  }, [asset?.id, annotationRefreshSignal]);

  if (!asset) {
    return (
      <div className="empty-state" style={{ marginTop: 32 }}>
        <h2>Inspecteur Média</h2>
        <p>
          Sélectionne une image, une vidéo ou un audio dans la grille pour consulter ses
          métadonnées ComfyUI, poser des annotations visuelles pour Claude et copier sa référence.
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

  const handleMediaClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!annotateMode || !mediaLayerRef.current) return;
    if (asset.type !== 'image' && asset.type !== 'video') return;

    const rect = mediaLayerRef.current.getBoundingClientRect();
    const coords = normalizeMediaCoordinates(e.clientX, e.clientY, rect);

    let timecodeSec: number | null = null;
    let frameNumber: number | null = null;
    if (asset.type === 'video' && videoRef.current) {
      videoRef.current.pause();
      timecodeSec = Math.round(videoRef.current.currentTime * 1000) / 1000;
      frameNumber = timecodeToFrame(timecodeSec, asset.fps);
    }

    setPendingPin({ ...coords, timecodeSec, frameNumber });
  };

  const submitAnnotation = async () => {
    if (!pendingPin || !pinComment.trim()) return;
    const created = await api.createAnnotation(asset.id, {
      x: pendingPin.x,
      y: pendingPin.y,
      shapeType: 'pin',
      timecodeSec: pendingPin.timecodeSec,
      frameNumber: pendingPin.frameNumber,
      color: '#e5a038',
      comment: pinComment.trim(),
      author: 'user',
    });
    setAnnotations((prev) => [...prev, created]);
    setPendingPin(null);
    setPinComment('');
    setAnnotateMode(false);
    onNotify('Annotation ajoutée dans la file Feedback de Claude');
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

  const parentForCompare = lineage?.ancestors[lineage.ancestors.length - 1];
  const openAnnotationsCount = annotations.filter((a) => a.status === 'open').length;

  return (
    <>
      {/* Media Preview Stage + Visual Annotation Overlay */}
      <div className="preview-stage">
        <div className="preview-media-box">
          <div
            ref={mediaLayerRef}
            className={`preview-annotate-layer ${annotateMode ? 'annotating' : ''}`}
            onClick={handleMediaClick}
          >
            {asset.type === 'image' && <img src={mediaSrc} alt={asset.title} />}
            {asset.type === 'video' && (
              <video
                ref={videoRef}
                key={mediaSrc}
                src={mediaSrc}
                controls={!annotateMode}
                playsInline
                preload="metadata"
              />
            )}
            {asset.type === 'audio' && (
              <audio
                src={asset.urls.original}
                controls
                style={{ width: 310, margin: '24px 0' }}
              />
            )}
            {asset.type === 'document' && (
              <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12.5 }}>
                {asset.originalFilename}
              </div>
            )}

            {/* Existing visual pins */}
            {(asset.type === 'image' || asset.type === 'video') &&
              annotations.map((ann, idx) => (
                <button
                  key={ann.id}
                  type="button"
                  className={`annotation-pin ${ann.status === 'resolved' ? 'resolved' : ''}`}
                  style={{
                    left: `${ann.x * 100}%`,
                    top: `${ann.y * 100}%`,
                    background: ann.color,
                  }}
                  title={`#${idx + 1}: ${ann.comment}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (ann.timecodeSec !== null && videoRef.current) {
                      videoRef.current.pause();
                      videoRef.current.currentTime = ann.timecodeSec;
                    }
                  }}
                >
                  {idx + 1}
                </button>
              ))}

            {pendingPin && (
              <div
                className="annotation-pin"
                style={{
                  left: `${pendingPin.x * 100}%`,
                  top: `${pendingPin.y * 100}%`,
                  background: '#38bdf8',
                }}
              >
                +
              </div>
            )}
          </div>
        </div>

        <div className="preview-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {(asset.type === 'image' || asset.type === 'video') && (
              <button
                type="button"
                className={`btn btn-sm ${annotateMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setAnnotateMode((v) => !v);
                  setPendingPin(null);
                }}
                title="Cliquer sur l'image ou la frame vidéo pour laisser un retour à Claude"
              >
                <MapPin size={12} /> {annotateMode ? 'Clique sur le visuel...' : 'Annoter'}
              </button>
            )}
            {asset.type === 'video' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepVideoFrame(-1)}
                  title="Frame précédente"
                >
                  <ChevronLeft size={12} /> -1f
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => stepVideoFrame(1)}
                  title="Frame suivante"
                >
                  +1f <ChevronRight size={12} />
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
          </div>

          <a
            href={asset.urls.original}
            download={asset.originalFilename}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={12} />
          </a>
        </div>
      </div>

      {/* Pending Annotation Composer */}
      {pendingPin && (
        <div className="annotation-card" style={{ borderColor: 'var(--status-live)' }}>
          <div className="section-label">
            <span>
              Nouvelle annotation ({Math.round(pendingPin.x * 100)}%, {Math.round(pendingPin.y * 100)}%)
              {pendingPin.frameNumber !== null ? ` · frame #${pendingPin.frameNumber}` : ''}
            </span>
          </div>
          <textarea
            className="textarea"
            autoFocus
            value={pinComment}
            onChange={(e) => setPinComment(e.target.value)}
            placeholder="Ex : Main gauche à 6 doigts, corrige en 5 doigts selon la règle du projet"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPendingPin(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void submitAnnotation()}
            >
              Envoyer à Claude
            </button>
          </div>
        </div>
      )}

      {/* Annotations / Feedback List */}
      {annotations.length > 0 && (
        <div className="inspector-section">
          <div className="section-label">
            <span>Annotations & Feedback ({openAnnotationsCount} ouvert(s))</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {annotations.map((ann, idx) => (
              <div
                key={ann.id}
                className={`annotation-card ${ann.status === 'resolved' ? 'resolved' : ''}`}
              >
                <div className="rule-row-top">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    <strong>#{idx + 1}</strong> · ({Math.round(ann.x * 100)}%,{' '}
                    {Math.round(ann.y * 100)}%)
                    {ann.frameNumber !== null && ` · f${ann.frameNumber}`}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title={ann.status === 'open' ? 'Marquer résolu' : 'Rouvrir'}
                      onClick={async () => {
                        const updated = await api.updateAnnotation(ann.id, {
                          status: ann.status === 'open' ? 'resolved' : 'open',
                        });
                        setAnnotations((prev) =>
                          prev.map((a) => (a.id === updated.id ? updated : a)),
                        );
                      }}
                    >
                      <CheckCircle2
                        size={13}
                        color={ann.status === 'resolved' ? 'var(--status-approved)' : undefined}
                      />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await api.deleteAnnotation(ann.id);
                        setAnnotations((prev) => prev.filter((a) => a.id !== ann.id));
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 12.5 }}>{ann.comment}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reference Copy & Compare Actions */}
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
            <Copy size={11} /> URI studio://
          </button>
          {(asset.type === 'image' || asset.type === 'video') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onOpenCompare(asset, parentForCompare)}
            >
              <Columns2 size={12} /> Comparer A/B
            </button>
          )}
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

        <div className="field">
          <label htmlFor="asset-folder-select">Dossier</label>
          <select
            id="asset-folder-select"
            className="select"
            value={asset.folderPath}
            onChange={(e) => void onUpdate(asset.id, { folderPath: e.target.value })}
          >
            <option value="">/ Racine</option>
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                /{f.path}
              </option>
            ))}
          </select>
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

      {/* Visual QC Checklist (recorded by Claude or User) */}
      <div className="inspector-section">
        <div className="section-label">
          <span>Contrôle Visuel (QC)</span>
          <span className={`badge badge-qc-${asset.qcStatus ?? 'pending'}`}>
            {asset.qcStatus === 'pass'
              ? 'QC ✓ Validé'
              : asset.qcStatus === 'warn'
                ? 'QC ! Alerte'
                : asset.qcStatus === 'fail'
                  ? 'QC ✗ Rejeté'
                  : 'En attente'}
          </span>
        </div>

        {Object.keys(asset.qcChecks ?? {}).length > 0 ? (
          <div className="qc-checks-grid">
            {Object.entries(asset.qcChecks ?? {}).map(([checkKey, val]) => {
              const nextCycle =
                val === 'ok' ? 'warn' : val === 'warn' ? 'fail' : val === 'fail' ? 'na' : 'ok';
              return (
                <button
                  key={checkKey}
                  type="button"
                  className={`qc-pill qc-${val}`}
                  title="Cliquer pour changer le statut de ce contrôle"
                  onClick={() => {
                    void api
                      .recordAssetQc(asset.id, {
                        checks: { ...asset.qcChecks, [checkKey]: nextCycle },
                      })
                      .then(() => onNotify(`QC "${checkKey}" → ${nextCycle.toUpperCase()}`))
                      .catch(() => onNotify('Erreur mise à jour QC'));
                  }}
                >
                  <span>{checkKey}</span>
                  <strong>{val.toUpperCase()}</strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
            Aucun contrôle visuel enregistré. Claude peut pousser un bilan via <code>record_qc</code>{' '}
            ou clique sur un contrôle rapide :
          </div>
        )}

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {['mains', 'yeux', 'visage', 'doublon', 'age'].map((preset) =>
            asset.qcChecks?.[preset] ? null : (
              <button
                key={preset}
                type="button"
                className="chip"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => {
                  void api
                    .recordAssetQc(asset.id, {
                      checks: { ...(asset.qcChecks ?? {}), [preset]: 'ok' },
                    })
                    .then(() => onNotify(`QC "${preset}" marqué OK`))
                    .catch(() => onNotify('Erreur mise à jour QC'));
                }}
              >
                + {preset}
              </button>
            ),
          )}
        </div>

        {asset.qcNotes && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              background: 'var(--bg-surface)',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {asset.qcNotes}
          </div>
        )}
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
                <span>
                  ↓ {child.relationType && child.relationType !== 'revision' ? `[${child.relationType}] ` : 'Dérivé : '}
                  {child.title}
                </span>
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

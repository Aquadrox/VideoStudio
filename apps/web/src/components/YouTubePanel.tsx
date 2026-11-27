import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  GripVertical,
  Monitor,
  Moon,
  Save,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UploadCloud,
  Youtube,
} from 'lucide-react';
import {
  formatYoutubeChapters,
  type AssetDto,
  type ChecklistItem,
  type ProjectDto,
  type YouTubeChapter,
  type YouTubePackageDto,
  type YouTubeUploadResultDto,
  type YouTubeUploadStatusDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { analyzeYoutubeTitle, buildChaptersFromStoryboard } from '../utils/youtube';

interface YouTubePanelProps {
  project: ProjectDto | null;
  assets: AssetDto[];
  refreshSignal: number;
  onAssetUploaded?: (asset: AssetDto) => void;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

type ThumbnailSlots = [string | null, string | null, string | null];

function toThumbnailSlots(ids: string[]): ThumbnailSlots {
  return [ids[0] ?? null, ids[1] ?? null, ids[2] ?? null];
}

export function YouTubePanel({
  project,
  assets,
  refreshSignal,
  onAssetUploaded,
  onCopyText,
  onNotify,
}: YouTubePanelProps) {
  const [pkg, setPkg] = useState<YouTubePackageDto | null>(null);
  const [titles, setTitles] = useState<string[]>(['', '', '']);
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [pinnedComment, setPinnedComment] = useState('');
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [thumbSlots, setThumbSlots] = useState<ThumbnailSlots>([null, null, null]);
  const [chapters, setChapters] = useState<YouTubeChapter[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  // Drag & drop state for YouTube A/B variants
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  // Simulator controls
  const [simTheme, setSimTheme] = useState<'dark' | 'light'>('dark');
  const [simDevice, setSimDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [exportInfo, setExportInfo] = useState<{ exportDir: string; files: string[] } | null>(null);

  // Optional YouTube Data API v3 Draft Upload
  const [ytApiStatus, setYtApiStatus] = useState<YouTubeUploadStatusDto | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [uploadTitleIndex, setUploadTitleIndex] = useState<number>(0);
  const [uploadThumbIndex, setUploadThumbIndex] = useState<number>(0);
  const [uploadPrivacy, setUploadPrivacy] = useState<'private' | 'unlisted'>('private');
  const [uploadingDraft, setUploadingDraft] = useState(false);
  const [lastUpload, setLastUpload] = useState<YouTubeUploadResultDto | null>(null);

  const imageAssets = useMemo(() => assets.filter((a) => a.type === 'image'), [assets]);
  const videoAssets = useMemo(() => assets.filter((a) => a.type === 'video'), [assets]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const activeThumbIds = useMemo(
    () => thumbSlots.filter((id): id is string => Boolean(id)),
    [thumbSlots],
  );

  useEffect(() => {
    void api.getYouTubeUploadStatus().then(setYtApiStatus).catch(() => setYtApiStatus(null));
  }, []);

  useEffect(() => {
    if (!selectedVideoId && videoAssets.length > 0) {
      const preferred =
        videoAssets.find((v) => v.qualityTier === 'final_master' || v.status === 'winner') ??
        videoAssets[0];
      if (preferred) setSelectedVideoId(preferred.id);
    }
  }, [videoAssets, selectedVideoId]);

  useEffect(() => {
    if (!project) return;
    void api
      .getYouTubePackage(project.id)
      .then((data) => {
        setPkg(data);
        setTitles([data.titles[0] ?? '', data.titles[1] ?? '', data.titles[2] ?? '']);
        setDescription(data.description);
        setTagsText(data.tags.join(', '));
        setHashtagsText(data.hashtags.join(' '));
        setPinnedComment(data.pinnedComment);
        setAiDisclosure(data.aiDisclosure);
        setThumbSlots(toThumbnailSlots(data.thumbnailAssetIds));
        setChapters(data.chapters);
        setChecklist(data.checklist);
      })
      .catch(() => undefined);
  }, [project?.id, refreshSignal]);

  if (!project || !pkg) {
    return (
      <div className="empty-state">
        <Youtube size={34} color="var(--text-muted)" />
        <h2>Hub YouTube</h2>
        <p>Sélectionne un projet pour gérer ses miniatures A/B, titres, description et chapitres.</p>
      </div>
    );
  }

  const chaptersResult = formatYoutubeChapters(chapters);

  const fullCopyableDescription = [
    description.trim(),
    chaptersResult.text ? `\nChapitres :\n${chaptersResult.text}` : '',
    hashtagsText.trim() ? `\n${hashtagsText.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const toggleThumbVariant = (id: string) => {
    setThumbSlots((prev) => {
      const existingIdx = prev.indexOf(id);
      if (existingIdx !== -1) {
        const next: ThumbnailSlots = [...prev] as ThumbnailSlots;
        next[existingIdx] = null;
        return next;
      }
      const emptyIdx = prev.indexOf(null);
      if (emptyIdx === -1) {
        onNotify('Maximum 3 miniatures (glisse une image sur une variante ou supprime-en une)');
        return prev;
      }
      const next: ThumbnailSlots = [...prev] as ThumbnailSlots;
      next[emptyIdx] = id;
      return next;
    });
  };

  const assignThumbToSlot = (slotIdx: number, assetId: string) => {
    setThumbSlots((prev) => {
      const next: ThumbnailSlots = [...prev] as ThumbnailSlots;
      // If asset is already in another slot, swap them cleanly
      const oldIdx = next.indexOf(assetId);
      if (oldIdx !== -1 && oldIdx !== slotIdx) {
        next[oldIdx] = next[slotIdx] ?? null;
      }
      next[slotIdx] = assetId;
      return next;
    });
  };

  const removeThumbSlot = (slotIdx: number) => {
    setThumbSlots((prev) => {
      const next: ThumbnailSlots = [...prev] as ThumbnailSlots;
      next[slotIdx] = null;
      return next;
    });
  };

  const swapThumbSlots = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setThumbSlots((prev) => {
      const next: ThumbnailSlots = [...prev] as ThumbnailSlots;
      const tmp = next[fromIdx] ?? null;
      next[fromIdx] = next[toIdx] ?? null;
      next[toIdx] = tmp;
      return next;
    });
  };

  const handleSlotDragOver = (e: DragEvent, slotIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverSlot !== slotIdx) setDragOverSlot(slotIdx);
  };

  const handleSlotDrop = async (e: DragEvent, slotIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverSlot(null);

    // 1. Reorder between A/B/C slots
    const draggedSlotStr = e.dataTransfer.getData('application/x-videostudio-yt-slot');
    if (draggedSlotStr !== '') {
      const fromIdx = Number(draggedSlotStr);
      if (Number.isInteger(fromIdx) && fromIdx >= 0 && fromIdx <= 2) {
        swapThumbSlots(fromIdx, slotIdx);
        return;
      }
    }

    // 2. Dragged from the Image Picker Strip
    const draggedAssetId = e.dataTransfer.getData('application/x-videostudio-asset-id');
    if (draggedAssetId) {
      assignThumbToSlot(slotIdx, draggedAssetId);
      return;
    }

    // 3. Dropped image file directly from user's desktop
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;

    setUploadingSlot(slotIdx);
    try {
      let targetSlot = slotIdx;
      for (const file of files) {
        if (targetSlot > 2) break;
        const uploaded = await api.uploadAssetFile(project.id, file, {
          folderPath: 'youtube',
          qualityTier: 'hq_upscale',
        });
        onAssetUploaded?.(uploaded);
        assignThumbToSlot(targetSlot, uploaded.id);
        targetSlot += 1;
      }
      onNotify(
        `Miniature importée dans Variante ${String.fromCharCode(65 + slotIdx)} (pense à Enregistrer)`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Erreur d'import miniature");
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleSave = async () => {
    const cleanTitles = titles.map((t) => t.trim()).filter(Boolean);
    const updated = await api.updateYouTubePackage(project.id, {
      titles: cleanTitles,
      description,
      tags: tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      hashtags: hashtagsText
        .split(/\s+/)
        .map((h) => h.trim())
        .filter(Boolean),
      pinnedComment,
      aiDisclosure,
      thumbnailAssetIds: activeThumbIds,
      chapters,
      checklist,
    });
    setPkg(updated);
    onNotify('Packaging YouTube enregistré');
  };

  const handleGenerateChapters = async () => {
    const storyboard = await api.getStoryboard(project.id);
    if (storyboard.length === 0) {
      onNotify('Ajoute des scènes dans le Storyboard pour générer les chapitres');
      return;
    }
    setChapters(buildChaptersFromStoryboard(storyboard));
    onNotify('Chapitres générés depuis le Storyboard');
  };

  const handleExportPack = async () => {
    await handleSave();
    const res = await api.exportYouTubePack(project.id);
    setExportInfo({ exportDir: res.exportDir, files: res.files });
    onNotify(`YouTube Ready Pack exporté (${res.files.length} fichiers)`);
  };

  return (
    <div className="panel-workspace">
      {/* Top Action Bar */}
      <div className="rule-row-top">
        <div>
          <strong style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Youtube size={17} color="#ef5d5d" /> Hub YouTube — {project.name}
          </strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Glisse-dépose des images (depuis la galerie ou ton bureau) dans les variantes A/B/C, réordonne-les ou supprime-les.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleSave()}>
            <Save size={13} /> Enregistrer
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleExportPack()}>
            <Download size={13} /> Exporter YouTube Pack
          </button>
        </div>
      </div>

      {exportInfo && (
        <div className="panel-card" style={{ borderColor: 'var(--status-approved)' }}>
          <div style={{ fontSize: 12.5 }}>
            <strong>Pack exporté :</strong> <code>{exportInfo.exportDir}</code> — Fichiers :{' '}
            <code>{exportInfo.files.join(', ')}</code>
          </div>
        </div>
      )}

      {/* A/B Thumbnails Selector & Live YouTube Feed Simulator */}
      <div className="panel-card">
        <div className="rule-row-top">
          <span className="section-label">
            Simulateur de Feed YouTube (Miniatures & Titres A/B · {activeThumbIds.length}/3)
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`chip ${simDevice === 'desktop' ? 'active' : ''}`}
              onClick={() => setSimDevice('desktop')}
            >
              <Monitor size={12} /> Desktop
            </button>
            <button
              type="button"
              className={`chip ${simDevice === 'mobile' ? 'active' : ''}`}
              onClick={() => setSimDevice('mobile')}
            >
              <Smartphone size={12} /> Mobile
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setSimTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {simTheme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            </button>
          </div>
        </div>

        {/* Image Picker Strip (clickable + draggable onto A/B/C slots) */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {imageAssets.map((img) => {
            const idx = thumbSlots.indexOf(img.id);
            const selected = idx !== -1;
            return (
              <button
                key={img.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-videostudio-asset-id', img.id);
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                onClick={() => toggleThumbVariant(img.id)}
                title="Cliquer pour sélectionner ou glisser-déposer vers Variante A, B ou C"
                style={{
                  position: 'relative',
                  width: 120,
                  flexShrink: 0,
                  padding: 0,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: selected ? '2px solid var(--accent-amber)' : '1px solid var(--border-default)',
                  cursor: 'grab',
                  background: '#000',
                }}
              >
                <img
                  src={img.urls.thumbnail ?? img.urls.original}
                  alt={img.title}
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                />
                {selected && (
                  <span
                    className="badge"
                    style={{ position: 'absolute', top: 4, left: 4, color: 'var(--accent-amber-hover)' }}
                  >
                    Variante {String.fromCharCode(65 + idx)}
                  </span>
                )}
              </button>
            );
          })}
          {imageAssets.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Glisse-dépose directement des fichiers image sur les variantes A, B ou C ci-dessous, ou importe des images dans Médias.
            </div>
          )}
        </div>

        {/* Feed Preview Frame with 3 Interactive Drag-and-Drop / Deletable Variant Slots */}
        <div className={`yt-sim-frame ${simTheme}`}>
          <div className={`yt-sim-grid ${simDevice}`}>
            {[0, 1, 2].map((i) => {
              const slotAssetId = thumbSlots[i];
              const tAsset = slotAssetId ? assetById.get(slotAssetId) : null;
              const titleStr = titles[i] || titles[0] || project.name;
              const isOver = dragOverSlot === i;
              const isUploading = uploadingSlot === i;
              const letter = String.fromCharCode(65 + i);

              return (
                <div
                  key={i}
                  className={`yt-variant-slot ${isOver ? 'drag-over' : ''}`}
                  draggable={Boolean(tAsset)}
                  onDragStart={(e) => {
                    if (!tAsset) return;
                    e.dataTransfer.setData('application/x-videostudio-yt-slot', String(i));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => handleSlotDragOver(e, i)}
                  onDragLeave={() => setDragOverSlot((curr) => (curr === i ? null : curr))}
                  onDrop={(e) => void handleSlotDrop(e, i)}
                >
                  <div className="yt-variant-bar">
                    <span className="yt-variant-label">
                      <GripVertical size={12} /> Variante {letter}
                    </span>
                    {tAsset && (
                      <button
                        type="button"
                        className="yt-variant-remove"
                        title={`Supprimer la miniature de la Variante ${letter}`}
                        onClick={() => removeThumbSlot(i)}
                      >
                        <Trash2 size={12} /> Retirer
                      </button>
                    )}
                  </div>

                  <div className="yt-thumb-box">
                    {isUploading ? (
                      <div className="yt-thumb-empty">
                        <Upload size={18} />
                        <span>Import en cours...</span>
                      </div>
                    ) : tAsset ? (
                      <img src={tAsset.urls.proxy ?? tAsset.urls.original} alt={titleStr} />
                    ) : (
                      <div className="yt-thumb-empty">
                        <Upload size={18} />
                        <span>Glisse une image ici (Variante {letter})</span>
                      </div>
                    )}
                    <span className="yt-duration-badge">12:34</span>
                  </div>
                  <div className="yt-sim-title">{titleStr}</div>
                  <div className="yt-sim-meta">Ta Chaîne · 12 k vues · il y a 2 heures</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Metadata & Description */}
      <div className="panel-split">
        <div className="panel-card">
          <div className="section-label">Titres A/B (jusqu'à 3 variantes)</div>
          {[0, 1, 2].map((i) => {
            const analysis = analyzeYoutubeTitle(titles[i] ?? '');
            return (
              <div key={i} className="field">
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Titre {String.fromCharCode(65 + i)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: analysis.exceedsMax
                          ? 'var(--status-danger)'
                          : analysis.truncatesOnMobile
                            ? 'var(--accent-amber)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {analysis.length}/100 {analysis.truncatesOnMobile ? '(tronqué mobile >60)' : ''}
                    </span>
                    {(titles[i] ?? '').length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 5px' }}
                        title={`Effacer Titre ${String.fromCharCode(65 + i)}`}
                        onClick={() =>
                          setTitles((prev) => prev.map((val, idx) => (idx === i ? '' : val)))
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                </label>
                <input
                  className="input"
                  value={titles[i] ?? ''}
                  onChange={(e) =>
                    setTitles((prev) => prev.map((val, idx) => (idx === i ? e.target.value : val)))
                  }
                  placeholder={`Variante de titre ${String.fromCharCode(65 + i)}...`}
                />
              </div>
            );
          })}

          <div className="field">
            <label>Tags (séparés par des virgules)</label>
            <input
              className="input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="ia video, comfyui, court metrage ia..."
            />
          </div>

          <div className="field">
            <label>Hashtags</label>
            <input
              className="input"
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              placeholder="#AIfilm #ComfyUI #YouTube"
            />
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={aiDisclosure}
              onChange={(e) => setAiDisclosure(e.target.checked)}
            />
            Déclaration YouTube : Contenu généré / modifié par IA
          </label>
        </div>

        <div className="panel-card">
          <div className="section-label">
            <span>Description & Chapitres</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleGenerateChapters()}
              >
                <Sparkles size={12} /> Chapitres auto
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onCopyText(fullCopyableDescription, 'Description complète')}
              >
                <Copy size={12} /> Tout copier
              </button>
            </div>
          </div>

          <textarea
            className="textarea"
            style={{ minHeight: 150 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Accroche, liens, crédits musicaux & IA..."
          />

          {chaptersResult.text && (
            <div>
              <div className="section-label">Chapitres formatés</div>
              <div className="prompt-box">{chaptersResult.text}</div>
              {chaptersResult.warnings.map((w, idx) => (
                <div key={idx} style={{ fontSize: 11.5, color: 'var(--accent-amber)', marginTop: 4 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label>Commentaire épinglé</label>
            <input
              className="input"
              value={pinnedComment}
              onChange={(e) => setPinnedComment(e.target.value)}
              placeholder="Question pour engager l'audience..."
            />
          </div>

          <div className="section-label">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <CheckSquare size={12} /> Checklist pré-publication
            </span>
          </div>
          {checklist.map((item) => (
            <label
              key={item.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={() =>
                  setChecklist((prev) =>
                    prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                  )
                }
              />
              <span style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.6 : 1 }}>
                {item.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Optional YouTube Data API v3 Draft Upload */}
      <div className="panel-card">
        <div className="section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <UploadCloud size={14} color="var(--accent-amber)" /> Upload Brouillon YouTube (API v3 — Privé / Non répertorié)
          </span>
          <span
            className={`pill ${ytApiStatus?.configured ? 'status-approved' : ''}`}
          >
            {ytApiStatus?.configured ? 'OAuth2 configuré' : 'Non configuré (.env)'}
          </span>
        </div>

        {!ytApiStatus?.configured ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Pour activer l'upload direct en brouillon privé vers YouTube Studio, renseigne{' '}
            <code>YOUTUBE_CLIENT_ID</code>, <code>YOUTUBE_CLIENT_SECRET</code> et{' '}
            <code>YOUTUBE_REFRESH_TOKEN</code> dans ton fichier <code>.env</code> local puis redémarre la stack.
          </div>
        ) : (
          <>
            <div className="ops-form-grid">
              <select
                className="select-compact"
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
              >
                <option value="">Choisir la vidéo à envoyer...</option>
                {videoAssets.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.handle} — {v.title} ({v.qualityTier})
                  </option>
                ))}
              </select>

              <select
                className="select-compact"
                value={uploadTitleIndex}
                onChange={(e) => setUploadTitleIndex(Number(e.target.value))}
              >
                {[0, 1, 2].map((idx) => (
                  <option key={idx} value={idx}>
                    Titre {String.fromCharCode(65 + idx)} : {titles[idx]?.trim() || '(vide)'}
                  </option>
                ))}
              </select>

              <select
                className="select-compact"
                value={uploadThumbIndex}
                onChange={(e) => setUploadThumbIndex(Number(e.target.value))}
              >
                <option value={-1}>Sans miniature</option>
                {[0, 1, 2].map((idx) => (
                  <option key={idx} value={idx} disabled={!thumbSlots[idx]}>
                    Miniature {String.fromCharCode(65 + idx)}{thumbSlots[idx] ? '' : ' (vide)'}
                  </option>
                ))}
              </select>

              <select
                className="select-compact"
                value={uploadPrivacy}
                onChange={(e) => setUploadPrivacy(e.target.value as 'private' | 'unlisted')}
              >
                <option value="private">Privé (brouillon recommandé)</option>
                <option value="unlisted">Non répertorié (lien de revue)</option>
              </select>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={uploadingDraft || !selectedVideoId}
                onClick={async () => {
                  if (!selectedVideoId) return;
                  setUploadingDraft(true);
                  try {
                    await handleSave();
                    const res = await api.uploadYouTubeDraft(project.id, {
                      videoAssetId: selectedVideoId,
                      titleIndex: uploadTitleIndex,
                      thumbnailIndex: uploadThumbIndex < 0 ? null : uploadThumbIndex,
                      privacyStatus: uploadPrivacy,
                    });
                    setLastUpload(res);
                    onNotify(`Brouillon YouTube envoyé (${res.videoId})`);
                  } catch (err) {
                    onNotify(err instanceof Error ? err.message : 'Échec upload YouTube');
                  } finally {
                    setUploadingDraft(false);
                  }
                }}
              >
                <UploadCloud size={13} />{' '}
                {uploadingDraft ? 'Upload vers YouTube...' : 'Envoyer le brouillon'}
              </button>
            </div>

            {lastUpload && (
              <div className="ops-preview-summary" style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span>
                    Brouillon envoyé : <strong>{lastUpload.title}</strong> ({lastUpload.privacyStatus}
                    {lastUpload.thumbnailUploaded ? ' · miniature appliquée' : ''})
                  </span>
                  <a
                    href={lastUpload.studioUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                  >
                    <ExternalLink size={12} /> Ouvrir YouTube Studio
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

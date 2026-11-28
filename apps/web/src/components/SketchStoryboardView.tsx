import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock,
  Download,
  EyeOff,
  FilePlus2,
  Film,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  PenTool,
  Plus,
  Printer,
  Send,
  Unlink2,
} from 'lucide-react';
import {
  isLightCanvasColor,
  sortSketchesForBoard,
  type ProjectDto,
  type SceneDto,
  type SketchDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { renderSketchStoryboardSheetPng } from '../utils/sketch-renderer';
import { ProductionDossierModal } from './ProductionDossierModal';

type BoardLayout = 'grid-2' | 'grid-3' | 'grid-4' | 'strip';

export interface SketchStoryboardViewProps {
  project: ProjectDto;
  sketches: SketchDto[];
  scenes: SceneDto[];
  onSketchesChanged: (next: SketchDto[]) => void;
  onEditSketch: (sketch: SketchDto) => void;
  onNewWhiteboard: () => void;
  onNewScenePlan: () => void;
  onOpenPreprodStoryboard: () => void;
  onExportedSheetToMedia: () => void;
  onNotify: (msg: string) => void;
}

export function SketchStoryboardView({
  project,
  sketches,
  scenes,
  onSketchesChanged,
  onEditSketch,
  onNewWhiteboard,
  onNewScenePlan,
  onOpenPreprodStoryboard,
  onExportedSheetToMedia,
  onNotify,
}: SketchStoryboardViewProps) {
  const [layout, setLayout] = useState<BoardLayout>('grid-3');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [syncSceneId, setSyncSceneId] = useState<string>('');
  const [syncingAll, setSyncingAll] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [linkingSketchId, setLinkingSketchId] = useState<string | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [showDossierModal, setShowDossierModal] = useState(false);
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});

  const boardSketches = useMemo(() => sortSketchesForBoard(sketches), [sketches]);
  const offBoardSketches = useMemo(
    () => sketches.filter((s) => !s.inSketchBoard),
    [sketches],
  );
  const totalDurationSec = useMemo(
    () =>
      Math.round(
        boardSketches.reduce((sum, s) => sum + (Number.isFinite(s.durationSec) ? s.durationSec : 0), 0) * 10,
      ) / 10,
    [boardSketches],
  );

  const persistOrder = async (ordered: SketchDto[]) => {
    try {
      const updated = await api.reorderSketchBoard(project.id, {
        items: ordered.map((s, idx) => ({
          sketchId: s.id,
          inSketchBoard: true,
          boardOrder: idx,
        })),
      });
      onSketchesChanged(updated);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur réorganisation');
    }
  };

  const handleMoveIndex = (idx: number, delta: -1 | 1) => {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= boardSketches.length) return;
    const next = boardSketches.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved!);
    void persistOrder(next);
  };

  const handleDropOnCard = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = boardSketches.findIndex((s) => s.id === draggingId);
    const toIdx = boardSketches.findIndex((s) => s.id === targetId);
    setDraggingId(null);
    setDragOverId(null);
    if (fromIdx < 0 || toIdx < 0) return;

    const next = boardSketches.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved!);
    void persistOrder(next);
  };

  const handleToggleInBoard = async (sketch: SketchDto, include: boolean) => {
    try {
      const updated = await api.reorderSketchBoard(project.id, {
        items: [
          {
            sketchId: sketch.id,
            inSketchBoard: include,
            boardOrder: include ? boardSketches.length : sketch.boardOrder,
          },
        ],
      });
      onSketchesChanged(updated);
      onNotify(
        include
          ? `« ${sketch.title} » ajouté à la planche Storyboard`
          : `« ${sketch.title} » retiré de la planche (conservé dans Médias)`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur mise à jour planche');
    }
  };

  const handleSaveCardMeta = async (sketch: SketchDto) => {
    const nextCaption = captionDrafts[sketch.id] ?? sketch.caption;
    const rawDur = durationDrafts[sketch.id];
    const parsedDur = rawDur !== undefined ? Number(rawDur) : sketch.durationSec;
    const nextDuration =
      Number.isFinite(parsedDur) && parsedDur >= 0.5 && parsedDur <= 300
        ? parsedDur
        : sketch.durationSec;

    if (nextCaption === sketch.caption && nextDuration === sketch.durationSec) return;

    try {
      const updated = await api.reorderSketchBoard(project.id, {
        items: [
          {
            sketchId: sketch.id,
            caption: nextCaption,
            durationSec: nextDuration,
          },
        ],
      });
      onSketchesChanged(updated);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde légende');
    }
  };

  const handleLinkToExistingShot = async (sketch: SketchDto, shotId: string | null) => {
    try {
      const updated = await api.linkSketchToShot(sketch.id, {
        shotId,
        syncKeyframe: true,
        syncBrief: true,
      });
      onSketchesChanged(sketches.map((s) => (s.id === updated.id ? updated : s)));
      setLinkingSketchId(null);
      onNotify(
        shotId
          ? `« ${sketch.title} » lié au plan ${updated.shotHandle ?? ''} (Pré-prod)`
          : `Lien Pré-prod retiré pour « ${sketch.title} »`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur liaison Pré-prod');
    }
  };

  const handleCreateShotForSketch = async (sketch: SketchDto, sceneId?: string) => {
    try {
      const updated = await api.linkSketchToShot(sketch.id, {
        createShotInSceneId: sceneId || undefined,
        newSceneTitle: sceneId ? undefined : 'Storyboard Croquis',
        syncKeyframe: true,
        syncBrief: true,
      });
      onSketchesChanged(sketches.map((s) => (s.id === updated.id ? updated : s)));
      setLinkingSketchId(null);
      onNotify(
        `Plan ${updated.shotHandle ?? ''} créé dans Storyboard Pré-prod et lié à « ${sketch.title} »`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur création plan Pré-prod');
    }
  };

  const handleSyncAllToPreprod = async () => {
    if (boardSketches.length === 0) return;
    setSyncingAll(true);
    try {
      const res = await api.syncSketchBoardToStoryboard(project.id, {
        sceneId: syncSceneId || undefined,
        newSceneTitle: 'Storyboard Croquis',
        sketchIds: boardSketches.map((s) => s.id),
      });
      onSketchesChanged(res.sketches);
      onNotify(
        `Storyboard Pré-prod synchronisé (${res.sceneTitle}) : ${res.createdCount} plan(s) créé(s), ${res.updatedCount} mis à jour`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur synchronisation Pré-prod');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleExportSheet = async (saveToMedia: boolean) => {
    if (boardSketches.length === 0) return;
    setExportingSheet(true);
    try {
      const cols = layout === 'grid-2' ? 2 : layout === 'grid-4' ? 4 : 3;
      const dataUrl = await renderSketchStoryboardSheetPng(boardSketches, {
        projectName: project.name,
        columns: cols,
        paperTheme: 'light',
      });
      if (saveToMedia) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File(
          [blob],
          `storyboard-croquis-${project.slug}.png`,
          { type: 'image/png' },
        );
        const uploaded = await api.uploadAssetFile(project.id, file, {
          qualityTier: 'draft_lowres',
          folderPath: 'storyboard',
        });
        onExportedSheetToMedia();
        onNotify(`Planche Storyboard enregistrée dans /storyboard (${uploaded.handle})`);
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `storyboard-croquis-${project.slug}.png`;
        link.click();
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Échec export planche PNG');
    } finally {
      setExportingSheet(false);
    }
  };

  return (
    <div className="sketch-board-view">
      {/* Board Action Header */}
      <div className="sketch-board-toolbar">
        <div className="sketch-board-toolbar-left">
          <button type="button" className="btn btn-sm btn-primary" onClick={onNewWhiteboard}>
            <FilePlus2 size={14} /> + Feuille blanche
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onNewScenePlan}>
            <Camera size={14} /> + Plan de scène
          </button>

          <div className="sketch-mode-switch" role="group" aria-label="Disposition de la planche">
            {(
              [
                { id: 'grid-2', label: '2 col.' },
                { id: 'grid-3', label: '3 col.' },
                { id: 'grid-4', label: '4 col.' },
                { id: 'strip', label: 'Bande →' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`btn btn-xs ${layout === opt.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setLayout(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="pill-tag">
            <LayoutGrid size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {boardSketches.length} case(s) · <Clock size={11} style={{ margin: '0 3px', verticalAlign: 'middle' }} />
            {totalDurationSec}s
          </span>
        </div>

        <div className="sketch-board-toolbar-right">
          <select
            className="input input-sm"
            value={syncSceneId}
            onChange={(e) => setSyncSceneId(e.target.value)}
            title="Scène cible dans le Storyboard Pré-prod"
            style={{ width: 190 }}
          >
            <option value="">Nouvelle scène « Storyboard Croquis »</option>
            {scenes.map((sc) => (
              <option key={sc.id} value={sc.id}>
                Scène {sc.sceneNumber} — {sc.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={syncingAll || boardSketches.length === 0}
            onClick={() => void handleSyncAllToPreprod()}
            title="Créer ou mettre à jour tous les plans de cette planche dans le Storyboard Pré-prod"
          >
            <Send size={13} />{' '}
            {syncingAll ? 'Synchro…' : 'Tout pousser vers Pré-prod'}
          </button>

          <button
            type="button"
            className="btn btn-xs btn-secondary"
            disabled={exportingSheet || boardSketches.length === 0}
            onClick={() => void handleExportSheet(true)}
            title="Exporter toute la planche côte à côte en PNG dans Médias /storyboard"
          >
            <ImageIcon size={13} /> Planche → Médias
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            disabled={exportingSheet || boardSketches.length === 0}
            onClick={() => void handleExportSheet(false)}
            title="Télécharger la planche complète en PNG"
          >
            <Download size={13} /> PNG
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => setShowDossierModal(true)}
            title="Exporter le Dossier de Production / Pitch Deck en PDF"
          >
            <Printer size={13} /> Dossier PDF
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={onOpenPreprodStoryboard}
            title="Voir le Storyboard complet dans Pré-prod"
          >
            <Film size={13} /> Voir Pré-prod
          </button>
        </div>
      </div>

      {showDossierModal && (
        <ProductionDossierModal
          project={project}
          onClose={() => setShowDossierModal(false)}
          onNotify={onNotify}
          onAssetSaved={onExportedSheetToMedia}
        />
      )}

      {/* Main Side-by-Side Storyboard Canvas */}
      <div className="sketch-board-scroll">
        {boardSketches.length === 0 ? (
          <div className="empty-state" style={{ margin: '48px auto', maxWidth: 520 }}>
            <LayoutGrid size={36} color="var(--accent-amber)" style={{ marginBottom: 8 }} />
            <h2>Storyboard de Croquis vide</h2>
            <p>
              Dessine tes cases à la main sur une <strong>feuille blanche</strong> ou place des{' '}
              <strong>plans de scène</strong>, puis organise-les côte à côte ici et pousse-les en 1
              clic dans le <strong>Storyboard Pré-prod</strong>.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={onNewWhiteboard}>
                <FilePlus2 size={14} /> Dessiner sur feuille blanche
              </button>
              <button type="button" className="btn btn-secondary" onClick={onNewScenePlan}>
                <Camera size={14} /> Créer un plan de scène
              </button>
            </div>
          </div>
        ) : (
          <div className={`sketch-board-grid layout-${layout}`}>
            {boardSketches.map((sk, idx) => {
              const isPaper = isLightCanvasColor(sk.sceneData.backgroundColor);
              const captionVal = captionDrafts[sk.id] ?? sk.caption;
              const durationVal = durationDrafts[sk.id] ?? String(sk.durationSec);
              const isLinking = linkingSketchId === sk.id;

              return (
                <article
                  key={sk.id}
                  draggable
                  onDragStart={() => setDraggingId(sk.id)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverId !== sk.id) setDragOverId(sk.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverId === sk.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnCard(sk.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  className={`sketch-board-card ${draggingId === sk.id ? 'dragging' : ''} ${
                    dragOverId === sk.id && draggingId !== sk.id ? 'drag-over' : ''
                  }`}
                >
                  {/* Card Top Bar */}
                  <div className="sketch-board-card-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="sketch-board-drag-handle" title="Glisser pour réordonner">
                        <GripVertical size={13} />
                      </span>
                      <span className="sketch-board-num">#{String(idx + 1).padStart(2, '0')}</span>
                      <span className="pill-tag">
                        {sk.mode === 'scene_plan'
                          ? 'Plan'
                          : isPaper
                            ? 'Feuille blanche'
                            : 'Croquis'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={idx === 0}
                        onClick={() => handleMoveIndex(idx, -1)}
                        title="Déplacer avant"
                      >
                        <ArrowLeft size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={idx === boardSketches.length - 1}
                        onClick={() => handleMoveIndex(idx, 1)}
                        title="Déplacer après"
                      >
                        <ArrowRight size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => void handleToggleInBoard(sk, false)}
                        title="Retirer de la planche (conserve le croquis et le média)"
                      >
                        <EyeOff size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Visual Frame */}
                  <div
                    className={`sketch-board-frame ${isPaper ? 'paper-frame' : ''}`}
                    onClick={() => onEditSketch(sk)}
                    title="Cliquer pour ouvrir et éditer ce croquis"
                  >
                    {sk.assetThumbnailUrl || sk.assetUrl ? (
                      <img
                        src={sk.assetUrl ?? sk.assetThumbnailUrl ?? ''}
                        alt={sk.title}
                        className="sketch-board-img"
                      />
                    ) : (
                      <div className="sketch-board-empty-frame">
                        <PenTool size={22} />
                        <span>Cliquer pour dessiner</span>
                      </div>
                    )}
                    <span className="sketch-board-edit-overlay">
                      <PenTool size={12} /> Éditer
                    </span>
                  </div>

                  {/* Title, Duration & Pre-prod Link Badges */}
                  <div className="sketch-board-card-body">
                    <div className="sketch-board-title-row">
                      <strong className="sketch-board-title" title={sk.title}>
                        {sk.title}
                      </strong>
                      <label className="sketch-board-dur" title="Durée estimée du plan (secondes)">
                        <input
                          type="number"
                          min={0.5}
                          max={300}
                          step={0.5}
                          value={durationVal}
                          onChange={(e) =>
                            setDurationDrafts((prev) => ({ ...prev, [sk.id]: e.target.value }))
                          }
                          onBlur={() => void handleSaveCardMeta(sk)}
                        />
                        <span>s</span>
                      </label>
                    </div>

                    <textarea
                      className="sketch-board-caption"
                      rows={2}
                      value={captionVal}
                      onChange={(e) =>
                        setCaptionDrafts((prev) => ({ ...prev, [sk.id]: e.target.value }))
                      }
                      onBlur={() => void handleSaveCardMeta(sk)}
                      placeholder="Légende, action, dialogue ou note de transition…"
                    />

                    {/* Link status & actions */}
                    <div className="sketch-board-card-foot">
                      {sk.shotHandle ? (
                        <span className="sketch-board-linked-pill" title={sk.shotTitle ?? ''}>
                          <Check size={11} /> Pré-prod : {sk.shotHandle}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Non lié à Pré-prod
                        </span>
                      )}

                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => onEditSketch(sk)}
                        >
                          <PenTool size={11} /> Éditer
                        </button>
                        <button
                          type="button"
                          className={`btn btn-xs ${isLinking ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setLinkingSketchId(isLinking ? null : sk.id)}
                          title="Lier ou envoyer ce croquis vers le Storyboard Pré-prod"
                        >
                          <Link2 size={11} /> Pré-prod
                        </button>
                      </div>
                    </div>

                    {/* Inline Pre-prod Link Popover */}
                    {isLinking && (
                      <div className="sketch-board-link-box">
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                          Lier au Storyboard Pré-prod :
                        </div>
                        <select
                          className="input input-sm"
                          value={sk.shotId ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) void handleLinkToExistingShot(sk, val);
                          }}
                        >
                          <option value="">— Choisir un plan existant —</option>
                          {scenes.map((sc) => (
                            <optgroup key={sc.id} label={`Scène ${sc.sceneNumber} — ${sc.title}`}>
                              {sc.shots.map((sh) => (
                                <option key={sh.id} value={sh.id}>
                                  {sh.handle} — {sh.title}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-xs btn-primary"
                            onClick={() => void handleCreateShotForSketch(sk, syncSceneId || scenes[0]?.id)}
                          >
                            <Plus size={11} /> Créer nouveau plan Pré-prod
                          </button>
                          {sk.shotId && (
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost"
                              onClick={() => void handleLinkToExistingShot(sk, null)}
                            >
                              <Unlink2 size={11} /> Délier
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {/* Quick Add Next Panel Card */}
            <div className="sketch-board-add-card">
              <button type="button" className="btn btn-primary btn-sm" onClick={onNewWhiteboard}>
                <FilePlus2 size={14} /> + Case feuille blanche
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onNewScenePlan}>
                <Camera size={14} /> + Case plan de scène
              </button>
            </div>
          </div>
        )}

        {/* Off-board sketches drawer so any saved sketch can be added back onto the board */}
        {offBoardSketches.length > 0 && (
          <div className="sketch-offboard-drawer">
            <div className="sketch-offboard-head">
              <strong>Croquis & Plans hors planche ({offBoardSketches.length})</strong>
              <span className="muted" style={{ fontSize: 11.5 }}>
                Clique sur « + Planche » pour les placer dans le Storyboard Croquis
              </span>
            </div>
            <div className="sketch-offboard-list">
              {offBoardSketches.map((sk) => (
                <div key={sk.id} className="sketch-offboard-pill">
                  <span onClick={() => onEditSketch(sk)} style={{ cursor: 'pointer' }}>
                    {sk.title}
                  </span>
                  <button
                    type="button"
                    className="btn btn-xs btn-secondary"
                    onClick={() => void handleToggleInBoard(sk, true)}
                  >
                    <Plus size={11} /> Planche
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

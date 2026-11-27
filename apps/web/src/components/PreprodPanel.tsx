import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Copy,
  FileText,
  Film,
  GitCompare,
  Plus,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import {
  computeLineDiff,
  type AssetDto,
  type BibleEntityDto,
  type BibleEntityType,
  type ProjectDto,
  type ProjectScriptDto,
  type SceneDto,
  type ShotStatus,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/format';

interface PreprodPanelProps {
  project: ProjectDto | null;
  assets: AssetDto[];
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

const BIBLE_LABELS: Record<BibleEntityType, string> = {
  character: 'Personnage',
  location: 'Lieu / Décor',
  prop: 'Objet / Accessoire',
  style: 'Style Visuel',
};

const SHOT_STATUS_LABELS: Record<ShotStatus, string> = {
  planned: 'Planifié',
  generating: 'En génération',
  draft_ready: 'Draft prêt',
  hq_ready: 'HQ prêt',
  approved: 'Approuvé',
};

export function PreprodPanel({
  project,
  assets,
  refreshSignal,
  onCopyText,
  onNotify,
}: PreprodPanelProps) {
  const [subTab, setSubTab] = useState<'script' | 'bible' | 'storyboard'>('script');

  // Script state
  const [script, setScript] = useState<ProjectScriptDto | null>(null);
  const [scriptContent, setScriptContent] = useState('');
  const [scriptSummary, setScriptSummary] = useState('');
  const [diffVersionNum, setDiffVersionNum] = useState<number | null>(null);

  // Bible state
  const [entities, setEntities] = useState<BibleEntityDto[]>([]);
  const [bType, setBType] = useState<BibleEntityType>('character');
  const [bName, setBName] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [bPrompt, setBPrompt] = useState('');
  const [bLora, setBLora] = useState('');

  // Storyboard state
  const [scenes, setScenes] = useState<SceneDto[]>([]);
  const [newSceneTitle, setNewSceneTitle] = useState('');
  const [newSceneSummary, setNewSceneSummary] = useState('');
  const [addingShotSceneId, setAddingShotSceneId] = useState<string | null>(null);
  const [shotTitle, setShotTitle] = useState('');
  const [shotCamera, setShotCamera] = useState('');
  const [shotDuration, setShotDuration] = useState(4);
  const [shotPrompt, setShotPrompt] = useState('');

  const loadAll = async () => {
    if (!project) return;
    const [sc, bib, sb] = await Promise.all([
      api.getProjectScript(project.id),
      api.listBibleEntities(project.id),
      api.getStoryboard(project.id),
    ]);
    setScript(sc);
    setScriptContent(sc.content);
    setEntities(bib);
    setScenes(sb);
  };

  useEffect(() => {
    void loadAll().catch(() => undefined);
  }, [project?.id, refreshSignal]);

  const diffLines = useMemo(() => {
    if (!script || diffVersionNum === null) return null;
    const oldVer = script.versions.find((v) => v.version === diffVersionNum);
    if (!oldVer) return null;
    return computeLineDiff(oldVer.content, scriptContent);
  }, [script, diffVersionNum, scriptContent]);

  if (!project) {
    return (
      <div className="empty-state">
        <h2>Pré-production</h2>
        <p>Sélectionne un projet pour éditer son scénario, sa bible de continuité et son storyboard.</p>
      </div>
    );
  }

  const handleSaveScript = async (e: FormEvent) => {
    e.preventDefault();
    const updated = await api.updateProjectScript(project.id, {
      content: scriptContent,
      changeSummary: scriptSummary.trim() || 'Mise à jour du scénario',
      author: 'user',
    });
    setScript(updated);
    setScriptSummary('');
    onNotify(`Scénario enregistré (v${updated.version})`);
  };

  const handleCreateBible = async (e: FormEvent) => {
    e.preventDefault();
    if (!bName.trim()) return;
    const created = await api.upsertBibleEntity(project.id, {
      entityType: bType,
      name: bName.trim(),
      description: bDesc.trim(),
      visualPrompt: bPrompt.trim(),
      loraName: bLora.trim(),
      referenceAssetIds: [],
      tags: [],
    });
    setBName('');
    setBDesc('');
    setBPrompt('');
    setBLora('');
    await loadAll();
    onNotify(`Fiche continuité ${created.handle} enregistrée`);
  };

  const handleCreateScene = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSceneTitle.trim()) return;
    await api.createScene(project.id, {
      title: newSceneTitle.trim(),
      summary: newSceneSummary.trim(),
      locationRef: '',
    });
    setNewSceneTitle('');
    setNewSceneSummary('');
    await loadAll();
    onNotify('Scène ajoutée au storyboard');
  };

  const handleCreateShot = async (e: FormEvent, sceneId: string) => {
    e.preventDefault();
    if (!shotTitle.trim()) return;
    await api.createShot(project.id, {
      sceneId,
      title: shotTitle.trim(),
      visualDescription: '',
      cameraMovement: shotCamera.trim(),
      dialogue: '',
      prompt: shotPrompt.trim(),
      durationSec: shotDuration,
      status: 'planned',
      bibleEntityRefs: [],
    });
    setShotTitle('');
    setShotCamera('');
    setShotPrompt('');
    setAddingShotSceneId(null);
    await loadAll();
    onNotify('Plan ajouté');
  };

  const assetById = new Map(assets.map((a) => [a.id, a]));

  return (
    <div className="panel-workspace">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`chip ${subTab === 'script' ? 'active' : ''}`}
          onClick={() => setSubTab('script')}
        >
          <FileText size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Scénario {script ? `(v${script.version})` : ''}
        </button>
        <button
          type="button"
          className={`chip ${subTab === 'bible' ? 'active' : ''}`}
          onClick={() => setSubTab('bible')}
        >
          <Users size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Bible continuité ({entities.length})
        </button>
        <button
          type="button"
          className={`chip ${subTab === 'storyboard' ? 'active' : ''}`}
          onClick={() => setSubTab('storyboard')}
        >
          <Film size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Storyboard ({scenes.length} scènes)
        </button>
      </div>

      {/* Sub-tab 1: Versioned Script + Diff */}
      {subTab === 'script' && (
        <div className="panel-split">
          <div className="panel-card">
            <div className="section-label">Historique ({script?.versions.length ?? 0})</div>
            {(script?.versions ?? []).map((v) => (
              <div key={v.id} className="rule-row">
                <div className="rule-row-top">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    <strong>v{v.version}</strong> · {v.author}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatRelativeTime(v.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {v.changeSummary}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setDiffVersionNum((curr) => (curr === v.version ? null : v.version))
                    }
                  >
                    <GitCompare size={11} />{' '}
                    {diffVersionNum === v.version ? 'Masquer diff' : `Diff vs v${v.version}`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setScriptContent(v.content)}
                  >
                    Charger
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="panel-card">
            <form onSubmit={(e) => void handleSaveScript(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="section-label">
                <span>Éditeur de Scénario (Markdown / Découpage)</span>
                <span className="pill-tag">MCP : get_script / update_script</span>
              </div>

              <textarea
                className="textarea"
                style={{ fontFamily: 'var(--font-mono)', minHeight: 280, fontSize: 12.5 }}
                value={scriptContent}
                onChange={(e) => setScriptContent(e.target.value)}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  value={scriptSummary}
                  onChange={(e) => setScriptSummary(e.target.value)}
                  placeholder="Résumé de la modification (ex : Ajout scène d'ouverture)..."
                />
                <button type="submit" className="btn btn-primary">
                  <Save size={14} /> Enregistrer
                </button>
              </div>
            </form>

            {diffLines && (
              <div style={{ marginTop: 8 }}>
                <div className="section-label">
                  <span>Comparaison Diff (v{diffVersionNum} → brouillon actuel)</span>
                </div>
                <div className="diff-viewer">
                  {diffLines.map((line, i) => (
                    <div key={i} className={`diff-line ${line.type}`}>
                      {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                      {line.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 2: Continuity Bible */}
      {subTab === 'bible' && (
        <div className="panel-split">
          <form onSubmit={(e) => void handleCreateBible(e)} className="panel-card">
            <div className="section-label">Nouvelle fiche continuité</div>
            <div className="field">
              <label>Type</label>
              <select
                className="select"
                value={bType}
                onChange={(e) => setBType(e.target.value as BibleEntityType)}
              >
                {(Object.keys(BIBLE_LABELS) as BibleEntityType[]).map((t) => (
                  <option key={t} value={t}>
                    {BIBLE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Nom</label>
              <input
                className="input"
                required
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="Ex : Elena (Héroïne)"
              />
            </div>
            <div className="field">
              <label>Description narrative</label>
              <textarea
                className="textarea"
                value={bDesc}
                onChange={(e) => setBDesc(e.target.value)}
                placeholder="Traits physiques, tenue, personnalité..."
              />
            </div>
            <div className="field">
              <label>Prompt visuel de référence (cohérence IA)</label>
              <textarea
                className="textarea"
                value={bPrompt}
                onChange={(e) => setBPrompt(e.target.value)}
                placeholder="young woman with short dark hair, amber leather jacket..."
              />
            </div>
            <div className="field">
              <label>LoRA associé (optionnel)</label>
              <input
                className="input"
                value={bLora}
                onChange={(e) => setBLora(e.target.value)}
                placeholder="elena_v2.safetensors:0.8"
              />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={13} /> Ajouter à la Bible
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {entities.map((ent) => (
              <div key={ent.id} className="panel-card">
                <div className="rule-row-top">
                  <strong>{ent.name}</strong>
                  <span className="pill-tag amber">{BIBLE_LABELS[ent.entityType]}</span>
                </div>
                {ent.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {ent.description}
                  </div>
                )}
                {ent.visualPrompt && <div className="prompt-box">{ent.visualPrompt}</div>}
                {ent.loraName && (
                  <div style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--status-live)' }}>
                    LoRA : {ent.loraName}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={() => onCopyText(ent.handle, 'Référence Bible')}
                  >
                    <Copy size={11} /> {ent.handle}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await api.deleteBibleEntity(ent.id);
                      await loadAll();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab 3: Storyboard Scenes & Shots */}
      {subTab === 'storyboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <form onSubmit={(e) => void handleCreateScene(e)} className="panel-card">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                required
                value={newSceneTitle}
                onChange={(e) => setNewSceneTitle(e.target.value)}
                placeholder="Titre de nouvelle scène (ex : Scène 1 — Arrivée dans le studio)"
              />
              <input
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                value={newSceneSummary}
                onChange={(e) => setNewSceneSummary(e.target.value)}
                placeholder="Résumé court..."
              />
              <button type="submit" className="btn btn-primary btn-sm">
                <Plus size={13} /> Ajouter scène
              </button>
            </div>
          </form>

          {scenes.map((scene) => (
            <div key={scene.id} className="panel-card">
              <div className="rule-row-top">
                <div>
                  <strong>
                    Scène {scene.sceneNumber} — {scene.title}
                  </strong>
                  {scene.summary && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {scene.summary}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setAddingShotSceneId((curr) => (curr === scene.id ? null : scene.id))
                    }
                  >
                    <Plus size={12} /> Plan
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await api.deleteScene(scene.id);
                      await loadAll();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {addingShotSceneId === scene.id && (
                <form
                  onSubmit={(e) => void handleCreateShot(e, scene.id)}
                  className="rule-row"
                  style={{ gap: 8 }}
                >
                  <div className="field-grid">
                    <input
                      className="input"
                      required
                      placeholder="Titre du plan"
                      value={shotTitle}
                      onChange={(e) => setShotTitle(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input"
                        placeholder="Mouvement caméra (ex : Dolly in)"
                        value={shotCamera}
                        onChange={(e) => setShotCamera(e.target.value)}
                      />
                      <input
                        className="input"
                        type="number"
                        step="0.5"
                        min={0.5}
                        style={{ width: 82 }}
                        value={shotDuration}
                        onChange={(e) => setShotDuration(Number(e.target.value) || 4)}
                        title="Durée en secondes"
                      />
                    </div>
                  </div>
                  <input
                    className="input"
                    placeholder="Prompt visuel du plan..."
                    value={shotPrompt}
                    onChange={(e) => setShotPrompt(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAddingShotSceneId(null)}
                    >
                      Annuler
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Ajouter le plan
                    </button>
                  </div>
                </form>
              )}

              <div className="shot-grid">
                {scene.shots.map((shot) => {
                  const keyframe = shot.keyframeAssetId ? assetById.get(shot.keyframeAssetId) : null;
                  const video = shot.videoAssetId ? assetById.get(shot.videoAssetId) : null;
                  const previewUrl =
                    video?.urls.thumbnail ?? keyframe?.urls.thumbnail ?? keyframe?.urls.proxy;

                  return (
                    <div key={shot.id} className="rule-row">
                      {previewUrl && (
                        <img
                          src={previewUrl}
                          alt={shot.title}
                          style={{
                            width: '100%',
                            aspectRatio: '16/9',
                            objectFit: 'cover',
                            borderRadius: 6,
                          }}
                        />
                      )}
                      <div className="rule-row-top">
                        <button
                          type="button"
                          className="ref-copy-btn"
                          onClick={() => onCopyText(shot.handle, 'Référence plan')}
                        >
                          <Copy size={10} /> {shot.handle}
                        </button>
                        <span className="pill-tag">{shot.durationSec}s</span>
                      </div>
                      <strong style={{ fontSize: 13 }}>{shot.title}</strong>
                      {shot.cameraMovement && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          Caméra : {shot.cameraMovement}
                        </div>
                      )}
                      {shot.prompt && (
                        <div className="prompt-box" style={{ maxHeight: 74 }}>
                          {shot.prompt}
                        </div>
                      )}
                      <div className="rule-row-top">
                        <select
                          className="select-compact"
                          value={shot.status}
                          onChange={async (e) => {
                            await api.updateShot(shot.id, {
                              status: e.target.value as ShotStatus,
                            });
                            await loadAll();
                          }}
                        >
                          {(Object.keys(SHOT_STATUS_LABELS) as ShotStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {SHOT_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            await api.deleteShot(shot.id);
                            await loadAll();
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

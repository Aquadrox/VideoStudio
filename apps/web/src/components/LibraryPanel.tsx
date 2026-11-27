import { useEffect, useState, type FormEvent } from 'react';
import { Copy, FileJson, Plus, Sparkles, Trash2 } from 'lucide-react';
import type {
  ComfyWorkflowCategory,
  ComfyWorkflowDto,
  ProjectDto,
  PromptCategory,
  PromptTemplateDto,
} from '@videostudio/shared';
import { api } from '../api/client';

interface LibraryPanelProps {
  project: ProjectDto | null;
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

export function LibraryPanel({
  project,
  refreshSignal,
  onCopyText,
  onNotify,
}: LibraryPanelProps) {
  const [subTab, setSubTab] = useState<'prompts' | 'workflows'>('prompts');
  const [prompts, setPrompts] = useState<PromptTemplateDto[]>([]);
  const [workflows, setWorkflows] = useState<ComfyWorkflowDto[]>([]);

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [injectRules, setInjectRules] = useState(true);
  const [contextTagsDraft, setContextTagsDraft] = useState('');
  const [renderedOutput, setRenderedOutput] = useState<{
    positive: string;
    negative: string;
    appliedRulesCount: number;
  } | null>(null);

  // Create Prompt form
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [pName, setPName] = useState('');
  const [pCategory, setPCategory] = useState<PromptCategory>('image');
  const [pModel, setPModel] = useState('');
  const [pPos, setPPos] = useState('');
  const [pNeg, setPNeg] = useState('');

  // Create Workflow form
  const [showNewWf, setShowNewWf] = useState(false);
  const [wfName, setWfName] = useState('');
  const [wfCat, setWfCat] = useState<ComfyWorkflowCategory>('image_gen');
  const [wfDesc, setWfDesc] = useState('');
  const [wfNotes, setWfNotes] = useState('');
  const [wfJsonStr, setWfJsonStr] = useState('{}');

  const loadLibrary = async () => {
    const [pList, wList] = await Promise.all([
      api.listPromptTemplates(),
      api.listComfyWorkflows(),
    ]);
    setPrompts(pList);
    setWorkflows(wList);
    if (!selectedPromptId && pList[0]) {
      setSelectedPromptId(pList[0].id);
    }
  };

  useEffect(() => {
    void loadLibrary().catch(() => undefined);
  }, [refreshSignal]);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId) ?? null;

  useEffect(() => {
    if (!selectedPrompt) {
      setRenderedOutput(null);
      return;
    }
    const defaults: Record<string, string> = {};
    for (const v of selectedPrompt.variables) {
      defaults[v.name] = varValues[v.name] ?? v.defaultValue ?? '';
    }
    const parsedTags = contextTagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    void api
      .renderPromptTemplate(selectedPrompt.id, {
        projectIdOrSlug: project?.id,
        variables: defaults,
        includeProjectRules: injectRules,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
      })
      .then((res) =>
        setRenderedOutput({
          positive: res.positive,
          negative: res.negative,
          appliedRulesCount: res.appliedRulesCount,
        }),
      )
      .catch(() => undefined);
  }, [selectedPrompt?.id, project?.id, injectRules, contextTagsDraft, JSON.stringify(varValues)]);

  const handleCreatePrompt = async (e: FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || !pPos.trim()) return;
    const created = await api.createPromptTemplate({
      name: pName.trim(),
      category: pCategory,
      targetModel: pModel.trim(),
      positiveTemplate: pPos.trim(),
      negativeTemplate: pNeg.trim(),
      variables: [],
      tags: [],
      notes: '',
    });
    setPName('');
    setPModel('');
    setPPos('');
    setPNeg('');
    setShowNewPrompt(false);
    await loadLibrary();
    setSelectedPromptId(created.id);
    onNotify(`Template ${created.handle} créé`);
  };

  const handleCreateWorkflow = async (e: FormEvent) => {
    e.preventDefault();
    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(wfJsonStr) as Record<string, unknown>;
    } catch {
      onNotify('JSON de workflow invalide');
      return;
    }
    const created = await api.createComfyWorkflow({
      name: wfName.trim(),
      category: wfCat,
      description: wfDesc.trim(),
      workflowJson: parsedJson,
      inputNotes: wfNotes.trim(),
      tags: [],
    });
    setWfName('');
    setWfDesc('');
    setWfNotes('');
    setWfJsonStr('{}');
    setShowNewWf(false);
    await loadLibrary();
    onNotify(`Workflow ${created.handle} enregistré`);
  };

  return (
    <div className="panel-workspace">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={`chip ${subTab === 'prompts' ? 'active' : ''}`}
            onClick={() => setSubTab('prompts')}
          >
            <Sparkles size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Prompts réutilisables ({prompts.length})
          </button>
          <button
            type="button"
            className={`chip ${subTab === 'workflows' ? 'active' : ''}`}
            onClick={() => setSubTab('workflows')}
          >
            <FileJson size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Workflows ComfyUI ({workflows.length})
          </button>
        </div>

        {subTab === 'prompts' ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowNewPrompt((v) => !v)}
          >
            <Plus size={13} /> Nouveau prompt
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowNewWf((v) => !v)}
          >
            <Plus size={13} /> Ajouter workflow JSON
          </button>
        )}
      </div>

      {subTab === 'prompts' ? (
        <>
          {showNewPrompt && (
            <form onSubmit={(e) => void handleCreatePrompt(e)} className="panel-card">
              <div className="field-grid">
                <div className="field">
                  <label>Nom du template</label>
                  <input
                    className="input"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Ex : Portrait Cinéma Flux"
                  />
                </div>
                <div className="field">
                  <label>Catégorie / Modèle</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      className="select"
                      value={pCategory}
                      onChange={(e) => setPCategory(e.target.value as PromptCategory)}
                    >
                      <option value="image">Image</option>
                      <option value="video">Vidéo</option>
                      <option value="music">Musique</option>
                      <option value="voice">Voix</option>
                      <option value="script">Script</option>
                      <option value="thumbnail">Miniature</option>
                    </select>
                    <input
                      className="input"
                      value={pModel}
                      onChange={(e) => setPModel(e.target.value)}
                      placeholder="Flux / Wan 2.2 / Suno"
                    />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Template positif (utilise {'{{variable}}'} pour les paramètres)</label>
                <textarea
                  className="textarea"
                  required
                  value={pPos}
                  onChange={(e) => setPPos(e.target.value)}
                  placeholder="Cinematic close-up of {{personnage}} in {{decor}}, {{lumiere}} lighting..."
                />
              </div>

              <div className="field">
                <label>Template négatif (optionnel)</label>
                <input
                  className="input"
                  value={pNeg}
                  onChange={(e) => setPNeg(e.target.value)}
                  placeholder="blurry, lowres..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewPrompt(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Enregistrer
                </button>
              </div>
            </form>
          )}

          <div className="panel-split">
            <div className="panel-card">
              <div className="section-label">Templates ({prompts.length})</div>
              {prompts.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Aucun template de prompt. Crée-en un ou laisse Claude utiliser{' '}
                  <code>save_prompt_template</code>.
                </div>
              )}
              {prompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`project-item ${p.id === selectedPromptId ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedPromptId(p.id);
                    setVarValues({});
                  }}
                >
                  <div className="project-item-top">
                    <span className="project-item-name">{p.name}</span>
                    <span className="pill-tag">{p.category}</span>
                  </div>
                  <div className="project-item-meta">
                    <span>{p.handle}</span>
                    {p.targetModel && <span>· {p.targetModel}</span>}
                  </div>
                </button>
              ))}
            </div>

            <div className="panel-card">
              {selectedPrompt ? (
                <>
                  <div className="rule-row-top">
                    <div>
                      <strong style={{ fontSize: 15 }}>{selectedPrompt.name}</strong>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button
                          type="button"
                          className="ref-copy-btn"
                          onClick={() => onCopyText(selectedPrompt.handle, 'Référence prompt')}
                        >
                          <Copy size={11} /> {selectedPrompt.handle}
                        </button>
                        {selectedPrompt.targetModel && (
                          <span className="pill-tag">{selectedPrompt.targetModel}</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={async () => {
                        await api.deletePromptTemplate(selectedPrompt.id);
                        setSelectedPromptId(null);
                        await loadLibrary();
                        onNotify('Template supprimé');
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {selectedPrompt.variables.length > 0 && (
                    <div className="field-grid">
                      {selectedPrompt.variables.map((v) => (
                        <div key={v.name} className="field">
                          <label>{`{{${v.name}}}`}</label>
                          <input
                            className="input"
                            value={varValues[v.name] ?? v.defaultValue ?? ''}
                            onChange={(e) =>
                              setVarValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                            }
                            placeholder={`Valeur pour ${v.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {project && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={injectRules}
                          onChange={(e) => setInjectRules(e.target.checked)}
                        />
                        Injecter les règles actives du projet <strong>{project.name}</strong>
                        {renderedOutput && injectRules && (
                          <span className="pill-tag amber">
                            {renderedOutput.appliedRulesCount} règle(s) injectée(s)
                          </span>
                        )}
                      </label>
                      {injectRules && (
                        <div className="field">
                          <label>Tags de contexte (optionnel — ex : elena, caspian, scene-01)</label>
                          <input
                            className="input"
                            value={contextTagsDraft}
                            onChange={(e) => setContextTagsDraft(e.target.value)}
                            placeholder="Active uniquement les règles ciblées sur ces tags..."
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {renderedOutput && (
                    <>
                      <div className="section-label">
                        <span>Prompt positif rendu</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onCopyText(renderedOutput.positive, 'Prompt positif')}
                        >
                          <Copy size={11} /> Copier
                        </button>
                      </div>
                      <div className="prompt-box">{renderedOutput.positive}</div>

                      {renderedOutput.negative && (
                        <>
                          <div className="section-label">
                            <span>Prompt négatif rendu</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onCopyText(renderedOutput.negative, 'Prompt négatif')}
                            >
                              <Copy size={11} /> Copier
                            </button>
                          </div>
                          <div className="prompt-box">{renderedOutput.negative}</div>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Sélectionne un template de prompt pour tester ses variables et l'injection des
                  règles du projet.
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {showNewWf && (
            <form onSubmit={(e) => void handleCreateWorkflow(e)} className="panel-card">
              <div className="field-grid">
                <div className="field">
                  <label>Nom du workflow ComfyUI</label>
                  <input
                    className="input"
                    required
                    value={wfName}
                    onChange={(e) => setWfName(e.target.value)}
                    placeholder="Ex : Wan 2.2 Img2Vid Draft 480p"
                  />
                </div>
                <div className="field">
                  <label>Catégorie</label>
                  <select
                    className="select"
                    value={wfCat}
                    onChange={(e) => setWfCat(e.target.value as ComfyWorkflowCategory)}
                  >
                    <option value="image_gen">Génération Image</option>
                    <option value="img2vid">Image → Vidéo</option>
                    <option value="upscale">Upscale HQ</option>
                    <option value="inpaint">Inpainting / Fix</option>
                    <option value="audio">Audio</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Description & paramètres d'entrée (notes pour Claude)</label>
                <input
                  className="input"
                  value={wfDesc}
                  onChange={(e) => setWfDesc(e.target.value)}
                  placeholder="Ex : Node 3 = prompt positif, Node 5 = seed..."
                />
              </div>
              <div className="field">
                <label>Workflow JSON (format API ComfyUI)</label>
                <textarea
                  className="textarea"
                  style={{ fontFamily: 'var(--font-mono)', minHeight: 110 }}
                  value={wfJsonStr}
                  onChange={(e) => setWfJsonStr(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewWf(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Enregistrer le workflow
                </button>
              </div>
            </form>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
            {workflows.map((wf) => (
              <div key={wf.id} className="panel-card">
                <div className="rule-row-top">
                  <strong>{wf.name}</strong>
                  <span className="pill-tag">v{wf.version} · {wf.category}</span>
                </div>
                {wf.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {wf.description}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={() => onCopyText(wf.handle, 'Référence workflow')}
                  >
                    <Copy size={11} /> {wf.handle}
                  </button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        onCopyText(JSON.stringify(wf.workflowJson, null, 2), 'JSON workflow')
                      }
                    >
                      Copier JSON
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await api.deleteComfyWorkflow(wf.id);
                        await loadLibrary();
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  ProjectDto,
  ProjectRulesBundle,
  ResolvedProjectRule,
  RulebookDto,
  RuleCategory,
  RuleSeverity,
} from '@videostudio/shared';
import { api } from '../api/client';

interface RulesPanelProps {
  project: ProjectDto | null;
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  anatomy: 'Anatomie',
  style: 'Style & DA',
  framing: 'Cadrage',
  prompt_positive: 'Prompt +',
  prompt_negative: 'Prompt -',
  audio: 'Audio',
  editing: 'Montage',
  youtube: 'YouTube',
};

const SEVERITY_LABELS: Record<RuleSeverity, string> = {
  mandatory: 'Obligatoire',
  recommended: 'Recommandé',
  forbidden: 'Interdit',
};

export function RulesPanel({
  project,
  refreshSignal,
  onCopyText,
  onNotify,
}: RulesPanelProps) {
  const [rulebooks, setRulebooks] = useState<RulebookDto[]>([]);
  const [bundle, setBundle] = useState<ProjectRulesBundle | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Override editor fields
  const [ovValue, setOvValue] = useState('');
  const [ovInstruction, setOvInstruction] = useState('');
  const [ovPosFrag, setOvPosFrag] = useState('');
  const [ovNegFrag, setOvNegFrag] = useState('');

  // Quick create forms
  const [showNewPack, setShowNewPack] = useState(false);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDesc, setNewPackDesc] = useState('');

  const [showNewRule, setShowNewRule] = useState(false);
  const [ruleTarget, setRuleTarget] = useState<'project' | string>('project');
  const [ruleCode, setRuleCode] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleCategory, setRuleCategory] = useState<RuleCategory>('anatomy');
  const [ruleSeverity, setRuleSeverity] = useState<RuleSeverity>('mandatory');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleInstruction, setRuleInstruction] = useState('');
  const [rulePosFrag, setRulePosFrag] = useState('');
  const [ruleNegFrag, setRuleNegFrag] = useState('');

  const loadData = async () => {
    const books = await api.listRulebooks();
    setRulebooks(books);
    if (project) {
      const b = await api.getProjectRules(project.id);
      setBundle(b);
    } else {
      setBundle(null);
    }
  };

  useEffect(() => {
    void loadData().catch(() => undefined);
  }, [project?.id, refreshSignal]);

  const toggleRulebookOnProject = async (rulebookId: string) => {
    if (!project || !bundle) return;
    const exists = bundle.attachedRulebookIds.includes(rulebookId);
    const nextIds = exists
      ? bundle.attachedRulebookIds.filter((id) => id !== rulebookId)
      : [...bundle.attachedRulebookIds, rulebookId];
    const updated = await api.setProjectRulebooks(project.id, nextIds);
    setBundle(updated);
    onNotify(exists ? 'Pack retiré du projet' : 'Pack attaché au projet');
  };

  const openOverrideEditor = (rule: ResolvedProjectRule) => {
    setEditingRuleId(rule.ruleId);
    setOvValue(rule.value);
    setOvInstruction(rule.instruction);
    setOvPosFrag(rule.positiveFragment);
    setOvNegFrag(rule.negativeFragment);
  };

  const saveOverride = async (ruleId: string) => {
    if (!project) return;
    const updated = await api.upsertProjectRuleOverride(project.id, ruleId, {
      valueOverride: ovValue,
      instructionOverride: ovInstruction,
      positiveFragmentOverride: ovPosFrag,
      negativeFragmentOverride: ovNegFrag,
    });
    setBundle(updated);
    setEditingRuleId(null);
    onNotify('Surcharge enregistrée pour ce projet');
  };

  const toggleRuleEnabled = async (rule: ResolvedProjectRule) => {
    if (!project) return;
    const updated = await api.upsertProjectRuleOverride(project.id, rule.ruleId, {
      enabledOverride: !rule.enabled,
    });
    setBundle(updated);
  };

  const resetOverride = async (ruleId: string) => {
    if (!project) return;
    const updated = await api.clearProjectRuleOverride(project.id, ruleId);
    setBundle(updated);
    setEditingRuleId(null);
    onNotify('Surcharge réinitialisée (valeur du pack global restaurée)');
  };

  const handleCreatePack = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPackName.trim()) return;
    await api.createRulebook({
      name: newPackName.trim(),
      description: newPackDesc.trim(),
      isDefault: false,
    });
    setNewPackName('');
    setNewPackDesc('');
    setShowNewPack(false);
    await loadData();
    onNotify('Nouveau pack de règles créé');
  };

  const handleCreateRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!ruleCode.trim() || !ruleTitle.trim() || !ruleInstruction.trim()) return;
    const payload = {
      code: ruleCode.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-'),
      title: ruleTitle.trim(),
      category: ruleCategory,
      severity: ruleSeverity,
      defaultValue: ruleValue.trim(),
      instruction: ruleInstruction.trim(),
      positiveFragment: rulePosFrag.trim(),
      negativeFragment: ruleNegFrag.trim(),
      enabled: true,
      sortOrder: 10,
    };

    if (ruleTarget === 'project' && project) {
      await api.addProjectCustomRule(project.id, payload);
    } else if (ruleTarget !== 'project') {
      await api.addRuleToRulebook(ruleTarget, payload);
    }

    setRuleCode('');
    setRuleTitle('');
    setRuleValue('');
    setRuleInstruction('');
    setRulePosFrag('');
    setRuleNegFrag('');
    setShowNewRule(false);
    await loadData();
    onNotify('Règle ajoutée');
  };

  return (
    <div className="panel-workspace">
      <div className="panel-split">
        {/* Left: Global Rulebooks Library */}
        <div className="panel-card">
          <div className="section-label">
            <span>Packs de règles globaux</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowNewPack((v) => !v)}
            >
              <Plus size={13} /> Pack
            </button>
          </div>

          {showNewPack && (
            <form onSubmit={(e) => void handleCreatePack(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="input"
                placeholder="Ex : Anatomie Cartoon"
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Description..."
                value={newPackDesc}
                onChange={(e) => setNewPackDesc(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Créer le pack
              </button>
            </form>
          )}

          {rulebooks.map((book) => {
            const attached = bundle?.attachedRulebookIds.includes(book.id) ?? false;
            return (
              <div key={book.id} className="rule-row">
                <div className="rule-row-top">
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: project ? 'pointer' : 'default',
                      fontWeight: 500,
                    }}
                  >
                    {project && (
                      <input
                        type="checkbox"
                        checked={attached}
                        onChange={() => void toggleRulebookOnProject(book.id)}
                      />
                    )}
                    <span>{book.name}</span>
                  </label>
                  <span className="pill-tag">{book.rules.length} règle(s)</span>
                </div>
                {book.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {book.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Resolved Active Rules for Selected Project */}
        <div className="panel-card">
          <div className="rule-row-top">
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <ShieldCheck size={16} color="var(--accent-amber)" />
                {project
                  ? `Règles actives — ${project.name}`
                  : 'Sélectionne un projet pour personnaliser ses règles'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                Exposé à Claude Code via <code>get_active_rules</code> et{' '}
                <code>studio://projects/{project?.slug ?? '...'}/rules</code>. Chaque règle globale
                peut être surchargée ici (ex. 5 doigts → 4 doigts).
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowNewRule((v) => !v)}
            >
              <Plus size={13} /> Nouvelle règle
            </button>
          </div>

          {showNewRule && (
            <form
              onSubmit={(e) => void handleCreateRule(e)}
              className="rule-row"
              style={{ gap: 10 }}
            >
              <div className="field-grid">
                <div className="field">
                  <label>Portée</label>
                  <select
                    className="select"
                    value={ruleTarget}
                    onChange={(e) => setRuleTarget(e.target.value)}
                  >
                    {project && <option value="project">Uniquement ce projet ({project.name})</option>}
                    {rulebooks.map((rb) => (
                      <option key={rb.id} value={rb.id}>
                        Pack global : {rb.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Code court</label>
                  <input
                    className="input"
                    required
                    placeholder="ex: hands-fingers"
                    value={ruleCode}
                    onChange={(e) => setRuleCode(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-grid">
                <div className="field">
                  <label>Titre</label>
                  <input
                    className="input"
                    required
                    placeholder="Ex : Mains à 4 doigts cartoon"
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Valeur courte</label>
                  <input
                    className="input"
                    placeholder="Ex : 4 doigts"
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-grid">
                <div className="field">
                  <label>Catégorie</label>
                  <select
                    className="select"
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value as RuleCategory)}
                  >
                    {(Object.keys(CATEGORY_LABELS) as RuleCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Sévérité</label>
                  <select
                    className="select"
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value as RuleSeverity)}
                  >
                    {(Object.keys(SEVERITY_LABELS) as RuleSeverity[]).map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Instruction pour Claude Code</label>
                <textarea
                  className="textarea"
                  required
                  value={ruleInstruction}
                  onChange={(e) => setRuleInstruction(e.target.value)}
                  placeholder="Consigne précise que Claude doit respecter..."
                />
              </div>

              <div className="field-grid">
                <div className="field">
                  <label>Fragment prompt positif (optionnel)</label>
                  <input
                    className="input"
                    value={rulePosFrag}
                    onChange={(e) => setRulePosFrag(e.target.value)}
                    placeholder="ex: 4 fingers per hand, cartoon style"
                  />
                </div>
                <div className="field">
                  <label>Fragment prompt négatif (optionnel)</label>
                  <input
                    className="input"
                    value={ruleNegFrag}
                    onChange={(e) => setRuleNegFrag(e.target.value)}
                    placeholder="ex: 5 fingers, extra fingers"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewRule(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Enregistrer la règle
                </button>
              </div>
            </form>
          )}

          {bundle && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bundle.resolvedRules.map((rule) => (
                  <div
                    key={rule.ruleId}
                    className={`rule-row ${rule.isOverridden ? 'overridden' : ''} ${
                      !rule.enabled ? 'disabled' : ''
                    }`}
                  >
                    <div className="rule-row-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => void toggleRuleEnabled(rule)}
                          title="Activer / désactiver pour ce projet"
                        />
                        <strong>{rule.title}</strong>
                        {rule.value && <span className="pill-tag amber">{rule.value}</span>}
                        <span className="pill-tag">{CATEGORY_LABELS[rule.category]}</span>
                        <span
                          className={`pill-tag ${
                            rule.severity === 'forbidden'
                              ? 'red'
                              : rule.severity === 'mandatory'
                                ? 'green'
                                : ''
                          }`}
                        >
                          {SEVERITY_LABELS[rule.severity]}
                        </span>
                        {rule.isOverridden && <span className="pill-tag amber">Surchargé projet</span>}
                        {rule.source === 'project_custom' && (
                          <span className="pill-tag blue">Spécifique projet</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {rule.source !== 'project_custom' ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openOverrideEditor(rule)}
                            >
                              Surcharger
                            </button>
                            {rule.isOverridden && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                title="Réinitialiser à la valeur du pack global"
                                onClick={() => void resetOverride(rule.ruleId)}
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={async () => {
                              await api.deleteRule(rule.ruleId);
                              await loadData();
                            }}
                            title="Supprimer cette règle projet"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {rule.instruction}
                    </div>

                    {(rule.positiveFragment || rule.negativeFragment) && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 10,
                          flexWrap: 'wrap',
                          fontSize: 11.5,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {rule.positiveFragment && (
                          <span style={{ color: 'var(--status-approved)' }}>
                            + {rule.positiveFragment}
                          </span>
                        )}
                        {rule.negativeFragment && (
                          <span style={{ color: 'var(--status-danger)' }}>
                            − {rule.negativeFragment}
                          </span>
                        )}
                      </div>
                    )}

                    {editingRuleId === rule.ruleId && (
                      <div
                        style={{
                          marginTop: 6,
                          paddingTop: 10,
                          borderTop: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div className="field">
                          <label>Valeur spécifique pour ce projet (ex : 4 doigts)</label>
                          <input
                            className="input"
                            value={ovValue}
                            onChange={(e) => setOvValue(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Instruction surchargée pour Claude</label>
                          <textarea
                            className="textarea"
                            value={ovInstruction}
                            onChange={(e) => setOvInstruction(e.target.value)}
                          />
                        </div>
                        <div className="field-grid">
                          <div className="field">
                            <label>Fragment prompt + surchargé</label>
                            <input
                              className="input"
                              value={ovPosFrag}
                              onChange={(e) => setOvPosFrag(e.target.value)}
                            />
                          </div>
                          <div className="field">
                            <label>Fragment prompt − surchargé</label>
                            <input
                              className="input"
                              value={ovNegFrag}
                              onChange={(e) => setOvNegFrag(e.target.value)}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingRuleId(null)}
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void saveOverride(rule.ruleId)}
                          >
                            Appliquer à ce projet
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Compiled Prompt Fragments Preview */}
              {(bundle.mergedPositiveFragments || bundle.mergedNegativeFragments) && (
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div className="section-label">
                    <span>Fragments compilés injectables automatiquement</span>
                  </div>
                  {bundle.mergedPositiveFragments && (
                    <div>
                      <div className="section-label">
                        <span style={{ color: 'var(--status-approved)' }}>Positif (+)</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            onCopyText(bundle.mergedPositiveFragments, 'Fragments positifs')
                          }
                        >
                          <Copy size={11} /> Copier
                        </button>
                      </div>
                      <div className="prompt-box">{bundle.mergedPositiveFragments}</div>
                    </div>
                  )}
                  {bundle.mergedNegativeFragments && (
                    <div>
                      <div className="section-label">
                        <span style={{ color: 'var(--status-danger)' }}>Négatif (−)</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            onCopyText(bundle.mergedNegativeFragments, 'Fragments négatifs')
                          }
                        >
                          <Copy size={11} /> Copier
                        </button>
                      </div>
                      <div className="prompt-box">{bundle.mergedNegativeFragments}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

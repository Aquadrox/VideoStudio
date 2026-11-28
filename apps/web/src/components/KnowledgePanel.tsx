import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRightCircle,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  Copy,
  Edit3,
  Lightbulb,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_PROJECT_TYPE_LABELS,
  type KnowledgeKind,
  type KnowledgePriority,
  type KnowledgeProjectType,
  type ProjectDto,
  type ProjectPlaybookDto,
  type SkillDto,
  type StudioKnowledgeEntryDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/format';

interface KnowledgePanelProps {
  activeProject: ProjectDto | null;
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

const ALL_PROJECT_TYPES: KnowledgeProjectType[] = [
  'all',
  'youtube_long',
  'youtube_short',
  'music_video',
  'animation',
  'commercial',
  'experimental',
];

const ALL_KINDS: KnowledgeKind[] = ['rule', 'prompt', 'skill', 'lesson', 'preset'];

const PRIORITY_LABELS: Record<KnowledgePriority, string> = {
  critical: 'Critique',
  high: 'Haute',
  normal: 'Normale',
  low: 'Basse',
};

const CLAUDE_MEMORY_SNIPPET = `## Mémoire Commune VideoStudio (Apprentissage continu via MCP)
- Au démarrage d'un projet (ou après \`create_project\`), appelle systématiquement \`recall_project_playbook(project)\` pour charger toutes les règles, prompts validés, presets ComfyUI, skills et leçons apprises pour ce type de projet.
- Dès qu'une recette de prompt, un réglage ComfyUI (CFG/steps/modèle/LoRA), une règle de cohérence ou une erreur à éviter est validé avec l'utilisateur, enregistre-le dans la mémoire commune avec \`learn_studio_knowledge(...)\` en ciblant les bons \`projectTypes\` (\`["all"]\` ou \`["animation", "music_video"]\`, etc.).`;

export function KnowledgePanel({
  activeProject,
  refreshSignal,
  onCopyText,
  onNotify,
}: KnowledgePanelProps) {
  const [subTab, setSubTab] = useState<'memory' | 'playbook' | 'mcp'>('memory');
  const [entries, setEntries] = useState<StudioKnowledgeEntryDto[]>([]);
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState<KnowledgeProjectType | 'every'>('every');
  const [filterKind, setFilterKind] = useState<KnowledgeKind | 'all'>('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [search, setSearch] = useState('');

  // Playbook preview state
  const [playbookType, setPlaybookType] = useState<KnowledgeProjectType>(
    activeProject?.type ?? 'all',
  );
  const [playbook, setPlaybook] = useState<ProjectPlaybookDto | null>(null);
  const [loadingPlaybook, setLoadingPlaybook] = useState(false);

  // Create / Edit modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fSlug, setFSlug] = useState('');
  const [fKind, setFKind] = useState<KnowledgeKind>('rule');
  const [fTypes, setFTypes] = useState<KnowledgeProjectType[]>(['all']);
  const [fPriority, setFPriority] = useState<KnowledgePriority>('high');
  const [fContent, setFContent] = useState('');
  const [fPos, setFPos] = useState('');
  const [fNeg, setFNeg] = useState('');
  const [fModel, setFModel] = useState('');
  const [fSkillSlug, setFSkillSlug] = useState('');
  const [fTags, setFTags] = useState('');
  const [fVerified, setFVerified] = useState(true);
  const [fPinned, setFPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeProject?.type) {
      setPlaybookType(activeProject.type);
    }
  }, [activeProject?.id, activeProject?.type]);

  const loadData = useCallback(async () => {
    try {
      const [list, skillList] = await Promise.all([
        api.listKnowledge({
          projectType: filterType === 'every' ? undefined : filterType,
          kind: filterKind === 'all' ? undefined : filterKind,
          search: search.trim() || undefined,
          verifiedOnly,
        }),
        api.listSkills(activeProject?.id).catch(() => [] as SkillDto[]),
      ]);
      setEntries(list);
      setSkills(skillList);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, [filterType, filterKind, search, verifiedOnly, activeProject?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshSignal]);

  const loadPlaybook = useCallback(async () => {
    setLoadingPlaybook(true);
    try {
      const pb = await api.getProjectPlaybook({
        projectIdOrSlug:
          activeProject && activeProject.type === playbookType ? activeProject.id : undefined,
        projectType: playbookType,
      });
      setPlaybook(pb);
    } catch {
      setPlaybook(null);
    } finally {
      setLoadingPlaybook(false);
    }
  }, [playbookType, activeProject]);

  useEffect(() => {
    if (subTab === 'playbook') {
      void loadPlaybook();
    }
  }, [subTab, loadPlaybook, refreshSignal]);

  const stats = useMemo(() => {
    const aiLearned = entries.filter((e) => e.learnedBy === 'claude').length;
    const verified = entries.filter((e) => e.verified).length;
    const totalRecalls = entries.reduce((acc, e) => acc + e.usageCount, 0);
    return { total: entries.length, aiLearned, verified, totalRecalls };
  }, [entries]);

  const openCreateForm = (defaultKind: KnowledgeKind = 'rule') => {
    setEditingId(null);
    setFTitle('');
    setFSlug('');
    setFKind(defaultKind);
    setFTypes(activeProject ? [activeProject.type] : ['all']);
    setFPriority('high');
    setFContent('');
    setFPos('');
    setFNeg('');
    setFModel('');
    setFSkillSlug('');
    setFTags('');
    setFVerified(true);
    setFPinned(false);
    setShowForm(true);
  };

  const openEditForm = (entry: StudioKnowledgeEntryDto) => {
    setEditingId(entry.id);
    setFTitle(entry.title);
    setFSlug(entry.slug);
    setFKind(entry.kind);
    setFTypes(entry.projectTypes.length > 0 ? entry.projectTypes : ['all']);
    setFPriority(entry.priority);
    setFContent(entry.content);
    setFPos(entry.positiveFragment);
    setFNeg(entry.negativeFragment);
    setFModel(entry.recommendedModel);
    setFSkillSlug(entry.linkedSkillSlug ?? '');
    setFTags(entry.tags.join(', '));
    setFVerified(entry.verified);
    setFPinned(entry.pinned);
    setShowForm(true);
  };

  const toggleProjectTypeSelection = (pt: KnowledgeProjectType) => {
    setFTypes((prev) => {
      if (pt === 'all') return ['all'];
      const withoutAll = prev.filter((x) => x !== 'all');
      if (withoutAll.includes(pt)) {
        const next = withoutAll.filter((x) => x !== pt);
        return next.length > 0 ? next : ['all'];
      }
      return [...withoutAll, pt];
    });
  };

  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!fTitle.trim() || !fContent.trim()) return;
    setSaving(true);
    try {
      const tags = fTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.upsertKnowledge({
        id: editingId ?? undefined,
        slug: fSlug.trim() || undefined,
        title: fTitle.trim(),
        kind: fKind,
        projectTypes: fTypes,
        priority: fPriority,
        content: fContent.trim(),
        positiveFragment: fPos.trim(),
        negativeFragment: fNeg.trim(),
        recommendedModel: fModel.trim(),
        linkedSkillSlug: fSkillSlug.trim() || null,
        tags,
        verified: fVerified,
        pinned: fPinned,
        sourceProjectSlug: activeProject?.slug ?? null,
      });
      setShowForm(false);
      await loadData();
      onNotify(
        res.created
          ? `Connaissance ajoutée à la Mémoire Studio : ${res.entry.title}`
          : `Connaissance mise à jour : ${res.entry.title}`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde connaissance');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVerify = async (entry: StudioKnowledgeEntryDto) => {
    try {
      await api.updateKnowledge(entry.id, { verified: !entry.verified });
      await loadData();
      onNotify(entry.verified ? 'Marquée comme non vérifiée' : 'Connaissance validée ✓');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur mise à jour');
    }
  };

  const handleTogglePin = async (entry: StudioKnowledgeEntryDto) => {
    try {
      await api.updateKnowledge(entry.id, { pinned: !entry.pinned });
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur mise à jour');
    }
  };

  const handleDelete = async (entry: StudioKnowledgeEntryDto) => {
    try {
      await api.deleteKnowledge(entry.id);
      await loadData();
      onNotify(`Supprimée de la mémoire commune : ${entry.title}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur suppression');
    }
  };

  const handleApplyToActiveProject = async (entry: StudioKnowledgeEntryDto) => {
    if (!activeProject) return;
    try {
      await api.applyKnowledgeToProject(entry.id, activeProject.id);
      await loadData();
      onNotify(`Appliquée dans les Règles de « ${activeProject.name} » !`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur application au projet');
    }
  };

  const renderKindIcon = (kind: KnowledgeKind) => {
    switch (kind) {
      case 'rule':
        return <ShieldCheck size={13} color="var(--accent-amber)" />;
      case 'prompt':
        return <Sparkles size={13} color="#38bdf8" />;
      case 'skill':
        return <BookOpen size={13} color="#a78bfa" />;
      case 'preset':
        return <Sliders size={13} color="#34d399" />;
      case 'lesson':
      default:
        return <Lightbulb size={13} color="#fbbf24" />;
    }
  };

  return (
    <div className="panel-workspace knowledge-workspace">
      {/* Header Banner */}
      <div className="knowledge-hero-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="knowledge-hero-icon">
            <Brain size={19} color="var(--accent-amber)" />
          </div>
          <div>
            <h2 className="stage-title" style={{ margin: 0 }}>
              Mémoire IA &amp; Base de Connaissances Commune
            </h2>
            <p className="stage-subtitle" style={{ margin: '2px 0 0' }}>
              Pérennise les règles, prompts, skills, presets et leçons par type de projet — rappelés
              automatiquement par Claude Code via MCP pour apprendre au fil des projets.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="knowledge-kpi-row">
            <span className="pill-tag">{stats.total} fiches</span>
            <span className="pill-tag">{stats.verified} vérifiées</span>
            <span className="pill-tag">{stats.aiLearned} apprises par IA</span>
            <span className="pill-tag">{stats.totalRecalls}× rappelées</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateForm('rule')}>
            <Plus size={13} /> Nouvelle connaissance
          </button>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className={`chip ${subTab === 'memory' ? 'active' : ''}`}
          onClick={() => setSubTab('memory')}
        >
          <Brain size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Base Commune ({entries.length})
        </button>
        <button
          type="button"
          className={`chip ${subTab === 'playbook' ? 'active' : ''}`}
          onClick={() => setSubTab('playbook')}
        >
          <BookOpen size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Playbook par Type de Projet (Rappel IA)
        </button>
        <button
          type="button"
          className={`chip ${subTab === 'mcp' ? 'active' : ''}`}
          onClick={() => setSubTab('mcp')}
        >
          <Terminal size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Apprentissage continu MCP
        </button>
      </div>

      {/* TAB 1: Shared Knowledge Base */}
      {subTab === 'memory' && (
        <>
          <div className="knowledge-filters-card">
            <div className="knowledge-filter-row">
              <div className="search-input-wrap" style={{ flex: '1 1 220px', maxWidth: 340 }}>
                <Search size={13} color="var(--text-muted)" />
                <input
                  className="input"
                  placeholder="Rechercher règle, prompt, modèle, tag..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`chip-btn ${filterKind === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterKind('all')}
                >
                  Toutes catégories
                </button>
                {ALL_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip-btn ${filterKind === k ? 'active' : ''}`}
                    onClick={() => setFilterKind(k)}
                  >
                    {KNOWLEDGE_KIND_LABELS[k]}
                  </button>
                ))}
              </div>

              <label className="dossier-check" style={{ marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                />
                <span>Vérifiées uniquement</span>
              </label>
            </div>

            <div className="knowledge-filter-row" style={{ gap: 5 }}>
              <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>
                Type de projet :
              </span>
              <button
                type="button"
                className={`chip-btn ${filterType === 'every' ? 'active' : ''}`}
                onClick={() => setFilterType('every')}
              >
                Tout afficher
              </button>
              {ALL_PROJECT_TYPES.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  className={`chip-btn ${filterType === pt ? 'active' : ''}`}
                  onClick={() => setFilterType(pt)}
                >
                  {pt === 'all' ? 'Global (tous)' : KNOWLEDGE_PROJECT_TYPE_LABELS[pt]}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <p>Chargement de la mémoire commune...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="empty-state">
              <Brain size={30} color="var(--text-muted)" />
              <p>Aucune connaissance trouvée pour ces filtres.</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateForm('lesson')}>
                <Plus size={13} /> Ajouter une règle ou leçon
              </button>
            </div>
          ) : (
            <div className="knowledge-grid">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className={`knowledge-card ${entry.pinned ? 'pinned' : ''} priority-${entry.priority}`}
                >
                  <div className="knowledge-card-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="knowledge-kind-badge">
                        {renderKindIcon(entry.kind)}
                        {KNOWLEDGE_KIND_LABELS[entry.kind]}
                      </span>
                      <span className={`knowledge-priority-badge priority-${entry.priority}`}>
                        {PRIORITY_LABELS[entry.priority]}
                      </span>
                      {entry.learnedBy === 'claude' && (
                        <span className="knowledge-ai-badge" title="Appris et enregistré par Claude Code via MCP">
                          <Bot size={11} /> Appris par IA
                        </span>
                      )}
                      {entry.verified && (
                        <span className="knowledge-verified-badge" title="Validé par l'humain">
                          <CheckCircle2 size={11} /> Vérifié
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => void handleTogglePin(entry)}
                        title={entry.pinned ? 'Désépingler' : 'Épingler en priorité dans le rappel IA'}
                        style={entry.pinned ? { borderColor: 'var(--accent-amber)', color: 'var(--accent-amber)' } : undefined}
                      >
                        <Pin size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => void handleToggleVerify(entry)}
                        title={entry.verified ? 'Retirer la validation' : 'Valider cette connaissance'}
                        style={entry.verified ? { borderColor: '#34d399', color: '#34d399' } : undefined}
                      >
                        <CheckCircle2 size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => openEditForm(entry)}
                        title="Modifier"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => void handleDelete(entry)}
                        title="Supprimer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <h3 className="knowledge-card-title">{entry.title}</h3>
                  <p className="knowledge-card-content">{entry.content}</p>

                  {(entry.positiveFragment || entry.negativeFragment || entry.recommendedModel || entry.linkedSkillSlug) && (
                    <div className="knowledge-fragments">
                      {entry.recommendedModel && (
                        <div className="knowledge-frag-line">
                          <span className="muted">Modèle :</span> <code>{entry.recommendedModel}</code>
                        </div>
                      )}
                      {entry.positiveFragment && (
                        <div className="knowledge-frag-line pos">
                          <span>+</span> <code>{entry.positiveFragment}</code>
                        </div>
                      )}
                      {entry.negativeFragment && (
                        <div className="knowledge-frag-line neg">
                          <span>−</span> <code>{entry.negativeFragment}</code>
                        </div>
                      )}
                      {entry.linkedSkillSlug && (
                        <div className="knowledge-frag-line">
                          <span className="muted">Skill :</span> <code>{entry.linkedSkillSlug}</code>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="knowledge-card-foot">
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {entry.projectTypes.map((pt) => (
                        <span key={pt} className="pill-tag">
                          {pt === 'all' ? 'Global' : KNOWLEDGE_PROJECT_TYPE_LABELS[pt]}
                        </span>
                      ))}
                      {entry.tags.slice(0, 4).map((t) => (
                        <span key={t} className="knowledge-tag">
                          #{t}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <span className="muted" style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
                        {entry.usageCount}× rappelé · {formatRelativeTime(entry.updatedAt)}
                      </span>
                      {activeProject && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleApplyToActiveProject(entry)}
                          title={`Injecter cette connaissance dans les règles actives de "${activeProject.name}"`}
                        >
                          <ArrowRightCircle size={12} /> Appliquer au projet
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 2: Compiled Playbook Recall Preview */}
      {subTab === 'playbook' && (
        <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="section-label" style={{ margin: 0 }}>
                Simuler le rappel IA pour le type de projet :
              </span>
              <select
                className="select"
                value={playbookType}
                onChange={(e) => setPlaybookType(e.target.value as KnowledgeProjectType)}
              >
                {ALL_PROJECT_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {KNOWLEDGE_PROJECT_TYPE_LABELS[pt]}
                  </option>
                ))}
              </select>
            </div>

            {playbook && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onCopyText(playbook.compiledBrief, 'Playbook Studio')}
              >
                <Copy size={13} /> Copier le Playbook complet
              </button>
            )}
          </div>

          {loadingPlaybook || !playbook ? (
            <p className="muted">Compilation du Playbook en cours...</p>
          ) : (
            <>
              <div className="knowledge-playbook-stats">
                <div className="knowledge-stat-box">
                  <span className="muted">Connaissances rappelées</span>
                  <strong>{playbook.totalEntries}</strong>
                </div>
                <div className="knowledge-stat-box">
                  <span className="muted">Rulebooks globaux</span>
                  <strong>{playbook.rulebooks.length}</strong>
                </div>
                <div className="knowledge-stat-box">
                  <span className="muted">Templates Prompts</span>
                  <strong>{playbook.promptTemplates.length}</strong>
                </div>
                <div className="knowledge-stat-box">
                  <span className="muted">Workflows ComfyUI</span>
                  <strong>{playbook.comfyWorkflows.length}</strong>
                </div>
                <div className="knowledge-stat-box">
                  <span className="muted">Skills (SKILL.md)</span>
                  <strong>{playbook.skills.length}</strong>
                </div>
              </div>

              <pre className="knowledge-brief-pre">{playbook.compiledBrief}</pre>
            </>
          )}
        </div>
      )}

      {/* TAB 3: MCP Continuous Learning Guide */}
      {subTab === 'mcp' && (
        <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="section-label">
            <span>Comment Claude Code apprend &amp; rappelle ta mémoire studio (MCP)</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Dès que Claude Code crée un nouveau projet (<code>create_project</code>) ou démarre une
            session (<code>recall_project_playbook</code>), VideoStudio lui transmet automatiquement
            toutes les règles, prompts, skills, presets et retours d&apos;expérience correspondant au
            type du projet. Lorsqu&apos;il découvre une nouvelle bonne pratique, il l&apos;enregistre
            via <code>learn_studio_knowledge</code> — tu peux ensuite la relire, l&apos;éditer,
            l&apos;épingler ou la valider ici.
          </p>

          <div className="knowledge-mcp-tools-grid">
            <div className="rule-row">
              <strong><code>recall_project_playbook(project?, projectType?)</code></strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Rappelle tout le savoir studio applicable + Rulebooks + Prompts + Workflows + Skills en 1 appel.
              </span>
            </div>
            <div className="rule-row">
              <strong><code>learn_studio_knowledge(title, kind, projectTypes, content, ...)</code></strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Enregistre ou affine une règle, un prompt validé, un skill, un preset ou une leçon (idempotent par slug).
              </span>
            </div>
            <div className="rule-row">
              <strong><code>studio://knowledge</code> &amp; <code>studio://playbooks/&#123;projectType&#125;</code></strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Ressources MCP lisibles directement par Claude Code à tout moment.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="section-label" style={{ margin: 0 }}>
              Snippet recommandé à ajouter dans ton CLAUDE.md
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onCopyText(CLAUDE_MEMORY_SNIPPET, 'Snippet CLAUDE.md')}
            >
              <Copy size={12} /> Copier pour CLAUDE.md
            </button>
          </div>
          <pre className="knowledge-brief-pre">{CLAUDE_MEMORY_SNIPPET}</pre>
        </div>
      )}

      {/* Create / Edit Knowledge Modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div
            className="modal-card"
            style={{ width: 'min(680px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Brain size={16} color="var(--accent-amber)" />
                {editingId ? 'Modifier la connaissance' : 'Nouvelle connaissance commune'}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitForm(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>Titre *</label>
                  <input
                    className="input"
                    required
                    value={fTitle}
                    onChange={(e) => setFTitle(e.target.value)}
                    placeholder="Ex: Wan 2.1 I2V — CFG 5.5 pour préserver les visages"
                  />
                </div>
                <div className="field">
                  <label>Catégorie</label>
                  <select className="select" value={fKind} onChange={(e) => setFKind(e.target.value as KnowledgeKind)}>
                    {ALL_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KNOWLEDGE_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Priorité</label>
                  <select
                    className="select"
                    value={fPriority}
                    onChange={(e) => setFPriority(e.target.value as KnowledgePriority)}
                  >
                    <option value="critical">Critique</option>
                    <option value="high">Haute</option>
                    <option value="normal">Normale</option>
                    <option value="low">Basse</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Types de projets concernés</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ALL_PROJECT_TYPES.map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      className={`chip-btn ${fTypes.includes(pt) ? 'active' : ''}`}
                      onClick={() => toggleProjectTypeSelection(pt)}
                    >
                      {pt === 'all' ? 'Global (tous les projets)' : KNOWLEDGE_PROJECT_TYPE_LABELS[pt]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Instruction / Recette / Leçon apprise *</label>
                <textarea
                  className="textarea"
                  rows={4}
                  required
                  value={fContent}
                  onChange={(e) => setFContent(e.target.value)}
                  placeholder="Décris la règle, la procédure ou le retour d'expérience que l'IA devra appliquer sur les prochains projets..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>Fragment Prompt Positif (+) optionnel</label>
                  <input
                    className="input"
                    value={fPos}
                    onChange={(e) => setFPos(e.target.value)}
                    placeholder="cinematic lighting, consistent face..."
                  />
                </div>
                <div className="field">
                  <label>Fragment Prompt Négatif (−) optionnel</label>
                  <input
                    className="input"
                    value={fNeg}
                    onChange={(e) => setFNeg(e.target.value)}
                    placeholder="extra fingers, blurry, watermark..."
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>Modèle / LoRA recommandé</label>
                  <input
                    className="input"
                    value={fModel}
                    onChange={(e) => setFModel(e.target.value)}
                    placeholder="flux1-dev / wan2.1..."
                  />
                </div>
                <div className="field">
                  <label>Skill associé (optionnel)</label>
                  <select className="select" value={fSkillSlug} onChange={(e) => setFSkillSlug(e.target.value)}>
                    <option value="">Aucun</option>
                    {skills.map((sk) => (
                      <option key={sk.id} value={sk.slug}>
                        {sk.slug} — {sk.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Tags (séparés par virgules)</label>
                  <input
                    className="input"
                    value={fTags}
                    onChange={(e) => setFTags(e.target.value)}
                    placeholder="comfyui, animation, cfg"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                <div style={{ display: 'flex', gap: 14 }}>
                  <label className="dossier-check">
                    <input type="checkbox" checked={fVerified} onChange={(e) => setFVerified(e.target.checked)} />
                    <span>Validé par l&apos;humain</span>
                  </label>
                  <label className="dossier-check">
                    <input type="checkbox" checked={fPinned} onChange={(e) => setFPinned(e.target.checked)} />
                    <span>Épingler en tête du rappel IA</span>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>
                    Annuler
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? 'Enregistrement...' : editingId ? 'Mettre à jour' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

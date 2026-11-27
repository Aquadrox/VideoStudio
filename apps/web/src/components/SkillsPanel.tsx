import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Copy, History, Plus, Save, Trash2 } from 'lucide-react';
import type { ProjectDto, SkillDto, SkillScope, SkillVersionDto } from '@videostudio/shared';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/format';

interface SkillsPanelProps {
  project: ProjectDto | null;
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

export function SkillsPanel({
  project,
  refreshSignal,
  onCopyText,
  onNotify,
}: SkillsPanelProps) {
  const [skillsList, setSkillsList] = useState<SkillDto[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [versions, setVersions] = useState<SkillVersionDto[]>([]);

  // Editor state
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<SkillScope>('global');
  const [content, setContent] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSkills = async () => {
    const items = await api.listSkills(project?.id);
    setSkillsList(items);
  };

  useEffect(() => {
    void loadSkills().catch(() => undefined);
  }, [project?.id, refreshSignal]);

  const selectSkill = async (skillSlug: string) => {
    setSelectedSlug(skillSlug);
    const detail = await api.getSkillDetail(skillSlug);
    setSlug(detail.skill.slug);
    setName(detail.skill.name);
    setDescription(detail.skill.description);
    setScope(detail.skill.scope);
    setContent(detail.skill.content);
    setSyncEnabled(detail.skill.syncEnabled);
    setChangeSummary('');
    setVersions(detail.versions);
  };

  const startNewSkill = () => {
    setSelectedSlug(null);
    setSlug('');
    setName('');
    setDescription('');
    setScope('global');
    setContent('# Objectif\n\nDécris ici la procédure étape par étape que Claude Code doit appliquer.\n\n## Étapes\n1. Vérifier les règles actives du projet (`get_active_rules`)\n2. Générer un draft basse résolution\n3. Enregistrer via `register_asset`\n');
    setSyncEnabled(true);
    setChangeSummary('Création initiale');
    setVersions([]);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const saved = await api.upsertSkill({
        slug: slug.trim() || undefined,
        name: name.trim(),
        description: description.trim(),
        scope,
        projectId: scope === 'project' ? (project?.id ?? null) : null,
        content,
        syncEnabled,
        changeSummary: changeSummary.trim() || 'Mise à jour depuis VideoStudio',
        author: 'user',
      });
      await loadSkills();
      await selectSkill(saved.slug);
      onNotify(`Skill ${saved.handle} enregistré (v${saved.version})`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur enregistrement skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-workspace">
      <div className="panel-split">
        {/* Left: Skills List */}
        <div className="panel-card">
          <div className="section-label">
            <span>Skills Claude Code ({skillsList.length})</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={startNewSkill}>
              <Plus size={13} /> Skill
            </button>
          </div>

          {skillsList.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Crée des skills réutilisables (<code>SKILL.md</code>) synchronisés sur ton serveur
              local et accessibles à Claude Code via MCP (<code>list_skills</code> /{' '}
              <code>read_skill</code> / <code>save_skill</code>).
            </div>
          )}

          {skillsList.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`project-item ${s.slug === selectedSlug ? 'active' : ''}`}
              onClick={() => void selectSkill(s.slug)}
            >
              <div className="project-item-top">
                <span className="project-item-name">{s.name}</span>
                <span className="pill-tag">v{s.version}</span>
              </div>
              <div className="project-item-meta">
                <span>{s.handle}</span>
                <span>· {s.scope === 'global' ? 'Global' : `Projet`}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Right: SKILL.md Editor & Version History */}
        <div className="panel-card">
          <form onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="rule-row-top">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
                <BookOpen size={16} color="var(--accent-amber)" />
                {selectedSlug ? `Éditer ${name}` : 'Nouveau Skill Claude Code (SKILL.md)'}
              </div>

              {selectedSlug && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={() => onCopyText(`skill://${selectedSlug}`, 'Référence skill')}
                  >
                    <Copy size={11} /> skill://{selectedSlug}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await api.deleteSkill(selectedSlug);
                      startNewSkill();
                      await loadSkills();
                      onNotify('Skill supprimé');
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Nom du skill</label>
                <input
                  className="input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex : Upscale Vidéo Wan 2.2 4K"
                />
              </div>
              <div className="field">
                <label>Slug (dossier SKILL.md)</label>
                <input
                  className="input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto-généré ex: upscale-wan-4k"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Description (utilisée par Claude pour déclencher le skill)</label>
                <input
                  className="input"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Quand et comment Claude doit utiliser ce skill..."
                />
              </div>
              <div className="field">
                <label>Portée</label>
                <select
                  className="select"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as SkillScope)}
                >
                  <option value="global">Global (tous les projets)</option>
                  {project && <option value="project">Projet : {project.name}</option>}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Instructions SKILL.md (Markdown)</label>
              <textarea
                className="textarea"
                required
                style={{ fontFamily: 'var(--font-mono)', minHeight: 220, fontSize: 12.5 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Résumé de la modification (journal de versions)</label>
                <input
                  className="input"
                  value={changeSummary}
                  onChange={(e) => setChangeSummary(e.target.value)}
                  placeholder="Ex : Ajout du paramètre CFG 3.5 pour les mains"
                />
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    paddingBottom: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    onChange={(e) => setSyncEnabled(e.target.checked)}
                  />
                  Synchroniser dans <code>/skills/&lt;slug&gt;/SKILL.md</code>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save size={14} /> {saving ? 'Enregistrement...' : 'Enregistrer nouvelle version'}
              </button>
            </div>
          </form>

          {versions.length > 0 && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 12,
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div className="section-label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <History size={12} /> Historique des versions ({versions.length})
                </span>
              </div>
              {versions.map((v) => (
                <div key={v.id} className="rule-row">
                  <div className="rule-row-top">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      <strong>v{v.version}</strong> · {v.author} · {formatRelativeTime(v.createdAt)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setContent(v.content);
                        setChangeSummary(`Restauré depuis v${v.version}`);
                        onNotify(`Contenu v${v.version} chargé dans l'éditeur`);
                      }}
                    >
                      Charger dans l'éditeur
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {v.changeSummary}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Activity,
  BookOpen,
  Clapperboard,
  Columns2,
  Copy,
  FileText,
  FolderPlus,
  GitBranch,
  Layers,
  Music,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Upload,
  Youtube,
} from 'lucide-react';
import type {
  ActivityDto,
  AssetDto,
  AssetStatus,
  AssetType,
  CreateProjectInput,
  JobDto,
  ProjectDto,
  QualityTier,
  RealtimeEvent,
} from '@videostudio/shared';
import { api, type AssetLineage, type HealthResponse } from './api/client';
import { ActivityFeed } from './components/ActivityFeed';
import { AssetCard } from './components/AssetCard';
import { AssetInspector } from './components/AssetInspector';
import { AudioPanel } from './components/AudioPanel';
import { CompareView } from './components/CompareView';
import { LibraryPanel } from './components/LibraryPanel';
import { CreateProjectModal, McpSetupModal } from './components/Modals';
import { PreprodPanel } from './components/PreprodPanel';
import { ProjectGitPanel } from './components/ProjectGitPanel';
import { RulesPanel } from './components/RulesPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { YouTubePanel } from './components/YouTubePanel';
import { useRealtimeEvents } from './hooks/useRealtime';
import { copyToClipboard, QUALITY_TIER_LABELS, STATUS_LABELS } from './utils/format';

type WorkspaceMode =
  | 'media'
  | 'preprod'
  | 'audio'
  | 'compare'
  | 'rules'
  | 'library'
  | 'skills'
  | 'youtube'
  | 'git';

export function App() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('media');
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedLineage, setSelectedLineage] = useState<AssetLineage | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string | null; rightId: string | null }>({
    leftId: null,
    rightId: null,
  });

  const [activities, setActivities] = useState<ActivityDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [annotationRefresh, setAnnotationRefresh] = useState(0);
  const [rulesRefresh, setRulesRefresh] = useState(0);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [skillsRefresh, setSkillsRefresh] = useState(0);
  const [stage3Refresh, setStage3Refresh] = useState(0);

  const [rightTab, setRightTab] = useState<'inspector' | 'activity'>('inspector');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<QualityTier | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [showNewProject, setShowNewProject] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 2600);
  }, []);

  const handleCopyText = useCallback(
    (text: string, label = 'Référence') => {
      void copyToClipboard(text).then((ok) => {
        showToast(ok ? `${label} copiée` : 'Impossible de copier');
      });
    },
    [showToast],
  );

  // Initial boot load
  useEffect(() => {
    void api.getHealth().then(setHealth).catch(() => setHealth(null));
    void api
      .listProjects()
      .then((list) => {
        setProjects(list);
        if (list[0]) {
          setActiveProjectId((curr) => curr ?? list[0]!.id);
        }
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'Erreur chargement projets'));
    void api.listActivities().then(setActivities).catch(() => undefined);
  }, [showToast]);

  // Load project assets & jobs whenever active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setAssets([]);
      setJobs([]);
      return;
    }
    void api.listAssets(activeProjectId).then(setAssets).catch(() => undefined);
    void api.listJobs(activeProjectId).then(setJobs).catch(() => undefined);
    void api.listActivities(activeProjectId).then(setActivities).catch(() => undefined);
    setSelectedAssetId(null);
    setSelectedLineage(null);
  }, [activeProjectId]);

  // Load lineage when an asset is selected
  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedLineage(null);
      return;
    }
    void api
      .getAssetDetail(selectedAssetId)
      .then((res) => setSelectedLineage(res.lineage))
      .catch(() => setSelectedLineage(null));
  }, [selectedAssetId]);

  // Realtime WebSocket synchronization (Claude MCP actions appear live!)
  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case 'project.created':
          setProjects((prev) => [event.payload, ...prev.filter((p) => p.id !== event.payload.id)]);
          setActiveProjectId((curr) => curr ?? event.payload.id);
          break;
        case 'project.updated':
          setProjects((prev) =>
            prev.map((p) => (p.id === event.payload.id ? event.payload : p)),
          );
          break;
        case 'project.deleted':
          setProjects((prev) => prev.filter((p) => p.id !== event.payload.id));
          setActiveProjectId((curr) => (curr === event.payload.id ? null : curr));
          break;
        case 'asset.created':
          setProjects((prev) =>
            prev.map((p) =>
              p.id === event.payload.projectId ? { ...p, assetCount: p.assetCount + 1 } : p,
            ),
          );
          if (event.payload.projectId === activeProjectId) {
            setAssets((prev) => [event.payload, ...prev.filter((a) => a.id !== event.payload.id)]);
          }
          if (event.payload.createdBy === 'claude') {
            showToast(`Claude a ajouté ${event.payload.handle} (${event.payload.title})`);
          }
          break;
        case 'asset.updated':
          if (event.payload.projectId === activeProjectId) {
            setAssets((prev) =>
              prev.map((a) => (a.id === event.payload.id ? event.payload : a)),
            );
          }
          break;
        case 'asset.deleted':
          setProjects((prev) =>
            prev.map((p) =>
              p.id === event.payload.projectId
                ? { ...p, assetCount: Math.max(0, p.assetCount - 1) }
                : p,
            ),
          );
          setAssets((prev) => prev.filter((a) => a.id !== event.payload.id));
          setSelectedAssetId((curr) => (curr === event.payload.id ? null : curr));
          break;
        case 'activity.logged':
          setActivities((prev) => [event.payload, ...prev].slice(0, 100));
          break;
        case 'job.updated':
          if (event.payload.projectId === activeProjectId) {
            setJobs((prev) => [
              event.payload,
              ...prev.filter((j) => j.id !== event.payload.id),
            ].slice(0, 20));
          }
          break;
        case 'annotation.changed':
          setAnnotationRefresh((n) => n + 1);
          break;
        case 'rules.changed':
          setRulesRefresh((n) => n + 1);
          break;
        case 'library.changed':
          if (event.payload.kind === 'skill') {
            setSkillsRefresh((n) => n + 1);
          } else {
            setLibraryRefresh((n) => n + 1);
          }
          break;
        case 'stage3.changed':
          setStage3Refresh((n) => n + 1);
          break;
      }
    },
    [activeProjectId, showToast],
  );

  const { connected } = useRealtimeEvents(handleRealtimeEvent);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
      if (tierFilter !== 'all' && asset.qualityTier !== tierFilter) return false;
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (q) {
        const hay = [
          asset.title,
          asset.refCode,
          asset.handle,
          asset.promptUsed ?? '',
          asset.notes,
          asset.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [assets, typeFilter, tierFilter, statusFilter, searchQuery]);

  const runningJobs = useMemo(
    () => jobs.filter((j) => j.status === 'pending' || j.status === 'running'),
    [jobs],
  );

  const handleCreateProject = async (input: CreateProjectInput) => {
    const created = await api.createProject(input);
    setProjects((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
    setActiveProjectId(created.id);
    showToast(`Projet "${created.name}" créé`);
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!activeProjectId) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    try {
      for (const file of list) {
        const uploaded = await api.uploadAssetFile(activeProjectId, file);
        setSelectedAssetId(uploaded.id);
        setRightTab('inspector');
      }
      showToast(`${list.length} fichier(s) importé(s)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur d'import");
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (activeProjectId && workspaceMode === 'media') setIsDragging(true);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void handleUploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="studio-shell">
      {/* Left Sidebar: Projects & Server Status */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <div className="brand-icon" aria-hidden="true">
              <Clapperboard size={17} />
            </div>
            <div>
              <div className="brand-title">VideoStudio</div>
              <div className="brand-sub">v0.3 · MCP · LAN</div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowMcpModal(true)}
            title="Configuration MCP Claude Code & Santé Serveur"
          >
            <Terminal size={15} />
          </button>
        </div>

        <div className="sidebar-section-header">
          <span>Projets ({projects.length})</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowNewProject(true)}
            title="Nouveau projet"
          >
            <FolderPlus size={14} />
          </button>
        </div>

        <nav className="project-list" aria-label="Projets vidéo">
          {projects.map((proj) => (
            <button
              key={proj.id}
              type="button"
              className={`project-item ${proj.id === activeProjectId ? 'active' : ''}`}
              onClick={() => setActiveProjectId(proj.id)}
            >
              <div className="project-item-top">
                <span className="project-item-name">{proj.name}</span>
                <span className="project-item-count">{proj.assetCount}</span>
              </div>
              <div className="project-item-meta">
                <span>{proj.aspectRatio}</span>
                <span>{proj.fps}fps</span>
                <span>{proj.targetResolution}</span>
              </div>
            </button>
          ))}

          {projects.length === 0 && (
            <div style={{ padding: '16px 8px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Aucun projet pour le moment. Crée ton premier projet ou demande à Claude Code de le
              faire via MCP.
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="connection-row">
            <span className="connection-status">
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              <span>{connected ? 'Temps réel actif (WS)' : 'Reconnexion WS...'}</span>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            onClick={() => setShowMcpModal(true)}
          >
            <Terminal size={13} /> Connecter Claude Code (MCP)
          </button>
        </div>
      </aside>

      {/* Center Workspace */}
      <main
        className="workspace"
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="drop-overlay">
            <Upload size={34} color="var(--accent-amber)" />
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              Dépose tes images, vidéos ou sons ici
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Les métadonnées ComfyUI et vignettes seront extraites automatiquement
            </div>
          </div>
        )}

        <header className="workspace-header">
          {activeProject ? (
            <>
              <div className="workspace-title-group">
                <div className="workspace-title-row">
                  <h1 className="workspace-h1">{activeProject.name}</h1>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={() =>
                      handleCopyText(`@proj-${activeProject.slug}`, 'Référence projet')
                    }
                  >
                    <Copy size={11} /> @proj-{activeProject.slug}
                  </button>
                </div>
                <div className="workspace-subtitle">
                  <span>{activeProject.aspectRatio}</span>
                  <span>·</span>
                  <span>{activeProject.targetResolution}</span>
                  <span>·</span>
                  <span>{activeProject.fps} fps</span>
                  <span>·</span>
                  <span>{assets.length} médias</span>
                </div>
              </div>

              <div className="workspace-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void handleUploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> {uploading ? 'Import...' : 'Importer média'}
                </button>
              </div>
            </>
          ) : (
            <div className="workspace-title-group">
              <h1 className="workspace-h1">VideoStudio</h1>
              <div className="workspace-subtitle">
                Sélectionne ou crée un projet pour commencer
              </div>
            </div>
          )}
        </header>

        {/* Studio Mode Tabs */}
        <nav className="mode-tabs" aria-label="Modules du studio">
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'media' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('media')}
          >
            <Layers size={14} /> Médias <span className="mode-badge">{assets.length}</span>
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'preprod' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('preprod')}
          >
            <FileText size={14} /> Pré-prod
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'audio' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('audio')}
          >
            <Music size={14} /> Audio
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'compare' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('compare')}
          >
            <Columns2 size={14} /> Comparateur
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'rules' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('rules')}
          >
            <ShieldCheck size={14} /> Règles
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'library' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('library')}
          >
            <Sparkles size={14} /> Prompts
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'skills' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('skills')}
          >
            <BookOpen size={14} /> Skills
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'youtube' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('youtube')}
          >
            <Youtube size={14} /> YouTube
          </button>
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'git' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('git')}
          >
            <GitBranch size={14} /> Git
          </button>
        </nav>

        {/* Live Claude Jobs Banner */}
        {runningJobs.length > 0 && (
          <div className="jobs-strip" role="status" aria-live="polite">
            {runningJobs.map((job) => (
              <div key={job.id} className="job-row">
                <span className="actor-pill actor-claude">Claude Live</span>
                <span style={{ fontWeight: 500 }}>{job.title}</span>
                <div className="job-progress-bar">
                  <div className="job-progress-fill" style={{ width: `${job.progress}%` }} />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {job.progress}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Active Workspace View */}
        {workspaceMode === 'media' && (
          <>
            {activeProject && (
              <div className="toolbar">
                <div className="search-box">
                  <Search size={14} />
                  <input
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher titre, @ref, prompt, tag..."
                  />
                </div>

                <div className="filter-group">
                  {(['all', 'image', 'video', 'audio'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${typeFilter === t ? 'active' : ''}`}
                      onClick={() => setTypeFilter(t)}
                    >
                      {t === 'all'
                        ? 'Tous'
                        : t === 'image'
                          ? 'Images'
                          : t === 'video'
                            ? 'Vidéos'
                            : 'Audio'}
                    </button>
                  ))}

                  <select
                    aria-label="Filtrer par niveau qualité"
                    className="select-compact"
                    value={tierFilter}
                    onChange={(e) => setTierFilter(e.target.value as QualityTier | 'all')}
                  >
                    <option value="all">Qualité : Toutes</option>
                    {(Object.keys(QUALITY_TIER_LABELS) as QualityTier[]).map((tier) => (
                      <option key={tier} value={tier}>
                        {QUALITY_TIER_LABELS[tier]}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filtrer par statut"
                    className="select-compact"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as AssetStatus | 'all')}
                  >
                    <option value="all">Statut : Tous</option>
                    {(Object.keys(STATUS_LABELS) as AssetStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <section className="gallery-scroll">
              {!activeProject ? (
                <div className="empty-state">
                  <Layers size={36} color="var(--accent-amber)" />
                  <h2>Prêt à produire avec Claude Code</h2>
                  <p>
                    Crée ton premier projet vidéo pour centraliser tes générations ComfyUI (images,
                    tests basse rés., rendus HQ, musiques) et suivre le travail de Claude en direct.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowNewProject(true)}
                  >
                    <FolderPlus size={15} /> Créer un projet
                  </button>
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="empty-state">
                  <Upload size={34} color="var(--text-muted)" />
                  <h2>Aucun média dans cette vue</h2>
                  <p>
                    Glisse-dépose des fichiers ici ou demande à Claude Code d'enregistrer une
                    génération ComfyUI via <code>register_asset</code> sur{' '}
                    <code>@proj-{activeProject.slug}</code>.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} /> Importer un fichier
                  </button>
                </div>
              ) : (
                <div className="gallery-grid">
                  {filteredAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      selected={asset.id === selectedAssetId}
                      onSelect={(item) => {
                        setSelectedAssetId(item.id);
                        setRightTab('inspector');
                      }}
                      onCopyRef={(ref) => handleCopyText(ref, 'Référence Claude')}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {workspaceMode === 'preprod' && (
          <PreprodPanel
            project={activeProject}
            assets={assets}
            refreshSignal={stage3Refresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'audio' && (
          <AudioPanel
            project={activeProject}
            assets={assets}
            refreshSignal={stage3Refresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'compare' && (
          <CompareView
            assets={assets}
            initialLeftId={comparePair.leftId}
            initialRightId={comparePair.rightId}
          />
        )}

        {workspaceMode === 'rules' && (
          <RulesPanel
            project={activeProject}
            refreshSignal={rulesRefresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'library' && (
          <LibraryPanel
            project={activeProject}
            refreshSignal={libraryRefresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'skills' && (
          <SkillsPanel
            project={activeProject}
            refreshSignal={skillsRefresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'youtube' && (
          <YouTubePanel
            project={activeProject}
            assets={assets}
            refreshSignal={stage3Refresh}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'git' && (
          <ProjectGitPanel
            project={activeProject}
            refreshSignal={stage3Refresh}
            onNotify={showToast}
          />
        )}
      </main>

      {/* Right Panel: Asset Inspector & Claude Live Feed */}
      <aside className="inspector">
        <div className="inspector-tabs">
          <button
            type="button"
            className={`inspector-tab ${rightTab === 'inspector' ? 'active' : ''}`}
            onClick={() => setRightTab('inspector')}
          >
            <SlidersHorizontal size={14} /> Inspecteur
          </button>
          <button
            type="button"
            className={`inspector-tab ${rightTab === 'activity' ? 'active' : ''}`}
            onClick={() => setRightTab('activity')}
          >
            <Activity size={14} /> Live ({activities.length})
          </button>
        </div>

        <div className="inspector-body">
          {rightTab === 'inspector' ? (
            <AssetInspector
              asset={selectedAsset}
              lineage={selectedLineage}
              annotationRefreshSignal={annotationRefresh}
              onUpdate={async (id, patch) => {
                const updated = await api.updateAsset(id, patch);
                setAssets((prev) => prev.map((a) => (a.id === id ? updated : a)));
                showToast(`Mis à jour ${updated.handle}`);
              }}
              onDelete={async (id) => {
                await api.deleteAsset(id);
                setAssets((prev) => prev.filter((a) => a.id !== id));
                setSelectedAssetId(null);
                showToast('Média supprimé');
              }}
              onSelectAsset={(target) => setSelectedAssetId(target.id)}
              onOpenCompare={(target, compareWith) => {
                setComparePair({
                  leftId: compareWith?.id ?? assets.find((a) => a.id !== target.id)?.id ?? target.id,
                  rightId: target.id,
                });
                setWorkspaceMode('compare');
              }}
              onCopyText={handleCopyText}
              onNotify={showToast}
            />
          ) : (
            <ActivityFeed
              activities={activities}
              onSelectEntityId={(entityId) => {
                const exists = assets.some((a) => a.id === entityId);
                if (exists) {
                  setSelectedAssetId(entityId);
                  setWorkspaceMode('media');
                  setRightTab('inspector');
                }
              }}
            />
          )}
        </div>
      </aside>

      {showNewProject && (
        <CreateProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}

      {showMcpModal && (
        <McpSetupModal
          health={health}
          onClose={() => setShowMcpModal(false)}
          onCopyText={handleCopyText}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

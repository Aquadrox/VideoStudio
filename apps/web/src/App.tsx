import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Activity,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Columns2,
  Command,
  Copy,
  CornerLeftUp,
  FileText,
  Film,
  Folder,
  FolderPlus,
  GitBranch,
  Keyboard,
  Layers,
  Music,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Youtube,
} from 'lucide-react';
import type {
  ActivityDto,
  AgentTaskDto,
  AssetDto,
  AssetStatus,
  AssetType,
  CreateProjectInput,
  JobDto,
  MediaFolderDto,
  ProjectDto,
  ProjectStatus,
  QualityTier,
  RealtimeEvent,
} from '@videostudio/shared';
import { api, type AssetLineage, type HealthResponse } from './api/client';
import { ActivityFeed } from './components/ActivityFeed';
import { AssetCard } from './components/AssetCard';
import { AssetInspector } from './components/AssetInspector';
import { AudioPanel } from './components/AudioPanel';
import { ClaudeLiveBar } from './components/ClaudeLiveBar';
import {
  CommandPalette,
  ShortcutsHelpModal,
  type ExecutableCommandItem,
} from './components/CommandPalette';
import { CompareView } from './components/CompareView';
import { LibraryPanel } from './components/LibraryPanel';
import { MediaLightbox } from './components/MediaLightbox';
import { CreateProjectModal, McpSetupModal } from './components/Modals';
import { OpsPanel } from './components/OpsPanel';
import { PreprodPanel } from './components/PreprodPanel';
import { ProjectGitPanel } from './components/ProjectGitPanel';
import { RulesPanel } from './components/RulesPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { YouTubePanel } from './components/YouTubePanel';
import { useRealtimeEvents } from './hooks/useRealtime';
import {
  copyToClipboard,
  PROJECT_STATUS_LABELS,
  QUALITY_TIER_LABELS,
  STATUS_LABELS,
} from './utils/format';

type WorkspaceMode =
  | 'media'
  | 'preprod'
  | 'timeline'
  | 'audio'
  | 'compare'
  | 'rules'
  | 'library'
  | 'skills'
  | 'youtube'
  | 'git'
  | 'ops';

function parseCompareDeepLink(): { active: boolean; leftRef: string | null; rightRef: string | null } {
  if (typeof window === 'undefined') return { active: false, leftRef: null, rightRef: null };
  const url = new URL(window.location.href);
  const pathIsCompare = url.pathname.replace(/\/+$/, '') === '/compare';
  const modeParam = url.searchParams.get('mode');
  const leftRef = url.searchParams.get('left');
  const rightRef = url.searchParams.get('right');
  const active = pathIsCompare || modeParam === 'compare' || Boolean(leftRef || rightRef);
  return { active, leftRef, rightRef };
}

export function App() {
  const initialCompareLink = useMemo(() => parseCompareDeepLink(), []);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    initialCompareLink.active ? 'compare' : 'media',
  );
  const [pendingCompareRefs, setPendingCompareRefs] = useState<{
    leftRef: string | null;
    rightRef: string | null;
  } | null>(
    initialCompareLink.leftRef || initialCompareLink.rightRef
      ? { leftRef: initialCompareLink.leftRef, rightRef: initialCompareLink.rightRef }
      : null,
  );
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [folders, setFolders] = useState<MediaFolderDto[]>([]);
  const [currentFolderPath, setCurrentFolderPath] = useState('');
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [selectedLineage, setSelectedLineage] = useState<AssetLineage | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string | null; rightId: string | null }>({
    leftId: null,
    rightId: null,
  });

  const [activities, setActivities] = useState<ActivityDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTaskDto[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [annotationRefresh, setAnnotationRefresh] = useState(0);
  const [rulesRefresh, setRulesRefresh] = useState(0);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [skillsRefresh, setSkillsRefresh] = useState(0);
  const [stage3Refresh, setStage3Refresh] = useState(0);
  const [timelineRefresh, setTimelineRefresh] = useState(0);

  const [rightTab, setRightTab] = useState<'inspector' | 'activity'>('inspector');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<QualityTier | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [showNewProject, setShowNewProject] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
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

  const refreshFolders = useCallback(async (projectId: string) => {
    try {
      const list = await api.listMediaFolders(projectId);
      setFolders(list);
    } catch {
      setFolders([]);
    }
  }, []);

  // Load project assets, folders, jobs & live agent tasks whenever active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setAssets([]);
      setFolders([]);
      setJobs([]);
      setAgentTasks([]);
      setCurrentFolderPath('');
      setLightboxAssetId(null);
      return;
    }
    setCurrentFolderPath('');
    setShowNewFolderInput(false);
    setNewFolderName('');
    setLightboxAssetId(null);
    void api.listAssets(activeProjectId).then(setAssets).catch(() => undefined);
    void refreshFolders(activeProjectId);
    void api.listJobs(activeProjectId).then(setJobs).catch(() => undefined);
    void api.listAgentTasks(activeProjectId).then(setAgentTasks).catch(() => setAgentTasks([]));
    void api.listActivities(activeProjectId).then(setActivities).catch(() => undefined);
    setSelectedAssetId(null);
    setSelectedLineage(null);
  }, [activeProjectId, refreshFolders]);

  // Resolve deep-linked /compare?left=@img-038-v2&right=@img-144 once assets load
  useEffect(() => {
    if (!pendingCompareRefs || assets.length === 0) return;
    const matchAsset = (ref: string | null) => {
      if (!ref) return null;
      const clean = ref.trim().toLowerCase();
      const withoutAt = clean.replace(/^@/, '');
      return (
        assets.find(
          (a) =>
            a.id.toLowerCase() === clean ||
            a.handle.toLowerCase() === clean ||
            a.refCode.toLowerCase() === withoutAt,
        ) ?? null
      );
    };

    const leftMatch = matchAsset(pendingCompareRefs.leftRef);
    const rightMatch = matchAsset(pendingCompareRefs.rightRef);
    if (leftMatch || rightMatch) {
      setComparePair({
        leftId: leftMatch?.id ?? null,
        rightId: rightMatch?.id ?? null,
      });
      setWorkspaceMode('compare');
      setPendingCompareRefs(null);
    }
  }, [assets, pendingCompareRefs]);

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
          setLightboxAssetId((curr) => (curr === event.payload.id ? null : curr));
          break;
        case 'folders.changed':
          if (event.payload.projectId === activeProjectId) {
            void refreshFolders(event.payload.projectId);
            void api.listAssets(event.payload.projectId).then(setAssets).catch(() => undefined);
          }
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
        case 'tasks.changed':
          if (event.payload.projectId === activeProjectId) {
            setAgentTasks(event.payload.tasks);
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
        case 'timeline.changed':
          setTimelineRefresh((n) => n + 1);
          break;
      }
    },
    [activeProjectId, refreshFolders, showToast],
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

  const lightboxAsset = useMemo(
    () => assets.find((a) => a.id === lightboxAssetId) ?? null,
    [assets, lightboxAssetId],
  );

  const childFolders = useMemo(() => {
    return folders
      .filter((f) => f.parentPath === currentFolderPath)
      .map((f) => {
        const totalRecursiveCount = assets.filter(
          (a) => a.folderPath === f.path || a.folderPath.startsWith(`${f.path}/`),
        ).length;
        return { ...f, totalRecursiveCount };
      });
  }, [folders, currentFolderPath, assets]);

  const breadcrumbSegments = useMemo(() => {
    if (!currentFolderPath) return [];
    const parts = currentFolderPath.split('/');
    return parts.map((name, idx) => ({
      name,
      path: parts.slice(0, idx + 1).join('/'),
    }));
  }, [currentFolderPath]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      if (!includeSubfolders) {
        if (asset.folderPath !== currentFolderPath) return false;
      } else if (currentFolderPath) {
        const inTree =
          asset.folderPath === currentFolderPath ||
          asset.folderPath.startsWith(`${currentFolderPath}/`);
        if (!inTree) return false;
      }

      if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
      if (tierFilter !== 'all' && asset.qualityTier !== tierFilter) return false;
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (q) {
        const hay = [
          asset.title,
          asset.refCode,
          asset.handle,
          asset.folderPath,
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
  }, [
    assets,
    currentFolderPath,
    includeSubfolders,
    typeFilter,
    tierFilter,
    statusFilter,
    searchQuery,
  ]);

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

  const handleProjectStatusChange = async (status: ProjectStatus) => {
    if (!activeProject) return;
    try {
      const updated = await api.updateProject(activeProject.id, { status });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast(`Statut projet : ${PROJECT_STATUS_LABELS[status]}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur mise à jour statut');
    }
  };

  const handleCreateFolder = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !newFolderName.trim()) return;
    const raw = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    const fullPath = currentFolderPath ? `${currentFolderPath}/${raw}` : raw;
    try {
      const created = await api.createMediaFolder(activeProjectId, fullPath);
      await refreshFolders(activeProjectId);
      setNewFolderName('');
      setShowNewFolderInput(false);
      showToast(`Dossier /${created.path} créé`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Nom de dossier invalide');
    }
  };

  const handleDeleteFolder = async (folderPath: string) => {
    if (!activeProjectId) return;
    if (
      !window.confirm(
        `Supprimer le dossier /${folderPath} ? Les médias à l'intérieur ne seront PAS supprimés mais déplacés vers le dossier parent.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteMediaFolder(activeProjectId, folderPath);
      await Promise.all([
        refreshFolders(activeProjectId),
        api.listAssets(activeProjectId).then(setAssets),
      ]);
      if (currentFolderPath === folderPath || currentFolderPath.startsWith(`${folderPath}/`)) {
        const parts = folderPath.split('/');
        setCurrentFolderPath(parts.slice(0, -1).join('/'));
      }
      showToast(`Dossier /${folderPath} supprimé (médias conservés)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur suppression dossier');
    }
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!activeProjectId) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    try {
      for (const file of list) {
        const uploaded = await api.uploadAssetFile(activeProjectId, file, {
          folderPath: currentFolderPath || undefined,
        });
        setSelectedAssetId(uploaded.id);
        setRightTab('inspector');
      }
      showToast(
        `${list.length} fichier(s) importé(s)${currentFolderPath ? ` dans /${currentFolderPath}` : ''}`,
      );
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
    if (workspaceMode !== 'media') return;
    if (e.dataTransfer.files?.length) {
      void handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Stage 5: Pro Keyboard Shortcuts (Cmd/Ctrl+K, ?, A/R triage, 1-5 rating, J/K/L & arrows video transport)
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const findActiveVideoElement = (): HTMLVideoElement | null => {
      const lightboxVideo = document.querySelector<HTMLVideoElement>('.lightbox-stage video');
      if (lightboxVideo) return lightboxVideo;
      const timelineVideo = document.querySelector<HTMLVideoElement>('.timeline-monitor-stage video');
      if (timelineVideo) return timelineVideo;
      const inspectorVideo = document.querySelector<HTMLVideoElement>('.inspector video');
      if (inspectorVideo) return inspectorVideo;
      return document.querySelector<HTMLVideoElement>('video');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((open) => !open);
        return;
      }

      if (showCommandPalette || showNewProject || showMcpModal) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsHelp((open) => !open);
        return;
      }

      if (showShortcutsHelp) return;

      const key = e.key.toLowerCase();

      // Quick triage on selected asset (A = Approve, R = Needs revision, 1..5 = Rating)
      if (selectedAsset && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (key === 'a') {
          e.preventDefault();
          void api
            .updateAsset(selectedAsset.id, { status: 'approved' })
            .then((updated) => {
              setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
              showToast(`Approuvé : ${updated.handle}`);
            })
            .catch(() => undefined);
          return;
        }
        if (key === 'r') {
          e.preventDefault();
          void api
            .updateAsset(selectedAsset.id, { status: 'needs_revision' })
            .then((updated) => {
              setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
              showToast(`À revoir : ${updated.handle}`);
            })
            .catch(() => undefined);
          return;
        }
        if (/^[1-5]$/.test(key)) {
          e.preventDefault();
          const rating = Number(key);
          void api
            .updateAsset(selectedAsset.id, { rating })
            .then((updated) => {
              setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
              showToast(`Note ${rating}/5 sur ${updated.handle}`);
            })
            .catch(() => undefined);
          return;
        }
      }

      // Pro video transport (J / K / L and frame-by-frame ArrowLeft / ArrowRight)
      const video = findActiveVideoElement();
      if (video && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (key === 'k') {
          e.preventDefault();
          video.playbackRate = 1;
          if (video.paused) {
            void video.play().catch(() => undefined);
          } else {
            video.pause();
          }
          return;
        }
        if (key === 'l') {
          e.preventDefault();
          if (video.paused) {
            video.playbackRate = 1;
            void video.play().catch(() => undefined);
          } else {
            video.playbackRate = video.playbackRate >= 2 ? 2 : video.playbackRate >= 1.5 ? 2 : 1.5;
          }
          return;
        }
        if (key === 'j') {
          e.preventDefault();
          video.playbackRate = 1;
          video.currentTime = Math.max(0, video.currentTime - 1);
          return;
        }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !lightboxAssetId) {
          e.preventDefault();
          video.pause();
          const frameStep = 1 / (activeProject?.fps || 24);
          const delta = e.key === 'ArrowRight' ? frameStep : -frameStep;
          video.currentTime = Math.max(
            0,
            Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + delta),
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeProject?.fps,
    lightboxAssetId,
    selectedAsset,
    showCommandPalette,
    showMcpModal,
    showNewProject,
    showShortcutsHelp,
    showToast,
  ]);

  const commandPaletteItems = useMemo<ExecutableCommandItem[]>(() => {
    const items: ExecutableCommandItem[] = [
      {
        id: 'action-new-project',
        category: 'action',
        label: 'Créer un nouveau projet',
        subtitle: 'Ouvre la fenêtre de création de projet',
        keywords: ['project', 'nouveau', 'create'],
        onSelect: () => setShowNewProject(true),
      },
      {
        id: 'action-backup-now',
        category: 'action',
        label: 'Créer un backup complet maintenant',
        subtitle: 'Exporte DB + métadonnées + skills dans BACKUP_DIR',
        keywords: ['sauvegarde', 'archive', 'dump', 'ops'],
        onSelect: () => {
          void api
            .createBackup('Backup rapide (Palette Cmd+K)')
            .then((b) => showToast(`Backup créé : ${b.filename}`))
            .catch((err) => showToast(err instanceof Error ? err.message : 'Erreur backup'));
        },
      },
      {
        id: 'action-mcp-setup',
        category: 'action',
        label: 'Configurer Claude Code (MCP)',
        subtitle: 'Afficher l’URL MCP, le token et la santé serveur',
        keywords: ['claude', 'token', 'mcp'],
        onSelect: () => setShowMcpModal(true),
      },
      {
        id: 'action-shortcuts',
        category: 'action',
        label: 'Afficher les raccourcis clavier Pro',
        subtitle: 'J/K/L, A/R, 1-5, Cmd+K',
        shortcut: '?',
        keywords: ['help', 'keyboard', 'raccourcis'],
        onSelect: () => setShowShortcutsHelp(true),
      },
    ];

    const tabs: Array<{ mode: WorkspaceMode; label: string; subtitle: string }> = [
      { mode: 'media', label: 'Module Médias', subtitle: 'Galerie DAM, dossiers et versions' },
      { mode: 'preprod', label: 'Module Pré-prod', subtitle: 'Scénario, Bible & Storyboard' },
      { mode: 'timeline', label: 'Module Timeline', subtitle: 'Montage multi-pistes, animatique & rendu FFmpeg' },
      { mode: 'audio', label: 'Module Audio', subtitle: 'Musique, paroles LRC/SRT et marqueurs' },
      { mode: 'compare', label: 'Module Comparateur', subtitle: 'A/B côte à côte, slider & paires auto' },
      { mode: 'rules', label: 'Module Règles', subtitle: 'Rulebooks globaux & surcharges projet' },
      { mode: 'library', label: 'Module Prompts & Workflows', subtitle: 'Templates prompts & ComfyUI JSON' },
      { mode: 'skills', label: 'Module Skills', subtitle: 'Guides méthodologiques synchronisés' },
      { mode: 'youtube', label: 'Module YouTube', subtitle: 'Miniatures A/B, chapitres & upload brouillon' },
      { mode: 'git', label: 'Module Git Projet', subtitle: 'Dépôt local & synchronisation GitHub' },
      { mode: 'ops', label: 'Module Exploitation', subtitle: 'Monitoring, disque, backups, watch folders & webhooks' },
    ];

    for (const t of tabs) {
      items.push({
        id: `tab-${t.mode}`,
        category: 'tab',
        label: t.label,
        subtitle: t.subtitle,
        keywords: [t.mode],
        onSelect: () => setWorkspaceMode(t.mode),
      });
    }

    for (const proj of projects) {
      items.push({
        id: `proj-${proj.id}`,
        category: 'project',
        label: proj.name,
        subtitle: `@proj-${proj.slug} · ${proj.aspectRatio} · ${proj.assetCount} médias`,
        keywords: [proj.slug, proj.status, proj.type],
        onSelect: () => setActiveProjectId(proj.id),
      });
    }

    for (const a of assets.slice(0, 200)) {
      items.push({
        id: `asset-${a.id}`,
        category: 'asset',
        label: `${a.handle} — ${a.title}`,
        subtitle: `${a.type} · ${a.status} · ${a.qualityTier}${a.folderPath ? ` · /${a.folderPath}` : ''}`,
        keywords: [a.refCode, a.originalFilename, ...a.tags],
        onSelect: () => {
          setSelectedAssetId(a.id);
          setRightTab('inspector');
          setWorkspaceMode('media');
        },
      });
    }

    return items;
  }, [assets, projects, showToast]);

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
              <div className="brand-sub">v0.5.0 · MCP · LAN</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCommandPalette(true)}
              title="Palette de commandes (Ctrl+K / ⌘K)"
            >
              <Command size={14} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowShortcutsHelp(true)}
              title="Raccourcis clavier Pro (?)"
            >
              <Keyboard size={14} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMcpModal(true)}
              title="Configuration MCP Claude Code & Santé Serveur"
            >
              <Terminal size={14} />
            </button>
          </div>
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
              {currentFolderPath ? ` (dans /${currentFolderPath})` : ''}
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
                  <select
                    aria-label="Statut du projet"
                    className="select-compact"
                    value={activeProject.status}
                    onChange={(e) => void handleProjectStatusChange(e.target.value as ProjectStatus)}
                  >
                    {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {PROJECT_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
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
                  <Upload size={14} />{' '}
                  {uploading
                    ? 'Import...'
                    : currentFolderPath
                      ? `Importer dans /${currentFolderPath.split('/').pop()}`
                      : 'Importer média'}
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
            className={`mode-tab ${workspaceMode === 'timeline' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('timeline')}
          >
            <Film size={14} /> Timeline
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
          <button
            type="button"
            className={`mode-tab ${workspaceMode === 'ops' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('ops')}
          >
            <Server size={14} /> Exploitation
          </button>
        </nav>

        {/* Expandable Claude Live Progress & Task List Banner */}
        <ClaudeLiveBar
          runningJobs={runningJobs}
          tasks={agentTasks}
          onClearTasks={async (scope) => {
            if (!activeProjectId) return;
            try {
              const remaining = await api.clearAgentTasks(activeProjectId, scope);
              setAgentTasks(remaining);
              showToast(scope === 'all' ? 'Liste de tâches vidée' : 'Tâches terminées effacées');
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Erreur nettoyage tâches');
            }
          }}
          onSelectAssetRef={(ref) => {
            const clean = ref.trim().toLowerCase();
            const match = assets.find(
              (a) =>
                a.handle.toLowerCase() === clean ||
                a.refCode.toLowerCase() === clean.replace(/^@/, ''),
            );
            if (match) {
              setSelectedAssetId(match.id);
              setRightTab('inspector');
              setWorkspaceMode('media');
            }
          }}
        />

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

            {activeProject && (
              <div className="folder-bar">
                <div className="folder-breadcrumbs" aria-label="Chemin du dossier média">
                  <button
                    type="button"
                    className={`breadcrumb-btn ${currentFolderPath === '' ? 'current' : ''}`}
                    onClick={() => setCurrentFolderPath('')}
                  >
                    <Folder size={13} /> Racine
                  </button>
                  {breadcrumbSegments.map((seg, idx) => (
                    <span
                      key={seg.path}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    >
                      <ChevronRight size={13} color="var(--text-muted)" />
                      <button
                        type="button"
                        className={`breadcrumb-btn ${
                          idx === breadcrumbSegments.length - 1 ? 'current' : ''
                        }`}
                        onClick={() => setCurrentFolderPath(seg.path)}
                      >
                        {seg.name}
                      </button>
                    </span>
                  ))}
                  {currentFolderPath && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Remonter au dossier parent"
                      onClick={() => {
                        const parts = currentFolderPath.split('/');
                        setCurrentFolderPath(parts.slice(0, -1).join('/'));
                      }}
                    >
                      <CornerLeftUp size={13} /> Parent
                    </button>
                  )}
                </div>

                <div className="folder-actions">
                  <button
                    type="button"
                    className={`chip ${includeSubfolders ? 'active' : ''}`}
                    onClick={() => setIncludeSubfolders((v) => !v)}
                    title="Afficher aussi les médias contenus dans les sous-dossiers"
                  >
                    {includeSubfolders ? 'Vue à plat (sous-dossiers inclus)' : 'Inclure sous-dossiers'}
                  </button>

                  {showNewFolderInput ? (
                    <form
                      className="folder-inline-form"
                      onSubmit={(e) => void handleCreateFolder(e)}
                    >
                      <input
                        className="input"
                        style={{ height: 28, width: 185, padding: '2px 8px', fontSize: 12.5 }}
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="ex: personnages ou sc01/drafts"
                      />
                      <button type="submit" className="btn btn-primary btn-sm">
                        Créer
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setShowNewFolderInput(false);
                          setNewFolderName('');
                        }}
                      >
                        Annuler
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowNewFolderInput(true)}
                    >
                      <FolderPlus size={13} /> Nouveau dossier
                    </button>
                  )}
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
              ) : (
                <>
                  {!includeSubfolders && childFolders.length > 0 && (
                    <div className="folder-grid" aria-label="Sous-dossiers">
                      {childFolders.map((folder) => (
                        <div
                          key={folder.path}
                          className="folder-card"
                          role="button"
                          tabIndex={0}
                          onClick={() => setCurrentFolderPath(folder.path)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setCurrentFolderPath(folder.path);
                            }
                          }}
                        >
                          <div className="folder-card-main">
                            <Folder size={17} color="var(--accent-amber)" />
                            <div style={{ minWidth: 0 }}>
                              <div className="folder-card-name" title={folder.path}>
                                {folder.name}
                              </div>
                              <div className="folder-card-count">
                                {folder.totalRecursiveCount} média(s)
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title={`Supprimer le dossier /${folder.path} (les médias remontent au parent)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteFolder(folder.path);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredAssets.length === 0 ? (
                    <div className="empty-state">
                      <Upload size={34} color="var(--text-muted)" />
                      <h2>
                        {currentFolderPath
                          ? `Aucun média dans /${currentFolderPath}`
                          : 'Aucun média dans cette vue'}
                      </h2>
                      <p>
                        Glisse-dépose des fichiers ici ou demande à Claude Code d'enregistrer une
                        génération ComfyUI via <code>register_asset</code> sur{' '}
                        <code>@proj-{activeProject.slug}</code>
                        {currentFolderPath ? (
                          <>
                            {' '}
                            (<code>folderPath: "{currentFolderPath}"</code>)
                          </>
                        ) : null}
                        .
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload size={14} /> Importer un fichier
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setShowNewFolderInput(true)}
                        >
                          <FolderPlus size={14} /> Créer un sous-dossier
                        </button>
                      </div>
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
                          onDoubleClick={(item) => {
                            setSelectedAssetId(item.id);
                            setLightboxAssetId(item.id);
                          }}
                          onCopyRef={(ref) => handleCopyText(ref, 'Référence Claude')}
                        />
                      ))}
                    </div>
                  )}
                </>
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

        {workspaceMode === 'timeline' && activeProject && (
          <TimelinePanel
            projectId={activeProject.id}
            assets={assets}
            refreshSignal={timelineRefresh}
            onNotify={showToast}
            onOpenAssetId={(assetId) => {
              setSelectedAssetId(assetId);
              setRightTab('inspector');
              setWorkspaceMode('media');
            }}
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
            onCopyLink={(url) => handleCopyText(url, 'Lien comparateur')}
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
            onAssetUploaded={(uploaded) => {
              setAssets((prev) => [uploaded, ...prev.filter((a) => a.id !== uploaded.id)]);
              if (activeProjectId) void refreshFolders(activeProjectId);
            }}
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

        {workspaceMode === 'ops' && (
          <OpsPanel
            projects={projects}
            activeProject={activeProject}
            onCopyText={handleCopyText}
            onNotify={showToast}
            onAssetsMutated={() => {
              if (activeProjectId) {
                void api.listAssets(activeProjectId).then(setAssets);
                void refreshFolders(activeProjectId);
              }
            }}
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
              folders={folders}
              annotationRefreshSignal={annotationRefresh}
              onUpdate={async (id, patch) => {
                const updated = await api.updateAsset(id, patch);
                setAssets((prev) => prev.map((a) => (a.id === id ? updated : a)));
                if (patch.folderPath !== undefined && activeProjectId) {
                  void refreshFolders(activeProjectId);
                }
                showToast(`Mis à jour ${updated.handle}`);
              }}
              onDelete={async (id) => {
                await api.deleteAsset(id);
                setAssets((prev) => prev.filter((a) => a.id !== id));
                setSelectedAssetId(null);
                setLightboxAssetId((curr) => (curr === id ? null : curr));
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

      {lightboxAsset && (
        <MediaLightbox
          asset={lightboxAsset}
          assets={filteredAssets.length > 0 ? filteredAssets : assets}
          onClose={() => setLightboxAssetId(null)}
          onNavigate={(target) => {
            setSelectedAssetId(target.id);
            setLightboxAssetId(target.id);
          }}
          onCopyText={handleCopyText}
        />
      )}

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

      {showCommandPalette && (
        <CommandPalette
          items={commandPaletteItems}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {showShortcutsHelp && (
        <ShortcutsHelpModal onClose={() => setShowShortcutsHelp(false)} />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

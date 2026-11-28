import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Activity,
  BookOpen,
  CheckSquare,
  ChevronRight,
  Clapperboard,
  Clock,
  Columns2,
  Command,
  Copy,
  CornerLeftUp,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderPlus,
  GitBranch,
  Keyboard,
  Layers,
  LayoutGrid,
  List,
  Maximize2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Terminal,
  Trash2,
  Upload,
  X,
  Youtube,
} from 'lucide-react';
import {
  isEditableTextFile,
  type ActivityDto,
  type AgentTaskDto,
  type AssetDto,
  type AssetStatus,
  type AssetType,
  type CreateProjectInput,
  type JobDto,
  type MediaFolderDto,
  type ProjectDto,
  type ProjectStatus,
  type QualityTier,
  type RealtimeEvent,
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
import { MediaDetailsTable, MediaListView } from './components/MediaListViews';
import { CreateProjectModal, McpSetupModal } from './components/Modals';
import { OpsPanel } from './components/OpsPanel';
import { PreprodPanel } from './components/PreprodPanel';
import { ProjectGitPanel } from './components/ProjectGitPanel';
import { RulesPanel } from './components/RulesPanel';
import { SketchStudioPanel, type SketchLaunchRequest } from './components/SketchStudioPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { TextDocumentEditorModal } from './components/TextDocumentEditor';
import { TimelinePanel } from './components/TimelinePanel';
import { YouTubePanel } from './components/YouTubePanel';
import { useRealtimeEvents } from './hooks/useRealtime';
import {
  ASSET_DRAG_MIME,
  ASSET_LIST_DRAG_MIME,
  computeMultiSelection,
  extractDraggedAssetIds,
  getParentFolder,
  isExternalFileDrag,
  resolveDragAssetIds,
} from './utils/drag';
import {
  copyToClipboard,
  PROJECT_STATUS_LABELS,
  QUALITY_TIER_LABELS,
  STATUS_LABELS,
} from './utils/format';
import {
  countRecentAssets,
  isAssetWithinRecentWindow,
  RECENT_WINDOW_LABELS,
  sortMediaAssets,
  type MediaSortBy,
  type MediaViewMode,
  type RecentWindow,
} from './utils/media-view';
import {
  clampPanelWidth,
  DEFAULT_PANEL_LAYOUT,
  LEFT_PANEL_DEFAULT_WIDTH,
  parseStoredPanelLayout,
  RIGHT_PANEL_DEFAULT_WIDTH,
  type PanelLayoutState,
} from './utils/panel-layout';

type WorkspaceMode =
  | 'media'
  | 'sketch'
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
  const [sketchRefresh, setSketchRefresh] = useState(0);
  const [sketchLaunchRequest, setSketchLaunchRequest] = useState<SketchLaunchRequest | null>(null);
  const [preprodSubTab, setPreprodSubTab] = useState<'script' | 'bible' | 'storyboard' | undefined>(
    undefined,
  );
  const [textEditorTarget, setTextEditorTarget] = useState<
    { mode: 'edit'; asset: AssetDto } | { mode: 'create' } | null
  >(null);

  const [rightTab, setRightTab] = useState<'inspector' | 'activity'>('inspector');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<QualityTier | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaViewMode, setMediaViewMode] = useState<MediaViewMode>(() => {
    if (typeof window === 'undefined') return 'grid';
    const saved = window.localStorage.getItem('videostudio:mediaViewMode');
    if (saved === 'grid' || saved === 'large' || saved === 'list' || saved === 'details') {
      return saved;
    }
    return 'grid';
  });
  const [mediaSortBy, setMediaSortBy] = useState<MediaSortBy>(() => {
    if (typeof window === 'undefined') return 'updated_desc';
    const saved = window.localStorage.getItem('videostudio:mediaSortBy');
    if (
      saved === 'updated_desc' ||
      saved === 'created_desc' ||
      saved === 'title_asc' ||
      saved === 'rating_desc' ||
      saved === 'size_desc'
    ) {
      return saved;
    }
    return 'updated_desc';
  });
  const [recentWindow, setRecentWindow] = useState<RecentWindow>('off');

  useEffect(() => {
    try {
      window.localStorage.setItem('videostudio:mediaViewMode', mediaViewMode);
    } catch {
      // Ignore storage quota / private mode restrictions
    }
  }, [mediaViewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('videostudio:mediaSortBy', mediaSortBy);
    } catch {
      // Ignore storage quota / private mode restrictions
    }
  }, [mediaSortBy]);

  const [panelLayout, setPanelLayout] = useState<PanelLayoutState>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_PANEL_LAYOUT };
    return parseStoredPanelLayout(window.localStorage.getItem('videostudio:panelLayout'));
  });
  const [resizingSide, setResizingSide] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('videostudio:panelLayout', JSON.stringify(panelLayout));
    } catch {
      // Ignore storage quota / private mode restrictions
    }
  }, [panelLayout]);

  const startPanelResize = useCallback(
    (side: 'left' | 'right', e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = side === 'left' ? panelLayout.leftWidth : panelLayout.rightWidth;
      const otherOccupied =
        side === 'left'
          ? panelLayout.rightOpen
            ? panelLayout.rightWidth
            : 0
          : panelLayout.leftOpen
            ? panelLayout.leftWidth
            : 0;

      setResizingSide(side);

      const handlePointerMove = (moveEvt: PointerEvent) => {
        const delta = side === 'left' ? moveEvt.clientX - startX : startX - moveEvt.clientX;
        const clamped = clampPanelWidth(
          side,
          startWidth + delta,
          window.innerWidth,
          otherOccupied,
        );
        setPanelLayout((prev) =>
          side === 'left' ? { ...prev, leftWidth: clamped } : { ...prev, rightWidth: clamped },
        );
      };

      const handlePointerUp = () => {
        setResizingSide(null);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [panelLayout.leftOpen, panelLayout.leftWidth, panelLayout.rightOpen, panelLayout.rightWidth],
  );

  const nudgePanelWidth = useCallback((side: 'left' | 'right', delta: number) => {
    setPanelLayout((prev) => {
      const current = side === 'left' ? prev.leftWidth : prev.rightWidth;
      const otherOccupied =
        side === 'left' ? (prev.rightOpen ? prev.rightWidth : 0) : prev.leftOpen ? prev.leftWidth : 0;
      const clamped = clampPanelWidth(side, current + delta, window.innerWidth, otherOccupied);
      return side === 'left' ? { ...prev, leftWidth: clamped } : { ...prev, rightWidth: clamped };
    });
  }, []);

  const [showNewProject, setShowNewProject] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[]>([]);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('');
  const [movingBatch, setMovingBatch] = useState(false);
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
        case 'sketches.changed':
          setSketchRefresh((n) => n + 1);
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

  const recent24hCount = useMemo(() => countRecentAssets(assets, '24h'), [assets]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const isRecentActive = recentWindow !== 'off';
    const matched = assets.filter((asset) => {
      if (isRecentActive) {
        if (!isAssetWithinRecentWindow(asset, recentWindow)) return false;
      } else if (!includeSubfolders) {
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

    return sortMediaAssets(matched, mediaSortBy);
  }, [
    assets,
    currentFolderPath,
    includeSubfolders,
    recentWindow,
    mediaSortBy,
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

  const handleUploadFiles = async (
    files: FileList | File[],
    targetFolderPath: string = currentFolderPath,
  ) => {
    if (!activeProjectId) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    try {
      for (const file of list) {
        const uploaded = await api.uploadAssetFile(activeProjectId, file, {
          folderPath: targetFolderPath || undefined,
        });
        setSelectedAssetId(uploaded.id);
        setRightTab('inspector');
      }
      await refreshFolders(activeProjectId);
      showToast(
        `${list.length} fichier(s) importé(s)${targetFolderPath ? ` dans /${targetFolderPath}` : ''}`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur d'import");
    } finally {
      setUploading(false);
    }
  };

  // Reset multi-selection when switching project or navigating folders
  useEffect(() => {
    setMultiSelectedIds([]);
    setSelectionAnchorId(null);
  }, [activeProjectId, currentFolderPath]);

  // Prune any multi-selected IDs that no longer exist in the current asset list
  useEffect(() => {
    setMultiSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set(assets.map((a) => a.id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [assets]);

  const isDraggingAssets = draggingAssetIds.length > 0;
  const multiSelectedSet = useMemo(() => new Set(multiSelectedIds), [multiSelectedIds]);
  const draggingAssetSet = useMemo(() => new Set(draggingAssetIds), [draggingAssetIds]);

  const handleToggleAssetCheck = (asset: AssetDto, opts: { shiftKey: boolean }) => {
    const orderedIds = filteredAssets.map((a) => a.id);
    const next = computeMultiSelection({
      orderedIds,
      currentSelectedIds: multiSelectedIds,
      clickedId: asset.id,
      anchorId: selectionAnchorId ?? selectedAssetId,
      mode: opts.shiftKey ? 'range' : 'toggle',
    });
    setMultiSelectedIds(next);
    setSelectionAnchorId(asset.id);
  };

  const handleSelectAssetCard = (
    item: AssetDto,
    modifiers?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    if (modifiers?.shiftKey || modifiers?.metaKey || modifiers?.ctrlKey) {
      handleToggleAssetCheck(item, { shiftKey: Boolean(modifiers.shiftKey) });
      setSelectedAssetId(item.id);
      setRightTab('inspector');
      return;
    }

    setMultiSelectedIds([]);
    setSelectionAnchorId(item.id);
    setSelectedAssetId(item.id);
    setRightTab('inspector');
  };

  const handleSelectAllVisible = () => {
    const allIds = filteredAssets.map((a) => a.id);
    setMultiSelectedIds(allIds);
    setSelectionAnchorId(allIds[allIds.length - 1] ?? null);
  };

  const handleClearMultiSelection = () => {
    setMultiSelectedIds([]);
    setSelectionAnchorId(null);
  };

  const handleMoveAssetsToFolder = async (assetIds: string[], targetFolderPath: string) => {
    if (!activeProjectId || assetIds.length === 0) return;

    const uniqueIds = Array.from(new Set(assetIds));
    const targetAssets = uniqueIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is AssetDto => Boolean(a));
    if (targetAssets.length === 0) return;

    const toMove = targetAssets.filter((a) => (a.folderPath ?? '') !== targetFolderPath);
    if (toMove.length === 0) {
      showToast(
        targetAssets.length === 1
          ? targetFolderPath
            ? `${targetAssets[0]!.handle} est déjà dans /${targetFolderPath}`
            : `${targetAssets[0]!.handle} est déjà à la racine`
          : targetFolderPath
            ? `Ces médias sont déjà dans /${targetFolderPath}`
            : `Ces médias sont déjà à la racine`,
      );
      return;
    }

    setMovingBatch(true);
    try {
      const results = await Promise.allSettled(
        toMove.map((a) => api.updateAsset(a.id, { folderPath: targetFolderPath })),
      );
      const updatedMap = new Map<string, AssetDto>();
      let failedCount = 0;
      for (const res of results) {
        if (res.status === 'fulfilled') {
          updatedMap.set(res.value.id, res.value);
        } else {
          failedCount += 1;
        }
      }

      if (updatedMap.size > 0) {
        setAssets((prev) => prev.map((a) => updatedMap.get(a.id) ?? a));
        setMultiSelectedIds((prev) => prev.filter((id) => !updatedMap.has(id)));
        await refreshFolders(activeProjectId);

        const destLabel = targetFolderPath ? `dans /${targetFolderPath}` : 'à la racine';
        if (updatedMap.size === 1) {
          const single = Array.from(updatedMap.values())[0]!;
          showToast(`Déplacé ${single.handle} ${destLabel}`);
        } else {
          showToast(
            `${updatedMap.size} médias déplacés ${destLabel}${
              failedCount > 0 ? ` (${failedCount} erreur(s))` : ''
            }`,
          );
        }
      } else if (failedCount > 0) {
        showToast('Erreur lors du déplacement des médias');
      }
    } finally {
      setMovingBatch(false);
    }
  };

  const handleFolderDragOver = (e: DragEvent, targetFolderPath: string) => {
    const types = Array.from(e.dataTransfer.types ?? []);
    const hasAsset =
      isDraggingAssets ||
      types.includes(ASSET_DRAG_MIME) ||
      types.includes(ASSET_LIST_DRAG_MIME);
    const hasFiles = isExternalFileDrag(e.dataTransfer, draggingAssetIds);
    if (!hasAsset && !hasFiles) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasAsset ? 'move' : 'copy';
    setIsDragging(false);
    if (dragOverFolderPath !== targetFolderPath) {
      setDragOverFolderPath(targetFolderPath);
    }
  };

  const handleFolderDragLeave = (e: DragEvent<HTMLElement>, targetFolderPath: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverFolderPath((curr) => (curr === targetFolderPath ? null : curr));
  };

  const handleFolderDrop = (e: DragEvent, targetFolderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderPath(null);
    setIsDragging(false);

    const droppedAssetIds = extractDraggedAssetIds(e.dataTransfer, draggingAssetIds);
    setDraggingAssetIds([]);

    if (droppedAssetIds.length > 0) {
      void handleMoveAssetsToFolder(droppedAssetIds, targetFolderPath);
      return;
    }

    if (e.dataTransfer.files?.length) {
      void handleUploadFiles(e.dataTransfer.files, targetFolderPath);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    if (!isExternalFileDrag(e.dataTransfer, draggingAssetIds)) return;
    e.preventDefault();
    if (activeProjectId && workspaceMode === 'media') setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    if (!isExternalFileDrag(e.dataTransfer, draggingAssetIds)) {
      setDraggingAssetIds([]);
      setDragOverFolderPath(null);
      return;
    }
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

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (e.shiftKey) {
          setPanelLayout((prev) => ({ ...prev, rightOpen: !prev.rightOpen }));
        } else {
          setPanelLayout((prev) => ({ ...prev, leftOpen: !prev.leftOpen }));
        }
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

      if (e.key === 'Escape' && multiSelectedIds.length > 0 && !lightboxAssetId) {
        e.preventDefault();
        setMultiSelectedIds([]);
        setSelectionAnchorId(null);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && workspaceMode === 'media' && !lightboxAssetId) {
        if (filteredAssets.length > 0) {
          e.preventDefault();
          const allIds = filteredAssets.map((a) => a.id);
          setMultiSelectedIds(allIds);
          setSelectionAnchorId(allIds[allIds.length - 1] ?? null);
        }
        return;
      }

      const key = e.key.toLowerCase();

      // Quick triage on selected asset (A = Approve, R = Needs revision, 1..5 = Rating)
      if (
        selectedAsset &&
        workspaceMode !== 'sketch' &&
        !textEditorTarget &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
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
    filteredAssets,
    lightboxAssetId,
    multiSelectedIds.length,
    selectedAsset,
    showCommandPalette,
    showMcpModal,
    showNewProject,
    showShortcutsHelp,
    showToast,
    textEditorTarget,
    workspaceMode,
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
      ...(activeProjectId
        ? [
            {
              id: 'action-new-text-doc',
              category: 'action' as const,
              label: 'Nouveau fichier texte (.md, .txt, .log, .json)',
              subtitle: 'Ouvre l’éditeur enrichi pour créer un document dans Médias',
              keywords: ['markdown', 'md', 'txt', 'log', 'notes', 'document', 'texte', 'editeur'],
              onSelect: () => setTextEditorTarget({ mode: 'create' }),
            },
            {
              id: 'action-new-whiteboard',
              category: 'action' as const,
              label: 'Dessiner un croquis sur feuille blanche',
              subtitle: 'Ouvre une feuille blanche à main levée prête pour le storyboard',
              keywords: ['croquis', 'feuille', 'blanche', 'dessin', 'storyboard', 'sketch'],
              onSelect: () => {
                setSketchLaunchRequest({ kind: 'whiteboard', nonce: Date.now() });
                setWorkspaceMode('sketch');
              },
            },
            {
              id: 'action-open-sketch-board',
              category: 'action' as const,
              label: 'Ouvrir le Storyboard Croquis (planche côte à côte)',
              subtitle: 'Séquencer les croquis et les synchroniser avec Pré-prod',
              keywords: ['storyboard', 'croquis', 'planche', 'board', 'sketch'],
              onSelect: () => {
                setSketchLaunchRequest({ kind: 'board', nonce: Date.now() });
                setWorkspaceMode('sketch');
              },
            },
          ]
        : []),
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
        subtitle: 'J/K/L, A/R, 1-5, Cmd+K, Ctrl+B',
        shortcut: '?',
        keywords: ['help', 'keyboard', 'raccourcis'],
        onSelect: () => setShowShortcutsHelp(true),
      },
      {
        id: 'action-toggle-left-panel',
        category: 'action',
        label: panelLayout.leftOpen
          ? 'Masquer le panneau gauche (Projets)'
          : 'Afficher le panneau gauche (Projets)',
        subtitle: 'Libérer de la place à gauche',
        shortcut: 'Ctrl+B',
        keywords: ['sidebar', 'gauche', 'projets', 'masquer', 'panel'],
        onSelect: () => setPanelLayout((prev) => ({ ...prev, leftOpen: !prev.leftOpen })),
      },
      {
        id: 'action-toggle-right-panel',
        category: 'action',
        label: panelLayout.rightOpen
          ? "Masquer le panneau droit (Inspecteur / Live)"
          : "Afficher le panneau droit (Inspecteur / Live)",
        subtitle: 'Libérer de la place à droite',
        shortcut: 'Ctrl+Shift+B',
        keywords: ['inspector', 'droite', 'live', 'masquer', 'panel'],
        onSelect: () => setPanelLayout((prev) => ({ ...prev, rightOpen: !prev.rightOpen })),
      },
      {
        id: 'action-reset-panels',
        category: 'action',
        label: 'Réinitialiser la largeur des panneaux',
        subtitle: 'Rétablir les panneaux gauche et droit par défaut',
        keywords: ['layout', 'reset', 'largeur', 'resize', 'panneaux'],
        onSelect: () => setPanelLayout({ ...DEFAULT_PANEL_LAYOUT }),
      },
    ];

    const tabs: Array<{ mode: WorkspaceMode; label: string; subtitle: string }> = [
      { mode: 'media', label: 'Module Médias', subtitle: 'Galerie DAM, dossiers et versions' },
      {
        mode: 'sketch',
        label: 'Module Croquis & Plans',
        subtitle: 'Blocking caméra/personnages, mouvements & dessin à main levée',
      },
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
  }, [assets, panelLayout.leftOpen, panelLayout.rightOpen, projects, showToast]);

  return (
    <div className={`studio-shell ${resizingSide ? 'is-resizing' : ''}`}>
      {/* Left Sidebar: Projects & Server Status */}
      {panelLayout.leftOpen && (
        <>
          <aside className="sidebar" style={{ width: panelLayout.leftWidth }}>
            <div className="sidebar-brand">
              <div className="brand-mark">
                <div className="brand-icon" aria-hidden="true">
                  <Clapperboard size={17} />
                </div>
                <div>
                  <div className="brand-title">VideoStudio</div>
                  <div className="brand-sub">v0.8.1 · MCP · LAN</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 2 }}>
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
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPanelLayout((prev) => ({ ...prev, leftOpen: false }))}
                  title="Masquer le panneau Projets (Ctrl+B)"
                  aria-label="Masquer le panneau gauche"
                >
                  <PanelLeftClose size={14} />
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

          <div
            className={`panel-resizer panel-resizer-left ${resizingSide === 'left' ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau gauche"
            tabIndex={0}
            title="Glisser pour redimensionner · Double-cliquer pour réinitialiser"
            onPointerDown={(e) => startPanelResize('left', e)}
            onDoubleClick={() =>
              setPanelLayout((prev) => ({ ...prev, leftWidth: LEFT_PANEL_DEFAULT_WIDTH }))
            }
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                nudgePanelWidth('left', -16);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nudgePanelWidth('left', 16);
              }
            }}
          />
        </>
      )}

      {/* Center Workspace */}
      <main
        className="workspace"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
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
          <div className="workspace-header-left">
            <button
              type="button"
              className={`btn btn-ghost btn-sm panel-toggle-btn ${!panelLayout.leftOpen ? 'panel-closed' : ''}`}
              onClick={() => setPanelLayout((prev) => ({ ...prev, leftOpen: !prev.leftOpen }))}
              title={
                panelLayout.leftOpen
                  ? 'Masquer le panneau Projets (Ctrl+B)'
                  : 'Afficher le panneau Projets (Ctrl+B)'
              }
              aria-label={
                panelLayout.leftOpen ? 'Masquer le panneau gauche' : 'Afficher le panneau gauche'
              }
              aria-pressed={panelLayout.leftOpen}
            >
              {panelLayout.leftOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>

            {activeProject ? (
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
            ) : (
              <div className="workspace-title-group">
                <h1 className="workspace-h1">VideoStudio</h1>
                <div className="workspace-subtitle">
                  Sélectionne ou crée un projet pour commencer
                </div>
              </div>
            )}
          </div>

          <div className="workspace-actions">
            {activeProject && (
              <>
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
                  className="btn btn-secondary"
                  onClick={() => setTextEditorTarget({ mode: 'create' })}
                  title="Créer un nouveau fichier texte (.md, .txt, .log, .json…) dans l'éditeur enrichi"
                >
                  <FileText size={14} /> Nouveau texte
                </button>
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
              </>
            )}

            <button
              type="button"
              className={`btn btn-ghost btn-sm panel-toggle-btn ${!panelLayout.rightOpen ? 'panel-closed' : ''}`}
              onClick={() => setPanelLayout((prev) => ({ ...prev, rightOpen: !prev.rightOpen }))}
              title={
                panelLayout.rightOpen
                  ? "Masquer l'Inspecteur & Live (Ctrl+Shift+B)"
                  : "Afficher l'Inspecteur & Live (Ctrl+Shift+B)"
              }
              aria-label={
                panelLayout.rightOpen ? 'Masquer le panneau droit' : 'Afficher le panneau droit'
              }
              aria-pressed={panelLayout.rightOpen}
            >
              {panelLayout.rightOpen ? (
                <PanelRightClose size={15} />
              ) : (
                <PanelRightOpen size={15} />
              )}
            </button>
          </div>
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
            className={`mode-tab ${workspaceMode === 'sketch' ? 'active' : ''}`}
            onClick={() => setWorkspaceMode('sketch')}
          >
            <PenTool size={14} /> Croquis & Plans
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
                  {(['all', 'image', 'video', 'audio', 'document'] as const).map((t) => (
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
                            : t === 'audio'
                              ? 'Audio'
                              : 'Docs'}
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

                  <div className="recent-filter-group">
                    <button
                      type="button"
                      className={`chip chip-recent ${recentWindow !== 'off' ? 'active' : ''}`}
                      onClick={() => {
                        if (recentWindow === 'off') {
                          setRecentWindow('24h');
                          setMediaSortBy('updated_desc');
                        } else {
                          setRecentWindow('off');
                        }
                      }}
                      title="Afficher uniquement les médias ajoutés ou modifiés récemment (tous dossiers confondus)"
                    >
                      <Clock size={12} /> Récents
                      {recent24hCount > 0 && (
                        <span className="recent-count-badge">{recent24hCount}</span>
                      )}
                    </button>
                    {recentWindow !== 'off' && (
                      <select
                        aria-label="Période des modifications récentes"
                        className="select-compact"
                        value={recentWindow}
                        onChange={(e) => setRecentWindow(e.target.value as RecentWindow)}
                      >
                        <option value="1h">1 heure</option>
                        <option value="24h">24 heures</option>
                        <option value="7d">7 jours</option>
                      </select>
                    )}
                  </div>

                  <select
                    aria-label="Trier les médias"
                    className="select-compact"
                    value={mediaSortBy}
                    onChange={(e) => setMediaSortBy(e.target.value as MediaSortBy)}
                  >
                    <option value="updated_desc">Tri : Récents (modifiés)</option>
                    <option value="created_desc">Tri : Récents (ajoutés)</option>
                    <option value="title_asc">Tri : Nom (A → Z)</option>
                    <option value="rating_desc">Tri : Note ★</option>
                    <option value="size_desc">Tri : Taille</option>
                  </select>

                  <div className="view-mode-switch" role="group" aria-label="Mode d'affichage des médias">
                    <button
                      type="button"
                      className={`view-mode-btn ${mediaViewMode === 'grid' ? 'active' : ''}`}
                      onClick={() => setMediaViewMode('grid')}
                      title="Miniatures (grille standard)"
                      aria-pressed={mediaViewMode === 'grid'}
                    >
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${mediaViewMode === 'large' ? 'active' : ''}`}
                      onClick={() => setMediaViewMode('large')}
                      title="Grandes miniatures"
                      aria-pressed={mediaViewMode === 'large'}
                    >
                      <Maximize2 size={14} />
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${mediaViewMode === 'list' ? 'active' : ''}`}
                      onClick={() => setMediaViewMode('list')}
                      title="Liste compacte"
                      aria-pressed={mediaViewMode === 'list'}
                    >
                      <List size={14} />
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${mediaViewMode === 'details' ? 'active' : ''}`}
                      onClick={() => setMediaViewMode('details')}
                      title="Détails (tableau complet)"
                      aria-pressed={mediaViewMode === 'details'}
                    >
                      <Table2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeProject && recentWindow !== 'off' && (
              <div className="recent-filter-banner" role="status">
                <div className="recent-filter-banner-text">
                  <Clock size={14} color="var(--accent-amber)" />
                  <strong>
                    Modifications & ajouts récents ({RECENT_WINDOW_LABELS[recentWindow]})
                  </strong>
                  <span>
                    · Tous les dossiers du projet · {filteredAssets.length} média(s)
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRecentWindow('off')}
                >
                  <X size={13} /> Retour au dossier
                </button>
              </div>
            )}

            {activeProject && (
              <div className="folder-bar">
                <div className="folder-breadcrumbs" aria-label="Chemin du dossier média">
                  <button
                    type="button"
                    className={`breadcrumb-btn ${currentFolderPath === '' && recentWindow === 'off' ? 'current' : ''} ${
                      isDraggingAssets ? 'drop-ready' : ''
                    } ${dragOverFolderPath === '' ? 'drop-target-active' : ''}`}
                    onClick={() => {
                      setRecentWindow('off');
                      setCurrentFolderPath('');
                    }}
                    onDragOver={(e) => handleFolderDragOver(e, '')}
                    onDragLeave={(e) => handleFolderDragLeave(e, '')}
                    onDrop={(e) => handleFolderDrop(e, '')}
                    title="Racine · Glisser un ou plusieurs médias ici pour les déplacer à la racine"
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
                          idx === breadcrumbSegments.length - 1 && recentWindow === 'off'
                            ? 'current'
                            : ''
                        } ${isDraggingAssets ? 'drop-ready' : ''} ${
                          dragOverFolderPath === seg.path ? 'drop-target-active' : ''
                        }`}
                        onClick={() => {
                          setRecentWindow('off');
                          setCurrentFolderPath(seg.path);
                        }}
                        onDragOver={(e) => handleFolderDragOver(e, seg.path)}
                        onDragLeave={(e) => handleFolderDragLeave(e, seg.path)}
                        onDrop={(e) => handleFolderDrop(e, seg.path)}
                        title={`/${seg.path} · Glisser un ou plusieurs médias ici pour les déplacer`}
                      >
                        {seg.name}
                      </button>
                    </span>
                  ))}
                  {currentFolderPath && (
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${isDraggingAssets ? 'drop-ready' : ''} ${
                        dragOverFolderPath === getParentFolder(currentFolderPath)
                          ? 'drop-target-active'
                          : ''
                      }`}
                      title="Remonter au dossier parent · Glisser un ou plusieurs médias ici pour les remonter d'un niveau"
                      onClick={() => {
                        setRecentWindow('off');
                        setCurrentFolderPath(getParentFolder(currentFolderPath));
                      }}
                      onDragOver={(e) =>
                        handleFolderDragOver(e, getParentFolder(currentFolderPath))
                      }
                      onDragLeave={(e) =>
                        handleFolderDragLeave(e, getParentFolder(currentFolderPath))
                      }
                      onDrop={(e) => handleFolderDrop(e, getParentFolder(currentFolderPath))}
                    >
                      <CornerLeftUp size={13} /> Parent
                    </button>
                  )}
                </div>

                <div className="folder-actions">
                  {filteredAssets.length > 1 && (
                    <button
                      type="button"
                      className={`chip ${
                        multiSelectedIds.length > 0 &&
                        multiSelectedIds.length === filteredAssets.length
                          ? 'active'
                          : ''
                      }`}
                      onClick={() =>
                        multiSelectedIds.length === filteredAssets.length
                          ? handleClearMultiSelection()
                          : handleSelectAllVisible()
                      }
                      title="Tout sélectionner dans cette vue (Ctrl/Cmd+A)"
                    >
                      <CheckSquare size={12} />{' '}
                      {multiSelectedIds.length === filteredAssets.length
                        ? 'Tout désélectionner'
                        : 'Tout sélectionner'}
                    </button>
                  )}

                  {recentWindow === 'off' && (
                    <button
                      type="button"
                      className={`chip ${includeSubfolders ? 'active' : ''}`}
                      onClick={() => setIncludeSubfolders((v) => !v)}
                      title="Afficher aussi les médias contenus dans les sous-dossiers"
                    >
                      {includeSubfolders
                        ? 'Vue à plat (sous-dossiers inclus)'
                        : 'Inclure sous-dossiers'}
                    </button>
                  )}

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

            {activeProject && multiSelectedIds.length > 0 && (
              <div className="bulk-selection-bar" role="region" aria-label="Actions groupées">
                <div className="bulk-selection-info">
                  <CheckSquare size={14} color="var(--accent-amber)" />
                  <strong>
                    {multiSelectedIds.length}{' '}
                    {multiSelectedIds.length > 1 ? 'médias sélectionnés' : 'média sélectionné'}
                  </strong>
                  <span className="bulk-selection-hint">
                    · Glisse une carte vers un dossier ou choisis une destination :
                  </span>
                </div>

                <div className="bulk-selection-controls">
                  <select
                    aria-label="Dossier de destination pour les médias sélectionnés"
                    className="select-compact"
                    value={bulkMoveTarget}
                    onChange={(e) => setBulkMoveTarget(e.target.value)}
                  >
                    <option value="">/ (Racine)</option>
                    {folders.map((folder) => (
                      <option key={folder.path} value={folder.path}>
                        /{folder.path}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={movingBatch}
                    onClick={() => void handleMoveAssetsToFolder(multiSelectedIds, bulkMoveTarget)}
                  >
                    <FolderInput size={13} /> {movingBatch ? 'Déplacement...' : 'Déplacer ici'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleClearMultiSelection}
                    title="Effacer la sélection (Échap)"
                  >
                    <X size={13} /> Effacer
                  </button>
                </div>
              </div>
            )}

            {activeProject && isDraggingAssets && folders.length > 0 && (
              <div className="folder-drop-dock" aria-label="Déposer dans un dossier du projet">
                <span className="folder-drop-dock-label">
                  {draggingAssetIds.length > 1
                    ? `Déplacer ${draggingAssetIds.length} médias vers :`
                    : 'Déplacer vers :'}
                </span>
                <button
                  type="button"
                  className={`folder-drop-pill ${dragOverFolderPath === '' ? 'drop-target-active' : ''}`}
                  onDragOver={(e) => handleFolderDragOver(e, '')}
                  onDragLeave={(e) => handleFolderDragLeave(e, '')}
                  onDrop={(e) => handleFolderDrop(e, '')}
                >
                  <Folder size={12} /> Racine
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    className={`folder-drop-pill ${
                      dragOverFolderPath === folder.path ? 'drop-target-active' : ''
                    }`}
                    onDragOver={(e) => handleFolderDragOver(e, folder.path)}
                    onDragLeave={(e) => handleFolderDragLeave(e, folder.path)}
                    onDrop={(e) => handleFolderDrop(e, folder.path)}
                  >
                    <Folder size={12} color="var(--accent-amber)" /> /{folder.path}
                  </button>
                ))}
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
                  {recentWindow === 'off' && !includeSubfolders && childFolders.length > 0 && (
                    <div className="folder-grid" aria-label="Sous-dossiers">
                      {childFolders.map((folder) => {
                        const isOver = dragOverFolderPath === folder.path;
                        return (
                          <div
                            key={folder.path}
                            className={`folder-card ${isDraggingAssets ? 'drop-ready' : ''} ${
                              isOver ? 'drop-target-active' : ''
                            }`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setCurrentFolderPath(folder.path)}
                            onDragOver={(e) => handleFolderDragOver(e, folder.path)}
                            onDragLeave={(e) => handleFolderDragLeave(e, folder.path)}
                            onDrop={(e) => handleFolderDrop(e, folder.path)}
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
                                  {isOver
                                    ? draggingAssetIds.length > 1
                                      ? `Déposer ${draggingAssetIds.length} médias ici`
                                      : 'Déposer ici'
                                    : `${folder.totalRecursiveCount} média(s)`}
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
                        );
                      })}
                    </div>
                  )}

                  {filteredAssets.length === 0 ? (
                    <div className="empty-state">
                      <Upload size={34} color="var(--text-muted)" />
                      <h2>
                        {recentWindow !== 'off'
                          ? `Aucune modification sur : ${RECENT_WINDOW_LABELS[recentWindow]}`
                          : currentFolderPath
                            ? `Aucun média dans /${currentFolderPath}`
                            : 'Aucun média dans cette vue'}
                      </h2>
                      <p>
                        {recentWindow !== 'off' ? (
                          <>Essaie d'élargir la période (24h / 7 jours) ou reviens à la vue dossiers.</>
                        ) : (
                          <>
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
                          </>
                        )}
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {recentWindow !== 'off' ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setRecentWindow('off')}
                          >
                            Afficher tous les médias
                          </button>
                        ) : (
                          <>
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
                          </>
                        )}
                      </div>
                    </div>
                  ) : mediaViewMode === 'list' ? (
                    <MediaListView
                      assets={filteredAssets}
                      selectedAssetId={selectedAssetId}
                      multiSelectedIds={multiSelectedIds}
                      draggingAssetSet={draggingAssetSet}
                      sortBy={mediaSortBy}
                      onChangeSort={setMediaSortBy}
                      onSelect={handleSelectAssetCard}
                      onToggleCheck={handleToggleAssetCheck}
                      onDoubleClick={(item) => {
                        setSelectedAssetId(item.id);
                        if (
                          item.type === 'document' &&
                          isEditableTextFile(item.originalFilename, item.mimeType)
                        ) {
                          setTextEditorTarget({ mode: 'edit', asset: item });
                        } else {
                          setLightboxAssetId(item.id);
                        }
                      }}
                      onCopyRef={(ref) => handleCopyText(ref, 'Référence Claude')}
                      onNavigateFolder={(folderPath) => {
                        setRecentWindow('off');
                        setCurrentFolderPath(folderPath);
                      }}
                      onDragStartAsset={(item) =>
                        setDraggingAssetIds(resolveDragAssetIds(item.id, multiSelectedIds))
                      }
                      onDragEndAsset={() => {
                        setDraggingAssetIds([]);
                        setDragOverFolderPath(null);
                      }}
                    />
                  ) : mediaViewMode === 'details' ? (
                    <MediaDetailsTable
                      assets={filteredAssets}
                      selectedAssetId={selectedAssetId}
                      multiSelectedIds={multiSelectedIds}
                      draggingAssetSet={draggingAssetSet}
                      sortBy={mediaSortBy}
                      onChangeSort={setMediaSortBy}
                      onSelect={handleSelectAssetCard}
                      onToggleCheck={handleToggleAssetCheck}
                      onToggleSelectAll={() =>
                        multiSelectedIds.length === filteredAssets.length
                          ? handleClearMultiSelection()
                          : handleSelectAllVisible()
                      }
                      onDoubleClick={(item) => {
                        setSelectedAssetId(item.id);
                        if (
                          item.type === 'document' &&
                          isEditableTextFile(item.originalFilename, item.mimeType)
                        ) {
                          setTextEditorTarget({ mode: 'edit', asset: item });
                        } else {
                          setLightboxAssetId(item.id);
                        }
                      }}
                      onCopyRef={(ref) => handleCopyText(ref, 'Référence Claude')}
                      onNavigateFolder={(folderPath) => {
                        setRecentWindow('off');
                        setCurrentFolderPath(folderPath);
                      }}
                      onDragStartAsset={(item) =>
                        setDraggingAssetIds(resolveDragAssetIds(item.id, multiSelectedIds))
                      }
                      onDragEndAsset={() => {
                        setDraggingAssetIds([]);
                        setDragOverFolderPath(null);
                      }}
                    />
                  ) : (
                    <div
                      className={`gallery-grid ${
                        mediaViewMode === 'large' ? 'gallery-grid-large' : ''
                      }`}
                    >
                      {filteredAssets.map((asset) => {
                        const dragIdsForCard = resolveDragAssetIds(asset.id, multiSelectedIds);
                        return (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            selected={asset.id === selectedAssetId}
                            checked={multiSelectedSet.has(asset.id)}
                            selectionMode={multiSelectedIds.length > 0}
                            dragging={draggingAssetSet.has(asset.id)}
                            dragAssetIds={dragIdsForCard}
                            showRecentStamp={
                              recentWindow !== 'off' ||
                              mediaSortBy === 'updated_desc' ||
                              mediaSortBy === 'created_desc'
                            }
                            onSelect={handleSelectAssetCard}
                            onToggleCheck={handleToggleAssetCheck}
                            onDoubleClick={(item) => {
                              setSelectedAssetId(item.id);
                              if (
                                item.type === 'document' &&
                                isEditableTextFile(item.originalFilename, item.mimeType)
                              ) {
                                setTextEditorTarget({ mode: 'edit', asset: item });
                              } else {
                                setLightboxAssetId(item.id);
                              }
                            }}
                            onCopyRef={(ref) => handleCopyText(ref, 'Référence Claude')}
                            onNavigateFolder={(folderPath) => {
                              setRecentWindow('off');
                              setCurrentFolderPath(folderPath);
                            }}
                            onDragStartAsset={(item) =>
                              setDraggingAssetIds(resolveDragAssetIds(item.id, multiSelectedIds))
                            }
                            onDragEndAsset={() => {
                              setDraggingAssetIds([]);
                              setDragOverFolderPath(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {workspaceMode === 'sketch' && activeProject && (
          <SketchStudioPanel
            project={activeProject}
            assets={assets}
            folders={folders}
            launchRequest={sketchLaunchRequest}
            refreshSignal={sketchRefresh + stage3Refresh}
            onSketchSaved={() => {
              if (activeProjectId) {
                void api.listAssets(activeProjectId).then(setAssets);
                void refreshFolders(activeProjectId);
              }
            }}
            onOpenPreprodStoryboard={() => {
              setPreprodSubTab('storyboard');
              setWorkspaceMode('preprod');
            }}
            onAssetsMutated={() => {
              if (activeProjectId) {
                void api.listAssets(activeProjectId).then(setAssets);
                void refreshFolders(activeProjectId);
              }
            }}
            onCopyText={handleCopyText}
            onNotify={showToast}
          />
        )}

        {workspaceMode === 'preprod' && (
          <PreprodPanel
            project={activeProject}
            assets={assets}
            refreshSignal={stage3Refresh + sketchRefresh}
            initialSubTab={preprodSubTab}
            onOpenSketchBoard={() => {
              setSketchLaunchRequest({ kind: 'board', nonce: Date.now() });
              setWorkspaceMode('sketch');
            }}
            onEditSketch={(sketchId) => {
              setSketchLaunchRequest({ kind: 'edit_sketch', sketchId, nonce: Date.now() });
              setWorkspaceMode('sketch');
            }}
            onDrawSketchForShot={(shot) => {
              setSketchLaunchRequest({
                kind: 'whiteboard',
                shotId: shot.id || undefined,
                title: shot.title,
                durationSec: shot.durationSec,
                nonce: Date.now(),
              });
              setWorkspaceMode('sketch');
            }}
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
      {panelLayout.rightOpen && (
        <>
          <div
            className={`panel-resizer panel-resizer-right ${resizingSide === 'right' ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau droit"
            tabIndex={0}
            title="Glisser pour redimensionner · Double-cliquer pour réinitialiser"
            onPointerDown={(e) => startPanelResize('right', e)}
            onDoubleClick={() =>
              setPanelLayout((prev) => ({ ...prev, rightWidth: RIGHT_PANEL_DEFAULT_WIDTH }))
            }
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                nudgePanelWidth('right', 16);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nudgePanelWidth('right', -16);
              }
            }}
          />

          <aside className="inspector" style={{ width: panelLayout.rightWidth }}>
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
              <button
                type="button"
                className="inspector-close-btn"
                onClick={() => setPanelLayout((prev) => ({ ...prev, rightOpen: false }))}
                title="Masquer le panneau droit (Ctrl+Shift+B)"
                aria-label="Masquer le panneau droit"
              >
                <PanelRightClose size={14} />
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
                      leftId:
                        compareWith?.id ??
                        assets.find((a) => a.id !== target.id)?.id ??
                        target.id,
                      rightId: target.id,
                    });
                    setWorkspaceMode('compare');
                  }}
                  onEditSketch={(sketchId) => {
                    setSketchLaunchRequest({ kind: 'edit_sketch', sketchId, nonce: Date.now() });
                    setWorkspaceMode('sketch');
                  }}
                  onSketchOverAsset={(targetAsset) => {
                    setSketchLaunchRequest({
                      kind: 'underlay',
                      asset: targetAsset,
                      nonce: Date.now(),
                    });
                    setWorkspaceMode('sketch');
                  }}
                  onOpenTextEditor={(targetAsset) =>
                    setTextEditorTarget({ mode: 'edit', asset: targetAsset })
                  }
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
        </>
      )}

      {lightboxAsset && (
        <MediaLightbox
          asset={lightboxAsset}
          assets={filteredAssets.length > 0 ? filteredAssets : assets}
          onClose={() => setLightboxAssetId(null)}
          onNavigate={(target) => {
            setSelectedAssetId(target.id);
            setLightboxAssetId(target.id);
          }}
          onOpenTextEditor={(targetAsset) => {
            setLightboxAssetId(null);
            setTextEditorTarget({ mode: 'edit', asset: targetAsset });
          }}
          onCopyText={handleCopyText}
        />
      )}

      {textEditorTarget && activeProjectId && (
        <TextDocumentEditorModal
          asset={textEditorTarget.mode === 'edit' ? textEditorTarget.asset : null}
          projectId={activeProjectId}
          folders={folders}
          defaultFolderPath={currentFolderPath}
          onClose={() => setTextEditorTarget(null)}
          onSaved={(savedAsset, isNew) => {
            setAssets((prev) =>
              isNew
                ? [savedAsset, ...prev.filter((a) => a.id !== savedAsset.id)]
                : prev.map((a) => (a.id === savedAsset.id ? savedAsset : a)),
            );
            setSelectedAssetId(savedAsset.id);
            setTextEditorTarget({ mode: 'edit', asset: savedAsset });
            void refreshFolders(activeProjectId);
          }}
          onCopyText={handleCopyText}
          onNotify={showToast}
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

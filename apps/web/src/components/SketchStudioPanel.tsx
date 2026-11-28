import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  Box,
  Camera,
  Check,
  Circle,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  Film,
  Grid3x3,
  Highlighter,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  Link2,
  Minus,
  MousePointer2,
  Move,
  PenTool,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  User,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildScenePlanTemplate,
  CAMERA_MOVEMENT_LABELS,
  createEmptySketchScene,
  createWhiteboardSketchScene,
  generateAiDirectorBrief,
  getCanvasDimensionsForAspectRatio,
  isLightCanvasColor,
  SCENE_PLAN_TEMPLATES,
  SHOT_SIZE_LABELS,
  sortSketchesForBoard,
  type AssetDto,
  type BibleEntityDto,
  type MediaFolderDto,
  type ProjectDto,
  type SceneDto,
  type ScenePlanTemplateId,
  type SketchCameraMovement,
  type SketchGuideType,
  type SketchLightKind,
  type SketchMode,
  type SketchMotionArrow,
  type SketchMotionTarget,
  type SketchPropKind,
  type SketchSceneData,
  type SketchShape,
  type SketchShapeKind,
  type SketchShotSize,
  type SketchStroke,
  type SketchDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import {
  eraseStrokesNearPoint,
  getRotationHandlePos,
  hitTestSketchScene,
  renderSketchToCanvas,
  type SelectedSketchItem,
} from '../utils/sketch-renderer';
import { SketchStoryboardView } from './SketchStoryboardView';

type ActiveTool =
  | 'select'
  | 'camera'
  | 'character'
  | 'light'
  | 'prop'
  | 'motion_arrow'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'shape_line'
  | 'shape_arrow'
  | 'shape_rect'
  | 'shape_ellipse'
  | 'shape_zoom_in'
  | 'shape_zoom_out'
  | 'text';

const PALETTE_COLORS = [
  '#111827',
  '#334155',
  '#e5a038',
  '#dc2626',
  '#2563eb',
  '#f8fafc',
  '#38bdf8',
  '#34d399',
  '#f472b6',
  '#fbbf24',
];

const PAPER_PRESETS = [
  { id: 'dark', label: 'Sombre', hex: '#131720' },
  { id: 'white', label: 'Feuille blanche', hex: '#ffffff' },
  { id: 'cream', label: 'Papier crème', hex: '#f8f4e8' },
  { id: 'slate', label: 'Ardoise', hex: '#1e293b' },
] as const;

const FOCAL_PRESETS = [24, 35, 50, 85, 135];
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '2.39:1'];

const GUIDE_OPTIONS: Array<{ id: SketchGuideType; label: string }> = [
  { id: 'grid', label: 'Grille' },
  { id: 'thirds', label: 'Tiers 3×3' },
  { id: 'golden', label: 'Diagonales' },
  { id: 'crosshair', label: 'Croix' },
  { id: 'safe_frames', label: 'Safe 90/80' },
];

const PROP_KIND_LABELS: Record<SketchPropKind, string> = {
  wall: 'Mur / Cloison',
  table: 'Table / Objet',
  door: 'Porte',
  window: 'Fenêtre',
  mark: 'Repère X (Mark)',
  zone: 'Zone décor',
  vehicle: 'Véhicule',
};

const LIGHT_KIND_LABELS: Record<SketchLightKind, string> = {
  key: 'Key Light',
  fill: 'Fill Light',
  rim: 'Rim / Backlight',
  practical: 'Practical (Lampe)',
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clamp01(v: number): number {
  return Math.max(0.01, Math.min(0.99, v));
}

function normalizeDeg(deg: number): number {
  let d = Math.round(deg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export type SketchLaunchRequest =
  | { kind: 'edit_sketch'; sketchId: string; nonce: number }
  | { kind: 'underlay'; asset: AssetDto; nonce: number }
  | { kind: 'board'; nonce: number }
  | {
      kind: 'whiteboard';
      shotId?: string;
      title?: string;
      durationSec?: number;
      nonce: number;
    };

export interface SketchStudioPanelProps {
  project: ProjectDto;
  assets: AssetDto[];
  folders: MediaFolderDto[];
  launchRequest?: SketchLaunchRequest | null;
  refreshSignal: number;
  onSketchSaved: (sketch: SketchDto) => void;
  onOpenPreprodStoryboard: () => void;
  onAssetsMutated?: () => void;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (message: string) => void;
}

export function SketchStudioPanel({
  project,
  assets,
  folders,
  launchRequest,
  refreshSignal,
  onSketchSaved,
  onOpenPreprodStoryboard,
  onAssetsMutated,
  onCopyText,
  onNotify,
}: SketchStudioPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);

  const [studioView, setStudioView] = useState<'editor' | 'board'>('editor');
  const [sketches, setSketches] = useState<SketchDto[]>([]);
  const [preprodScenes, setPreprodScenes] = useState<SceneDto[]>([]);
  const [bibleCharacters, setBibleCharacters] = useState<BibleEntityDto[]>([]);
  const [editingSketchId, setEditingSketchId] = useState<string | null>(null);
  const [linkedAssetRef, setLinkedAssetRef] = useState<string | null>(null);
  const [linkedShotId, setLinkedShotId] = useState<string | null>(null);
  const [linkedShotHandle, setLinkedShotHandle] = useState<string | null>(null);

  const [title, setTitle] = useState('Plan S01 — Blocking');
  const [mode, setMode] = useState<SketchMode>('scene_plan');
  const [aspectRatio, setAspectRatio] = useState(project.aspectRatio || '16:9');
  const [folderPath, setFolderPath] = useState('plans');
  const [inSketchBoard, setInSketchBoard] = useState(true);
  const [durationSec, setDurationSec] = useState(3);
  const [caption, setCaption] = useState('');
  const [saveMode, setSaveMode] = useState<'new_version' | 'replace'>('new_version');
  const [includeGuidesInExport, setIncludeGuidesInExport] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scene, setScene] = useState<SketchSceneData>(() => createEmptySketchScene('scene_plan'));
  const [undoStack, setUndoStack] = useState<SketchSceneData[]>([]);
  const [redoStack, setRedoStack] = useState<SketchSceneData[]>([]);

  const [tool, setTool] = useState<ActiveTool>('select');
  const [activeColor, setActiveColor] = useState('#e5a038');
  const [brushWidth, setBrushWidth] = useState(4);
  const [arrowTarget, setArrowTarget] = useState<SketchMotionTarget>('camera');
  const [arrowDashed, setArrowDashed] = useState(true);
  const [propKind, setPropKind] = useState<SketchPropKind>('table');
  const [lightKind, setLightKind] = useState<SketchLightKind>('key');

  const [selected, setSelected] = useState<SelectedSketchItem | null>(null);
  const [underlayImage, setUnderlayImage] = useState<HTMLImageElement | null>(null);

  // Live drag / draw refs (kept out of React state for 60fps pointer responsiveness)
  const previewStrokeRef = useRef<SketchStroke | null>(null);
  const previewArrowRef = useRef<SketchMotionArrow | null>(null);
  const previewShapeRef = useRef<SketchShape | null>(null);
  const dragStateRef = useRef<
    | null
    | { type: 'move'; item: SelectedSketchItem; startNx: number; startNy: number; origScene: SketchSceneData }
    | { type: 'rotate'; item: SelectedSketchItem; origScene: SketchSceneData }
    | { type: 'draw_stroke' }
    | { type: 'draw_arrow'; startNx: number; startNy: number }
    | { type: 'draw_shape'; kind: SketchShapeKind; startNx: number; startNy: number }
    | { type: 'erase'; changed: boolean; origScene: SketchSceneData }
  >(null);
  const [, setRenderTick] = useState(0);

  const imageAssets = useMemo(
    () => assets.filter((a) => a.type === 'image'),
    [assets],
  );

  const folderSuggestions = useMemo(() => {
    const set = new Set<string>(['plans', 'croquis', 'storyboard']);
    for (const f of folders) {
      if (f.path) set.add(f.path);
    }
    return [...set].sort();
  }, [folders]);

  const aiBrief = useMemo(
    () => generateAiDirectorBrief(scene, { title, mode, aspectRatio }),
    [scene, title, mode, aspectRatio],
  );

  const commitScene = useCallback(
    (updater: (prev: SketchSceneData) => SketchSceneData, pushHistory = true) => {
      setScene((prev) => {
        const next = updater(prev);
        if (pushHistory) {
          setUndoStack((u) => [...u.slice(-39), prev]);
          setRedoStack([]);
        }
        return next;
      });
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1]!;
      setRedoStack((r) => [...r, scene]);
      setScene(last);
      return prev.slice(0, -1);
    });
  }, [scene]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1]!;
      setUndoStack((u) => [...u, scene]);
      setScene(next);
      return prev.slice(0, -1);
    });
  }, [scene]);

  const boardCount = useMemo(() => sortSketchesForBoard(sketches).length, [sketches]);

  const loadSketchIntoEditor = useCallback((sk: SketchDto) => {
    setStudioView('editor');
    setEditingSketchId(sk.id);
    setLinkedAssetRef(sk.assetRef);
    setLinkedShotId(sk.shotId);
    setLinkedShotHandle(sk.shotHandle);
    setTitle(sk.title);
    setMode(sk.mode);
    setAspectRatio(sk.aspectRatio || '16:9');
    setFolderPath(sk.folderPath || (sk.mode === 'scene_plan' ? 'plans' : 'croquis'));
    setInSketchBoard(sk.inSketchBoard);
    setDurationSec(sk.durationSec || 3);
    setCaption(sk.caption || '');
    setScene(sk.sceneData);
    setSelected(null);
    setUndoStack([]);
    setRedoStack([]);
    if (isLightCanvasColor(sk.sceneData.backgroundColor)) {
      setActiveColor('#111827');
      setTool('pen');
    }
  }, []);

  const handleNewBlank = useCallback(
    (nextMode: SketchMode) => {
      setStudioView('editor');
      setEditingSketchId(null);
      setLinkedAssetRef(null);
      setLinkedShotId(null);
      setLinkedShotHandle(null);
      setMode(nextMode);
      setTitle(nextMode === 'scene_plan' ? 'Nouveau plan de scène' : 'Nouveau croquis');
      setAspectRatio(project.aspectRatio || '16:9');
      setFolderPath(nextMode === 'scene_plan' ? 'plans' : 'croquis');
      setInSketchBoard(true);
      setDurationSec(3);
      setCaption('');
      setScene(createEmptySketchScene(nextMode));
      setSelected(null);
      setUndoStack([]);
      setRedoStack([]);
      setTool(nextMode === 'storyboard_sketch' ? 'pen' : 'select');
      setActiveColor('#e5a038');
    },
    [project.aspectRatio],
  );

  const handleNewWhiteboard = useCallback(
    (opts?: { shotId?: string; title?: string; durationSec?: number; paperHex?: string }) => {
      const nextNum = sketches.length + 1;
      setStudioView('editor');
      setEditingSketchId(null);
      setLinkedAssetRef(null);
      setLinkedShotId(opts?.shotId ?? null);
      setLinkedShotHandle(null);
      setMode('storyboard_sketch');
      setTitle(opts?.title?.trim() || `Croquis #${String(nextNum).padStart(2, '0')}`);
      setAspectRatio(project.aspectRatio || '16:9');
      setFolderPath('croquis');
      setInSketchBoard(true);
      setDurationSec(opts?.durationSec ?? 3);
      setCaption('');
      setScene(createWhiteboardSketchScene(opts?.paperHex ?? '#ffffff'));
      setSelected(null);
      setUndoStack([]);
      setRedoStack([]);
      setTool('pen');
      setActiveColor('#111827');
      setBrushWidth(3);
    },
    [project.aspectRatio, sketches.length],
  );

  const handleSetPaperColor = useCallback((hex: string) => {
    commitScene((prev) => ({ ...prev, backgroundColor: hex }));
    if (isLightCanvasColor(hex)) {
      setActiveColor((curr) => (curr === '#f8fafc' ? '#111827' : curr));
    } else {
      setActiveColor((curr) => (curr === '#111827' ? '#f8fafc' : curr));
    }
  }, [commitScene]);

  // Load saved sketches, Pre-prod storyboard scenes & Bible characters for the active project
  useEffect(() => {
    let active = true;
    void api
      .listSketches(project.id)
      .then((list) => {
        if (active) setSketches(list);
      })
      .catch(() => {});

    void api
      .getStoryboard(project.id)
      .then((sb) => {
        if (active) setPreprodScenes(sb);
      })
      .catch(() => {});

    void api
      .listBibleEntities(project.id)
      .then((entities) => {
        if (active) setBibleCharacters(entities.filter((e) => e.entityType === 'character'));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [project.id, refreshSignal]);

  // Handle direct deep-launch requests from Media Inspector or Pre-prod Storyboard
  useEffect(() => {
    if (!launchRequest) return;
    if (launchRequest.kind === 'board') {
      setStudioView('board');
      return;
    }
    if (launchRequest.kind === 'whiteboard') {
      handleNewWhiteboard({
        shotId: launchRequest.shotId,
        title: launchRequest.title,
        durationSec: launchRequest.durationSec,
      });
      return;
    }
    if (launchRequest.kind === 'underlay') {
      setStudioView('editor');
      setEditingSketchId(null);
      setLinkedAssetRef(null);
      setLinkedShotId(null);
      setLinkedShotHandle(null);
      setMode('storyboard_sketch');
      setTitle(`Croquis sur ${launchRequest.asset.title}`);
      setFolderPath('croquis');
      setInSketchBoard(true);
      setDurationSec(3);
      setCaption('');
      setScene({
        ...createEmptySketchScene('storyboard_sketch'),
        underlay: {
          assetId: launchRequest.asset.id,
          assetRef: launchRequest.asset.refCode,
          opacity: 0.65,
        },
      });
      setTool('motion_arrow');
      setSelected(null);
      setUndoStack([]);
      setRedoStack([]);
      return;
    }
    if (launchRequest.kind === 'edit_sketch') {
      let active = true;
      void api
        .getSketch(launchRequest.sketchId)
        .then((sk) => {
          if (active) loadSketchIntoEditor(sk);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [launchRequest, loadSketchIntoEditor, handleNewWhiteboard]);

  // Load reference underlay image element whenever underlay.assetId changes
  const underlayAssetId = scene.underlay?.assetId ?? null;
  useEffect(() => {
    if (!underlayAssetId) {
      setUnderlayImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setUnderlayImage(img);
    img.onerror = () => setUnderlayImage(null);
    img.src = `/api/assets/${encodeURIComponent(underlayAssetId)}/file`;
  }, [underlayAssetId]);

  // Delete selected item
  const handleDeleteSelected = useCallback(() => {
    if (!selected) return;
    commitScene((prev) => {
      if (selected.kind === 'camera') {
        return { ...prev, cameras: prev.cameras.filter((c) => c.id !== selected.id) };
      }
      if (selected.kind === 'character') {
        return { ...prev, characters: prev.characters.filter((c) => c.id !== selected.id) };
      }
      if (selected.kind === 'light') {
        return { ...prev, lights: prev.lights.filter((l) => l.id !== selected.id) };
      }
      if (selected.kind === 'prop') {
        return { ...prev, props: prev.props.filter((p) => p.id !== selected.id) };
      }
      if (selected.kind === 'arrow') {
        return { ...prev, arrows: prev.arrows.filter((a) => a.id !== selected.id) };
      }
      if (selected.kind === 'shape') {
        return { ...prev, shapes: prev.shapes.filter((s) => s.id !== selected.id) };
      }
      return { ...prev, notes: prev.notes.filter((n) => n.id !== selected.id) };
    });
    setSelected(null);
  }, [selected, commitScene]);

  // Keyboard shortcuts inside Sketch Studio
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === 'v') setTool('select');
      else if (lower === 'b') setTool('pen');
      else if (lower === 'm') setTool('marker');
      else if (lower === 'e') setTool('eraser');
      else if (lower === 't') setTool('text');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelected, selected]);

  // Render canvas at crisp DPR whenever scene, selection, underlay, or aspect ratio changes
  const dims = useMemo(() => getCanvasDimensionsForAspectRatio(aspectRatio), [aspectRatio]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    renderSketchToCanvas(ctx, scene, {
      width: rect.width,
      height: rect.height,
      selected,
      underlayImage,
      forExport: false,
      previewStroke: previewStrokeRef.current,
      previewArrow: previewArrowRef.current,
      previewShape: previewShapeRef.current,
    });
    ctx.restore();
  }, [scene, selected, underlayImage]);

  useEffect(() => {
    drawFrame();
  }, [drawFrame, dims]);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => drawFrame());
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawFrame]);

  // Pointer coordinates normalized [0..1]
  const getPointerNorm = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      nx: clamp01((e.clientX - rect.left) / rect.width),
      ny: clamp01((e.clientY - rect.top) / rect.height),
      width: rect.width,
      height: rect.height,
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const { nx, ny, width, height } = getPointerNorm(e);

    if (tool === 'select') {
      // Check rotation handle first
      if (selected) {
        const handle = getRotationHandlePos(scene, selected, width, height);
        if (handle && Math.hypot((nx - handle.x) * width, (ny - handle.y) * height) <= 14) {
          dragStateRef.current = { type: 'rotate', item: selected, origScene: scene };
          return;
        }
      }
      const hit = hitTestSketchScene(scene, nx, ny, width, height);
      setSelected(hit);
      if (hit) {
        dragStateRef.current = {
          type: 'move',
          item: hit,
          startNx: nx,
          startNy: ny,
          origScene: scene,
        };
      }
      return;
    }

    if (tool === 'camera') {
      const id = makeId('cam');
      const idx = scene.cameras.length;
      const letter = String.fromCharCode(65 + (idx % 26));
      commitScene((prev) => ({
        ...prev,
        cameras: [
          ...prev.cameras,
          {
            id,
            label: `Cam ${letter}`,
            x: nx,
            y: ny,
            angleDeg: -90,
            focalMm: 35,
            shotSize: 'MS',
            movement: 'static',
            color: activeColor,
            notes: '',
          },
        ],
      }));
      setSelected({ kind: 'camera', id });
      setTool('select');
      return;
    }

    if (tool === 'character') {
      const id = makeId('char');
      const idx = scene.characters.length + 1;
      commitScene((prev) => ({
        ...prev,
        characters: [
          ...prev.characters,
          {
            id,
            label: `Perso ${idx}`,
            x: nx,
            y: ny,
            angleDeg: 90,
            color: activeColor === '#e5a038' ? '#38bdf8' : activeColor,
            action: '',
            pose: '',
          },
        ],
      }));
      setSelected({ kind: 'character', id });
      setTool('select');
      return;
    }

    if (tool === 'light') {
      const id = makeId('light');
      commitScene((prev) => ({
        ...prev,
        lights: [
          ...prev.lights,
          {
            id,
            label: LIGHT_KIND_LABELS[lightKind],
            kind: lightKind,
            x: nx,
            y: ny,
            angleDeg: 90,
            color: lightKind === 'rim' ? '#60a5fa' : '#fbbf24',
            intensity: 80,
          },
        ],
      }));
      setSelected({ kind: 'light', id });
      setTool('select');
      return;
    }

    if (tool === 'prop') {
      const id = makeId('prop');
      const isWall = propKind === 'wall';
      const isMark = propKind === 'mark';
      commitScene((prev) => ({
        ...prev,
        props: [
          ...prev.props,
          {
            id,
            label: PROP_KIND_LABELS[propKind],
            kind: propKind,
            x: nx,
            y: ny,
            w: isWall ? 0.32 : isMark ? 0.05 : 0.14,
            h: isWall ? 0.025 : isMark ? 0.05 : 0.09,
            angleDeg: 0,
            color: isMark ? '#f43f5e' : '#94a3b8',
          },
        ],
      }));
      setSelected({ kind: 'prop', id });
      setTool('select');
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Texte de l’annotation sur le plan / croquis :', 'PAN →');
      if (text && text.trim()) {
        const id = makeId('note');
        commitScene((prev) => ({
          ...prev,
          notes: [
            ...prev.notes,
            {
              id,
              text: text.trim(),
              x: nx,
              y: ny,
              color: activeColor,
              fontSize: 18,
              badge: true,
            },
          ],
        }));
        setSelected({ kind: 'note', id });
      }
      setTool('select');
      return;
    }

    if (tool === 'pen' || tool === 'marker') {
      previewStrokeRef.current = {
        id: makeId('stroke'),
        tool,
        color: activeColor,
        width: brushWidth,
        opacity: tool === 'marker' ? 0.4 : 1,
        points: [{ x: nx, y: ny }],
      };
      dragStateRef.current = { type: 'draw_stroke' };
      drawFrame();
      return;
    }

    if (tool === 'eraser') {
      const nextStrokes = eraseStrokesNearPoint(scene.strokes, nx, ny);
      const changed = nextStrokes.length !== scene.strokes.length;
      dragStateRef.current = { type: 'erase', changed, origScene: scene };
      if (changed) {
        setScene((prev) => ({ ...prev, strokes: nextStrokes }));
      }
      return;
    }

    if (tool === 'motion_arrow') {
      const color =
        arrowTarget === 'camera'
          ? '#e5a038'
          : arrowTarget === 'character'
            ? '#38bdf8'
            : activeColor;
      previewArrowRef.current = {
        id: makeId('arrow'),
        target: arrowTarget,
        label:
          arrowTarget === 'camera'
            ? 'Mouvement caméra'
            : arrowTarget === 'character'
              ? 'Trajectoire perso'
              : 'Mouvement',
        x1: nx,
        y1: ny,
        x2: nx,
        y2: ny,
        color,
        dashed: arrowDashed,
        width: Math.max(3, Math.min(8, brushWidth)),
      };
      dragStateRef.current = { type: 'draw_arrow', startNx: nx, startNy: ny };
      drawFrame();
      return;
    }

    if (tool.startsWith('shape_')) {
      const kind = tool.replace('shape_', '') as SketchShapeKind;
      previewShapeRef.current = {
        id: makeId('shape'),
        kind,
        x1: nx,
        y1: ny,
        x2: nx,
        y2: ny,
        color: activeColor,
        width: Math.max(2, Math.min(10, brushWidth)),
        fill: false,
        dashed: false,
      };
      dragStateRef.current = { type: 'draw_shape', kind, startNx: nx, startNy: ny };
      drawFrame();
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const { nx, ny, width, height } = getPointerNorm(e);

    if (drag.type === 'draw_stroke' && previewStrokeRef.current) {
      const pts = previewStrokeRef.current.points;
      const last = pts[pts.length - 1]!;
      if (Math.hypot(nx - last.x, ny - last.y) > 0.002) {
        pts.push({ x: nx, y: ny });
        drawFrame();
      }
      return;
    }

    if (drag.type === 'erase') {
      setScene((prev) => {
        const nextStrokes = eraseStrokesNearPoint(prev.strokes, nx, ny);
        if (nextStrokes.length !== prev.strokes.length) {
          drag.changed = true;
          return { ...prev, strokes: nextStrokes };
        }
        return prev;
      });
      return;
    }

    if (drag.type === 'draw_arrow' && previewArrowRef.current) {
      previewArrowRef.current = {
        ...previewArrowRef.current,
        x2: nx,
        y2: ny,
      };
      drawFrame();
      return;
    }

    if (drag.type === 'draw_shape' && previewShapeRef.current) {
      previewShapeRef.current = {
        ...previewShapeRef.current,
        x2: nx,
        y2: ny,
      };
      drawFrame();
      return;
    }

    if (drag.type === 'rotate') {
      setScene((prev) => {
        const updateAngle = <T extends { id: string; x: number; y: number; angleDeg: number }>(
          arr: T[],
        ) =>
          arr.map((item) => {
            if (item.id !== drag.item.id) return item;
            const deg = normalizeDeg(
              (Math.atan2((ny - item.y) * height, (nx - item.x) * width) * 180) / Math.PI,
            );
            return { ...item, angleDeg: deg };
          });
        if (drag.item.kind === 'camera') return { ...prev, cameras: updateAngle(prev.cameras) };
        if (drag.item.kind === 'character') return { ...prev, characters: updateAngle(prev.characters) };
        if (drag.item.kind === 'light') return { ...prev, lights: updateAngle(prev.lights) };
        if (drag.item.kind === 'prop') return { ...prev, props: updateAngle(prev.props) };
        return prev;
      });
      return;
    }

    if (drag.type === 'move') {
      const dx = nx - drag.startNx;
      const dy = ny - drag.startNy;
      const orig = drag.origScene;
      setScene((prev) => {
        if (drag.item.kind === 'camera') {
          return {
            ...prev,
            cameras: orig.cameras.map((c) =>
              c.id === drag.item.id ? { ...c, x: clamp01(c.x + dx), y: clamp01(c.y + dy) } : c,
            ),
          };
        }
        if (drag.item.kind === 'character') {
          return {
            ...prev,
            characters: orig.characters.map((c) =>
              c.id === drag.item.id ? { ...c, x: clamp01(c.x + dx), y: clamp01(c.y + dy) } : c,
            ),
          };
        }
        if (drag.item.kind === 'light') {
          return {
            ...prev,
            lights: orig.lights.map((l) =>
              l.id === drag.item.id ? { ...l, x: clamp01(l.x + dx), y: clamp01(l.y + dy) } : l,
            ),
          };
        }
        if (drag.item.kind === 'prop') {
          return {
            ...prev,
            props: orig.props.map((p) =>
              p.id === drag.item.id ? { ...p, x: clamp01(p.x + dx), y: clamp01(p.y + dy) } : p,
            ),
          };
        }
        if (drag.item.kind === 'note') {
          return {
            ...prev,
            notes: orig.notes.map((n) =>
              n.id === drag.item.id ? { ...n, x: clamp01(n.x + dx), y: clamp01(n.y + dy) } : n,
            ),
          };
        }
        if (drag.item.kind === 'arrow') {
          return {
            ...prev,
            arrows: orig.arrows.map((a) =>
              a.id === drag.item.id
                ? {
                    ...a,
                    x1: clamp01(a.x1 + dx),
                    y1: clamp01(a.y1 + dy),
                    x2: clamp01(a.x2 + dx),
                    y2: clamp01(a.y2 + dy),
                    cx: a.cx !== undefined ? clamp01(a.cx + dx) : undefined,
                    cy: a.cy !== undefined ? clamp01(a.cy + dy) : undefined,
                  }
                : a,
            ),
          };
        }
        if (drag.item.kind === 'shape') {
          return {
            ...prev,
            shapes: orig.shapes.map((s) =>
              s.id === drag.item.id
                ? {
                    ...s,
                    x1: clamp01(s.x1 + dx),
                    y1: clamp01(s.y1 + dy),
                    x2: clamp01(s.x2 + dx),
                    y2: clamp01(s.y2 + dy),
                  }
                : s,
            ),
          };
        }
        return prev;
      });
    }
  };

  const handlePointerUp = () => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    if (!drag) return;

    if (drag.type === 'draw_stroke' && previewStrokeRef.current) {
      const finished = previewStrokeRef.current;
      previewStrokeRef.current = null;
      commitScene((prev) => ({ ...prev, strokes: [...prev.strokes, finished] }));
      return;
    }

    if (drag.type === 'erase') {
      if (drag.changed) {
        setUndoStack((u) => [...u.slice(-39), drag.origScene]);
        setRedoStack([]);
      }
      return;
    }

    if (drag.type === 'draw_arrow' && previewArrowRef.current) {
      const finished = previewArrowRef.current;
      previewArrowRef.current = null;
      if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) > 0.02) {
        commitScene((prev) => ({ ...prev, arrows: [...prev.arrows, finished] }));
        setSelected({ kind: 'arrow', id: finished.id });
      }
      setRenderTick((t) => t + 1);
      return;
    }

    if (drag.type === 'draw_shape' && previewShapeRef.current) {
      const finished = previewShapeRef.current;
      previewShapeRef.current = null;
      if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) > 0.015) {
        commitScene((prev) => ({ ...prev, shapes: [...prev.shapes, finished] }));
        setSelected({ kind: 'shape', id: finished.id });
      }
      setRenderTick((t) => t + 1);
      return;
    }

    if (drag.type === 'move' || drag.type === 'rotate') {
      setUndoStack((u) => [...u.slice(-39), drag.origScene]);
      setRedoStack([]);
    }
  };

  // Add character directly from Bible de continuité
  const handleAddBibleCharacter = (entity: BibleEntityDto) => {
    const id = makeId('char');
    const offset = (scene.characters.length % 5) * 0.08;
    commitScene((prev) => ({
      ...prev,
      characters: [
        ...prev.characters,
        {
          id,
          label: entity.name,
          bibleEntityId: entity.id,
          x: clamp01(0.35 + offset),
          y: 0.45,
          angleDeg: 90,
          color: PALETTE_COLORS[(scene.characters.length + 2) % PALETTE_COLORS.length]!,
          action: '',
          pose: '',
        },
      ],
    }));
    setSelected({ kind: 'character', id });
    setTool('select');
    onNotify(`Personnage « ${entity.name} » ajouté depuis la Bible`);
  };

  const handleApplyTemplate = (templateId: ScenePlanTemplateId) => {
    const charNames = bibleCharacters.map((c) => c.name);
    const tpl = buildScenePlanTemplate(templateId, charNames);
    setMode(tpl.mode);
    setFolderPath(tpl.mode === 'scene_plan' ? 'plans' : 'croquis');
    commitScene(() => tpl.scene);
    setSelected(null);
    if (isLightCanvasColor(tpl.scene.backgroundColor)) {
      setTool('pen');
      setActiveColor('#111827');
    }
    onNotify('Modèle de mise en scène appliqué');
  };

  const toggleGuide = (guide: SketchGuideType) => {
    commitScene((prev) => {
      const exists = prev.guides.includes(guide);
      return {
        ...prev,
        guides: exists ? prev.guides.filter((g) => g !== guide) : [...prev.guides, guide],
      };
    });
  };

  // Render clean high-res PNG base64 for Media export
  const renderExportPngDataUrl = (): string => {
    const off = document.createElement('canvas');
    off.width = dims.width;
    off.height = dims.height;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    renderSketchToCanvas(ctx, scene, {
      width: dims.width,
      height: dims.height,
      selected: null,
      underlayImage,
      forExport: true,
      includeGuidesInExport,
    });
    return off.toDataURL('image/png');
  };

  const handleDownloadPng = () => {
    try {
      const dataUrl = renderExportPngDataUrl();
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${title.trim().replace(/[^a-z0-9-_]+/gi, '_') || 'croquis'}.png`;
      link.click();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Échec export PNG');
    }
  };

  const handleSaveToMedia = async (): Promise<SketchDto | null> => {
    if (!title.trim()) {
      onNotify('Indique un titre pour enregistrer le croquis / plan');
      return null;
    }
    setSaving(true);
    try {
      const pngBase64 = renderExportPngDataUrl();
      const payload = {
        title: title.trim(),
        mode,
        aspectRatio,
        folderPath: folderPath.trim(),
        shotId: linkedShotId,
        inSketchBoard,
        durationSec: Number.isFinite(durationSec) && durationSec >= 0.5 ? durationSec : 3,
        caption: caption.trim(),
        sceneData: scene,
        aiDirectorBrief: aiBrief,
        pngBase64,
        saveMode,
      };
      const saved = editingSketchId
        ? await api.updateSketch(editingSketchId, payload)
        : await api.createSketch(project.id, payload);

      setEditingSketchId(saved.id);
      setLinkedAssetRef(saved.assetRef);
      setLinkedShotId(saved.shotId);
      setLinkedShotHandle(saved.shotHandle);
      setSketches((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);
      onSketchSaved(saved);
      onNotify(
        editingSketchId
          ? `Plan / croquis mis à jour (${saved.assetRef ?? 'enregistré'}) dans /${saved.folderPath || 'racine'}`
          : `Plan / croquis enregistré dans Médias (${saved.assetRef ?? 'ok'})${inSketchBoard ? ' + Storyboard Croquis' : ''}`,
      );
      return saved;
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleCreateShotInPreprod = async (sceneId?: string) => {
    const saved = await handleSaveToMedia();
    if (!saved) return;
    try {
      const linked = await api.linkSketchToShot(saved.id, {
        createShotInSceneId: sceneId || undefined,
        newSceneTitle: sceneId ? undefined : 'Storyboard Croquis',
        syncKeyframe: true,
        syncBrief: true,
      });
      setLinkedShotId(linked.shotId);
      setLinkedShotHandle(linked.shotHandle);
      setSketches((prev) => prev.map((s) => (s.id === linked.id ? linked : s)));
      const refreshedScenes = await api.getStoryboard(project.id);
      setPreprodScenes(refreshedScenes);
      onNotify(`Plan ${linked.shotHandle ?? ''} créé et lié dans le Storyboard Pré-prod`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur création plan Pré-prod');
    }
  };

  const handleDeleteSavedSketch = async (sk: SketchDto) => {
    if (!window.confirm(`Supprimer le croquis éditable « ${sk.title} » ? (L’image PNG dans Médias sera conservée)`)) {
      return;
    }
    try {
      await api.deleteSketch(sk.id, false);
      setSketches((prev) => prev.filter((item) => item.id !== sk.id));
      if (editingSketchId === sk.id) {
        setEditingSketchId(null);
        setLinkedAssetRef(null);
      }
      onNotify('Croquis supprimé de la liste');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur suppression');
    }
  };

  // Selected entity lookup for right inspector
  const selectedCamera =
    selected?.kind === 'camera' ? scene.cameras.find((c) => c.id === selected.id) ?? null : null;
  const selectedCharacter =
    selected?.kind === 'character'
      ? scene.characters.find((c) => c.id === selected.id) ?? null
      : null;
  const selectedLight =
    selected?.kind === 'light' ? scene.lights.find((l) => l.id === selected.id) ?? null : null;
  const selectedProp =
    selected?.kind === 'prop' ? scene.props.find((p) => p.id === selected.id) ?? null : null;
  const selectedArrow =
    selected?.kind === 'arrow' ? scene.arrows.find((a) => a.id === selected.id) ?? null : null;
  const selectedShape =
    selected?.kind === 'shape' ? scene.shapes.find((s) => s.id === selected.id) ?? null : null;
  const selectedNote =
    selected?.kind === 'note' ? scene.notes.find((n) => n.id === selected.id) ?? null : null;

  return (
    <div className="sketch-studio">
      {/* Top Studio Header Bar */}
      <div className="sketch-topbar">
        <div className="sketch-topbar-left">
          {/* Primary View Switch: Canvas Editor vs Side-by-Side Sketch Storyboard */}
          <div className="sketch-mode-switch" role="group" aria-label="Vue atelier ou planche storyboard">
            <button
              type="button"
              className={`btn btn-xs ${studioView === 'editor' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStudioView('editor')}
            >
              <PenTool size={13} /> Atelier Dessin
            </button>
            <button
              type="button"
              className={`btn btn-xs ${studioView === 'board' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStudioView('board')}
              title="Afficher les croquis côte à côte en Storyboard"
            >
              <LayoutGrid size={13} /> Storyboard Croquis ({boardCount})
            </button>
          </div>

          {studioView === 'editor' && (
            <>
              <div className="sketch-mode-switch" role="group" aria-label="Mode de création">
                <button
                  type="button"
                  className={`btn btn-xs ${mode === 'scene_plan' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    setMode('scene_plan');
                    if (!editingSketchId) setFolderPath('plans');
                    if (!scene.guides.includes('grid')) toggleGuide('grid');
                  }}
                >
                  <Camera size={13} /> Plan de scène
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${
                    mode === 'storyboard_sketch' && !isLightCanvasColor(scene.backgroundColor)
                      ? 'btn-primary'
                      : 'btn-ghost'
                  }`}
                  onClick={() => {
                    setMode('storyboard_sketch');
                    if (!editingSketchId) setFolderPath('croquis');
                    if (!scene.guides.includes('thirds')) toggleGuide('thirds');
                    setTool('pen');
                  }}
                >
                  <PenTool size={13} /> Croquis
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${
                    mode === 'storyboard_sketch' && isLightCanvasColor(scene.backgroundColor)
                      ? 'btn-primary'
                      : 'btn-ghost'
                  }`}
                  onClick={() => handleNewWhiteboard()}
                  title="Ouvrir une feuille blanche vierge prête pour dessiner au crayon noir"
                >
                  <FilePlus2 size={13} /> Feuille blanche
                </button>
              </div>

              <select
                className="input input-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) handleApplyTemplate(e.target.value as ScenePlanTemplateId);
                }}
                title="Charger un modèle de mise en scène pré-configuré"
                style={{ width: 195 }}
              >
                <option value="">✨ Modèles rapides…</option>
                {SCENE_PLAN_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.label}
                  </option>
                ))}
              </select>

              <select
                className="input input-sm"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                title="Format / Ratio du cadre"
                style={{ width: 82 }}
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {studioView === 'editor' && (
          <div className="sketch-topbar-right">
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Annuler (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Rétablir (Ctrl+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() =>
                isLightCanvasColor(scene.backgroundColor)
                  ? handleNewWhiteboard()
                  : handleNewBlank(mode)
              }
              title="Nouveau plan / croquis vierge"
            >
              <Plus size={14} /> Nouveau
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={handleDownloadPng}
              title="Télécharger PNG localement"
            >
              <Download size={14} /> PNG
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleSaveToMedia()}
              disabled={saving}
            >
              <Save size={14} />{' '}
              {saving
                ? 'Enregistrement…'
                : editingSketchId
                  ? 'Mettre à jour'
                  : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>

      {/* Mode 1: Side-by-Side Sketch Storyboard View */}
      {studioView === 'board' ? (
        <SketchStoryboardView
          project={project}
          sketches={sketches}
          scenes={preprodScenes}
          onSketchesChanged={(next) => {
            setSketches(next);
            void api.getStoryboard(project.id).then(setPreprodScenes).catch(() => {});
          }}
          onEditSketch={(sk) => loadSketchIntoEditor(sk)}
          onNewWhiteboard={() => handleNewWhiteboard()}
          onNewScenePlan={() => handleNewBlank('scene_plan')}
          onOpenPreprodStoryboard={onOpenPreprodStoryboard}
          onExportedSheetToMedia={() => onAssetsMutated?.()}
          onNotify={onNotify}
        />
      ) : (
        /* Mode 2: Main 3-Column Canvas Editor */
        <div className="sketch-body">
        {/* Left Tools Palette */}
        <aside className="sketch-tools">
          <div className="sketch-tool-group">
            <span className="sketch-tool-heading">Sélection</span>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'select' ? 'active' : ''}`}
              onClick={() => setTool('select')}
              title="Sélectionner, déplacer et orienter (V)"
            >
              <MousePointer2 size={15} /> <span>Sélect.</span>
            </button>
          </div>

          <div className="sketch-tool-group">
            <span className="sketch-tool-heading">Plan & Blocking</span>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'camera' ? 'active' : ''}`}
              onClick={() => setTool('camera')}
              title="Placer une caméra avec cône FOV"
            >
              <Camera size={15} /> <span>Caméra</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'character' ? 'active' : ''}`}
              onClick={() => setTool('character')}
              title="Placer un personnage / sujet"
            >
              <User size={15} /> <span>Perso</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'motion_arrow' ? 'active' : ''}`}
              onClick={() => setTool('motion_arrow')}
              title="Tracer une flèche de mouvement caméra ou personnage"
            >
              <ArrowUpRight size={15} /> <span>Mouvement</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'light' ? 'active' : ''}`}
              onClick={() => setTool('light')}
              title="Placer une source de lumière (Key/Fill/Rim)"
            >
              <Lightbulb size={15} /> <span>Lumière</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'prop' ? 'active' : ''}`}
              onClick={() => setTool('prop')}
              title="Placer un mur, porte, table ou repère X"
            >
              <Box size={15} /> <span>Décor</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${scene.show180Line ? 'active' : ''}`}
              onClick={() =>
                commitScene((prev) => ({ ...prev, show180Line: !prev.show180Line }))
              }
              title="Afficher / masquer la ligne des 180° entre 2 personnages"
            >
              <Move size={15} /> <span>Ligne 180°</span>
            </button>
          </div>

          <div className="sketch-tool-group">
            <span className="sketch-tool-heading">Dessin libre</span>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'pen' ? 'active' : ''}`}
              onClick={() => setTool('pen')}
              title="Crayon / Pinceau à main levée (B)"
            >
              <PenTool size={15} /> <span>Crayon</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'marker' ? 'active' : ''}`}
              onClick={() => setTool('marker')}
              title="Marqueur / Surligneur (M)"
            >
              <Highlighter size={15} /> <span>Marqueur</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
              onClick={() => setTool('eraser')}
              title="Gomme sur les tracés à main levée (E)"
            >
              <Eraser size={15} /> <span>Gomme</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_arrow' ? 'active' : ''}`}
              onClick={() => setTool('shape_arrow')}
              title="Flèche droite"
            >
              <ArrowUpRight size={15} /> <span>Flèche</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_line' ? 'active' : ''}`}
              onClick={() => setTool('shape_line')}
              title="Ligne droite"
            >
              <Minus size={15} /> <span>Ligne</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_rect' ? 'active' : ''}`}
              onClick={() => setTool('shape_rect')}
              title="Rectangle / Cadre"
            >
              <Square size={15} /> <span>Rect.</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_ellipse' ? 'active' : ''}`}
              onClick={() => setTool('shape_ellipse')}
              title="Cercle / Ellipse"
            >
              <Circle size={15} /> <span>Cercle</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_zoom_in' ? 'active' : ''}`}
              onClick={() => setTool('shape_zoom_in')}
              title="Cadre Zoom Avant (4 flèches storyboard)"
            >
              <ZoomIn size={15} /> <span>Zoom In</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'shape_zoom_out' ? 'active' : ''}`}
              onClick={() => setTool('shape_zoom_out')}
              title="Cadre Zoom Arrière (4 flèches storyboard)"
            >
              <ZoomOut size={15} /> <span>Zoom Out</span>
            </button>
            <button
              type="button"
              className={`sketch-tool-btn ${tool === 'text' ? 'active' : ''}`}
              onClick={() => setTool('text')}
              title="Ajouter une note texte (T)"
            >
              <Type size={15} /> <span>Texte</span>
            </button>
          </div>
        </aside>

        {/* Center Canvas Workspace */}
        <section className="sketch-center">
          {/* Contextual Options Bar (Colors, Width, Sub-options, Guides, Underlay) */}
          <div className="sketch-subbar">
            <div className="sketch-swatches" title="Couleur active">
              {PALETTE_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`sketch-swatch ${activeColor === hex ? 'active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => setActiveColor(hex)}
                  aria-label={`Couleur ${hex}`}
                />
              ))}
            </div>

            <div className="sketch-paper-strip" title="Fond de la feuille">
              <span className="muted" style={{ fontSize: 11 }}>
                Feuille :
              </span>
              {PAPER_PRESETS.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={`chip-btn ${
                    scene.backgroundColor.toLowerCase() === paper.hex ? 'active' : ''
                  }`}
                  onClick={() => handleSetPaperColor(paper.hex)}
                  title={`Passer sur fond ${paper.label}`}
                >
                  <span
                    className="paper-dot"
                    style={{ background: paper.hex }}
                    aria-hidden="true"
                  />
                  {paper.label}
                </button>
              ))}
            </div>

            <label className="sketch-inline-control" title="Épaisseur du trait">
              <span>Trait</span>
              <input
                type="range"
                min={1}
                max={18}
                value={brushWidth}
                onChange={(e) => setBrushWidth(Number(e.target.value))}
                style={{ width: 64 }}
              />
              <span className="mono">{brushWidth}px</span>
            </label>

            {tool === 'motion_arrow' && (
              <div className="sketch-inline-control">
                <select
                  className="input input-sm"
                  value={arrowTarget}
                  onChange={(e) => setArrowTarget(e.target.value as SketchMotionTarget)}
                >
                  <option value="camera">Trajectoire Caméra</option>
                  <option value="character">Trajectoire Personnage</option>
                  <option value="object">Mouvement Objet</option>
                </select>
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={arrowDashed}
                    onChange={(e) => setArrowDashed(e.target.checked)}
                  />
                  Pointillé
                </label>
              </div>
            )}

            {tool === 'prop' && (
              <select
                className="input input-sm"
                value={propKind}
                onChange={(e) => setPropKind(e.target.value as SketchPropKind)}
              >
                {(Object.keys(PROP_KIND_LABELS) as SketchPropKind[]).map((k) => (
                  <option key={k} value={k}>
                    {PROP_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}

            {tool === 'light' && (
              <select
                className="input input-sm"
                value={lightKind}
                onChange={(e) => setLightKind(e.target.value as SketchLightKind)}
              >
                {(Object.keys(LIGHT_KIND_LABELS) as SketchLightKind[]).map((k) => (
                  <option key={k} value={k}>
                    {LIGHT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}

            <div className="sketch-guides-strip">
              <Grid3x3 size={13} className="muted" />
              {GUIDE_OPTIONS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`chip-btn ${scene.guides.includes(g.id) ? 'active' : ''}`}
                  onClick={() => toggleGuide(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="sketch-underlay-control">
              <ImageIcon size={13} className="muted" />
              <select
                className="input input-sm"
                value={scene.underlay?.assetId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    commitScene((prev) => ({ ...prev, underlay: null }));
                  } else {
                    const found = imageAssets.find((a) => a.id === id);
                    commitScene((prev) => ({
                      ...prev,
                      underlay: {
                        assetId: id,
                        assetRef: found?.refCode,
                        opacity: prev.underlay?.opacity ?? 0.5,
                      },
                    }));
                  }
                }}
                title="Utiliser une image du projet en fond (calque de référence)"
                style={{ maxWidth: 165 }}
              >
                <option value="">Fond : aucun</option>
                {imageAssets.slice(0, 60).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.refCode} — {a.title.slice(0, 22)}
                  </option>
                ))}
              </select>
              {scene.underlay && (
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={scene.underlay.opacity}
                  onChange={(e) =>
                    setScene((prev) =>
                      prev.underlay
                        ? {
                            ...prev,
                            underlay: { ...prev.underlay, opacity: Number(e.target.value) },
                          }
                        : prev,
                    )
                  }
                  title="Opacité de l’image de fond"
                  style={{ width: 58 }}
                />
              )}
            </div>
          </div>

          {/* Quick-Add Bible Characters Strip */}
          {bibleCharacters.length > 0 && (
            <div className="sketch-bible-strip">
              <span className="muted" style={{ fontSize: 11 }}>
                Personnages Bible :
              </span>
              {bibleCharacters.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className="chip-btn"
                  onClick={() => handleAddBibleCharacter(ch)}
                  title={`Placer ${ch.name} sur le plan`}
                >
                  <Plus size={11} /> {ch.name}
                </button>
              ))}
            </div>
          )}

          {/* Responsive Canvas Stage */}
          <div className="sketch-stage-wrap" ref={stageWrapRef}>
            <canvas
              ref={canvasRef}
              className={`sketch-canvas tool-${tool}`}
              style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>

          <div className="sketch-hint-bar">
            <span>
              {tool === 'select'
                ? 'Clique un élément pour l’éditer, glisse pour le déplacer, ou tire le point ambre pour le faire pivoter.'
                : tool === 'motion_arrow'
                  ? 'Clique et glisse sur le plan pour tracer la trajectoire de mouvement.'
                  : tool === 'pen' || tool === 'marker'
                    ? 'Dessine librement sur le cadre (souris, trackpad ou stylet).'
                    : tool === 'eraser'
                      ? 'Passe la gomme sur les traits à main levée pour les effacer.'
                      : 'Clique sur le canvas pour placer l’élément.'}
            </span>
            <span className="mono muted">
              Export {dims.width}×{dims.height}px
            </span>
          </div>
        </section>

        {/* Right Context Inspector + Save + AI Brief + Saved Sketches */}
        <aside className="sketch-inspector">
          {/* Save Metadata & Storyboard Linking Card */}
          <div className="sketch-card">
            <div className="sketch-card-head">
              <strong>
                <Film size={13} /> Fiche, Storyboard & Médias
              </strong>
              {linkedAssetRef && (
                <button
                  type="button"
                  className="ref-pill"
                  onClick={() => onCopyText(linkedAssetRef, linkedAssetRef)}
                  title="Copier la référence Média"
                >
                  {linkedAssetRef}
                </button>
              )}
            </div>

            <label className="field-label">
              Titre
              <input
                className="input input-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: S04 — Plan dialogue taverne"
              />
            </label>

            <div className="sketch-form-row">
              <label className="field-label" style={{ flex: 1 }}>
                Dossier Médias
                <input
                  className="input input-sm"
                  list="sketch-folder-suggestions"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="plans"
                />
                <datalist id="sketch-folder-suggestions">
                  {folderSuggestions.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>

              <label className="field-label" style={{ width: 74 }}>
                Durée (s)
                <input
                  className="input input-sm"
                  type="number"
                  min={0.5}
                  max={300}
                  step={0.5}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value) || 3)}
                />
              </label>

              {editingSketchId && (
                <label className="field-label" style={{ width: 108 }}>
                  Mise à jour
                  <select
                    className="input input-sm"
                    value={saveMode}
                    onChange={(e) => setSaveMode(e.target.value as 'new_version' | 'replace')}
                  >
                    <option value="new_version">Nouvelle v2</option>
                    <option value="replace">Remplacer</option>
                  </select>
                </label>
              )}
            </div>

            <label className="field-label">
              Légende / Dialogue / Action (Storyboard)
              <textarea
                className="input input-sm"
                rows={2}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Note affichée sous la case du Storyboard Croquis et synchronisée en Pré-prod…"
                style={{ resize: 'vertical' }}
              />
            </label>

            <label className="checkbox-inline" style={{ fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={inSketchBoard}
                onChange={(e) => setInSketchBoard(e.target.checked)}
              />
              Placer dans le Storyboard Croquis (planche côte à côte)
            </label>

            <label className="checkbox-inline" style={{ fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={includeGuidesInExport}
                onChange={(e) => setIncludeGuidesInExport(e.target.checked)}
              />
              Inclure la grille / règle des tiers dans le PNG exporté
            </label>

            {/* Pre-prod Storyboard Link */}
            <div className="sketch-preprod-link-section">
              <div className="sketch-card-head" style={{ fontSize: 11.5 }}>
                <strong>
                  <Link2 size={12} /> Lien Storyboard Pré-prod
                </strong>
                {linkedShotHandle && (
                  <button
                    type="button"
                    className="sketch-board-linked-pill"
                    onClick={onOpenPreprodStoryboard}
                    title="Ouvrir le Storyboard dans Pré-prod"
                  >
                    <Check size={11} /> {linkedShotHandle}
                  </button>
                )}
              </div>

              <select
                className="input input-sm"
                value={linkedShotId ?? ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setLinkedShotId(val);
                  const foundShot = preprodScenes
                    .flatMap((sc) => sc.shots)
                    .find((sh) => sh.id === val);
                  setLinkedShotHandle(foundShot?.handle ?? null);
                }}
              >
                <option value="">— Aucun plan Pré-prod lié —</option>
                {preprodScenes.map((sc) => (
                  <optgroup key={sc.id} label={`Scène ${sc.sceneNumber} — ${sc.title}`}>
                    {sc.shots.map((sh) => (
                      <option key={sh.id} value={sh.id}>
                        {sh.handle} — {sh.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-xs btn-secondary"
                disabled={saving}
                onClick={() => void handleCreateShotInPreprod(preprodScenes[0]?.id)}
                title="Enregistrer ce croquis et créer directement un Plan lié dans le Storyboard Pré-prod"
              >
                <Plus size={12} /> Enregistrer & créer un Plan dans Pré-prod
              </button>
            </div>
          </div>

          {/* Selected Element Properties */}
          {selected && (
            <div className="sketch-card sketch-card-accent">
              <div className="sketch-card-head">
                <strong>Élément sélectionné</strong>
                <button
                  type="button"
                  className="btn btn-xs btn-danger"
                  onClick={handleDeleteSelected}
                  title="Supprimer (Suppr)"
                >
                  <Trash2 size={12} /> Suppr.
                </button>
              </div>

              {selectedCamera && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Nom caméra
                    <input
                      className="input input-sm"
                      value={selectedCamera.label}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            cameras: prev.cameras.map((c) =>
                              c.id === selectedCamera.id ? { ...c, label: e.target.value } : c,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <div className="field-label">
                    Optique (FOV live)
                    <div className="chip-row">
                      {FOCAL_PRESETS.map((mm) => (
                        <button
                          key={mm}
                          type="button"
                          className={`chip-btn ${selectedCamera.focalMm === mm ? 'active' : ''}`}
                          onClick={() =>
                            commitScene((prev) => ({
                              ...prev,
                              cameras: prev.cameras.map((c) =>
                                c.id === selectedCamera.id ? { ...c, focalMm: mm } : c,
                              ),
                            }))
                          }
                        >
                          {mm}mm
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="field-label">
                    Valeur de plan
                    <select
                      className="input input-sm"
                      value={selectedCamera.shotSize}
                      onChange={(e) =>
                        commitScene((prev) => ({
                          ...prev,
                          cameras: prev.cameras.map((c) =>
                            c.id === selectedCamera.id
                              ? { ...c, shotSize: e.target.value as SketchShotSize }
                              : c,
                          ),
                        }))
                      }
                    >
                      {(Object.keys(SHOT_SIZE_LABELS) as SketchShotSize[]).map((k) => (
                        <option key={k} value={k}>
                          {SHOT_SIZE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Mouvement caméra
                    <select
                      className="input input-sm"
                      value={selectedCamera.movement}
                      onChange={(e) =>
                        commitScene((prev) => ({
                          ...prev,
                          cameras: prev.cameras.map((c) =>
                            c.id === selectedCamera.id
                              ? { ...c, movement: e.target.value as SketchCameraMovement }
                              : c,
                          ),
                        }))
                      }
                    >
                      {(Object.keys(CAMERA_MOVEMENT_LABELS) as SketchCameraMovement[]).map((k) => (
                        <option key={k} value={k}>
                          {CAMERA_MOVEMENT_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Orientation ({selectedCamera.angleDeg}°)
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={selectedCamera.angleDeg}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            cameras: prev.cameras.map((c) =>
                              c.id === selectedCamera.id
                                ? { ...c, angleDeg: Number(e.target.value) }
                                : c,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    Consigne / note caméra
                    <input
                      className="input input-sm"
                      value={selectedCamera.notes}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            cameras: prev.cameras.map((c) =>
                              c.id === selectedCamera.id ? { ...c, notes: e.target.value } : c,
                            ),
                          }),
                          false,
                        )
                      }
                      placeholder="ex: Travelling lent fluide, shallow DOF"
                    />
                  </label>
                </div>
              )}

              {selectedCharacter && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Nom personnage
                    <input
                      className="input input-sm"
                      value={selectedCharacter.label}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            characters: prev.characters.map((c) =>
                              c.id === selectedCharacter.id ? { ...c, label: e.target.value } : c,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    Pose / Attitude
                    <input
                      className="input input-sm"
                      value={selectedCharacter.pose}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            characters: prev.characters.map((c) =>
                              c.id === selectedCharacter.id ? { ...c, pose: e.target.value } : c,
                            ),
                          }),
                          false,
                        )
                      }
                      placeholder="ex: Assis 3/4, dos voûté"
                    />
                  </label>
                  <label className="field-label">
                    Action / Mouvement voulu
                    <input
                      className="input input-sm"
                      value={selectedCharacter.action}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            characters: prev.characters.map((c) =>
                              c.id === selectedCharacter.id ? { ...c, action: e.target.value } : c,
                            ),
                          }),
                          false,
                        )
                      }
                      placeholder="ex: Se lève brusquement et sort"
                    />
                  </label>
                  <label className="field-label">
                    Direction regard ({selectedCharacter.angleDeg}°)
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={selectedCharacter.angleDeg}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            characters: prev.characters.map((c) =>
                              c.id === selectedCharacter.id
                                ? { ...c, angleDeg: Number(e.target.value) }
                                : c,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {selectedLight && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Nom lumière
                    <input
                      className="input input-sm"
                      value={selectedLight.label}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            lights: prev.lights.map((l) =>
                              l.id === selectedLight.id ? { ...l, label: e.target.value } : l,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    Type
                    <select
                      className="input input-sm"
                      value={selectedLight.kind}
                      onChange={(e) =>
                        commitScene((prev) => ({
                          ...prev,
                          lights: prev.lights.map((l) =>
                            l.id === selectedLight.id
                              ? { ...l, kind: e.target.value as SketchLightKind }
                              : l,
                          ),
                        }))
                      }
                    >
                      {(Object.keys(LIGHT_KIND_LABELS) as SketchLightKind[]).map((k) => (
                        <option key={k} value={k}>
                          {LIGHT_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Intensité ({selectedLight.intensity}%)
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={selectedLight.intensity}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            lights: prev.lights.map((l) =>
                              l.id === selectedLight.id
                                ? { ...l, intensity: Number(e.target.value) }
                                : l,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {selectedProp && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Nom décor / accessoire
                    <input
                      className="input input-sm"
                      value={selectedProp.label}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            props: prev.props.map((p) =>
                              p.id === selectedProp.id ? { ...p, label: e.target.value } : p,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    Largeur ({Math.round(selectedProp.w * 100)}%)
                    <input
                      type="range"
                      min={0.04}
                      max={0.8}
                      step={0.01}
                      value={selectedProp.w}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            props: prev.props.map((p) =>
                              p.id === selectedProp.id ? { ...p, w: Number(e.target.value) } : p,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    Rotation ({selectedProp.angleDeg}°)
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={selectedProp.angleDeg}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            props: prev.props.map((p) =>
                              p.id === selectedProp.id
                                ? { ...p, angleDeg: Number(e.target.value) }
                                : p,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {selectedArrow && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Description du mouvement
                    <input
                      className="input input-sm"
                      value={selectedArrow.label}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            arrows: prev.arrows.map((a) =>
                              a.id === selectedArrow.id ? { ...a, label: e.target.value } : a,
                            ),
                          }),
                          false,
                        )
                      }
                      placeholder="ex: Travelling avant lent 3s"
                    />
                  </label>
                  <label className="field-label">
                    Cible du mouvement
                    <select
                      className="input input-sm"
                      value={selectedArrow.target}
                      onChange={(e) =>
                        commitScene((prev) => ({
                          ...prev,
                          arrows: prev.arrows.map((a) =>
                            a.id === selectedArrow.id
                              ? { ...a, target: e.target.value as SketchMotionTarget }
                              : a,
                          ),
                        }))
                      }
                    >
                      <option value="camera">Caméra</option>
                      <option value="character">Personnage</option>
                      <option value="object">Objet / Élément</option>
                    </select>
                  </label>
                  <div className="chip-row">
                    <label className="checkbox-inline" style={{ fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedArrow.dashed}
                        onChange={(e) =>
                          commitScene((prev) => ({
                            ...prev,
                            arrows: prev.arrows.map((a) =>
                              a.id === selectedArrow.id ? { ...a, dashed: e.target.checked } : a,
                            ),
                          }))
                        }
                      />
                      Pointillé
                    </label>
                    <label className="checkbox-inline" style={{ fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedArrow.cx !== undefined}
                        onChange={(e) =>
                          commitScene((prev) => ({
                            ...prev,
                            arrows: prev.arrows.map((a) => {
                              if (a.id !== selectedArrow.id) return a;
                              if (!e.target.checked) {
                                return { ...a, cx: undefined, cy: undefined };
                              }
                              const mx = (a.x1 + a.x2) / 2;
                              const my = (a.y1 + a.y2) / 2;
                              const dx = a.x2 - a.x1;
                              const dy = a.y2 - a.y1;
                              return {
                                ...a,
                                cx: clamp01(mx - dy * 0.35),
                                cy: clamp01(my + dx * 0.35),
                              };
                            }),
                          }))
                        }
                      />
                      Trajectoire courbe (Arc)
                    </label>
                  </div>
                </div>
              )}

              {selectedShape && (
                <div className="sketch-prop-fields">
                  <div className="chip-row">
                    <label className="checkbox-inline" style={{ fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedShape.fill}
                        onChange={(e) =>
                          commitScene((prev) => ({
                            ...prev,
                            shapes: prev.shapes.map((s) =>
                              s.id === selectedShape.id ? { ...s, fill: e.target.checked } : s,
                            ),
                          }))
                        }
                      />
                      Remplissage
                    </label>
                    <label className="checkbox-inline" style={{ fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedShape.dashed}
                        onChange={(e) =>
                          commitScene((prev) => ({
                            ...prev,
                            shapes: prev.shapes.map((s) =>
                              s.id === selectedShape.id ? { ...s, dashed: e.target.checked } : s,
                            ),
                          }))
                        }
                      />
                      Pointillé
                    </label>
                  </div>
                </div>
              )}

              {selectedNote && (
                <div className="sketch-prop-fields">
                  <label className="field-label">
                    Texte
                    <input
                      className="input input-sm"
                      value={selectedNote.text}
                      onChange={(e) =>
                        commitScene(
                          (prev) => ({
                            ...prev,
                            notes: prev.notes.map((n) =>
                              n.id === selectedNote.id ? { ...n, text: e.target.value } : n,
                            ),
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  <label className="checkbox-inline" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedNote.badge}
                      onChange={(e) =>
                        commitScene((prev) => ({
                          ...prev,
                          notes: prev.notes.map((n) =>
                            n.id === selectedNote.id ? { ...n, badge: e.target.checked } : n,
                          ),
                        }))
                      }
                    />
                    Fond badge lisible
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Live AI Director Brief Card */}
          <div className="sketch-card">
            <div className="sketch-card-head">
              <strong>
                <Sparkles size={13} /> Brief IA (Claude / ComfyUI)
              </strong>
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => onCopyText(aiBrief, 'Brief IA copié')}
              >
                <Copy size={12} /> Copier
              </button>
            </div>
            <pre className="sketch-brief-preview">{aiBrief}</pre>
          </div>

          {/* Saved Sketches List for Re-Editing */}
          <div className="sketch-card">
            <div className="sketch-card-head">
              <strong>Plans & Croquis enregistrés ({sketches.length})</strong>
            </div>
            {sketches.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                Aucun plan ou croquis enregistré sur ce projet. Clique sur « Enregistrer dans
                Médias » pour le stocker et pouvoir le ré-éditer plus tard.
              </p>
            ) : (
              <div className="sketch-saved-list">
                {sketches.map((sk) => (
                  <div
                    key={sk.id}
                    className={`sketch-saved-item ${editingSketchId === sk.id ? 'active' : ''}`}
                    onClick={() => loadSketchIntoEditor(sk)}
                  >
                    {sk.assetThumbnailUrl ? (
                      <img src={sk.assetThumbnailUrl} alt={sk.title} className="sketch-saved-thumb" />
                    ) : (
                      <div className="sketch-saved-thumb placeholder">
                        {sk.mode === 'scene_plan' ? <Camera size={14} /> : <PenTool size={14} />}
                      </div>
                    )}
                    <div className="sketch-saved-meta">
                      <span className="sketch-saved-title">{sk.title}</span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {sk.mode === 'scene_plan' ? 'Plan' : 'Croquis'}
                        {sk.assetRef ? ` · ${sk.assetRef}` : ''}
                        {editingSketchId === sk.id && (
                          <Check size={11} style={{ marginLeft: 4, color: 'var(--accent)' }} />
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteSavedSketch(sk);
                      }}
                      title="Supprimer ce croquis"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
      )}
    </div>
  );
}

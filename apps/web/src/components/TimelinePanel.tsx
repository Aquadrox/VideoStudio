import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Captions,
  Clapperboard,
  Download,
  Layers,
  Loader2,
  Lock,
  Magnet,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  applyClipDragMove,
  applyClipTrimLeft,
  applyClipTrimRight,
  collectTimelineSnapPoints,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_SUBTITLE_STYLE,
  evaluateTimelineTransitionFrame,
  extractTimelineBeatMarkers,
  findActiveSubtitleCues,
  secondsToSmpte,
  TIMELINE_TRANSITION_META,
  type AssetDto,
  type AudioTrackDto,
  type ClipTextOverlay,
  type ProjectSubtitlesDto,
  type SubtitleCue,
  type TimelineClipDto,
  type TimelineDto,
  type TimelineQualityMode,
  type TimelineTrackDto,
  type TimelineTrackType,
  type TimelineTransition,
  type VideoEffectDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatDuration } from '../utils/format';
import { CapCutClipInspector } from './CapCutClipInspector';
import { EffectsLibraryDrawer } from './EffectsLibraryDrawer';
import { SubtitleEditorPanel } from './SubtitleEditorPanel';
import { TimelinePreviewCanvas, type ActiveTextOverlayEntry } from './TimelinePreviewCanvas';
import { TimelineWaveform } from './TimelineWaveform';

interface TimelinePanelProps {
  projectId: string;
  assets: AssetDto[];
  refreshSignal: number;
  onNotify: (msg: string) => void;
  onOpenAssetId?: (assetId: string) => void;
}

type ClipDragAction = {
  kind: 'move' | 'trim_left' | 'trim_right';
  clipId: string;
  trackId: string;
  originClientX: number;
  initialClip: TimelineClipDto;
  moved: boolean;
};

type CueDragAction = {
  kind: 'move' | 'trim_left' | 'trim_right';
  cueId: string;
  originClientX: number;
  initialCue: SubtitleCue;
  moved: boolean;
};

const PX_PER_SEC_DEFAULT = 36;
const MAX_HISTORY = 30;

export function TimelinePanel({
  projectId,
  assets,
  refreshSignal,
  onNotify,
  onOpenAssetId,
}: TimelinePanelProps) {
  const [timeline, setTimeline] = useState<TimelineDto | null>(null);
  const [effects, setEffects] = useState<VideoEffectDto[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackDto[]>([]);
  const [subtitles, setSubtitles] = useState<ProjectSubtitlesDto>({
    projectId,
    language: 'fr',
    cues: [],
    style: { ...DEFAULT_SUBTITLE_STYLE },
    updatedAt: new Date().toISOString(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSubs, setSavingSubs] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [buildingAnimatic, setBuildingAnimatic] = useState(false);
  const [zoomPxPerSec, setZoomPxPerSec] = useState(PX_PER_SEC_DEFAULT);

  // Undo / Redo snapshots of tracks
  const [undoStack, setUndoStack] = useState<TimelineTrackDto[][]>([]);
  const [redoStack, setRedoStack] = useState<TimelineTrackDto[][]>([]);

  // CapCut NLE options
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showBeatMarkers, setShowBeatMarkers] = useState(true);
  const [showSubtitlesPreview, setShowSubtitlesPreview] = useState(true);
  const [fxPreviewEnabled, setFxPreviewEnabled] = useState(true);
  const [burnSubtitlesOnRender, setBurnSubtitlesOnRender] = useState(false);
  const [bottomTab, setBottomTab] = useState<'tracks' | 'subtitles'>('tracks');
  const [rightMode, setRightMode] = useState<'inspector' | 'renders'>('inspector');
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);

  // Playback state for live CapCut WYSIWYG Preview Monitor
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Drag / Trim live refs
  const timelineRef = useRef<TimelineDto | null>(null);
  const subtitlesRef = useRef<ProjectSubtitlesDto>(subtitles);
  const clipDragRef = useRef<ClipDragAction | null>(null);
  const cueDragRef = useRef<CueDragAction | null>(null);
  const rulerScrubRef = useRef<{ laneEl: HTMLDivElement; active: boolean } | null>(null);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const effectCatalog = useMemo(() => new Map(effects.map((fx) => [fx.slug, fx])), [effects]);

  const loadEffects = useCallback(async () => {
    try {
      const fxList = await api.listEffects();
      setEffects(fxList);
    } catch {
      // Ignore
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [tl, aud, subs, fxList] = await Promise.all([
        api.getTimeline(projectId),
        api.listAudioTracks(projectId).catch(() => [] as AudioTrackDto[]),
        api.getSubtitles(projectId).catch(() => null),
        api.listEffects().catch(() => [] as VideoEffectDto[]),
      ]);
      setTimeline(tl);
      setAudioTracks(aud);
      setEffects(fxList);
      if (subs) setSubtitles(subs);
    } catch {
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void loadAll();
  }, [loadAll, refreshSignal]);

  const totalDuration = useMemo(() => {
    let maxEnd = timeline?.totalDurationSec ?? 0;
    for (const tr of timeline?.tracks ?? []) {
      for (const c of tr.clips) {
        if (c.startSec + c.durationSec > maxEnd) maxEnd = c.startSec + c.durationSec;
      }
    }
    for (const cue of subtitles.cues) {
      if (cue.endSec > maxEnd) maxEnd = cue.endSec;
    }
    return Math.max(4, Math.round(maxEnd * 100) / 100);
  }, [timeline, subtitles.cues]);

  const allBeatMarkers = useMemo(
    () => extractTimelineBeatMarkers(audioTracks, totalDuration),
    [audioTracks, totalDuration],
  );

  const beatMarkers = useMemo(
    () => (showBeatMarkers ? allBeatMarkers : []),
    [allBeatMarkers, showBeatMarkers],
  );

  // Advance playhead smoothly when playing preview
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing, totalDuration]);

  // Active video clips for main track compositing
  const activeVideoClips = useMemo(() => {
    if (!timeline) return [];
    return timeline.tracks
      .filter((t) => t.type === 'video' && !t.muted)
      .flatMap((t) => t.clips)
      .filter((c) => !c.muted);
  }, [timeline]);

  const transitionFrame = useMemo(
    () => evaluateTimelineTransitionFrame(activeVideoClips, playheadSec),
    [activeVideoClips, playheadSec],
  );

  const activeVideoClip = transitionFrame.activeClip;
  const outgoingVideoClip = transitionFrame.outgoingClip;

  // Active Overlay / PiP clips at playhead
  const activeOverlayClips = useMemo(() => {
    if (!timeline) return [];
    return timeline.tracks
      .filter((t) => t.type === 'overlay' && !t.muted)
      .flatMap((t) => t.clips)
      .filter(
        (c) =>
          !c.muted &&
          c.assetId &&
          playheadSec >= c.startSec &&
          playheadSec <= c.startSec + c.durationSec,
      );
  }, [timeline, playheadSec]);

  // Active Text track clips + inline clip textOverlay at playhead
  const activeTextOverlays = useMemo<ActiveTextOverlayEntry[]>(() => {
    const items: ActiveTextOverlayEntry[] = [];
    if (activeVideoClip?.textOverlay?.text?.trim()) {
      items.push({
        id: `inline-${activeVideoClip.id}`,
        overlay: activeVideoClip.textOverlay,
        startSec: activeVideoClip.startSec,
        durationSec: activeVideoClip.durationSec,
      });
    }
    if (timeline) {
      for (const tr of timeline.tracks) {
        if (tr.type !== 'text' || tr.muted) continue;
        for (const c of tr.clips) {
          if (
            !c.muted &&
            c.textOverlay?.text?.trim() &&
            playheadSec >= c.startSec &&
            playheadSec <= c.startSec + c.durationSec
          ) {
            items.push({
              id: c.id,
              overlay: c.textOverlay,
              startSec: c.startSec,
              durationSec: c.durationSec,
            });
          }
        }
      }
    }
    return items;
  }, [timeline, activeVideoClip, playheadSec]);

  // Primary audio clip for synchronized playback
  const activeAudioClip = useMemo<TimelineClipDto | null>(() => {
    if (!timeline) return null;
    for (const track of timeline.tracks) {
      if (track.type !== 'audio' || track.muted) continue;
      const found = track.clips.find((c) => !c.muted && c.assetId);
      if (found) return found;
    }
    return null;
  }, [timeline]);

  const activeVideoAsset = activeVideoClip?.assetId ? assetMap.get(activeVideoClip.assetId) ?? null : null;
  const outgoingVideoAsset = outgoingVideoClip?.assetId
    ? assetMap.get(outgoingVideoClip.assetId) ?? null
    : null;
  const activeAudioAsset = activeAudioClip?.assetId ? assetMap.get(activeAudioClip.assetId) ?? null : null;

  const activeSubtitleCues = useMemo(
    () => (showSubtitlesPreview ? findActiveSubtitleCues(subtitles.cues, playheadSec) : []),
    [showSubtitlesPreview, subtitles.cues, playheadSec],
  );

  // Keep HTML5 audio synced with playhead when playing
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeAudioAsset || !activeAudioClip) return;
    const targetAudioTime = Math.max(
      0,
      (playheadSec - activeAudioClip.startSec) * (activeAudioClip.speed ?? 1) + activeAudioClip.inSec,
    );
    audio.volume = Math.max(0, Math.min(1, activeAudioClip.volume));
    audio.playbackRate = Math.max(0.25, Math.min(4, activeAudioClip.speed ?? 1));
    if (playing) {
      if (Math.abs(audio.currentTime - targetAudioTime) > 0.35) {
        audio.currentTime = targetAudioTime;
      }
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [playing, playheadSec, activeAudioAsset, activeAudioClip]);

  const selectedClip = useMemo(() => {
    if (!timeline || !selectedClipId) return null;
    for (const tr of timeline.tracks) {
      const match = tr.clips.find((c) => c.id === selectedClipId);
      if (match) return { track: tr, clip: match };
    }
    return null;
  }, [timeline, selectedClipId]);

  const pushUndoSnapshot = useCallback((tracks: TimelineTrackDto[]) => {
    setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY - 1)), structuredClone(tracks)]);
    setRedoStack([]);
  }, []);

  const persistTracks = useCallback(
    async (
      nextTracks: TimelineTrackDto[],
      qualityMode?: TimelineQualityMode,
      silent = false,
      recordUndo = true,
    ) => {
      if (recordUndo && timelineRef.current) {
        pushUndoSnapshot(timelineRef.current.tracks);
      }
      setSaving(true);
      try {
        const saved = await api.saveTimeline(projectId, {
          qualityMode: qualityMode ?? timelineRef.current?.qualityMode ?? 'draft_proxy',
          tracks: nextTracks.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            muted: t.muted,
            locked: t.locked,
            volume: t.volume,
            clips: t.clips.map((c) => ({
              id: c.id,
              assetId: c.assetId,
              title: c.title,
              startSec: c.startSec,
              durationSec: c.durationSec,
              inSec: c.inSec,
              outSec: c.outSec,
              speed: c.speed ?? 1,
              transition: c.transition,
              transitionDurationSec: c.transitionDurationSec,
              volume: c.volume,
              fadeInSec: c.fadeInSec ?? 0,
              fadeOutSec: c.fadeOutSec ?? 0,
              muted: c.muted,
              transform: c.transform ?? DEFAULT_CLIP_TRANSFORM,
              colorAdjust: c.colorAdjust ?? DEFAULT_CLIP_COLOR_ADJUST,
              effects: c.effects ?? [],
              keyframes: c.keyframes ?? [],
              textOverlay: c.textOverlay ?? null,
              camera: c.camera ?? null,
              cinemascope: c.cinemascope ?? null,
              fx: c.fx ?? [],
              flashIn: c.flashIn ?? 0,
              notes: c.notes,
            })),
          })),
        });
        setTimeline(saved);
        if (!silent) onNotify('Timeline enregistrée');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde timeline');
      } finally {
        setSaving(false);
      }
    },
    [projectId, onNotify, pushUndoSnapshot],
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !timelineRef.current) return;
    const prev = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, structuredClone(timelineRef.current!.tracks)]);
    void persistTracks(prev, undefined, true, false);
    onNotify('Annulé (Undo)');
  }, [undoStack, persistTracks, onNotify]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !timelineRef.current) return;
    const next = redoStack[redoStack.length - 1]!;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((s) => [...s, structuredClone(timelineRef.current!.tracks)]);
    void persistTracks(next, undefined, true, false);
    onNotify('Rétabli (Redo)');
  }, [redoStack, persistTracks, onNotify]);

  const persistSubtitles = useCallback(
    async (nextSubs: ProjectSubtitlesDto, silent = false) => {
      setSavingSubs(true);
      try {
        const saved = await api.saveSubtitles(projectId, {
          language: nextSubs.language,
          cues: nextSubs.cues,
          style: nextSubs.style,
        });
        setSubtitles(saved);
        if (!silent) onNotify(`Sous-titres enregistrés (${saved.cues.length} réplique(s))`);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde sous-titres');
      } finally {
        setSavingSubs(false);
      }
    },
    [projectId, onNotify],
  );

  // Surgical CapCut Split at Playhead (Razor Tool)
  const handleSplitAtPlayhead = useCallback(
    async (explicitClipId?: string) => {
      const tl = timelineRef.current;
      if (!tl) return;
      const targetClip = explicitClipId
        ? tl.tracks.flatMap((t) => t.clips).find((c) => c.id === explicitClipId)
        : (selectedClipId
            ? tl.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
            : null) ??
          tl.tracks
            .flatMap((t) => t.clips)
            .find((c) => playheadSec > c.startSec + 0.15 && playheadSec < c.startSec + c.durationSec - 0.15);

      if (!targetClip) {
        onNotify('Place la tête de lecture sur un clip pour le couper (S).');
        return;
      }

      try {
        pushUndoSnapshot(tl.tracks);
        const res = await api.splitTimelineClip(projectId, targetClip.id, playheadSec);
        setTimeline(res.timeline);
        setSelectedClipId(res.rightClip.id);
        onNotify(`Clip coupé à ${playheadSec.toFixed(2)}s ✂️`);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Impossible de couper à cette position');
      }
    },
    [projectId, playheadSec, selectedClipId, pushUndoSnapshot, onNotify],
  );

  const handleDeleteClip = useCallback(
    async (clipId: string, ripple = false) => {
      if (!timelineRef.current) return;
      try {
        pushUndoSnapshot(timelineRef.current.tracks);
        const res = await api.deleteTimelineClip(projectId, clipId, ripple);
        setTimeline(res.timeline);
        setSelectedClipId(null);
        onNotify(ripple ? 'Clip supprimé (Ripple)' : 'Clip supprimé');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erreur suppression clip');
      }
    },
    [projectId, pushUndoSnapshot, onNotify],
  );

  // CapCut Keyboard Shortcuts (Space = Play/Pause, S = Split, Ctrl+Z/Shift+Z = Undo/Redo, Delete = Delete clip)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void handleSplitAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        void handleDeleteClip(selectedClipId, e.shiftKey);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleSplitAtPlayhead, handleDeleteClip, selectedClipId]);

  // Global pointer handlers for direct Clip Drag/Trim, Subtitle Cue Drag/Trim, and Ruler Scrubbing
  useEffect(() => {
    const snapThresholdSec = Math.max(0.12, 10 / Math.max(14, zoomPxPerSec));

    const onPointerMove = (e: PointerEvent) => {
      if (rulerScrubRef.current?.active) {
        const rect = rulerScrubRef.current.laneEl.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left);
        const sec = Math.max(0, Math.min(totalDuration, Math.round((x / zoomPxPerSec) * 100) / 100));
        setPlayheadSec(sec);
        return;
      }

      const drag = clipDragRef.current;
      if (drag && timelineRef.current) {
        const dxPx = e.clientX - drag.originClientX;
        if (Math.abs(dxPx) > 2) drag.moved = true;
        const deltaSec = dxPx / zoomPxPerSec;
        const useSnap = snapEnabled && !e.altKey;
        const snapPoints = collectTimelineSnapPoints(
          timelineRef.current.tracks,
          playheadSec,
          beatMarkers,
          drag.clipId,
        );

        let patch: Partial<TimelineClipDto> = {};
        let guide: number | null = null;

        if (drag.kind === 'move') {
          const res = applyClipDragMove(drag.initialClip, deltaSec, snapPoints, snapThresholdSec, useSnap);
          patch = { startSec: res.startSec };
          guide = res.snappedGuideSec;
        } else if (drag.kind === 'trim_left') {
          const res = applyClipTrimLeft(drag.initialClip, deltaSec, snapPoints, snapThresholdSec, useSnap);
          patch = { startSec: res.startSec, durationSec: res.durationSec, inSec: res.inSec };
          guide = res.snappedGuideSec;
        } else {
          const res = applyClipTrimRight(drag.initialClip, deltaSec, snapPoints, snapThresholdSec, useSnap);
          patch = { durationSec: res.durationSec };
          guide = res.snappedGuideSec;
        }

        setSnapGuideSec(guide);
        setTimeline((curr) => {
          if (!curr) return curr;
          return {
            ...curr,
            tracks: curr.tracks.map((tr) =>
              tr.id !== drag.trackId
                ? tr
                : {
                    ...tr,
                    clips: tr.clips.map((c) => (c.id === drag.clipId ? { ...c, ...patch } : c)),
                  },
            ),
          };
        });
        return;
      }

      const cDrag = cueDragRef.current;
      if (cDrag) {
        const dxPx = e.clientX - cDrag.originClientX;
        if (Math.abs(dxPx) > 2) cDrag.moved = true;
        const deltaSec = dxPx / zoomPxPerSec;
        const orig = cDrag.initialCue;
        const dur = Math.max(0.2, orig.endSec - orig.startSec);

        let nextStart = orig.startSec;
        let nextEnd = orig.endSec;
        if (cDrag.kind === 'move') {
          nextStart = Math.max(0, Math.round((orig.startSec + deltaSec) * 100) / 100);
          nextEnd = Math.round((nextStart + dur) * 100) / 100;
        } else if (cDrag.kind === 'trim_left') {
          nextStart = Math.max(0, Math.min(orig.endSec - 0.2, Math.round((orig.startSec + deltaSec) * 100) / 100));
        } else {
          nextEnd = Math.max(orig.startSec + 0.2, Math.round((orig.endSec + deltaSec) * 100) / 100);
        }

        setSubtitles((curr) => ({
          ...curr,
          cues: curr.cues.map((q) =>
            q.id === cDrag.cueId ? { ...q, startSec: nextStart, endSec: nextEnd } : q,
          ),
        }));
      }
    };

    const onPointerUp = () => {
      if (rulerScrubRef.current?.active) {
        rulerScrubRef.current = null;
      }
      if (clipDragRef.current) {
        const wasMoved = clipDragRef.current.moved;
        clipDragRef.current = null;
        setSnapGuideSec(null);
        if (wasMoved && timelineRef.current) {
          void persistTracks(timelineRef.current.tracks, undefined, true);
        }
      }
      if (cueDragRef.current) {
        const wasMoved = cueDragRef.current.moved;
        cueDragRef.current = null;
        if (wasMoved) {
          void persistSubtitles(subtitlesRef.current, true);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [zoomPxPerSec, snapEnabled, playheadSec, beatMarkers, totalDuration, persistTracks, persistSubtitles]);

  const startClipDrag = (
    e: ReactPointerEvent,
    track: TimelineTrackDto,
    clip: TimelineClipDto,
    kind: ClipDragAction['kind'],
  ) => {
    if (track.locked) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedClipId(clip.id);
    setRightMode('inspector');
    clipDragRef.current = {
      kind,
      clipId: clip.id,
      trackId: track.id,
      originClientX: e.clientX,
      initialClip: { ...clip },
      moved: false,
    };
  };

  const startCueDrag = (
    e: ReactPointerEvent,
    cue: SubtitleCue,
    kind: CueDragAction['kind'],
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedCueId(cue.id);
    cueDragRef.current = {
      kind,
      cueId: cue.id,
      originClientX: e.clientX,
      initialCue: { ...cue },
      moved: false,
    };
  };

  const handleRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const laneEl = e.currentTarget;
    const rect = laneEl.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    setPlaying(false);
    setPlayheadSec(Math.max(0, Math.min(totalDuration, Math.round((x / zoomPxPerSec) * 100) / 100)));
    rulerScrubRef.current = { laneEl, active: true };
  };

  const handleBuildAnimatic = async () => {
    setBuildingAnimatic(true);
    try {
      const built = await api.buildTimelineFromStoryboard(projectId, true);
      setTimeline(built);
      setPlayheadSec(0);
      setPlaying(false);
      onNotify('Animatique générée depuis le Storyboard + Audio');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur génération animatique');
    } finally {
      setBuildingAnimatic(false);
    }
  };

  const handleSwitchQuality = async (mode: TimelineQualityMode) => {
    try {
      const res = await api.swapTimelineQualityMode(projectId, mode);
      setTimeline(res.timeline);
      onNotify(
        mode === 'hq_master'
          ? `Mode HQ Master activé (${res.swappedCount} clip(s) mis à jour)`
          : `Mode Draft Proxy activé (${res.swappedCount} clip(s) mis à jour)`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur changement de qualité');
    }
  };

  const handleStartRender = async (mode: TimelineQualityMode) => {
    setRendering(true);
    try {
      await api.startTimelineRender(projectId, {
        qualityMode: mode,
        burnSubtitles: burnSubtitlesOnRender,
      });
      setRightMode('renders');
      onNotify(
        `Rendu incrémental FFmpeg ${mode === 'hq_master' ? 'HQ Master' : 'Draft'} lancé !`,
      );
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Impossible de lancer le rendu FFmpeg');
    } finally {
      setRendering(false);
    }
  };

  const handleClearRenderCache = async () => {
    try {
      const res = await api.clearTimelineRenderCache(projectId);
      onNotify(`Cache rendu vidé (${res.clearedFiles} segment(s) supprimés)`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur nettoyage cache');
    }
  };

  const handleStartRangePreview = async () => {
    const startSec = Math.max(0, Math.round((playheadSec - 5) * 10) / 10);
    const endSec = Math.min(totalDuration, Math.max(startSec + 2, Math.round((playheadSec + 10) * 10) / 10));
    setRendering(true);
    try {
      const res = await api.startTimelineRangeRender(projectId, {
        startSec,
        endSec,
        resolution: '1280x720',
        burnSubtitles: burnSubtitlesOnRender,
      });
      setRightMode('renders');
      onNotify(`Preview rapide [${res.startSec.toFixed(1)}s → ${res.endSec.toFixed(1)}s] lancée (${res.clipCount} clip(s)) !`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Impossible de lancer la preview plage');
    } finally {
      setRendering(false);
    }
  };

  const handleAddTrack = (type: TimelineTrackType) => {
    if (!timeline) return;
    const count = timeline.tracks.filter((t) => t.type === type).length + 1;
    const labelMap: Record<TimelineTrackType, string> = {
      video: `V${count} · Vidéo`,
      overlay: `OV${count} · Overlay / PiP`,
      text: `T${count} · Textes`,
      effect: `FX${count} · Effets`,
      audio: `A${count} · Audio`,
    };
    const newTrack: TimelineTrackDto = {
      id: crypto.randomUUID(),
      projectId,
      name: labelMap[type],
      type,
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: timeline.tracks.length,
      clips: [],
    };
    void persistTracks([...timeline.tracks, newTrack]);
  };

  // Drop media from CapCut Left Resource Drawer
  const handleDropAssetToTrack = async (
    asset: AssetDto,
    trackType: 'video' | 'overlay' | 'audio',
  ) => {
    try {
      if (timeline) pushUndoSnapshot(timeline.tracks);
      const dur = asset.durationSec && asset.durationSec > 0 ? Math.round(asset.durationSec * 100) / 100 : 4;
      const res = await api.addTimelineClip(projectId, {
        trackType,
        assetId: asset.id,
        title: asset.title,
        startSec: trackType === 'overlay' ? Math.round(playheadSec * 100) / 100 : undefined,
        durationSec: dur,
        transform: trackType === 'overlay' ? { scale: 0.45, x: 0.45, y: -0.35 } : undefined,
      });
      setTimeline(res.timeline);
      setSelectedClipId(res.clip.id);
      setRightMode('inspector');
      onNotify(`"${asset.title}" ajouté sur ${trackType.toUpperCase()}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur ajout média');
    }
  };

  // Drop text preset from Left Resource Drawer onto track T1 at playhead
  const handleDropTextPreset = async (title: string, overlay: ClipTextOverlay) => {
    try {
      if (timeline) pushUndoSnapshot(timeline.tracks);
      const res = await api.addTimelineClip(projectId, {
        trackType: 'text',
        title,
        startSec: Math.round(playheadSec * 100) / 100,
        durationSec: 3.5,
        textOverlay: overlay,
      });
      setTimeline(res.timeline);
      setSelectedClipId(res.clip.id);
      setRightMode('inspector');
      onNotify(`Texte « ${title} » ajouté à ${playheadSec.toFixed(1)}s`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur ajout texte');
    }
  };

  // Apply effect from Effects Library to selected clip
  const handleApplyEffectToClip = async (effect: VideoEffectDto) => {
    if (!selectedClip) {
      onNotify('Sélectionne d’abord un clip sur la timeline.');
      return;
    }
    const existing = selectedClip.clip.effects ?? [];
    const nextEffects = [
      ...existing,
      {
        id: crypto.randomUUID(),
        effectSlug: effect.slug,
        enabled: true,
        intensity: 1,
        params: { ...(effect.defaultParams ?? {}) },
      },
    ];
    try {
      if (timeline) pushUndoSnapshot(timeline.tracks);
      const res = await api.updateTimelineClip(projectId, selectedClip.clip.id, {
        effects: nextEffects,
      });
      setTimeline(res.timeline);
      setRightMode('inspector');
      onNotify(`Effet ${effect.icon} ${effect.name} appliqué sur "${selectedClip.clip.title}"`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur application effet');
    }
  };

  // Apply transition from Transitions Drawer to selected clip
  const handleApplyTransitionToClip = async (transition: TimelineTransition) => {
    if (!selectedClip) {
      onNotify('Sélectionne d’abord un clip sur la timeline.');
      return;
    }
    try {
      if (timeline) pushUndoSnapshot(timeline.tracks);
      const res = await api.updateTimelineClip(projectId, selectedClip.clip.id, {
        transition,
        transitionDurationSec: transition === 'cut' ? 0 : selectedClip.clip.transitionDurationSec || 0.6,
      });
      setTimeline(res.timeline);
      onNotify(`Transition ${TIMELINE_TRANSITION_META[transition].label} appliquée`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur application transition');
    }
  };

  const handleDuplicateClip = async () => {
    if (!selectedClip || !timeline) return;
    const c = selectedClip.clip;
    try {
      pushUndoSnapshot(timeline.tracks);
      const res = await api.addTimelineClip(projectId, {
        trackId: selectedClip.track.id,
        trackType: selectedClip.track.type,
        assetId: c.assetId,
        title: `${c.title} (copie)`,
        startSec: Math.round((c.startSec + c.durationSec) * 100) / 100,
        durationSec: c.durationSec,
        inSec: c.inSec,
        outSec: c.outSec,
        speed: c.speed ?? 1,
        transition: c.transition,
        transitionDurationSec: c.transitionDurationSec,
        volume: c.volume,
        fadeInSec: c.fadeInSec ?? 0,
        fadeOutSec: c.fadeOutSec ?? 0,
        transform: c.transform,
        colorAdjust: c.colorAdjust,
        effects: c.effects,
        keyframes: c.keyframes,
        textOverlay: c.textOverlay,
        camera: c.camera ?? null,
        cinemascope: c.cinemascope ?? null,
        fx: c.fx ?? [],
        flashIn: c.flashIn ?? 0,
        notes: c.notes,
      });
      setTimeline(res.timeline);
      setSelectedClipId(res.clip.id);
      onNotify(`Clip dupliqué : "${res.clip.title}"`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur duplication clip');
    }
  };

  const handleAppendAssetToTrack = (trackId: string, assetId: string) => {
    if (!timeline) return;
    const asset = assetMap.get(assetId);
    if (!asset) return;

    const nextTracks = timeline.tracks.map((tr) => {
      if (tr.id !== trackId) return tr;
      const lastEnd = tr.clips.reduce((acc, c) => Math.max(acc, c.startSec + c.durationSec), 0);
      const dur = asset.durationSec && asset.durationSec > 0 ? Math.round(asset.durationSec * 100) / 100 : 4;
      const newClip: TimelineClipDto = {
        id: crypto.randomUUID(),
        trackId: tr.id,
        projectId,
        assetId: asset.id,
        assetRef: asset.handle,
        assetTitle: asset.title,
        assetType: asset.type,
        assetQualityTier: asset.qualityTier,
        title: asset.title,
        startSec: Math.round(lastEnd * 100) / 100,
        durationSec: dur,
        inSec: 0,
        outSec: null,
        speed: 1,
        transition: 'cut',
        transitionDurationSec: 0,
        volume: 1,
        fadeInSec: 0,
        fadeOutSec: 0,
        muted: false,
        transform: { ...DEFAULT_CLIP_TRANSFORM },
        colorAdjust: { ...DEFAULT_CLIP_COLOR_ADJUST },
        effects: [],
        keyframes: [],
        textOverlay: null,
        notes: '',
        sortOrder: tr.clips.length,
      };
      return { ...tr, clips: [...tr.clips, newClip] };
    });

    void persistTracks(nextTracks);
  };

  const handlePatchLocalClip = (clipId: string, patch: Partial<TimelineClipDto>) => {
    setTimeline((curr) => {
      if (!curr) return curr;
      return {
        ...curr,
        tracks: curr.tracks.map((tr) => ({
          ...tr,
          clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
        })),
      };
    });
  };

  const handleToggleTrackMute = (trackId: string) => {
    if (!timeline) return;
    const nextTracks = timeline.tracks.map((tr) =>
      tr.id === trackId ? { ...tr, muted: !tr.muted } : tr,
    );
    void persistTracks(nextTracks);
  };

  const handleToggleTrackLock = (trackId: string) => {
    if (!timeline) return;
    const nextTracks = timeline.tracks.map((tr) =>
      tr.id === trackId ? { ...tr, locked: !tr.locked } : tr,
    );
    void persistTracks(nextTracks, undefined, true);
  };

  if (loading && !timeline) {
    return (
      <div className="empty-state">
        <Loader2 size={28} className="task-spin" color="var(--accent-amber)" />
        <p>Chargement du studio de montage...</p>
      </div>
    );
  }

  const qualityMode: TimelineQualityMode = timeline?.qualityMode ?? 'draft_proxy';

  const timelineWidthPx = Math.max(780, Math.ceil((totalDuration + 4) * zoomPxPerSec));
  const rulerTicks = Array.from({ length: Math.ceil(totalDuration + 4) + 1 }, (_, i) => i).filter(
    (s) => s % (zoomPxPerSec < 22 ? 5 : 2) === 0,
  );

  return (
    <div className="timeline-workspace capcut-studio">
      {/* Top CapCut Studio Toolbar */}
      <div className="timeline-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleBuildAnimatic()}
            disabled={buildingAnimatic}
            title="Convertir automatiquement les plans du Storyboard + Audio en piste V1 / A1"
          >
            <Wand2 size={13} />
            {buildingAnimatic ? 'Génération...' : 'Animatique'}
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSplitAtPlayhead()}
            title="Couper le clip au niveau de la tête de lecture (Raccourci : S)"
          >
            <Scissors size={12} /> Couper (S)
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Annuler (Ctrl+Z)"
            style={{ padding: '4px 7px' }}
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Rétablir (Ctrl+Shift+Z)"
            style={{ padding: '4px 7px' }}
          >
            <Redo2 size={13} />
          </button>

          <div className="quality-toggle-group" role="group" aria-label="Mode de lecture Draft / HQ">
            <button
              type="button"
              className={`chip ${qualityMode === 'draft_proxy' ? 'active' : ''}`}
              onClick={() => void handleSwitchQuality('draft_proxy')}
            >
              Draft
            </button>
            <button
              type="button"
              className={`chip ${qualityMode === 'hq_master' ? 'active' : ''}`}
              onClick={() => void handleSwitchQuality('hq_master')}
            >
              <Sparkles size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              HQ
            </button>
          </div>

          <button
            type="button"
            className={`chip ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Aimantation (maintenir Alt pour désactiver ponctuellement)"
          >
            <Magnet size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            Snap
          </button>

          <button
            type="button"
            className={`chip ${showBeatMarkers ? 'active' : ''}`}
            onClick={() => setShowBeatMarkers((v) => !v)}
          >
            <Music size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            Beats ({beatMarkers.length})
          </button>

          <button
            type="button"
            className={`chip ${showSubtitlesPreview ? 'active' : ''}`}
            onClick={() => setShowSubtitlesPreview((v) => !v)}
          >
            <Captions size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            ST ({subtitles.cues.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <label
            className="timeline-burn-toggle"
            title="Incruster les sous-titres directement dans la vidéo MP4 rendue"
          >
            <input
              type="checkbox"
              checked={burnSubtitlesOnRender}
              onChange={(e) => setBurnSubtitlesOnRender(e.target.checked)}
              disabled={subtitles.cues.length === 0}
            />
            <span>Burn-in ST</span>
          </label>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleStartRender(qualityMode)}
            disabled={rendering}
            title="Rendu vidéo FFmpeg incrémental : seuls les clips modifiés sont ré-encodés !"
          >
            {rendering ? <Loader2 size={13} className="task-spin" /> : <Zap size={13} />}
            Rendu Rapide MP4 ({qualityMode === 'hq_master' ? 'HQ' : 'Draft'})
          </button>

          <a
            href={api.getTimelineExportUrl(projectId, 'otio')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={11} /> .otio
          </a>
          <a
            href={api.getTimelineExportUrl(projectId, 'fcpxml')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={11} /> .fcpxml
          </a>
          <a
            href={api.getTimelineExportUrl(projectId, 'edl')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={11} /> .edl
          </a>
        </div>
      </div>

      {/* CapCut 3-Column Studio Top Deck: Resources | Compositing Monitor | Tabbed Inspector */}
      <div className="capcut-top-deck">
        {/* LEFT: CapCut Resource Browser (Media, Effects + Custom Creator, Transitions, Text) */}
        <EffectsLibraryDrawer
          assets={assets}
          effects={effects}
          selectedClipId={selectedClip?.clip.id ?? null}
          selectedClipTitle={selectedClip?.clip.title ?? null}
          onDropAssetToTrack={(asset, type) => void handleDropAssetToTrack(asset, type)}
          onApplyEffectToClip={(fx) => void handleApplyEffectToClip(fx)}
          onApplyTransitionToClip={(tr) => void handleApplyTransitionToClip(tr)}
          onDropTextPreset={(title, ov) => void handleDropTextPreset(title, ov)}
          onEffectsChanged={() => void loadEffects()}
          onNotify={onNotify}
        />

        {/* CENTER: Real-Time WYSIWYG 16:9 Canvas Compositing Monitor */}
        <div className="timeline-monitor-card">
          <div className="timeline-monitor-stage">
            {activeVideoAsset || activeOverlayClips.length > 0 || activeTextOverlays.length > 0 ? (
              <TimelinePreviewCanvas
                playheadSec={playheadSec}
                fps={timeline?.fps ?? 24}
                playing={playing}
                fxPreviewEnabled={fxPreviewEnabled}
                qualityMode={qualityMode}
                activeVideoClip={activeVideoClip}
                activeVideoAsset={activeVideoAsset}
                outgoingVideoAsset={outgoingVideoAsset}
                transitionFrame={transitionFrame}
                activeOverlayClips={activeOverlayClips}
                activeTextOverlays={activeTextOverlays}
                assetMap={assetMap}
                effectCatalog={effectCatalog}
                beatMarkers={allBeatMarkers}
                activeSubtitleCues={activeSubtitleCues}
                subtitleStyle={subtitles.style}
                audioRef={audioRef}
                activeAudioClipStartSec={activeAudioClip?.startSec}
                activeAudioClipInSec={activeAudioClip?.inSec}
              />
            ) : (
              <div className="timeline-monitor-empty">
                <Clapperboard size={30} color="var(--text-muted)" />
                <span>
                  {activeVideoClip
                    ? `${activeVideoClip.title} (aucun média lié)`
                    : 'Dépose des médias depuis le panneau gauche ou génère l’Animatique'}
                </span>
              </div>
            )}

            <div className="timeline-monitor-hud">
              <span className="badge">
                {secondsToSmpte(playheadSec, timeline?.fps ?? 24)} /{' '}
                {secondsToSmpte(totalDuration, timeline?.fps ?? 24)}
              </span>
              <span className="badge">
                {timeline?.resolution ?? '1920x1080'} · {timeline?.fps ?? 24} fps ·{' '}
                {qualityMode === 'hq_master' ? 'HQ' : 'PROXY'} ·{' '}
                {fxPreviewEnabled ? 'FX ON' : 'FX OFF'}
              </span>
            </div>
          </div>

          {activeAudioAsset && (
            <audio ref={audioRef} src={activeAudioAsset.urls.original} preload="auto" />
          )}

          <div className="timeline-transport">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
              {playing ? 'Pause' : 'Lecture'}
            </button>

            <button
              type="button"
              className={`chip ${fxPreviewEnabled ? 'active' : ''}`}
              onClick={() => setFxPreviewEnabled((v) => !v)}
              title="Activer ou désactiver la prévisualisation temps réel caméra / Cinémascope / FX AMV"
              style={{ whiteSpace: 'nowrap' }}
            >
              <Sparkles size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              FX Preview {fxPreviewEnabled ? 'ON' : 'OFF'}
            </button>

            <input
              type="range"
              aria-label="Position tête de lecture"
              min={0}
              max={totalDuration}
              step={0.05}
              value={Math.min(playheadSec, totalDuration)}
              onChange={(e) => {
                setPlaying(false);
                setPlayheadSec(Number(e.target.value));
              }}
              style={{ flex: 1, accentColor: 'var(--accent-amber)' }}
            />

            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Zoom
              <input
                type="range"
                min={14}
                max={96}
                value={zoomPxPerSec}
                onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
                style={{ width: 70, accentColor: 'var(--accent-amber)' }}
              />
            </label>
          </div>
        </div>

        {/* RIGHT: CapCut Clip Inspector OR Server Renders & Incremental Cache History */}
        <div className="timeline-inspector-card capcut-right-panel">
          <div className="capcut-right-switcher">
            <button
              type="button"
              className={`chip ${rightMode === 'inspector' ? 'active' : ''}`}
              onClick={() => setRightMode('inspector')}
            >
              Inspecteur Clip
            </button>
            <button
              type="button"
              className={`chip ${rightMode === 'renders' ? 'active' : ''}`}
              onClick={() => setRightMode('renders')}
            >
              Rendus ({timeline?.renders.length ?? 0})
            </button>
          </div>

          {rightMode === 'inspector' && selectedClip ? (
            <CapCutClipInspector
              track={selectedClip.track}
              clip={selectedClip.clip}
              playheadSec={playheadSec}
              effectCatalog={effectCatalog}
              saving={saving}
              onPatchClip={(patch) => handlePatchLocalClip(selectedClip.clip.id, patch)}
              onCommit={() => timeline && void persistTracks(timeline.tracks)}
              onSplitAtPlayhead={() => void handleSplitAtPlayhead(selectedClip.clip.id)}
              onDuplicateClip={() => void handleDuplicateClip()}
              onDeleteClip={(ripple) => void handleDeleteClip(selectedClip.clip.id, ripple)}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
              <div className="section-label">
                <span>Rendus Serveur FFmpeg</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={rendering}
                    onClick={() => void handleStartRangePreview()}
                    title="Rendu preview rapide de la plage autour du curseur (-5s à +10s) en réutilisant le cache"
                    style={{ fontSize: 10.5 }}
                  >
                    <Zap size={11} /> Plage
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void handleClearRenderCache()}
                    title="Vider le cache des segments FFmpeg pour forcer un ré-encodage complet"
                    style={{ fontSize: 10.5 }}
                  >
                    <Trash2 size={11} /> Cache
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void loadAll()}
                    title="Actualiser"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>
              <div className="capcut-hint-banner">
                ⚡ <strong>Cache incrémental actif</strong> : si tu modifies 1 seul extrait, les autres segments sont réutilisés instantanément.
              </div>
              {timeline && timeline.renders.length > 0 ? (
                <div className="timeline-render-list">
                  {timeline.renders.slice(0, 8).map((r) => (
                    <div key={r.id} className="timeline-render-row">
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>
                          {r.qualityMode === 'hq_master' ? 'HQ Master' : 'Draft'} · {r.resolution}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {r.status === 'completed'
                            ? `Terminé · ${r.outputAssetHandle ?? 'MP4'}`
                            : r.status === 'failed'
                              ? `Erreur : ${r.errorMessage?.slice(0, 60) ?? 'échec'}`
                              : `Encodage ${r.progress}%...`}
                        </div>
                      </div>
                      {r.outputAssetId && onOpenAssetId && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onOpenAssetId(r.outputAssetId!)}
                        >
                          Voir
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  Aucun rendu MP4 encore généré. Clique sur un clip pour l’inspecter, ou lance « Rendu Rapide MP4 ».
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Workspace: Multi-Track CapCut Timeline OR Synchronized Subtitles Editor */}
      <div className="timeline-tracks-panel">
        <div className="timeline-tracks-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`chip ${bottomTab === 'tracks' ? 'active' : ''}`}
              onClick={() => setBottomTab('tracks')}
            >
              <Layers size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              Pistes Multi-Track ({timeline?.tracks.length ?? 0} + ST · {formatDuration(totalDuration)})
            </button>
            <button
              type="button"
              className={`chip ${bottomTab === 'subtitles' ? 'active' : ''}`}
              onClick={() => setBottomTab('subtitles')}
            >
              <Captions size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              Sous-titres SRT ({subtitles.cues.length})
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              Glisser = déplacer · Bords = Trim · <strong>S</strong> = couper · <strong>Espace</strong> = lecture · <strong>Ctrl+Z</strong> = annuler
            </span>
          </div>
          {bottomTab === 'tracks' && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('video')}
              >
                <Plus size={11} /> Vidéo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('overlay')}
              >
                <Plus size={11} /> Overlay
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('text')}
              >
                <Type size={11} /> Texte
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('audio')}
              >
                <Plus size={11} /> Audio
              </button>
            </div>
          )}
        </div>

        {bottomTab === 'subtitles' ? (
          <SubtitleEditorPanel
            projectId={projectId}
            subtitles={subtitles}
            audioTracks={audioTracks}
            playheadSec={playheadSec}
            selectedCueId={selectedCueId}
            saving={savingSubs}
            onChange={setSubtitles}
            onSave={(next) => persistSubtitles(next)}
            onReload={setSubtitles}
            onSeek={(sec) => {
              setPlaying(false);
              setPlayheadSec(sec);
            }}
            onSelectCue={setSelectedCueId}
            onNotify={onNotify}
          />
        ) : (
          <div className="timeline-tracks-scroll">
            <div className="timeline-ruler-row">
              <div className="timeline-track-label-col">Piste</div>
              <div
                className="timeline-ruler-lane"
                style={{ width: timelineWidthPx, cursor: 'ew-resize' }}
                onPointerDown={handleRulerPointerDown}
                title="Cliquer ou glisser pour déplacer la tête de lecture"
              >
                {rulerTicks.map((s) => (
                  <div
                    key={s}
                    className="timeline-ruler-tick"
                    style={{ left: `${s * zoomPxPerSec}px` }}
                  >
                    <span>{formatDuration(s)}</span>
                  </div>
                ))}

                {beatMarkers.map((m, i) => (
                  <div
                    key={`${m.kind}-${m.timeSec}-${i}`}
                    className={`timeline-beat-pin kind-${m.kind}`}
                    style={{ left: `${m.timeSec * zoomPxPerSec}px` }}
                    title={`${m.label} (${m.timeSec.toFixed(2)}s)`}
                  />
                ))}

                <div
                  className="timeline-playhead-line"
                  style={{ left: `${playheadSec * zoomPxPerSec}px` }}
                />
                {snapGuideSec !== null && (
                  <div
                    className="timeline-snap-guide"
                    style={{ left: `${snapGuideSec * zoomPxPerSec}px` }}
                  />
                )}
              </div>
            </div>

            {(timeline?.tracks ?? []).map((track) => {
              const selectableAssets = assets.filter((a) =>
                track.type === 'audio' ? a.type === 'audio' : a.type === 'image' || a.type === 'video',
              );
              return (
                <div key={track.id} className={`timeline-track-row ${track.muted ? 'muted' : ''}`}>
                  <div className="timeline-track-label-col">
                    <div className="timeline-track-name">{track.name}</div>
                    <div className="timeline-track-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleToggleTrackMute(track.id)}
                        title={track.muted ? 'Réactiver la piste' : 'Couper / masquer la piste'}
                        style={{ padding: '2px 5px' }}
                      >
                        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleToggleTrackLock(track.id)}
                        title={track.locked ? 'Déverrouiller la piste' : 'Verrouiller la piste'}
                        style={{ padding: '2px 5px' }}
                      >
                        {track.locked ? <Lock size={11} color="var(--accent-amber)" /> : <Unlock size={11} />}
                      </button>
                      {track.type !== 'text' && track.type !== 'effect' && (
                        <select
                          className="select timeline-add-clip-select"
                          aria-label={`Ajouter média sur ${track.name}`}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAppendAssetToTrack(track.id, e.target.value);
                              e.target.value = '';
                            }
                          }}
                        >
                          <option value="">+ Média...</option>
                          {selectableAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.handle} · {a.title.slice(0, 24)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="timeline-track-lane" style={{ width: timelineWidthPx }}>
                    {beatMarkers
                      .filter((m) => m.kind === 'beat')
                      .map((m, i) => (
                        <div
                          key={`bg-${i}`}
                          className="timeline-beat-gridline"
                          style={{ left: `${m.timeSec * zoomPxPerSec}px` }}
                        />
                      ))}

                    <div
                      className="timeline-playhead-line"
                      style={{ left: `${playheadSec * zoomPxPerSec}px` }}
                    />
                    {snapGuideSec !== null && (
                      <div
                        className="timeline-snap-guide"
                        style={{ left: `${snapGuideSec * zoomPxPerSec}px` }}
                      />
                    )}

                    {track.clips.map((clip) => {
                      const asset = clip.assetId ? assetMap.get(clip.assetId) : null;
                      const widthPx = Math.max(38, clip.durationSec * zoomPxPerSec);
                      const isAudio = track.type === 'audio';
                      const fxCount = (clip.effects ?? []).filter((e) => e.enabled).length;
                      const kfCount = (clip.keyframes ?? []).length;
                      const spd = clip.speed ?? 1;
                      const transMeta = TIMELINE_TRANSITION_META[clip.transition];
                      return (
                        <div
                          key={clip.id}
                          role="button"
                          tabIndex={0}
                          className={`timeline-clip-block ${track.type} ${selectedClipId === clip.id ? 'selected' : ''}`}
                          style={{
                            left: `${clip.startSec * zoomPxPerSec}px`,
                            width: `${widthPx}px`,
                          }}
                          onPointerDown={(e) => startClipDrag(e, track, clip, 'move')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClipId(clip.id);
                            setRightMode('inspector');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedClipId(clip.id);
                              setRightMode('inspector');
                            }
                          }}
                          title={`${clip.title} (${clip.startSec.toFixed(1)}s · ${clip.durationSec.toFixed(1)}s · ${spd}×)`}
                        >
                          <div
                            className="timeline-trim-handle left"
                            title="Tirer pour rogner le début (In)"
                            onPointerDown={(e) => startClipDrag(e, track, clip, 'trim_left')}
                          />

                          {isAudio && asset?.urls.original && (
                            <TimelineWaveform
                              audioUrl={asset.urls.original}
                              widthPx={Math.max(40, widthPx - 8)}
                              heightPx={36}
                            />
                          )}

                          {!isAudio && asset?.urls.thumbnail && (
                            <img
                              src={asset.urls.thumbnail}
                              alt=""
                              className="timeline-clip-thumb"
                              draggable={false}
                            />
                          )}

                          <div className="timeline-clip-meta">
                            <span className="timeline-clip-title">
                              {track.type === 'text' && clip.textOverlay?.text
                                ? `T · ${clip.textOverlay.text}`
                                : clip.title}
                            </span>
                            <span className="timeline-clip-sub">
                              {clip.durationSec.toFixed(1)}s
                              {Math.abs(spd - 1) > 0.02 ? ` · ${spd.toFixed(1)}×` : ''}
                              {clip.transition !== 'cut' ? ` · ${transMeta?.icon ?? '✨'}` : ''}
                              {fxCount > 0 ? ` · ✨${fxCount}` : ''}
                              {kfCount > 0 ? ` · ◆${kfCount}` : ''}
                            </span>
                          </div>

                          <div
                            className="timeline-trim-handle right"
                            title="Tirer pour ajuster la durée (Out)"
                            onPointerDown={(e) => startClipDrag(e, track, clip, 'trim_right')}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Synchronized Subtitles Track S1 */}
            <div className="timeline-track-row subtitle-track">
              <div className="timeline-track-label-col">
                <div className="timeline-track-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Captions size={12} color="var(--accent-amber)" />
                  S1 · Sous-titres ({subtitles.cues.length})
                </div>
                <div className="timeline-track-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBottomTab('subtitles')}
                    style={{ fontSize: 10.5 }}
                  >
                    Éditer SRT
                  </button>
                </div>
              </div>

              <div className="timeline-track-lane" style={{ width: timelineWidthPx }}>
                <div
                  className="timeline-playhead-line"
                  style={{ left: `${playheadSec * zoomPxPerSec}px` }}
                />
                {subtitles.cues.map((cue) => {
                  const widthPx = Math.max(26, (cue.endSec - cue.startSec) * zoomPxPerSec);
                  return (
                    <div
                      key={cue.id}
                      role="button"
                      tabIndex={0}
                      className={`timeline-clip-block subtitle ${selectedCueId === cue.id ? 'selected' : ''}`}
                      style={{
                        left: `${cue.startSec * zoomPxPerSec}px`,
                        width: `${widthPx}px`,
                      }}
                      onPointerDown={(e) => startCueDrag(e, cue, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCueId(cue.id);
                        setPlayheadSec(cue.startSec);
                      }}
                      onDoubleClick={() => {
                        setSelectedCueId(cue.id);
                        setBottomTab('subtitles');
                      }}
                      title={`${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text} (${cue.startSec.toFixed(2)}s -> ${cue.endSec.toFixed(2)}s)`}
                    >
                      <div
                        className="timeline-trim-handle left"
                        onPointerDown={(e) => startCueDrag(e, cue, 'trim_left')}
                      />
                      <div className="timeline-clip-meta">
                        <span className="timeline-clip-title">
                          {cue.speaker ? `${cue.speaker}: ` : ''}
                          {cue.text}
                        </span>
                      </div>
                      <div
                        className="timeline-trim-handle right"
                        onPointerDown={(e) => startCueDrag(e, cue, 'trim_right')}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

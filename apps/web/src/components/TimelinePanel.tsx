import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Captions,
  Clapperboard,
  Download,
  Film,
  Layers,
  Loader2,
  Magnet,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import {
  applyClipDragMove,
  applyClipTrimLeft,
  applyClipTrimRight,
  collectTimelineSnapPoints,
  DEFAULT_SUBTITLE_STYLE,
  evaluateTimelineTransitionFrame,
  extractTimelineBeatMarkers,
  findActiveSubtitleCues,
  secondsToSmpte,
  selectTimelinePlaybackUrl,
  type AssetDto,
  type AudioTrackDto,
  type ProjectSubtitlesDto,
  type SubtitleCue,
  type TimelineClipDto,
  type TimelineDto,
  type TimelineQualityMode,
  type TimelineTrackDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatDuration } from '../utils/format';
import { SubtitleEditorPanel } from './SubtitleEditorPanel';
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

export function TimelinePanel({
  projectId,
  assets,
  refreshSignal,
  onNotify,
  onOpenAssetId,
}: TimelinePanelProps) {
  const [timeline, setTimeline] = useState<TimelineDto | null>(null);
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

  // NLE v2 + Subtitles options
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showBeatMarkers, setShowBeatMarkers] = useState(true);
  const [showSubtitlesPreview, setShowSubtitlesPreview] = useState(true);
  const [burnSubtitlesOnRender, setBurnSubtitlesOnRender] = useState(false);
  const [bottomTab, setBottomTab] = useState<'tracks' | 'subtitles'>('tracks');
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);

  // Playback state for live Animatic / Timeline preview
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

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

  const loadAll = useCallback(async () => {
    try {
      const [tl, aud, subs] = await Promise.all([
        api.getTimeline(projectId),
        api.listAudioTracks(projectId).catch(() => [] as AudioTrackDto[]),
        api.getSubtitles(projectId).catch(() => null),
      ]);
      setTimeline(tl);
      setAudioTracks(aud);
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

  const beatMarkers = useMemo(
    () => (showBeatMarkers ? extractTimelineBeatMarkers(audioTracks, totalDuration) : []),
    [audioTracks, totalDuration, showBeatMarkers],
  );

  // Advance playhead smoothly at ~30-60fps when playing animatic preview
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

  // All non-muted video clips sorted for transition preview evaluation
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
    const targetAudioTime = Math.max(0, playheadSec - activeAudioClip.startSec + activeAudioClip.inSec);
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

  const persistTracks = useCallback(
    async (nextTracks: TimelineTrackDto[], qualityMode?: TimelineQualityMode, silent = false) => {
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
              transition: c.transition,
              transitionDurationSec: c.transitionDurationSec,
              volume: c.volume,
              muted: c.muted,
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
    [projectId, onNotify],
  );

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

  // Global pointer handlers for direct Clip Drag/Trim, Subtitle Cue Drag/Trim, and Ruler Scrubbing
  useEffect(() => {
    const snapThresholdSec = Math.max(0.12, 10 / Math.max(14, zoomPxPerSec));

    const onPointerMove = (e: PointerEvent) => {
      // 1. Ruler scrubbing
      if (rulerScrubRef.current?.active) {
        const rect = rulerScrubRef.current.laneEl.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left);
        const sec = Math.max(0, Math.min(totalDuration, Math.round((x / zoomPxPerSec) * 100) / 100));
        setPlayheadSec(sec);
        return;
      }

      // 2. Clip drag / trim
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

      // 3. Subtitle cue drag / trim on track S1
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
      onNotify(
        `Rendu FFmpeg ${mode === 'hq_master' ? 'HQ Master' : 'Draft'}${burnSubtitlesOnRender ? ' + Sous-titres incrustés' : ''} lancé !`,
      );
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Impossible de lancer le rendu FFmpeg');
    } finally {
      setRendering(false);
    }
  };

  const handleAddTrack = (type: 'video' | 'audio') => {
    if (!timeline) return;
    const count = timeline.tracks.filter((t) => t.type === type).length + 1;
    const newTrack: TimelineTrackDto = {
      id: crypto.randomUUID(),
      projectId,
      name: type === 'video' ? `V${count} · Vidéo` : `A${count} · Audio`,
      type,
      muted: false,
      locked: false,
      volume: 1,
      sortOrder: timeline.tracks.length,
      clips: [],
    };
    void persistTracks([...timeline.tracks, newTrack]);
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
        transition: 'cut',
        transitionDurationSec: 0,
        volume: 1,
        muted: false,
        notes: '',
        sortOrder: tr.clips.length,
      };
      return { ...tr, clips: [...tr.clips, newClip] };
    });

    void persistTracks(nextTracks);
  };

  const handleUpdateClipField = (
    clipId: string,
    patch: Partial<
      Pick<TimelineClipDto, 'title' | 'startSec' | 'durationSec' | 'inSec' | 'transition' | 'transitionDurationSec'>
    >,
  ) => {
    if (!timeline) return;
    setTimeline({
      ...timeline,
      tracks: timeline.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      })),
    });
  };

  const handleDeleteClip = (clipId: string) => {
    if (!timeline) return;
    const nextTracks = timeline.tracks.map((tr) => ({
      ...tr,
      clips: tr.clips.filter((c) => c.id !== clipId),
    }));
    setSelectedClipId(null);
    void persistTracks(nextTracks);
  };

  const handleToggleTrackMute = (trackId: string) => {
    if (!timeline) return;
    const nextTracks = timeline.tracks.map((tr) =>
      tr.id === trackId ? { ...tr, muted: !tr.muted } : tr,
    );
    void persistTracks(nextTracks);
  };

  if (loading && !timeline) {
    return (
      <div className="empty-state">
        <Loader2 size={28} className="task-spin" color="var(--accent-amber)" />
        <p>Chargement de la timeline NLE...</p>
      </div>
    );
  }

  const qualityMode: TimelineQualityMode = timeline?.qualityMode ?? 'draft_proxy';
  const playbackUrl =
    activeVideoAsset && timeline
      ? selectTimelinePlaybackUrl(activeVideoAsset.urls, activeVideoAsset.type, qualityMode)
      : null;
  const outgoingPlaybackUrl =
    outgoingVideoAsset && timeline
      ? selectTimelinePlaybackUrl(outgoingVideoAsset.urls, outgoingVideoAsset.type, qualityMode)
      : null;

  const timelineWidthPx = Math.max(780, Math.ceil((totalDuration + 4) * zoomPxPerSec));
  const rulerTicks = Array.from({ length: Math.ceil(totalDuration + 4) + 1 }, (_, i) => i).filter(
    (s) => s % (zoomPxPerSec < 22 ? 5 : 2) === 0,
  );

  return (
    <div className="timeline-workspace">
      {/* Top Toolbar */}
      <div className="timeline-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleBuildAnimatic()}
            disabled={buildingAnimatic}
            title="Convertir automatiquement les plans du Storyboard + Audio en piste V1 / A1"
          >
            <Wand2 size={13} />
            {buildingAnimatic ? 'Génération...' : 'Animatique depuis Storyboard'}
          </button>

          <div className="quality-toggle-group" role="group" aria-label="Mode de lecture Draft / HQ">
            <button
              type="button"
              className={`chip ${qualityMode === 'draft_proxy' ? 'active' : ''}`}
              onClick={() => void handleSwitchQuality('draft_proxy')}
            >
              Draft Proxy
            </button>
            <button
              type="button"
              className={`chip ${qualityMode === 'hq_master' ? 'active' : ''}`}
              onClick={() => void handleSwitchQuality('hq_master')}
            >
              <Sparkles size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              HQ Master
            </button>
          </div>

          <button
            type="button"
            className={`chip ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Aimantation sur les clips, le curseur et les beats (maintenir Alt pour désactiver ponctuellement)"
          >
            <Magnet size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Snap
          </button>

          <button
            type="button"
            className={`chip ${showBeatMarkers ? 'active' : ''}`}
            onClick={() => setShowBeatMarkers((v) => !v)}
            title="Afficher les repères BPM & paroles Suno/LRC sur la règle"
          >
            <Music size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Beats / LRC ({beatMarkers.length})
          </button>

          <button
            type="button"
            className={`chip ${showSubtitlesPreview ? 'active' : ''}`}
            onClick={() => setShowSubtitlesPreview((v) => !v)}
            title="Afficher les sous-titres en direct sur le moniteur"
          >
            <Captions size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            ST ({subtitles.cues.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <label
            className="timeline-burn-toggle"
            title="Incruster les sous-titres (Burn-in FFmpeg) directement dans la vidéo MP4 rendue"
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
            className="btn btn-secondary btn-sm"
            onClick={() => void handleStartRender(qualityMode)}
            disabled={rendering}
            title="Lancer un rendu vidéo MP4 FFmpeg côté serveur (enregistré dans /renders)"
          >
            {rendering ? <Loader2 size={13} className="task-spin" /> : <Film size={13} />}
            Rendu MP4 ({qualityMode === 'hq_master' ? 'HQ' : 'Draft'})
          </button>

          <a
            href={api.getTimelineExportUrl(projectId, 'otio')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
            title="Exporter en OpenTimelineIO (.otio) pour DaVinci Resolve"
          >
            <Download size={12} /> .otio
          </a>
          <a
            href={api.getTimelineExportUrl(projectId, 'fcpxml')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
            title="Exporter en Final Cut Pro XML (.fcpxml)"
          >
            <Download size={12} /> .fcpxml
          </a>
          <a
            href={api.getTimelineExportUrl(projectId, 'edl')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
            title="Exporter en CMX 3600 EDL (.edl)"
          >
            <Download size={12} /> .edl
          </a>
        </div>
      </div>

      {/* Preview Monitor + Transport + Selected Clip Inspector */}
      <div className="timeline-top-grid">
        <div className="timeline-monitor-card">
          <div className="timeline-monitor-stage">
            {/* Outgoing clip layer for live Crossfade transition preview */}
            {outgoingVideoAsset && outgoingPlaybackUrl && transitionFrame.outgoingOpacity > 0.01 && (
              <img
                src={outgoingVideoAsset.urls.thumbnail || outgoingPlaybackUrl}
                alt={outgoingVideoAsset.title}
                className="timeline-transition-layer"
                style={{ opacity: transitionFrame.outgoingOpacity }}
              />
            )}

            {activeVideoAsset && playbackUrl ? (
              activeVideoAsset.type === 'video' ? (
                <video
                  ref={videoPreviewRef}
                  key={playbackUrl}
                  src={playbackUrl}
                  muted
                  playsInline
                  autoPlay={playing}
                  style={{ opacity: transitionFrame.activeOpacity }}
                />
              ) : (
                <img
                  src={playbackUrl}
                  alt={activeVideoAsset.title}
                  style={{ opacity: transitionFrame.activeOpacity }}
                />
              )
            ) : (
              <div className="timeline-monitor-empty">
                <Clapperboard size={30} color="var(--text-muted)" />
                <span>
                  {activeVideoClip
                    ? `${activeVideoClip.title} (aucun média lié)`
                    : 'Clique sur « Animatique depuis Storyboard » ou ajoute des clips'}
                </span>
              </div>
            )}

            {/* Live Fade-to-Black Transition Overlay */}
            {transitionFrame.blackOverlayOpacity > 0.01 && (
              <div
                className="timeline-black-fade-overlay"
                style={{ opacity: transitionFrame.blackOverlayOpacity }}
                aria-hidden="true"
              />
            )}

            {/* Live Cinema Subtitle Overlay */}
            {activeSubtitleCues.length > 0 && (
              <div className={`timeline-subtitle-overlay pos-${subtitles.style.position}`}>
                {activeSubtitleCues.map((cue) => (
                  <div
                    key={cue.id}
                    className="timeline-subtitle-pill"
                    style={{
                      fontSize: `${Math.max(12, Math.round(subtitles.style.fontSize * 0.68))}px`,
                      color: subtitles.style.color,
                      backgroundColor: `rgba(0, 0, 0, ${subtitles.style.backgroundOpacity})`,
                    }}
                  >
                    {cue.speaker ? <strong>{cue.speaker}: </strong> : null}
                    {cue.text}
                  </div>
                ))}
              </div>
            )}

            <div className="timeline-monitor-hud">
              <span className="badge">
                {secondsToSmpte(playheadSec, timeline?.fps ?? 24)} /{' '}
                {secondsToSmpte(totalDuration, timeline?.fps ?? 24)}
              </span>
              <span className="badge">
                {timeline?.resolution ?? '1920x1080'} · {timeline?.fps ?? 24} fps ·{' '}
                {qualityMode === 'hq_master' ? 'HQ' : 'PROXY'}
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
              {playing ? 'Pause' : 'Lecture Animatique'}
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
                style={{ width: 78, accentColor: 'var(--accent-amber)' }}
              />
            </label>
          </div>
        </div>

        {/* Right Side: Selected Clip Inspector OR Server Renders History */}
        <div className="timeline-inspector-card">
          {selectedClip ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="section-label">
                <span>Clip sélectionné</span>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDeleteClip(selectedClip.clip.id)}
                >
                  <Trash2 size={12} /> Supprimer
                </button>
              </div>
              <div className="field">
                <label>Titre</label>
                <input
                  className="input"
                  value={selectedClip.clip.title}
                  onChange={(e) =>
                    handleUpdateClipField(selectedClip.clip.id, { title: e.target.value })
                  }
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>Début (s)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedClip.clip.startSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        startSec: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Durée (s)</label>
                  <input
                    className="input"
                    type="number"
                    min={0.2}
                    step={0.1}
                    value={selectedClip.clip.durationSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        durationSec: Math.max(0.2, Number(e.target.value) || 0.2),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>In (s)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedClip.clip.inSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        inSec: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>Transition</label>
                  <select
                    className="select"
                    value={selectedClip.clip.transition}
                    onChange={(e) => {
                      const nextTrans = e.target.value as TimelineClipDto['transition'];
                      handleUpdateClipField(selectedClip.clip.id, {
                        transition: nextTrans,
                        transitionDurationSec:
                          nextTrans === 'cut'
                            ? 0
                            : selectedClip.clip.transitionDurationSec || 0.6,
                      });
                    }}
                  >
                    <option value="cut">Cut</option>
                    <option value="crossfade">Crossfade</option>
                    <option value="fade_black">Fondu au noir</option>
                  </select>
                </div>
                <div className="field">
                  <label>Durée trans. (s)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    disabled={selectedClip.clip.transition === 'cut'}
                    value={selectedClip.clip.transitionDurationSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        transitionDurationSec: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saving}
                onClick={() => timeline && void persistTracks(timeline.tracks)}
              >
                <Save size={12} /> {saving ? 'Enregistrement...' : 'Appliquer'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="section-label">
                <span>Rendus Serveur FFmpeg</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadAll()}
                  title="Actualiser"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              {timeline && timeline.renders.length > 0 ? (
                <div className="timeline-render-list">
                  {timeline.renders.slice(0, 6).map((r) => (
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
                  Aucun rendu MP4 encore généré. Glisse ou redimensionne tes clips directement sur la
                  timeline, puis clique sur « Rendu MP4 ».
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Workspace Switcher: Multi-Track NLE OR Synchronized Subtitles Editor */}
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
              Éditeur Sous-titres SRT ({subtitles.cues.length})
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              Glisse un clip pour déplacer · tire ses bords gauche/droite pour rogner (Trim)
            </span>
          </div>
          {bottomTab === 'tracks' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('video')}
              >
                <Plus size={12} /> Piste Vidéo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleAddTrack('audio')}
              >
                <Plus size={12} /> Piste Audio
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

                {/* Suno / LRC Beat & Lyric Markers on Ruler */}
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
                        title={track.muted ? 'Réactiver la piste' : 'Couper le son / masquer la piste'}
                      >
                        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
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
                        <option value="">+ Ajouter média...</option>
                        {selectableAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.handle} · {a.title.slice(0, 28)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="timeline-track-lane" style={{ width: timelineWidthPx }}>
                    {/* Beat grid vertical hairlines */}
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
                      const widthPx = Math.max(36, clip.durationSec * zoomPxPerSec);
                      const isAudio = track.type === 'audio';
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
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') setSelectedClipId(clip.id);
                          }}
                          title={`${clip.title} (${clip.startSec.toFixed(1)}s → ${(clip.startSec + clip.durationSec).toFixed(1)}s) — Glisser pour déplacer, bords pour trim`}
                        >
                          {/* Left Trim Handle */}
                          <div
                            className="timeline-trim-handle left"
                            onPointerDown={(e) => startClipDrag(e, track, clip, 'trim_left')}
                            title="Tirer pour rogner le début (Trim In)"
                          />

                          {isAudio && (
                            <TimelineWaveform
                              audioUrl={asset?.urls.original ?? null}
                              widthPx={widthPx}
                              heightPx={34}
                              seedKey={clip.id}
                            />
                          )}

                          {asset?.urls.thumbnail && !isAudio && (
                            <img
                              src={asset.urls.thumbnail}
                              alt=""
                              className="timeline-clip-thumb"
                              draggable={false}
                            />
                          )}

                          <div className="timeline-clip-meta">
                            <span className="timeline-clip-title">
                              {isAudio && <Music size={10} style={{ marginRight: 3 }} />}
                              {clip.title}
                            </span>
                            <span className="timeline-clip-sub">
                              {clip.assetRef ?? 'sans média'} · {clip.durationSec.toFixed(1)}s
                              {clip.transition !== 'cut' ? ` · ${clip.transition === 'crossfade' ? 'FX' : 'FB'}` : ''}
                            </span>
                          </div>

                          {/* Right Trim Handle */}
                          <div
                            className="timeline-trim-handle right"
                            onPointerDown={(e) => startClipDrag(e, track, clip, 'trim_right')}
                            title="Tirer pour ajuster la durée (Trim Out)"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Dedicated Subtitle Track S1 */}
            <div className={`timeline-track-row subtitle-track ${!showSubtitlesPreview ? 'muted' : ''}`}>
              <div className="timeline-track-label-col">
                <div className="timeline-track-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Captions size={12} color="var(--accent-amber)" />
                  S1 · Sous-titres ({subtitles.language.toUpperCase()})
                </div>
                <div className="timeline-track-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBottomTab('subtitles')}
                    title="Ouvrir l'éditeur complet de sous-titres SRT"
                  >
                    Éditer ({subtitles.cues.length})
                  </button>
                </div>
              </div>
              <div className="timeline-track-lane" style={{ width: timelineWidthPx }}>
                <div
                  className="timeline-playhead-line"
                  style={{ left: `${playheadSec * zoomPxPerSec}px` }}
                />
                {subtitles.cues.map((cue) => {
                  const dur = Math.max(0.2, cue.endSec - cue.startSec);
                  const wPx = Math.max(28, dur * zoomPxPerSec);
                  return (
                    <div
                      key={cue.id}
                      className={`timeline-subtitle-block ${selectedCueId === cue.id ? 'selected' : ''}`}
                      style={{
                        left: `${cue.startSec * zoomPxPerSec}px`,
                        width: `${wPx}px`,
                      }}
                      onPointerDown={(e) => startCueDrag(e, cue, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCueId(cue.id);
                        setPlayheadSec(cue.startSec + 0.01);
                      }}
                      onDoubleClick={() => setBottomTab('subtitles')}
                      title={`${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text} (${cue.startSec.toFixed(1)}s → ${cue.endSec.toFixed(1)}s)`}
                    >
                      <div
                        className="timeline-trim-handle left"
                        onPointerDown={(e) => startCueDrag(e, cue, 'trim_left')}
                      />
                      <span className="timeline-subtitle-block-text">
                        {cue.speaker ? `${cue.speaker}: ` : ''}
                        {cue.text}
                      </span>
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

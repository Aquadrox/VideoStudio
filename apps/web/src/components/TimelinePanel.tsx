import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Download,
  Film,
  Layers,
  Loader2,
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
  secondsToSmpte,
  selectTimelinePlaybackUrl,
  type AssetDto,
  type TimelineClipDto,
  type TimelineDto,
  type TimelineQualityMode,
  type TimelineTrackDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatDuration } from '../utils/format';

interface TimelinePanelProps {
  projectId: string;
  assets: AssetDto[];
  refreshSignal: number;
  onNotify: (msg: string) => void;
  onOpenAssetId?: (assetId: string) => void;
}

const PX_PER_SEC_DEFAULT = 32;

export function TimelinePanel({
  projectId,
  assets,
  refreshSignal,
  onNotify,
  onOpenAssetId,
}: TimelinePanelProps) {
  const [timeline, setTimeline] = useState<TimelineDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [buildingAnimatic, setBuildingAnimatic] = useState(false);
  const [zoomPxPerSec, setZoomPxPerSec] = useState(PX_PER_SEC_DEFAULT);

  // Playback state for live Animatic / Timeline preview
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const loadTimeline = useCallback(async () => {
    try {
      const data = await api.getTimeline(projectId);
      setTimeline(data);
    } catch {
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void loadTimeline();
  }, [loadTimeline, refreshSignal]);

  const totalDuration = Math.max(4, timeline?.totalDurationSec ?? 0);

  // Advance playhead smoothly at ~30fps when playing animatic preview
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

  // Active video/image clip under playhead
  const activeVideoClip = useMemo<TimelineClipDto | null>(() => {
    if (!timeline) return null;
    for (const track of timeline.tracks) {
      if (track.type !== 'video' || track.muted) continue;
      const found = track.clips.find(
        (c) => !c.muted && playheadSec >= c.startSec && playheadSec < c.startSec + c.durationSec,
      );
      if (found) return found;
    }
    return null;
  }, [timeline, playheadSec]);

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
  const activeAudioAsset = activeAudioClip?.assetId ? assetMap.get(activeAudioClip.assetId) ?? null : null;

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

  const persistTracks = async (
    nextTracks: TimelineTrackDto[],
    qualityMode?: TimelineQualityMode,
  ) => {
    setSaving(true);
    try {
      const saved = await api.saveTimeline(projectId, {
        qualityMode: qualityMode ?? timeline?.qualityMode ?? 'draft_proxy',
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
      onNotify('Timeline enregistrée');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde timeline');
    } finally {
      setSaving(false);
    }
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
      await api.startTimelineRender(projectId, { qualityMode: mode });
      onNotify(`Rendu FFmpeg ${mode === 'hq_master' ? 'HQ Master' : 'Draft'} lancé en arrière-plan !`);
      await loadTimeline();
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
    patch: Partial<Pick<TimelineClipDto, 'title' | 'startSec' | 'durationSec' | 'inSec' | 'transition'>>,
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

  const timelineWidthPx = Math.max(760, Math.ceil((totalDuration + 4) * zoomPxPerSec));
  const rulerTicks = Array.from({ length: Math.ceil(totalDuration + 4) + 1 }, (_, i) => i).filter(
    (s) => s % (zoomPxPerSec < 20 ? 5 : 2) === 0,
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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
            {activeVideoAsset && playbackUrl ? (
              activeVideoAsset.type === 'video' ? (
                <video
                  ref={videoPreviewRef}
                  key={playbackUrl}
                  src={playbackUrl}
                  muted
                  playsInline
                  autoPlay={playing}
                />
              ) : (
                <img src={playbackUrl} alt={activeVideoAsset.title} />
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
                max={80}
                value={zoomPxPerSec}
                onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
                style={{ width: 72, accentColor: 'var(--accent-amber)' }}
              />
            </label>
          </div>
        </div>

        {/* Right Side: Selected Clip Properties OR Server Render History */}
        <div className="timeline-side-card">
          {selectedClip ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="section-label">
                <span>Clip sélectionné</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDeleteClip(selectedClip.clip.id)}
                  style={{ color: 'var(--status-danger)' }}
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
              <div className="field-row">
                <div className="field">
                  <label>Début (s)</label>
                  <input
                    className="input"
                    type="number"
                    step={0.1}
                    min={0}
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
                    step={0.1}
                    min={0.2}
                    value={selectedClip.clip.durationSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        durationSec: Math.max(0.2, Number(e.target.value) || 0.2),
                      })
                    }
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Trim In (s)</label>
                  <input
                    className="input"
                    type="number"
                    step={0.1}
                    min={0}
                    value={selectedClip.clip.inSec}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        inSec: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Transition</label>
                  <select
                    className="select"
                    value={selectedClip.clip.transition}
                    onChange={(e) =>
                      handleUpdateClipField(selectedClip.clip.id, {
                        transition: e.target.value as TimelineClipDto['transition'],
                      })
                    }
                  >
                    <option value="cut">Cut</option>
                    <option value="crossfade">Crossfade</option>
                    <option value="fade_black">Fondu au noir</option>
                  </select>
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
                  onClick={() => void loadTimeline()}
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
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {r.status.toUpperCase()} {r.status === 'rendering' ? `(${r.progress}%)` : ''}{' '}
                          {r.durationSec ? `· ${formatDuration(r.durationSec)}` : ''}
                        </div>
                      </div>
                      {r.outputAssetId && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="ref-copy-btn"
                            onClick={() => onOpenAssetId?.(r.outputAssetId!)}
                          >
                            {r.outputAssetHandle ?? 'Voir'}
                          </button>
                          <a
                            href={`/api/media/${r.outputAssetId}/original`}
                            download
                            className="btn btn-ghost btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            <Download size={12} />
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Aucun rendu MP4 encore généré. Cliquez sur « Rendu MP4 » pour assembler la timeline
                  en MP4 dans <code>/renders</code>.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Multi-Track NLE Sequencer */}
      <div className="timeline-tracks-card">
        <div className="timeline-tracks-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} color="var(--accent-amber)" />
            <strong>Pistes Multi-Track</strong>
            <span className="timeline-meta-muted">
              ({timeline?.tracks.length ?? 0} piste(s) · {formatDuration(totalDuration)})
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleAddTrack('video')}
            >
              <Plus size={12} /> Piste Vidéo
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleAddTrack('audio')}
            >
              <Plus size={12} /> Piste Audio
            </button>
          </div>
        </div>

        <div className="timeline-scroll-area">
          {/* Timecode Ruler */}
          <div className="timeline-ruler-row">
            <div className="timeline-track-label-col">Piste</div>
            <div
              className="timeline-ruler-lane"
              style={{ width: timelineWidthPx }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, e.clientX - rect.left);
                setPlaying(false);
                setPlayheadSec(Math.round((x / zoomPxPerSec) * 100) / 100);
              }}
            >
              {rulerTicks.map((sec) => (
                <div
                  key={sec}
                  className="timeline-ruler-tick"
                  style={{ left: sec * zoomPxPerSec }}
                >
                  <span>{formatDuration(sec)}</span>
                </div>
              ))}
              <div
                className="timeline-playhead-cap"
                style={{ left: playheadSec * zoomPxPerSec }}
              />
            </div>
          </div>

          {/* Tracks */}
          {(timeline?.tracks ?? []).map((track) => {
            const eligibleAssets = assets.filter((a) =>
              track.type === 'audio' ? a.type === 'audio' : a.type === 'video' || a.type === 'image',
            );

            return (
              <div key={track.id} className={`timeline-track-row ${track.muted ? 'muted' : ''}`}>
                <div className="timeline-track-label-col">
                  <div className="timeline-track-name">
                    {track.type === 'audio' ? (
                      <Music size={12} color="#4ade80" />
                    ) : (
                      <Film size={12} color="var(--accent-amber)" />
                    )}
                    <span title={track.name}>{track.name}</span>
                  </div>
                  <div className="timeline-track-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleToggleTrackMute(track.id)}
                      title={track.muted ? 'Réactiver la piste' : 'Muter la piste'}
                    >
                      {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                    <select
                      className="select-compact"
                      style={{ maxWidth: 118, fontSize: 10.5 }}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAppendAssetToTrack(track.id, e.target.value);
                        }
                      }}
                    >
                      <option value="">+ Ajouter média...</option>
                      {eligibleAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.handle} · {a.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="timeline-track-lane" style={{ width: timelineWidthPx }}>
                  <div
                    className="timeline-playhead-line"
                    style={{ left: playheadSec * zoomPxPerSec }}
                  />

                  {track.clips.map((clip) => {
                    const leftPx = clip.startSec * zoomPxPerSec;
                    const widthPx = Math.max(28, clip.durationSec * zoomPxPerSec);
                    const isSelected = clip.id === selectedClipId;
                    const clipAsset = clip.assetId ? assetMap.get(clip.assetId) : null;
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        className={`timeline-clip-block type-${track.type} ${isSelected ? 'selected' : ''}`}
                        style={{ left: leftPx, width: widthPx }}
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setPlayheadSec(clip.startSec);
                        }}
                        title={`${clip.title} (${clip.startSec.toFixed(1)}s · ${clip.durationSec.toFixed(1)}s)`}
                      >
                        {clipAsset?.urls.thumbnail && track.type === 'video' && (
                          <img
                            src={clipAsset.urls.thumbnail}
                            alt=""
                            className="timeline-clip-thumb"
                          />
                        )}
                        <div className="timeline-clip-text">
                          <span className="timeline-clip-title">{clip.title}</span>
                          <span className="timeline-clip-meta">
                            {clip.assetRef ?? 'sans média'} · {clip.durationSec.toFixed(1)}s
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

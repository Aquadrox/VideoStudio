import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy, Flag, Music, Pause, Play, Plus, Save, Trash2 } from 'lucide-react';
import {
  lrcToSrt,
  type AssetDto,
  type AudioCategory,
  type AudioMarker,
  type AudioMarkerType,
  type AudioTrackDto,
  type ProjectDto,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatDuration } from '../utils/format';

interface AudioPanelProps {
  project: ProjectDto | null;
  assets: AssetDto[];
  refreshSignal: number;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

const AUDIO_CAT_LABELS: Record<AudioCategory, string> = {
  music: 'Musique',
  stem: 'Stem (Voix / Instru)',
  voiceover: 'Voix-off',
  dialogue: 'Dialogue',
  sfx: 'SFX / Ambiance',
};

const WAVEFORM_BARS = Array.from({ length: 64 }, (_, i) =>
  22 + Math.round(Math.abs(Math.sin(i * 0.45) * 48 + Math.cos(i * 1.1) * 26)),
);

export function AudioPanel({
  project,
  assets,
  refreshSignal,
  onCopyText,
  onNotify,
}: AudioPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<AudioTrackDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Editor state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AudioCategory>('music');
  const [assetId, setAssetId] = useState<string>('');
  const [bpm, setBpm] = useState<string>('');
  const [musicalKey, setMusicalKey] = useState('');
  const [promptUsed, setPromptUsed] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [lrcContent, setLrcContent] = useState('');
  const [markers, setMarkers] = useState<AudioMarker[]>([]);
  const [markerLabel, setMarkerLabel] = useState('');
  const [markerType, setMarkerType] = useState<AudioMarkerType>('lipsync');

  const audioAssets = useMemo(
    () => assets.filter((a) => a.type === 'audio' || a.type === 'video'),
    [assets],
  );

  const loadTracks = async () => {
    if (!project) return;
    const list = await api.listAudioTracks(project.id);
    setTracks(list);
  };

  useEffect(() => {
    void loadTracks().catch(() => undefined);
  }, [project?.id, refreshSignal]);

  const selectTrack = (t: AudioTrackDto) => {
    setSelectedId(t.id);
    setTitle(t.title);
    setCategory(t.category);
    setAssetId(t.assetId ?? '');
    setBpm(t.bpm !== null ? String(t.bpm) : '');
    setMusicalKey(t.musicalKey);
    setPromptUsed(t.promptUsed);
    setLyrics(t.lyrics);
    setLrcContent(t.lrcContent);
    setMarkers(t.markers);
    setPlaying(false);
    setCurrentTime(0);
  };

  const resetNew = () => {
    setSelectedId(null);
    setTitle('');
    setCategory('music');
    setAssetId('');
    setBpm('');
    setMusicalKey('');
    setPromptUsed('');
    setLyrics('[Intro]\n\n[Couplet 1]\n\n[Refrain]\n');
    setLrcContent('[00:00.00] Intro instrumentale\n');
    setMarkers([]);
  };

  const selectedTrack = tracks.find((t) => t.id === selectedId) ?? null;
  const generatedSrt = useMemo(() => (lrcContent.trim() ? lrcToSrt(lrcContent) : ''), [lrcContent]);

  if (!project) {
    return (
      <div className="empty-state">
        <h2>Studio Audio & Paroles</h2>
        <p>Sélectionne un projet pour gérer ses musiques, voix-off, paroles et repères lip-sync.</p>
      </div>
    );
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const saved = await api.upsertAudioTrack(project.id, {
      id: selectedId ?? undefined,
      assetId: assetId || null,
      title: title.trim(),
      category,
      bpm: bpm.trim() ? Number(bpm) : null,
      musicalKey: musicalKey.trim(),
      promptUsed: promptUsed.trim(),
      lyrics,
      lrcContent,
      srtContent: generatedSrt,
      markers,
      notes: '',
    });
    await loadTracks();
    selectTrack(saved);
    onNotify(`Piste ${saved.handle} enregistrée`);
  };

  const addMarkerAtPlayhead = () => {
    if (!markerLabel.trim()) return;
    const next: AudioMarker = {
      id: `m-${Date.now()}`,
      timeSec: Math.round(currentTime * 100) / 100,
      label: markerLabel.trim(),
      type: markerType,
    };
    setMarkers((prev) => [...prev, next].sort((a, b) => a.timeSec - b.timeSec));
    setMarkerLabel('');
  };

  const audioUrl = assetId ? `/api/media/${assetId}/original` : selectedTrack?.audioUrl ?? null;
  const progressRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="panel-workspace">
      <div className="panel-split">
        {/* Left: Tracks list */}
        <div className="panel-card">
          <div className="section-label">
            <span>Pistes Audio ({tracks.length})</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={resetNew}>
              <Plus size={13} /> Piste
            </button>
          </div>
          {tracks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`project-item ${t.id === selectedId ? 'active' : ''}`}
              onClick={() => selectTrack(t)}
            >
              <div className="project-item-top">
                <span className="project-item-name">{t.title}</span>
                <span className="pill-tag">{AUDIO_CAT_LABELS[t.category]}</span>
              </div>
              <div className="project-item-meta">
                <span>{t.handle}</span>
                {t.bpm && <span>· {t.bpm} BPM</span>}
                {t.musicalKey && <span>· {t.musicalKey}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Right: Waveform Player + Lyrics + LRC/SRT */}
        <div className="panel-card">
          {audioUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onEnded={() => setPlaying(false)}
              />

              <div
                className="waveform-bar-track"
                onClick={(e) => {
                  const audio = audioRef.current;
                  if (!audio || !duration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  audio.currentTime = ratio * duration;
                }}
              >
                {WAVEFORM_BARS.map((height, idx) => (
                  <div
                    key={idx}
                    className={`waveform-bar ${idx / WAVEFORM_BARS.length <= progressRatio ? 'played' : ''}`}
                    style={{ height: `${height}%` }}
                  />
                ))}
                {duration > 0 &&
                  markers.map((m) => (
                    <div
                      key={m.id}
                      className="waveform-marker"
                      style={{ left: `${(m.timeSec / duration) * 100}%` }}
                      title={`${formatDuration(m.timeSec)} — ${m.label}`}
                    />
                  ))}
              </div>

              <div className="rule-row-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const audio = audioRef.current;
                      if (!audio) return;
                      if (playing) {
                        audio.pause();
                        setPlaying(false);
                      } else {
                        void audio.play();
                        setPlaying(true);
                      }
                    }}
                  >
                    {playing ? <Pause size={13} /> : <Play size={13} />}
                    {playing ? 'Pause' : 'Lire'}
                  </button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {formatDuration(currentTime)} / {formatDuration(duration)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
                    placeholder="Repère (ex : Refrain / Lip-sync)"
                    value={markerLabel}
                    onChange={(e) => setMarkerLabel(e.target.value)}
                  />
                  <select
                    className="select-compact"
                    value={markerType}
                    onChange={(e) => setMarkerType(e.target.value as AudioMarkerType)}
                  >
                    <option value="lipsync">Lip-sync</option>
                    <option value="beat">Beat</option>
                    <option value="section">Section</option>
                    <option value="cut">Coupe</option>
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addMarkerAtPlayhead}>
                    <Flag size={12} /> + Repère
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="rule-row-top">
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Music size={15} color="var(--accent-amber)" />
                {selectedTrack ? `${selectedTrack.title} (${selectedTrack.handle})` : 'Nouvelle piste audio'}
              </strong>
              {selectedTrack && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="ref-copy-btn"
                    onClick={() => onCopyText(selectedTrack.handle, 'Référence audio')}
                  >
                    <Copy size={11} /> {selectedTrack.handle}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await api.deleteAudioTrack(selectedTrack.id);
                      resetNew();
                      await loadTracks();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Titre de la piste</label>
                <input
                  className="input"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex : Thème Principal — Synthwave"
                />
              </div>
              <div className="field">
                <label>Catégorie</label>
                <select
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AudioCategory)}
                >
                  {(Object.keys(AUDIO_CAT_LABELS) as AudioCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {AUDIO_CAT_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Fichier audio lié (depuis Médias)</label>
                <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  <option value="">— Aucun fichier lié —</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.handle} · {a.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-grid">
                <div className="field">
                  <label>BPM</label>
                  <input className="input" type="number" value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="120" />
                </div>
                <div className="field">
                  <label>Tonalité</label>
                  <input className="input" value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} placeholder="Am" />
                </div>
              </div>
            </div>

            <div className="field">
              <label>Prompt musical / voix IA (Suno, Udio, TTS...)</label>
              <input
                className="input"
                value={promptUsed}
                onChange={(e) => setPromptUsed(e.target.value)}
                placeholder="dark cinematic synthwave, pulsing bass, 118 bpm..."
              />
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Paroles structurées ([Intro], [Couplet], [Refrain])</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 140 }}
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Paroles horodatées LRC ([mm:ss.xx] ligne)</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 140, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
                  value={lrcContent}
                  onChange={(e) => setLrcContent(e.target.value)}
                />
              </div>
            </div>

            {generatedSrt && (
              <div>
                <div className="section-label">
                  <span>Sous-titres .SRT générés automatiquement</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onCopyText(generatedSrt, 'Sous-titres SRT')}
                  >
                    <Copy size={11} /> Copier SRT
                  </button>
                </div>
                <div className="prompt-box">{generatedSrt}</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary">
                <Save size={14} /> Enregistrer la piste
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

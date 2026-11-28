import { useState } from 'react';
import {
  Captions,
  Download,
  FileDown,
  FolderPlus,
  Music,
  Plus,
  Save,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  formatSrtTimestamp,
  type AudioTrackDto,
  type ProjectSubtitlesDto,
  type SubtitleCue,
  type SubtitlePosition,
  type SubtitleStyle,
} from '@videostudio/shared';
import { api } from '../api/client';

interface SubtitleEditorPanelProps {
  projectId: string;
  subtitles: ProjectSubtitlesDto;
  audioTracks: AudioTrackDto[];
  playheadSec: number;
  selectedCueId: string | null;
  saving: boolean;
  onChange: (next: ProjectSubtitlesDto) => void;
  onSave: (next: ProjectSubtitlesDto) => Promise<void>;
  onReload: (next: ProjectSubtitlesDto) => void;
  onSeek: (sec: number) => void;
  onSelectCue: (id: string | null) => void;
  onNotify: (msg: string) => void;
}

export function SubtitleEditorPanel({
  projectId,
  subtitles,
  audioTracks,
  playheadSec,
  selectedCueId,
  saving,
  onChange,
  onSave,
  onReload,
  onSeek,
  onSelectCue,
  onNotify,
}: SubtitleEditorPanelProps) {
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [rawImportText, setRawImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const handleAddCueAtPlayhead = () => {
    const startSec = Math.max(0, Math.round(playheadSec * 100) / 100);
    const newCue: SubtitleCue = {
      id: `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      startSec,
      endSec: Math.round((startSec + 2.5) * 100) / 100,
      text: 'Nouveau sous-titre',
      speaker: '',
    };
    const next: ProjectSubtitlesDto = {
      ...subtitles,
      cues: [...subtitles.cues, newCue].sort((a, b) => a.startSec - b.startSec),
    };
    onChange(next);
    onSelectCue(newCue.id);
  };

  const handleUpdateCue = (cueId: string, patch: Partial<SubtitleCue>) => {
    const next: ProjectSubtitlesDto = {
      ...subtitles,
      cues: subtitles.cues.map((c) => (c.id === cueId ? { ...c, ...patch } : c)),
    };
    onChange(next);
  };

  const handleDeleteCue = (cueId: string) => {
    const next: ProjectSubtitlesDto = {
      ...subtitles,
      cues: subtitles.cues.filter((c) => c.id !== cueId),
    };
    if (selectedCueId === cueId) onSelectCue(null);
    onChange(next);
  };

  const handleUpdateStyle = (patch: Partial<SubtitleStyle>) => {
    onChange({
      ...subtitles,
      style: { ...subtitles.style, ...patch },
    });
  };

  const handleImportSource = async (
    source: 'raw' | 'audio_track' | 'storyboard',
    content?: string,
    audioTrackId?: string,
  ) => {
    setImporting(true);
    try {
      const res = await api.importSubtitles(projectId, {
        source,
        content,
        audioTrackId,
        replace: true,
      });
      onReload(res.subtitles);
      setShowPasteImport(false);
      setRawImportText('');
      onNotify(`${res.importedCount} sous-titre(s) importé(s) !`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur import sous-titres');
    } finally {
      setImporting(false);
    }
  };

  const handleSaveSrtToMedia = async () => {
    try {
      const res = await api.saveSubtitlesAsset(projectId, 'srt');
      onNotify(`Sous-titres enregistrés dans Médias (/subtitles) : ${res.asset.handle}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur export vers Médias');
    }
  };

  const lrcTrack = audioTracks.find((t) => t.lrcContent.trim() || t.srtContent.trim());

  return (
    <div className="subtitle-editor-shell">
      {/* Header & Quick Actions */}
      <div className="subtitle-editor-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="section-label" style={{ margin: 0, gap: 6 }}>
            <Captions size={14} color="var(--accent-amber)" />
            Sous-titres synchronisés ({subtitles.cues.length})
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleAddCueAtPlayhead}
            title="Ajouter une réplique à la position actuelle du curseur"
          >
            <Plus size={12} /> + Au curseur ({playheadSec.toFixed(1)}s)
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={importing}
            onClick={() => void handleImportSource('storyboard')}
            title="Générer des sous-titres depuis les dialogues/actions du Storyboard"
          >
            <Wand2 size={12} /> Depuis Storyboard
          </button>
          {lrcTrack && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={importing}
              onClick={() => void handleImportSource('audio_track', undefined, lrcTrack.id)}
              title={`Importer les paroles synchronisées de "${lrcTrack.title}"`}
            >
              <Music size={12} /> Depuis Suno / LRC
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${showPasteImport ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={() => setShowPasteImport((v) => !v)}
          >
            <Upload size={12} /> Coller SRT / VTT / LRC
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving}
            onClick={() => void onSave(subtitles)}
          >
            <Save size={12} /> {saving ? 'Sauvegarde...' : 'Enregistrer ST'}
          </button>
          <a
            href={api.getSubtitlesExportUrl(projectId, 'srt')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Download size={12} /> .srt
          </a>
          <a
            href={api.getSubtitlesExportUrl(projectId, 'vtt')}
            download
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <FileDown size={12} /> .vtt
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleSaveSrtToMedia()}
            title="Enregistrer le fichier .srt dans Médias (/subtitles)"
          >
            <FolderPlus size={12} /> → Médias
          </button>
        </div>
      </div>

      {/* Style Bar (Preview & FFmpeg Burn-in) */}
      <div className="subtitle-style-bar">
        <label className="subtitle-style-field">
          <span>Langue</span>
          <input
            className="input"
            style={{ width: 52, textTransform: 'uppercase' }}
            value={subtitles.language}
            onChange={(e) => onChange({ ...subtitles, language: e.target.value.slice(0, 8) })}
          />
        </label>
        <label className="subtitle-style-field">
          <span>Position</span>
          <select
            className="select"
            value={subtitles.style.position}
            onChange={(e) => handleUpdateStyle({ position: e.target.value as SubtitlePosition })}
          >
            <option value="bottom">Bas</option>
            <option value="middle">Milieu</option>
            <option value="top">Haut</option>
          </select>
        </label>
        <label className="subtitle-style-field">
          <span>Taille ({subtitles.style.fontSize}px)</span>
          <input
            type="range"
            min={14}
            max={44}
            value={subtitles.style.fontSize}
            onChange={(e) => handleUpdateStyle({ fontSize: Number(e.target.value) })}
            style={{ width: 84, accentColor: 'var(--accent-amber)' }}
          />
        </label>
        <label className="subtitle-style-field">
          <span>Fond ({Math.round(subtitles.style.backgroundOpacity * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={Math.round(subtitles.style.backgroundOpacity * 100)}
            onChange={(e) => handleUpdateStyle({ backgroundOpacity: Number(e.target.value) / 100 })}
            style={{ width: 76, accentColor: 'var(--accent-amber)' }}
          />
        </label>
        <label className="subtitle-style-field">
          <span>Couleur</span>
          <select
            className="select"
            value={subtitles.style.color}
            onChange={(e) => handleUpdateStyle({ color: e.target.value })}
          >
            <option value="#FFFFFF">Blanc cinéma</option>
            <option value="#FFE082">Jaune pellicule</option>
            <option value="#F5B84B">Ambre studio</option>
            <option value="#38BDF8">Cyan</option>
          </select>
        </label>
      </div>

      {/* Paste SRT/VTT/LRC Drawer */}
      {showPasteImport && (
        <div className="subtitle-import-box">
          <textarea
            className="textarea"
            rows={5}
            placeholder={`Colle ici du contenu .srt, .vtt ou .lrc...\nEx:\n1\n00:00:01,000 --> 00:00:03,500\nElara pousse la porte sous la pluie.`}
            value={rawImportText}
            onChange={(e) => setRawImportText(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPasteImport(false)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={importing || !rawImportText.trim()}
              onClick={() => void handleImportSource('raw', rawImportText)}
            >
              Importer &amp; synchroniser
            </button>
          </div>
        </div>
      )}

      {/* Cue List */}
      {subtitles.cues.length === 0 ? (
        <div className="subtitle-empty">
          Aucun sous-titre pour le moment. Clique sur <strong>+ Au curseur</strong>, importe depuis le{' '}
          <strong>Storyboard</strong> ou une piste <strong>Suno / LRC</strong>.
        </div>
      ) : (
        <div className="subtitle-cue-list">
          {subtitles.cues.map((cue, idx) => {
            const isActive = playheadSec >= cue.startSec && playheadSec <= cue.endSec;
            const isSelected = selectedCueId === cue.id;
            return (
              <div
                key={cue.id}
                className={`subtitle-cue-row ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectCue(cue.id);
                  onSeek(cue.startSec + 0.01);
                }}
              >
                <div className="subtitle-cue-index">#{idx + 1}</div>
                <div className="subtitle-cue-times">
                  <div className="subtitle-time-pair">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      className="input subtitle-num"
                      value={cue.startSec}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        handleUpdateCue(cue.id, {
                          startSec: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      title="Début (secondes)"
                    />
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateCue(cue.id, {
                          startSec: Math.round(playheadSec * 100) / 100,
                          endSec: Math.max(cue.endSec, Math.round((playheadSec + 0.5) * 100) / 100),
                        });
                      }}
                      title="Caler le début sur le curseur de lecture"
                    >
                      In
                    </button>
                  </div>
                  <div className="subtitle-time-pair">
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      className="input subtitle-num"
                      value={cue.endSec}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        handleUpdateCue(cue.id, {
                          endSec: Math.max(cue.startSec + 0.1, Number(e.target.value) || cue.startSec + 1),
                        })
                      }
                      title="Fin (secondes)"
                    />
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateCue(cue.id, {
                          endSec: Math.max(cue.startSec + 0.2, Math.round(playheadSec * 100) / 100),
                        });
                      }}
                      title="Caler la fin sur le curseur de lecture"
                    >
                      Out
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    {formatSrtTimestamp(cue.startSec).slice(3, 11)} → {formatSrtTimestamp(cue.endSec).slice(3, 11)}
                  </span>
                </div>

                <input
                  className="input subtitle-speaker-input"
                  placeholder="Personnage"
                  value={cue.speaker}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleUpdateCue(cue.id, { speaker: e.target.value })}
                />

                <textarea
                  className="textarea subtitle-text-input"
                  rows={2}
                  value={cue.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleUpdateCue(cue.id, { text: e.target.value })}
                  placeholder="Texte du sous-titre..."
                />

                <button
                  type="button"
                  className="btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCue(cue.id);
                  }}
                  title="Supprimer ce sous-titre"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

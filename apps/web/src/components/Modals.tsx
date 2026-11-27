import { useState, type FormEvent } from 'react';
import { Copy, Terminal, X } from 'lucide-react';
import type { CreateProjectInput, ProjectType } from '@videostudio/shared';
import type { HealthResponse } from '../api/client';
import { PROJECT_TYPE_LABELS } from '../utils/format';

interface CreateProjectModalProps {
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProjectType>('youtube_long');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [fps, setFps] = useState(24);
  const [targetResolution, setTargetResolution] = useState('1920x1080');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        type,
        aspectRatio,
        fps,
        targetResolution,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nouveau Projet Vidéo</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="proj-name">Nom du projet</label>
              <input
                id="proj-name"
                className="input"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex : Épisode 01 — Cyberpunk Noir"
              />
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="proj-type">Format</label>
                <select
                  id="proj-type"
                  className="select"
                  value={type}
                  onChange={(e) => {
                    const next = e.target.value as ProjectType;
                    setType(next);
                    if (next === 'youtube_short') {
                      setAspectRatio('9:16');
                      setTargetResolution('1080x1920');
                    } else {
                      setAspectRatio('16:9');
                      setTargetResolution('1920x1080');
                    }
                  }}
                >
                  {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map((k) => (
                    <option key={k} value={k}>
                      {PROJECT_TYPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="proj-ratio">Aspect Ratio</label>
                <input
                  id="proj-ratio"
                  className="input"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="proj-res">Résolution cible</label>
                <input
                  id="proj-res"
                  className="input"
                  value={targetResolution}
                  onChange={(e) => setTargetResolution(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="proj-fps">FPS</label>
                <input
                  id="proj-fps"
                  type="number"
                  min={1}
                  max={120}
                  className="input"
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) || 24)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="proj-desc">Pitch / Notes de production</label>
              <textarea
                id="proj-desc"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contexte, direction artistique, objectif YouTube..."
              />
            </div>

            {error && (
              <div style={{ color: 'var(--status-danger)', fontSize: 12.5 }}>{error}</div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Création...' : 'Créer le projet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface McpSetupModalProps {
  health: HealthResponse | null;
  onClose: () => void;
  onCopyText: (text: string, label?: string) => void;
}

export function McpSetupModal({ health, onClose, onCopyText }: McpSetupModalProps) {
  const mcpUrl = `${window.location.origin}/mcp`;
  const claudeCmd = `claude mcp add --transport http videostudio ${mcpUrl} --header "Authorization: Bearer <TON_MCP_AUTH_TOKEN>"`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={16} /> Connexion MCP & Santé Serveur
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="meta-kv-grid">
            <div className="meta-kv">
              <div className="meta-k">PostgreSQL (Isolé Docker)</div>
              <div
                className="meta-v"
                style={{
                  color:
                    health?.services.database === 'up'
                      ? 'var(--status-approved)'
                      : 'var(--status-danger)',
                }}
              >
                {health?.services.database ?? 'inconnu'}
              </div>
            </div>
            <div className="meta-kv">
              <div className="meta-k">FFmpeg Média</div>
              <div
                className="meta-v"
                style={{
                  color:
                    health?.services.ffmpeg === 'available'
                      ? 'var(--status-approved)'
                      : 'var(--accent-amber)',
                }}
              >
                {health?.services.ffmpeg ?? 'inconnu'}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Commande à exécuter sur ton serveur (Claude Code)</label>
            <div className="code-block">{claudeCmd}</div>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Remplace <code>&lt;TON_MCP_AUTH_TOKEN&gt;</code> par la valeur locale définie dans
              ton fichier <code>.env</code> (jamais versionnée dans Git).
            </span>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onCopyText(claudeCmd, 'Commande MCP')}
          >
            <Copy size={14} /> Copier la commande
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

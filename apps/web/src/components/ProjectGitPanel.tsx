import { useEffect, useState, type FormEvent } from 'react';
import { GitBranch, GitCommitHorizontal, RefreshCw, UploadCloud } from 'lucide-react';
import type { ProjectDto, ProjectRepoStatusDto } from '@videostudio/shared';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/format';

interface ProjectGitPanelProps {
  project: ProjectDto | null;
  refreshSignal: number;
  onNotify: (msg: string) => void;
}

export function ProjectGitPanel({
  project,
  refreshSignal,
  onNotify,
}: ProjectGitPanelProps) {
  const [status, setStatus] = useState<ProjectRepoStatusDto | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushLog, setPushLog] = useState<string | null>(null);

  const loadStatus = async () => {
    if (!project) return;
    const st = await api.getProjectGitStatus(project.id);
    setStatus(st);
    setRemoteUrl(st.githubRemoteUrl ?? '');
    setBranch(st.defaultBranch || 'main');
  };

  useEffect(() => {
    void loadStatus().catch(() => undefined);
  }, [project?.id, refreshSignal]);

  if (!project) {
    return (
      <div className="empty-state">
        <GitBranch size={34} color="var(--text-muted)" />
        <h2>Dépôt Git & GitHub du projet</h2>
        <p>Sélectionne un projet pour initialiser son dépôt Git local et le relier à GitHub.</p>
      </div>
    );
  }

  const handleInitOrConfig = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.initOrConfigureProjectGit(project.id, {
        githubRemoteUrl: remoteUrl.trim() || null,
        defaultBranch: branch.trim() || 'main',
      });
      setStatus(updated);
      onNotify('Dépôt Git local initialisé / configuré');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur configuration Git');
    } finally {
      setBusy(false);
    }
  };

  const handleSnapshotCommit = async (e: FormEvent) => {
    e.preventDefault();
    if (!commitMsg.trim()) return;
    setBusy(true);
    try {
      const res = await api.commitProjectGit(project.id, {
        message: commitMsg.trim(),
        exportSnapshot: true,
      });
      setStatus(res.status);
      setCommitMsg('');
      onNotify(
        res.committed
          ? `Snapshot exporté et commité (${res.sha?.slice(0, 7)})`
          : 'Aucun changement à commiter',
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur commit Git');
    } finally {
      setBusy(false);
    }
  };

  const handlePush = async () => {
    setBusy(true);
    setPushLog(null);
    try {
      const res = await api.pushProjectGit(project.id);
      setStatus(res.status);
      setPushLog(res.output);
      onNotify(res.ok ? 'Push vers GitHub réussi' : 'Push échoué — voir détail');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-workspace">
      <div className="panel-split">
        {/* Left: Configuration & Remote */}
        <form onSubmit={(e) => void handleInitOrConfig(e)} className="panel-card">
          <div className="section-label">
            <span>Dépôt Git local & GitHub</span>
            <span className={`pill-tag ${status?.initialized ? 'green' : ''}`}>
              {status?.initialized ? 'Initialisé' : 'Non initialisé'}
            </span>
          </div>

          <div className="meta-kv">
            <div className="meta-k">Chemin local (dans /data)</div>
            <div className="meta-v">{status?.localPath ?? `projects/${project.slug}/repo`}</div>
          </div>

          <div className="field">
            <label>URL du dépôt GitHub distant (HTTPS ou SSH, sans token intégré)</label>
            <input
              className="input"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/owner/mon-projet-video.git"
            />
          </div>

          <div className="field">
            <label>Branche par défaut</label>
            <input
              className="input"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              <GitBranch size={13} />{' '}
              {status?.initialized ? 'Mettre à jour la config' : 'Initialiser le dépôt Git'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void loadStatus()}
            >
              <RefreshCw size={13} /> Actualiser
            </button>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Le <code>.gitignore</code> du dépôt projet exclut automatiquement les médias lourds
            (<code>.mp4</code>, <code>.wav</code>) et les secrets pour ne versionner que les
            scénarios, la bible, le storyboard, les règles projet, les paroles et les métadonnées
            YouTube.
          </div>
        </form>

        {/* Right: Snapshot Commit, Push & History */}
        <div className="panel-card">
          <form onSubmit={(e) => void handleSnapshotCommit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="section-label">
              <span>Exporter Snapshot & Commiter</span>
              <span className="pill-tag">
                {status?.dirtyFiles.length ?? 0} fichier(s) modifié(s)
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                required
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="Ex : feat: update script v3, storyboard & YouTube chapters"
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                <GitCommitHorizontal size={14} /> Snapshot + Commit
              </button>
            </div>
          </form>

          {status?.githubRemoteUrl && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                origin → {status.githubRemoteUrl}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !status.initialized}
                onClick={() => void handlePush()}
              >
                <UploadCloud size={13} /> Push vers GitHub
              </button>
            </div>
          )}

          {pushLog && <div className="prompt-box">{pushLog}</div>}

          <div className="section-label">Historique Git ({status?.recentCommits.length ?? 0})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(status?.recentCommits ?? []).map((c) => (
              <div key={c.sha} className="rule-row">
                <div className="rule-row-top">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--accent-amber)' }}>
                    {c.shortSha}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatRelativeTime(c.date)}
                  </span>
                </div>
                <div style={{ fontSize: 12.5 }}>{c.message}</div>
              </div>
            ))}
            {(!status || status.recentCommits.length === 0) && (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Aucun commit pour le moment. Initialise le dépôt et lance un premier snapshot.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

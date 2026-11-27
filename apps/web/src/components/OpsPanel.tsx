import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  Archive,
  Bell,
  Copy,
  Database,
  Download,
  FolderSync,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  Trash2,
  Youtube,
} from 'lucide-react';
import type {
  BackupEntryDto,
  CleanupResultDto,
  DiskUsageSummaryDto,
  ProjectDto,
  QualityTier,
  StorageMode,
  SystemMetricsDto,
  WatchFolderDto,
  WebhookDto,
  WebhookEventType,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatBytes, formatRelativeTime } from '../utils/format';

interface OpsPanelProps {
  projects: ProjectDto[];
  activeProject: ProjectDto | null;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
  onAssetsMutated?: () => void;
}

const ALL_WEBHOOK_EVENTS: Array<{ id: WebhookEventType; label: string }> = [
  { id: 'annotation.created', label: 'Annotation créée' },
  { id: 'asset.created', label: 'Média ajouté' },
  { id: 'asset.status_changed', label: 'Statut média modifié' },
  { id: 'job.completed', label: 'Job terminé' },
  { id: 'job.failed', label: 'Job échoué' },
  { id: 'timeline.rendered', label: 'Rendu Timeline terminé' },
  { id: 'backup.completed', label: 'Backup terminé' },
];

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}j ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${seconds % 60}s`;
}

export function OpsPanel({
  projects,
  activeProject,
  onCopyText,
  onNotify,
  onAssetsMutated,
}: OpsPanelProps) {
  const [metrics, setMetrics] = useState<SystemMetricsDto | null>(null);
  const [disk, setDisk] = useState<DiskUsageSummaryDto | null>(null);
  const [backups, setBackups] = useState<BackupEntryDto[]>([]);
  const [watchFolders, setWatchFolders] = useState<WatchFolderDto[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [loading, setLoading] = useState(false);

  // Cleanup controls
  const [cleanupProjectId, setCleanupProjectId] = useState<string>('all');
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [includeTempFiles, setIncludeTempFiles] = useState(true);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupResultDto | null>(null);
  const [runningCleanup, setRunningCleanup] = useState(false);

  // Backup form
  const [backupNotes, setBackupNotes] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);

  // Watch folder form
  const [wfProjectId, setWfProjectId] = useState<string>(activeProject?.id ?? '');
  const [wfRelativeDir, setWfRelativeDir] = useState('');
  const [wfFolderPath, setWfFolderPath] = useState('comfyui');
  const [wfGlob, setWfGlob] = useState('*.png');
  const [wfStorageMode, setWfStorageMode] = useState<StorageMode>('reference');
  const [wfQualityTier, setWfQualityTier] = useState<QualityTier>('test');
  const [wfPollSec, setWfPollSec] = useState(15);
  const [scanningId, setScanningId] = useState<string | null>(null);

  // Webhook form
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');
  const [whScopeProject, setWhScopeProject] = useState<'global' | 'active'>('global');
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>([
    'annotation.created',
    'job.completed',
    'timeline.rendered',
  ]);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject && !wfProjectId) {
      setWfProjectId(activeProject.id);
    }
  }, [activeProject, wfProjectId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, d, b, wf, wh] = await Promise.all([
        api.getSystemMetrics(),
        api.getDiskUsage(),
        api.listBackups(),
        api.listWatchFolders(),
        api.listWebhooks(),
      ]);
      setMetrics(m);
      setDisk(d);
      setBackups(b);
      setWatchFolders(wf);
      setWebhooks(wh);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur chargement Exploitation');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handlePreviewCleanup = async () => {
    setRunningCleanup(true);
    try {
      const res = await api.previewCleanup({
        projectId: cleanupProjectId === 'all' ? undefined : cleanupProjectId,
        olderThanDays,
        statuses: ['needs_revision', 'archived'],
        qualityTiers: ['test', 'draft_lowres'],
        includeTempFiles,
      });
      setCleanupPreview(res);
      onNotify(
        `Aperçu : ${res.candidatesCount} média(s) éligible(s) (${formatBytes(res.totalFreedBytes)})`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur aperçu nettoyage');
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleRunCleanup = async () => {
    if (!cleanupPreview || (cleanupPreview.candidatesCount === 0 && cleanupPreview.freedTempBytes === 0)) {
      return;
    }
    const confirmed = window.confirm(
      `Confirmer le nettoyage sélectif de ${cleanupPreview.candidatesCount} média(s) rejeté(s)/archivé(s) (${formatBytes(cleanupPreview.totalFreedBytes)}) ?\n\nAucun média approuvé, winner, final_master ou référence ingest:// ne sera supprimé.`,
    );
    if (!confirmed) return;

    setRunningCleanup(true);
    try {
      const res = await api.runCleanup({
        projectId: cleanupProjectId === 'all' ? undefined : cleanupProjectId,
        olderThanDays,
        statuses: ['needs_revision', 'archived'],
        qualityTiers: ['test', 'draft_lowres'],
        includeTempFiles,
      });
      setCleanupPreview(res);
      onNotify(
        `Nettoyage effectué : ${res.deletedAssetsCount} média(s) supprimé(s), ${formatBytes(res.totalFreedBytes)} libérés`,
      );
      onAssetsMutated?.();
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur nettoyage disque');
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleCreateBackup = async (e: FormEvent) => {
    e.preventDefault();
    setCreatingBackup(true);
    try {
      const created = await api.createBackup(backupNotes.trim());
      setBackups((prev) => [created, ...prev]);
      setBackupNotes('');
      onNotify(`Backup créé : ${created.filename} (${formatBytes(created.sizeBytes)})`);
      void loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur création backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDeleteBackup = async (id: string) => {
    await api.deleteBackup(id);
    setBackups((prev) => prev.filter((b) => b.id !== id));
    onNotify('Backup supprimé');
  };

  const handleCreateWatchFolder = async (e: FormEvent) => {
    e.preventDefault();
    const targetProject = wfProjectId || activeProject?.id;
    if (!targetProject || !wfRelativeDir.trim()) return;
    try {
      const created = await api.createWatchFolder({
        projectId: targetProject,
        relativeDir: wfRelativeDir.trim(),
        folderPath: wfFolderPath.trim(),
        glob: wfGlob.trim() || '*',
        storageMode: wfStorageMode,
        qualityTier: wfQualityTier,
        tags: ['watch-folder'],
        enabled: true,
        pollIntervalSec: wfPollSec,
      });
      setWatchFolders((prev) => [created, ...prev]);
      setWfRelativeDir('');
      onNotify(`Watch folder ajouté : ${created.relativeDir}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur ajout watch folder');
    }
  };

  const handleScanWatchFolder = async (id: string) => {
    setScanningId(id);
    try {
      const res = await api.scanWatchFolder(id);
      setWatchFolders((prev) => prev.map((w) => (w.id === id ? res.folder : w)));
      onNotify(
        `Scan terminé : ${res.ingestedCount} nouveau(x), ${res.skippedCount} déjà présents`,
      );
      if (res.ingestedCount > 0) onAssetsMutated?.();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur scan watch folder');
    } finally {
      setScanningId(null);
    }
  };

  const handleToggleWatchFolder = async (wf: WatchFolderDto) => {
    const updated = await api.updateWatchFolder(wf.id, { enabled: !wf.enabled });
    setWatchFolders((prev) => prev.map((w) => (w.id === wf.id ? updated : w)));
  };

  const handleDeleteWatchFolder = async (id: string) => {
    await api.deleteWatchFolder(id);
    setWatchFolders((prev) => prev.filter((w) => w.id !== id));
    onNotify('Watch folder supprimé');
  };

  const toggleWebhookEvent = (evt: WebhookEventType) => {
    setWhEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  };

  const handleCreateWebhook = async (e: FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !whUrl.trim() || whEvents.length === 0) return;
    try {
      const created = await api.createWebhook({
        projectId: whScopeProject === 'active' && activeProject ? activeProject.id : null,
        name: whName.trim(),
        url: whUrl.trim(),
        events: whEvents,
        secret: whSecret.trim() || undefined,
        enabled: true,
      });
      setWebhooks((prev) => [created, ...prev]);
      setWhName('');
      setWhUrl('');
      setWhSecret('');
      onNotify(`Webhook créé : ${created.name}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur création webhook');
    }
  };

  const handleTestWebhook = async (id: string) => {
    setTestingWebhookId(id);
    try {
      const res = await api.testWebhook(id);
      setWebhooks((prev) => prev.map((w) => (w.id === id ? res.webhook : w)));
      onNotify(
        res.ok
          ? `Webhook OK (HTTP ${res.statusCode})`
          : `Échec webhook : ${res.error ?? `HTTP ${res.statusCode}`}`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur test webhook');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const handleToggleWebhook = async (wh: WebhookDto) => {
    const updated = await api.updateWebhook(wh.id, { enabled: !wh.enabled });
    setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? updated : w)));
  };

  const handleDeleteWebhook = async (id: string) => {
    await api.deleteWebhook(id);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    onNotify('Webhook supprimé');
  };

  const cronCommand =
    '0 3 * * * cd /chemin/vers/VideoStudio && ./scripts/backup.sh --retain-days 14 >> backups/cron.log 2>&1';

  const memPct =
    metrics && metrics.memoryTotalBytes > 0
      ? Math.round((metrics.memoryUsedBytes / metrics.memoryTotalBytes) * 100)
      : 0;
  const diskUsedBytes =
    disk?.filesystemTotalBytes != null && disk?.filesystemFreeBytes != null
      ? Math.max(0, disk.filesystemTotalBytes - disk.filesystemFreeBytes)
      : null;
  const diskPct =
    diskUsedBytes != null && disk?.filesystemTotalBytes
      ? Math.round((diskUsedBytes / disk.filesystemTotalBytes) * 100)
      : null;

  return (
    <div className="stage-workspace">
      <div className="stage-header-bar">
        <div>
          <h2 className="stage-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Server size={18} color="var(--accent-amber)" /> Exploitation & Maintenance (v0.5.4)
          </h2>
          <p className="stage-subtitle">
            Monitoring serveur, espace disque & nettoyage sélectif, sauvegardes, watch folders ComfyUI et webhooks sortants.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading}
          onClick={() => void loadAll()}
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {/* 1. Server Health Monitoring */}
      <div className="ops-metrics-grid">
        <div className="ops-metric-card">
          <div className="ops-metric-label">
            <Activity size={13} /> Instance & Slot Blue/Green
          </div>
          <div className="ops-metric-value">
            v{metrics?.version ?? '0.5.4'}{' '}
            <span className={`pill ${metrics?.slot === 'green' ? 'status-approved' : 'tier-hq_upscale'}`}>
              {metrics?.slot ?? 'standalone'}
            </span>
          </div>
          <div className="ops-metric-sub">
            Uptime : {metrics ? formatUptime(metrics.uptimeSec) : '—'} · En cours :{' '}
            {metrics?.inFlightRequests ?? 0} req · WS : {metrics?.websocketClients ?? 0}
          </div>
        </div>

        <div className="ops-metric-card">
          <div className="ops-metric-label">
            <Database size={13} /> Services
          </div>
          <div className="ops-metric-value" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className={`pill ${metrics?.database === 'up' ? 'status-approved' : 'status-needs_revision'}`}>
              PostgreSQL : {metrics?.database ?? '—'}
            </span>
            <span className={`pill ${metrics?.ffmpeg === 'available' ? 'status-approved' : 'status-needs_revision'}`}>
              FFmpeg : {metrics?.ffmpeg ?? '—'}
            </span>
            <span className={`pill ${metrics?.youtubeApiConfigured ? 'status-approved' : ''}`}>
              <Youtube size={11} /> YT API : {metrics?.youtubeApiConfigured ? 'OK' : 'Off'}
            </span>
          </div>
          <div className="ops-metric-sub">
            Watch folders : {metrics?.activeWatchFolders ?? 0} · Webhooks : {metrics?.activeWebhooks ?? 0} · Backups :{' '}
            {metrics?.backupsCount ?? 0}
          </div>
        </div>

        <div className="ops-metric-card">
          <div className="ops-metric-label">
            <Server size={13} /> CPU & Mémoire
          </div>
          <div className="ops-metric-value">
            Load {metrics?.cpuLoad1m ?? 0} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {metrics?.cpuCores ?? 1} cœurs</span>
          </div>
          <div className="ops-metric-sub">
            RAM : {metrics ? `${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)} (${memPct}%)` : '—'} · Node RSS :{' '}
            {metrics ? formatBytes(metrics.processRssBytes) : '—'}
          </div>
        </div>

        <div className="ops-metric-card">
          <div className="ops-metric-label">
            <HardDrive size={13} /> Disque ({disk?.dataDir ?? './data'})
          </div>
          <div className="ops-metric-value">
            {disk ? formatBytes(disk.totalManagedBytes) : '—'}{' '}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>gérés</span>
          </div>
          <div className="ops-metric-sub">
            {disk?.filesystemFreeBytes != null && disk?.filesystemTotalBytes != null
              ? `Libre : ${formatBytes(disk.filesystemFreeBytes)} / ${formatBytes(disk.filesystemTotalBytes)} (${diskPct}% utilisé)`
              : 'Stats volume indisponibles'}
          </div>
        </div>
      </div>

      {/* 2. Disk Usage & Selective Cleanup */}
      <div className="panel-card">
        <div className="section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <HardDrive size={14} color="var(--accent-amber)" /> Espace Disque & Nettoyage Sélectif
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Originaux : {formatBytes(disk?.originalsBytes ?? 0)} · Proxies : {formatBytes(disk?.proxiesBytes ?? 0)} · Vignettes :{' '}
            {formatBytes(disk?.thumbnailsBytes ?? 0)} · Temp : {formatBytes(disk?.tempBytes ?? 0)} · Backups :{' '}
            {formatBytes(disk?.backupsBytes ?? 0)}
          </span>
        </div>

        {disk && disk.projects.length > 0 && (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Projet</th>
                  <th>Médias</th>
                  <th>Originaux</th>
                  <th>Proxies</th>
                  <th>Total</th>
                  <th>Récupérable (rejetés/test)</th>
                </tr>
              </thead>
              <tbody>
                {disk.projects.map((p) => (
                  <tr key={p.projectId}>
                    <td>
                      <strong>{p.projectName}</strong>{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>@{p.projectSlug}</span>
                    </td>
                    <td>{p.assetCount}</td>
                    <td>{formatBytes(p.originalsBytes)}</td>
                    <td>{formatBytes(p.proxiesBytes)}</td>
                    <td><strong>{formatBytes(p.totalBytes)}</strong></td>
                    <td style={{ color: p.reclaimableRejectedTestBytes > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                      {formatBytes(p.reclaimableRejectedTestBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ops-cleanup-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <ShieldAlert size={14} color="var(--accent-amber)" />
            <span>
              Garantie non-destructive : ne supprime <strong>jamais</strong> les médias{' '}
              <code>approved</code>, <code>winner</code>, <code>final_master</code> ni les références zero-copy{' '}
              <code>ingest://</code>.
            </span>
          </div>

          <div className="ops-inline-controls">
            <select
              className="select-compact"
              value={cleanupProjectId}
              onChange={(e) => setCleanupProjectId(e.target.value)}
            >
              <option value="all">Tous les projets</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="ops-inline-label">
              Âge min (jours) :
              <input
                type="number"
                min={0}
                max={3650}
                className="input"
                style={{ width: 76, height: 30, padding: '2px 8px' }}
                value={olderThanDays}
                onChange={(e) => setOlderThanDays(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>

            <label className="ops-inline-label">
              <input
                type="checkbox"
                checked={includeTempFiles}
                onChange={(e) => setIncludeTempFiles(e.target.checked)}
              />
              Purger `.tmp`
            </label>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={runningCleanup}
              onClick={() => void handlePreviewCleanup()}
            >
              Aperçu (Dry-run)
            </button>

            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={
                runningCleanup ||
                !cleanupPreview ||
                !cleanupPreview.dryRun ||
                (cleanupPreview.candidatesCount === 0 && cleanupPreview.freedTempBytes === 0)
              }
              onClick={() => void handleRunCleanup()}
            >
              <Trash2 size={13} /> Exécuter le nettoyage
            </button>
          </div>

          {cleanupPreview && (
            <div className="ops-preview-summary">
              <div>
                <strong>{cleanupPreview.dryRun ? 'Aperçu dry-run' : 'Nettoyage effectué'} :</strong>{' '}
                {cleanupPreview.candidatesCount} média(s) ciblé(s) ·{' '}
                <strong>{formatBytes(cleanupPreview.totalFreedBytes)}</strong>{' '}
                (médias {formatBytes(cleanupPreview.freedAssetBytes)} + temp{' '}
                {formatBytes(cleanupPreview.freedTempBytes)})
              </div>
              {cleanupPreview.candidates.length > 0 && (
                <div className="ops-candidate-list">
                  {cleanupPreview.candidates.slice(0, 8).map((c) => (
                    <span key={c.assetId} className="pill">
                      {c.handle} · {c.projectSlug} · {formatBytes(c.reclaimableBytes)}
                    </span>
                  ))}
                  {cleanupPreview.candidates.length > 8 && (
                    <span className="pill">+{cleanupPreview.candidates.length - 8} autres</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Automated Backups */}
      <div className="panel-card">
        <div className="section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Archive size={14} color="var(--accent-amber)" /> Sauvegardes Automatisées (DB + Métadonnées + Skills)
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onCopyText(cronCommand, 'Ligne cron Debian')}
          >
            <Copy size={12} /> Copier commande cron
          </button>
        </div>

        <form className="ops-inline-controls" onSubmit={(e) => void handleCreateBackup(e)}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            value={backupNotes}
            onChange={(e) => setBackupNotes(e.target.value)}
            placeholder="Note de sauvegarde (ex: avant montage final v2)..."
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={creatingBackup}>
            <Archive size={13} /> {creatingBackup ? 'Archivage...' : 'Créer un backup'}
          </button>
        </form>

        <div className="prompt-box" style={{ fontSize: 11.5 }}>
          Cron Debian (quotidien 03h00, rétention 14j) : {cronCommand}
        </div>

        {backups.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Aucune archive enregistrée dans BACKUP_DIR.
          </div>
        ) : (
          <div className="ops-list">
            {backups.map((b) => (
              <div key={b.id} className="ops-list-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{b.filename}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {formatBytes(b.sizeBytes)} · {formatRelativeTime(b.createdAt)} ·{' '}
                    {b.includesDb ? 'SQL + ' : ''}JSON{b.includesSkills ? ' + Skills' : ''}
                    {b.notes ? ` · ${b.notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <a className="btn btn-secondary btn-sm" href={b.downloadUrl} download={b.filename}>
                    <Download size={12} /> Télécharger
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void handleDeleteBackup(b.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Watch Folders (ComfyUI -> VideoStudio Auto-Ingest) */}
      <div className="panel-card">
        <div className="section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FolderSync size={14} color="var(--accent-amber)" /> Watch Folders (Auto-ingest ComfyUI → Studio)
          </span>
        </div>

        <form className="ops-form-grid" onSubmit={(e) => void handleCreateWatchFolder(e)}>
          <select
            className="select-compact"
            value={wfProjectId}
            onChange={(e) => setWfProjectId(e.target.value)}
            required
          >
            <option value="">Projet cible...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            className="input"
            value={wfRelativeDir}
            onChange={(e) => setWfRelativeDir(e.target.value)}
            placeholder="Dossier source dans INGEST_ALLOWED_DIR (ex: comfy_out)"
            required
          />

          <input
            className="input"
            value={wfFolderPath}
            onChange={(e) => setWfFolderPath(e.target.value)}
            placeholder="Sous-dossier Studio (ex: comfyui)"
          />

          <input
            className="input"
            value={wfGlob}
            onChange={(e) => setWfGlob(e.target.value)}
            placeholder="Filtre glob (ex: *.png)"
          />

          <select
            className="select-compact"
            value={wfStorageMode}
            onChange={(e) => setWfStorageMode(e.target.value as StorageMode)}
          >
            <option value="reference">Zero-copy (reference)</option>
            <option value="copy">Copier dans data/</option>
            <option value="hardlink">Lien physique (hardlink)</option>
          </select>

          <select
            className="select-compact"
            value={wfQualityTier}
            onChange={(e) => setWfQualityTier(e.target.value as QualityTier)}
          >
            <option value="test">Test</option>
            <option value="draft_lowres">Draft</option>
            <option value="hq_upscale">HQ</option>
            <option value="final_master">Final</option>
          </select>

          <input
            type="number"
            min={5}
            max={3600}
            className="input"
            value={wfPollSec}
            onChange={(e) => setWfPollSec(Math.max(5, Number(e.target.value) || 15))}
            title="Intervalle de scan en secondes"
          />

          <button type="submit" className="btn btn-primary btn-sm">
            <Plus size={13} /> Ajouter Watch Folder
          </button>
        </form>

        {watchFolders.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Aucun watch folder configuré. Ajoute un sous-dossier présent dans <code>INGEST_ALLOWED_DIR</code> ou{' '}
            <code>INGEST_EXTRA_DIRS</code>.
          </div>
        ) : (
          <div className="ops-list">
            {watchFolders.map((wf) => (
              <div key={wf.id} className="ops-list-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {wf.relativeDir} → <code>/{wf.folderPath || 'racine'}</code>{' '}
                    <span className="pill">@{wf.projectSlug}</span>{' '}
                    <span className="pill">{wf.glob}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Mode {wf.storageMode} · toutes les {wf.pollIntervalSec}s · {wf.ingestedCount} ingéré(s) ·{' '}
                    {wf.lastScanAt ? `dernier scan ${formatRelativeTime(wf.lastScanAt)}` : 'jamais scanné'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`chip ${wf.enabled ? 'active' : ''}`}
                    onClick={() => void handleToggleWatchFolder(wf)}
                  >
                    {wf.enabled ? 'Actif' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={scanningId === wf.id}
                    onClick={() => void handleScanWatchFolder(wf.id)}
                  >
                    <Play size={12} /> {scanningId === wf.id ? 'Scan...' : 'Scanner'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void handleDeleteWatchFolder(wf.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Outgoing Webhooks */}
      <div className="panel-card">
        <div className="section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Bell size={14} color="var(--accent-amber)" /> Webhooks Sortants (n8n, Discord, Agent externe)
          </span>
        </div>

        <form className="ops-webhook-form" onSubmit={(e) => void handleCreateWebhook(e)}>
          <div className="ops-form-grid">
            <input
              className="input"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              placeholder="Nom (ex: Alerte n8n / Bot)"
              required
            />
            <input
              className="input"
              type="url"
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              placeholder="https://hooks.exemple.org/videostudio"
              required
            />
            <input
              className="input"
              type="password"
              value={whSecret}
              onChange={(e) => setWhSecret(e.target.value)}
              placeholder="Secret HMAC-SHA256 (optionnel)"
            />
            <select
              className="select-compact"
              value={whScopeProject}
              onChange={(e) => setWhScopeProject(e.target.value as 'global' | 'active')}
            >
              <option value="global">Portée : Globale</option>
              {activeProject && <option value="active">Projet : {activeProject.name}</option>}
            </select>
          </div>

          <div className="ops-event-chips">
            {ALL_WEBHOOK_EVENTS.map((evt) => (
              <button
                key={evt.id}
                type="button"
                className={`chip ${whEvents.includes(evt.id) ? 'active' : ''}`}
                onClick={() => toggleWebhookEvent(evt.id)}
              >
                {evt.label}
              </button>
            ))}
            <button type="submit" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>
              <Plus size={13} /> Créer Webhook
            </button>
          </div>
        </form>

        {webhooks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Aucun webhook configuré. Chaque requête signe le corps JSON avec <code>X-VideoStudio-Signature: sha256=...</code> si un secret est défini.
          </div>
        ) : (
          <div className="ops-list">
            {webhooks.map((wh) => (
              <div key={wh.id} className="ops-list-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {wh.name}{' '}
                    {wh.hasSecret && <span className="pill tier-hq_upscale">HMAC</span>}
                    {wh.lastStatusCode != null && (
                      <span
                        className={`pill ${wh.lastStatusCode >= 200 && wh.lastStatusCode < 300 ? 'status-approved' : 'status-needs_revision'}`}
                      >
                        HTTP {wh.lastStatusCode}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    <code>{wh.url}</code> · {wh.events.join(', ')}
                    {wh.lastError ? ` · ⚠ ${wh.lastError}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`chip ${wh.enabled ? 'active' : ''}`}
                    onClick={() => void handleToggleWebhook(wh)}
                  >
                    {wh.enabled ? 'Actif' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={testingWebhookId === wh.id}
                    onClick={() => void handleTestWebhook(wh.id)}
                  >
                    <Send size={12} /> {testingWebhookId === wh.id ? 'Envoi...' : 'Tester'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void handleDeleteWebhook(wh.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

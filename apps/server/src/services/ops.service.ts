import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { desc, eq } from 'drizzle-orm';
import type pg from 'pg';
import {
  buildAssetHandle,
  isAssetEligibleForCleanup,
  type AssetStatus,
  type BackupEntryDto,
  type CleanupCandidateDto,
  type CleanupFilterInput,
  type CleanupResultDto,
  type DiskUsageSummaryDto,
  type ProjectDiskUsageDto,
  type QualityTier,
  type SystemMetricsDto,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import {
  assets,
  audioTracks,
  backups,
  bibleEntities,
  comfyWorkflows,
  projectRuleOverrides,
  projectScripts,
  projects,
  promptTemplates,
  rulebooks,
  rules,
  scenes,
  shots,
  skills,
  timelineClips,
  timelineTracks,
  watchFolders,
  webhooks,
  youtubePackages,
} from '../db/schema.js';
import { resolveSafePath } from '../utils/security.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { StudioService } from './studio.service.js';
import type { WebhookService } from './webhook.service.js';

const execFileAsync = promisify(execFile);
const gzipAsync = promisify(zlib.gzip);

const APP_VERSION = '0.9.0';

async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(full);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.lstat(full);
        total += stat.size;
      } catch {
        // Ignore vanished files
      }
    }
  }
  return total;
}

async function getFileSizeSafe(absPath: string): Promise<number> {
  try {
    const st = await fs.stat(absPath);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

async function getFilesystemStats(
  targetPath: string,
): Promise<{ totalBytes: number | null; freeBytes: number | null }> {
  try {
    await fs.mkdir(targetPath, { recursive: true });
    const stats = await fs.statfs(targetPath);
    const blockSize = Number(stats.bsize);
    return {
      totalBytes: Number(stats.blocks) * blockSize,
      freeBytes: Number(stats.bavail) * blockSize,
    };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

export class OpsService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly pool: pg.Pool,
    private readonly studio: StudioService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
    private readonly webhookService?: WebhookService,
  ) {}

  // ---------------------------------------------------------------------------
  // Disk Usage & Selective Cleanup
  // ---------------------------------------------------------------------------

  async getDiskUsageSummary(): Promise<DiskUsageSummaryDto> {
    const [projectRows, assetRows] = await Promise.all([
      this.db.select().from(projects),
      this.db.select().from(assets),
    ]);

    const assetsByProject = new Map<string, Array<typeof assets.$inferSelect>>();
    for (const row of assetRows) {
      const list = assetsByProject.get(row.projectId) ?? [];
      list.push(row);
      assetsByProject.set(row.projectId, list);
    }

    const defaultFilter: CleanupFilterInput = {
      olderThanDays: 7,
      statuses: ['needs_revision', 'archived'],
      qualityTiers: ['test', 'draft_lowres'],
      includeTempFiles: true,
    };

    const nowMs = Date.now();
    let originalsTotal = 0;
    let proxiesTotal = 0;
    let thumbnailsTotal = 0;

    const projectSummaries: ProjectDiskUsageDto[] = [];

    for (const project of projectRows) {
      const projectDir = resolveSafePath(this.config.dataDir, 'projects', project.slug);
      const [originalsBytes, proxiesBytes, thumbnailsBytes] = await Promise.all([
        getDirectorySizeBytes(path.join(projectDir, 'originals')),
        getDirectorySizeBytes(path.join(projectDir, 'proxies')),
        getDirectorySizeBytes(path.join(projectDir, 'thumbnails')),
      ]);

      originalsTotal += originalsBytes;
      proxiesTotal += proxiesBytes;
      thumbnailsTotal += thumbnailsBytes;

      const projectAssets = assetsByProject.get(project.id) ?? [];
      let reclaimableRejectedTestBytes = 0;
      for (const a of projectAssets) {
        if (
          isAssetEligibleForCleanup(
            {
              status: a.status as AssetStatus,
              qualityTier: a.qualityTier as QualityTier,
              filePath: a.filePath,
              createdAt: a.createdAt,
            },
            defaultFilter,
            nowMs,
          )
        ) {
          reclaimableRejectedTestBytes += a.fileSize;
        }
      }

      projectSummaries.push({
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        assetCount: projectAssets.length,
        originalsBytes,
        proxiesBytes,
        thumbnailsBytes,
        totalBytes: originalsBytes + proxiesBytes + thumbnailsBytes,
        reclaimableRejectedTestBytes,
      });
    }

    projectSummaries.sort((a, b) => b.totalBytes - a.totalBytes);

    const [tempBytes, backupsBytes, fsStats] = await Promise.all([
      getDirectorySizeBytes(resolveSafePath(this.config.dataDir, '.tmp')),
      getDirectorySizeBytes(this.config.backupDir),
      getFilesystemStats(this.config.dataDir),
    ]);

    const totalManagedBytes = originalsTotal + proxiesTotal + thumbnailsTotal + tempBytes;

    return {
      dataDir: this.config.dataDir,
      totalManagedBytes,
      originalsBytes: originalsTotal,
      proxiesBytes: proxiesTotal,
      thumbnailsBytes: thumbnailsTotal,
      tempBytes,
      backupsBytes,
      filesystemTotalBytes: fsStats.totalBytes,
      filesystemFreeBytes: fsStats.freeBytes,
      projects: projectSummaries,
    };
  }

  async previewCleanup(input: CleanupFilterInput): Promise<CleanupResultDto> {
    return this.executeCleanup(input, true);
  }

  async runCleanup(input: CleanupFilterInput): Promise<CleanupResultDto> {
    return this.executeCleanup(input, false);
  }

  private async executeCleanup(
    input: CleanupFilterInput,
    dryRun: boolean,
  ): Promise<CleanupResultDto> {
    const [projectRows, assetRows] = await Promise.all([
      this.db.select({ id: projects.id, slug: projects.slug }).from(projects),
      input.projectId
        ? this.db.select().from(assets).where(eq(assets.projectId, input.projectId))
        : this.db.select().from(assets),
    ]);

    const slugById = new Map(projectRows.map((p) => [p.id, p.slug]));
    const nowMs = Date.now();
    const candidates: CleanupCandidateDto[] = [];
    let freedAssetBytes = 0;

    for (const row of assetRows) {
      if (
        !isAssetEligibleForCleanup(
          {
            status: row.status as AssetStatus,
            qualityTier: row.qualityTier as QualityTier,
            filePath: row.filePath,
            createdAt: row.createdAt,
          },
          input,
          nowMs,
        )
      ) {
        continue;
      }

      const managedPaths = [row.filePath, row.proxyPath, row.thumbnailPath].filter(
        (p): p is string =>
          typeof p === 'string' &&
          p.length > 0 &&
          !p.startsWith('ingest://') &&
          !p.startsWith('ingest-root://'),
      );

      let diskBytes = 0;
      for (const rel of managedPaths) {
        try {
          const abs = resolveSafePath(this.config.dataDir, rel);
          diskBytes += await getFileSizeSafe(abs);
        } catch {
          // Ignore invalid relative path
        }
      }
      const reclaimableBytes = diskBytes > 0 ? diskBytes : row.fileSize;

      candidates.push({
        assetId: row.id,
        projectId: row.projectId,
        projectSlug: slugById.get(row.projectId) ?? 'unknown',
        handle: buildAssetHandle(row.refCode),
        title: row.title,
        status: row.status as AssetStatus,
        qualityTier: row.qualityTier as QualityTier,
        reclaimableBytes,
        createdAt: row.createdAt.toISOString(),
      });
    }

    let deletedAssetsCount = 0;
    if (dryRun) {
      freedAssetBytes = candidates.reduce((acc, c) => acc + c.reclaimableBytes, 0);
    } else {
      for (const candidate of candidates) {
        const deleted = await this.studio.deleteAsset(candidate.assetId, 'user');
        if (deleted) {
          deletedAssetsCount += 1;
          freedAssetBytes += candidate.reclaimableBytes;
        }
      }
    }

    const tmpDir = resolveSafePath(this.config.dataDir, '.tmp');
    let freedTempBytes = 0;
    if (input.includeTempFiles) {
      freedTempBytes = await getDirectorySizeBytes(tmpDir);
      if (!dryRun && freedTempBytes > 0) {
        try {
          const entries = await fs.readdir(tmpDir, { withFileTypes: true });
          for (const entry of entries) {
            await fs.rm(path.join(tmpDir, entry.name), { recursive: true, force: true });
          }
        } catch {
          // Ignore temp cleanup errors
        }
      }
    }

    return {
      dryRun,
      candidatesCount: candidates.length,
      deletedAssetsCount,
      freedAssetBytes,
      freedTempBytes,
      totalFreedBytes: freedAssetBytes + freedTempBytes,
      candidates,
    };
  }

  // ---------------------------------------------------------------------------
  // Automated Backups
  // ---------------------------------------------------------------------------

  async listBackups(): Promise<BackupEntryDto[]> {
    const rows = await this.db.select().from(backups).orderBy(desc(backups.createdAt));
    return rows.map((row) => this.toBackupDto(row));
  }

  async createBackup(notes = ''): Promise<BackupEntryDto> {
    await fs.mkdir(this.config.backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videostudio-backup-'));

    let includesDb = false;
    let includesSkills = false;
    const includesMetadata = true;

    try {
      // 1. Always export a portable JSON snapshot of all production metadata (redacting webhook secrets)
      const [
        allProjects,
        allRulebooks,
        allProjectRules,
        allOverrides,
        allPromptTemplates,
        allWorkflowTemplates,
        allSkills,
        allScripts,
        allBible,
        allScenes,
        allShots,
        allAudio,
        allYoutube,
        allTracks,
        allClips,
        allWatchFolders,
        allWebhooks,
        allAssets,
      ] = await Promise.all([
        this.db.select().from(projects),
        this.db.select().from(rulebooks),
        this.db.select().from(rules),
        this.db.select().from(projectRuleOverrides),
        this.db.select().from(promptTemplates),
        this.db.select().from(comfyWorkflows),
        this.db.select().from(skills),
        this.db.select().from(projectScripts),
        this.db.select().from(bibleEntities),
        this.db.select().from(scenes),
        this.db.select().from(shots),
        this.db.select().from(audioTracks),
        this.db.select().from(youtubePackages),
        this.db.select().from(timelineTracks),
        this.db.select().from(timelineClips),
        this.db.select().from(watchFolders),
        this.db.select().from(webhooks),
        this.db.select().from(assets),
      ]);

      const snapshot = {
        format: 'videostudio-backup-v1',
        version: APP_VERSION,
        createdAt: new Date().toISOString(),
        notes,
        tables: {
          projects: allProjects,
          rulebooks: allRulebooks,
          projectRules: allProjectRules,
          projectRuleOverrides: allOverrides,
          promptTemplates: allPromptTemplates,
          workflowTemplates: allWorkflowTemplates,
          skills: allSkills,
          projectScripts: allScripts,
          bibleEntities: allBible,
          scenes: allScenes,
          shots: allShots,
          audioTracks: allAudio,
          youtubePackages: allYoutube,
          timelineTracks: allTracks,
          timelineClips: allClips,
          watchFolders: allWatchFolders,
          webhooks: allWebhooks.map((w) => ({ ...w, secret: w.secret ? '[REDACTED]' : null })),
          assets: allAssets,
        },
      };

      await fs.writeFile(
        path.join(stagingDir, 'metadata.json'),
        JSON.stringify(snapshot, null, 2),
        'utf8',
      );

      // 2. Best-effort pg_dump SQL snapshot if pg_dump is installed in the container/host
      try {
        const dumpPath = path.join(stagingDir, 'database.sql');
        await execFileAsync('pg_dump', ['--no-owner', '--no-privileges', '-f', dumpPath, this.config.databaseUrl], {
          timeout: 60_000,
        });
        includesDb = true;
      } catch {
        includesDb = false;
      }

      // 3. Copy synced skills directory if present
      try {
        const skillStat = await fs.stat(this.config.skillsSyncDir);
        if (skillStat.isDirectory()) {
          await fs.cp(this.config.skillsSyncDir, path.join(stagingDir, 'skills'), {
            recursive: true,
          });
          includesSkills = true;
        }
      } catch {
        includesSkills = false;
      }

      // 4. Pack staging directory into a compressed archive inside BACKUP_DIR
      let filename = `videostudio-backup-${stamp}.tar.gz`;
      let targetPath = resolveSafePath(this.config.backupDir, filename);

      try {
        await execFileAsync('tar', ['-czf', targetPath, '-C', stagingDir, '.'], {
          timeout: 60_000,
        });
      } catch {
        // Fallback if tar binary is unavailable: gzip metadata.json directly
        filename = `videostudio-backup-${stamp}.json.gz`;
        targetPath = resolveSafePath(this.config.backupDir, filename);
        const metaBuf = await fs.readFile(path.join(stagingDir, 'metadata.json'));
        const gz = await gzipAsync(metaBuf);
        await fs.writeFile(targetPath, gz);
      }

      const sizeBytes = await getFileSizeSafe(targetPath);

      const [created] = await this.db
        .insert(backups)
        .values({
          filename,
          filePath: filename,
          sizeBytes,
          includesDb,
          includesSkills,
          includesMetadata,
          status: 'completed',
          notes,
        })
        .returning();

      if (!created) {
        throw new Error('Failed to record backup metadata');
      }

      const dto = this.toBackupDto(created);
      this.webhookService?.emit('backup.completed', null, {
        backupId: dto.id,
        filename: dto.filename,
        sizeBytes: dto.sizeBytes,
        includesDb: dto.includesDb,
        includesSkills: dto.includesSkills,
      });

      return dto;
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async getBackupFile(
    id: string,
  ): Promise<{ absPath: string; filename: string; sizeBytes: number } | null> {
    const [row] = await this.db.select().from(backups).where(eq(backups.id, id)).limit(1);
    if (!row) return null;

    const absPath = resolveSafePath(this.config.backupDir, row.filePath);
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) return null;
      return {
        absPath,
        filename: row.filename,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  }

  async deleteBackup(id: string): Promise<boolean> {
    const [row] = await this.db.select().from(backups).where(eq(backups.id, id)).limit(1);
    if (!row) return false;

    try {
      const absPath = resolveSafePath(this.config.backupDir, row.filePath);
      await fs.unlink(absPath);
    } catch {
      // File may have been pruned externally
    }

    const deleted = await this.db
      .delete(backups)
      .where(eq(backups.id, id))
      .returning({ id: backups.id });
    return deleted.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Server Health & Resource Monitoring
  // ---------------------------------------------------------------------------

  async getSystemMetrics(inFlightRequests: number): Promise<SystemMetricsDto> {
    let dbOk = false;
    try {
      await this.pool.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const [ffmpegOk, fsStats, watchRows, webhookRows, backupRows] = await Promise.all([
      this.media.checkFfmpegAvailable(),
      getFilesystemStats(this.config.dataDir),
      this.db.select({ enabled: watchFolders.enabled }).from(watchFolders).catch(() => []),
      this.db.select({ enabled: webhooks.enabled }).from(webhooks).catch(() => []),
      this.db.select({ id: backups.id }).from(backups).catch(() => []),
    ]);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const load = os.loadavg();

    return {
      version: APP_VERSION,
      slot: process.env.DEPLOY_SLOT || 'standalone',
      uptimeSec: Math.round(process.uptime()),
      inFlightRequests: Math.max(0, inFlightRequests),
      websocketClients: this.realtime.clientCount,
      database: dbOk ? 'up' : 'down',
      ffmpeg: ffmpegOk ? 'available' : 'unavailable',
      cpuLoad1m: Math.round((load[0] ?? 0) * 100) / 100,
      cpuCores: os.cpus().length || 1,
      memoryUsedBytes: Math.max(0, totalMem - freeMem),
      memoryTotalBytes: totalMem,
      processRssBytes: process.memoryUsage().rss,
      diskFreeBytes: fsStats.freeBytes,
      diskTotalBytes: fsStats.totalBytes,
      activeWatchFolders: watchRows.filter((w) => w.enabled).length,
      activeWebhooks: webhookRows.filter((w) => w.enabled).length,
      backupsCount: backupRows.length,
      youtubeApiConfigured: Boolean(this.config.youtubeOAuth),
      timestamp: new Date().toISOString(),
    };
  }

  private toBackupDto(row: typeof backups.$inferSelect): BackupEntryDto {
    return {
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      includesDb: row.includesDb,
      includesSkills: row.includesSkills,
      includesMetadata: row.includesMetadata,
      status: row.status === 'failed' ? 'failed' : 'completed',
      notes: row.notes,
      downloadUrl: `/api/ops/backups/${row.id}/download`,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

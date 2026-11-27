import fs from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import {
  normalizeFolderPath,
  type CreateWatchFolderInput,
  type QualityTier,
  type StorageMode,
  type UpdateWatchFolderInput,
  type WatchFolderDto,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { projects, watchFolders } from '../db/schema.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { StudioService } from './studio.service.js';

export interface WatchFolderScanResult {
  folder: WatchFolderDto;
  ingestedCount: number;
  skippedCount: number;
  errors: Array<{ filename: string; error: string }>;
}

const FILE_SETTLE_MS = 2_000;

export class WatchFolderService {
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly activeScans = new Set<string>();
  private tickInProgress = false;

  constructor(
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
  ) {}

  startPolling(intervalMs = 5_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.runPollTick();
    }, intervalMs);
    this.pollTimer.unref?.();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async listWatchFolders(projectIdOrSlug?: string): Promise<WatchFolderDto[]> {
    let filterProjectId: string | undefined;
    if (projectIdOrSlug) {
      const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
      if (!project) return [];
      filterProjectId = project.id;
    }

    const [rows, projectRows] = await Promise.all([
      filterProjectId
        ? this.db
            .select()
            .from(watchFolders)
            .where(eq(watchFolders.projectId, filterProjectId))
            .orderBy(desc(watchFolders.createdAt))
        : this.db.select().from(watchFolders).orderBy(desc(watchFolders.createdAt)),
      this.db.select({ id: projects.id, slug: projects.slug }).from(projects),
    ]);

    const slugById = new Map(projectRows.map((p) => [p.id, p.slug]));
    return rows.map((row) => this.toDto(row, slugById.get(row.projectId) ?? 'unknown'));
  }

  async createWatchFolder(input: CreateWatchFolderInput): Promise<WatchFolderDto> {
    const project = await this.studio.getProjectByIdOrSlug(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    // Validate path strictly stays within configured read-only ingest roots
    this.media.resolveAllowedIngestPath(input.relativeDir);

    const [created] = await this.db
      .insert(watchFolders)
      .values({
        projectId: project.id,
        relativeDir: input.relativeDir,
        folderPath: normalizeFolderPath(input.folderPath ?? ''),
        glob: input.glob || '*',
        storageMode: input.storageMode ?? 'reference',
        qualityTier: input.qualityTier ?? 'test',
        tags: input.tags ?? [],
        enabled: input.enabled ?? true,
        pollIntervalSec: input.pollIntervalSec ?? 15,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create watch folder');
    }

    return this.toDto(created, project.slug);
  }

  async updateWatchFolder(
    id: string,
    input: UpdateWatchFolderInput,
  ): Promise<WatchFolderDto | null> {
    const [existing] = await this.db
      .select()
      .from(watchFolders)
      .where(eq(watchFolders.id, id))
      .limit(1);
    if (!existing) return null;

    const [updated] = await this.db
      .update(watchFolders)
      .set({
        folderPath:
          input.folderPath !== undefined
            ? normalizeFolderPath(input.folderPath)
            : existing.folderPath,
        glob: input.glob ?? existing.glob,
        storageMode: input.storageMode ?? existing.storageMode,
        qualityTier: input.qualityTier ?? existing.qualityTier,
        tags: input.tags ?? existing.tags,
        enabled: input.enabled ?? existing.enabled,
        pollIntervalSec: input.pollIntervalSec ?? existing.pollIntervalSec,
        updatedAt: new Date(),
      })
      .where(eq(watchFolders.id, id))
      .returning();

    if (!updated) return null;

    const project = await this.studio.getProjectByIdOrSlug(updated.projectId);
    return this.toDto(updated, project?.slug ?? 'unknown');
  }

  async deleteWatchFolder(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(watchFolders)
      .where(eq(watchFolders.id, id))
      .returning({ id: watchFolders.id });
    return deleted.length > 0;
  }

  async scanWatchFolder(
    id: string,
    options: { requireSettled?: boolean } = {},
  ): Promise<WatchFolderScanResult | null> {
    if (this.activeScans.has(id)) {
      const [row] = await this.db
        .select()
        .from(watchFolders)
        .where(eq(watchFolders.id, id))
        .limit(1);
      if (!row) return null;
      const project = await this.studio.getProjectByIdOrSlug(row.projectId);
      return {
        folder: this.toDto(row, project?.slug ?? 'unknown'),
        ingestedCount: 0,
        skippedCount: 0,
        errors: [],
      };
    }

    this.activeScans.add(id);
    try {
      const [row] = await this.db
        .select()
        .from(watchFolders)
        .where(eq(watchFolders.id, id))
        .limit(1);
      if (!row) return null;

      const project = await this.studio.getProjectByIdOrSlug(row.projectId);
      if (!project) return null;

      // Optional settle check for background polling so ComfyUI writes finish before ingest
      if (options.requireSettled) {
        const scanned = await this.media.scanIngestFolder({
          localDir: row.relativeDir,
          glob: row.glob,
          recursive: true,
          limit: 200,
        });
        const now = Date.now();
        for (const item of scanned) {
          try {
            const st = await fs.stat(item.absPath);
            if (now - st.mtimeMs < FILE_SETTLE_MS) {
              // File is actively being written; wait for the next poll tick
              return {
                folder: this.toDto(row, project.slug),
                ingestedCount: 0,
                skippedCount: 0,
                errors: [],
              };
            }
          } catch {
            // File vanished mid-scan; ignore
          }
        }
      }

      const batch = await this.studio.ingestFolderBatch({
        projectIdOrSlug: project.id,
        localDir: row.relativeDir,
        glob: row.glob,
        recursive: true,
        folderPath: row.folderPath,
        storageMode: row.storageMode as StorageMode,
        qualityTier: row.qualityTier as QualityTier,
        tags: row.tags ?? [],
        limit: 200,
        createdBy: 'system',
      });

      const now = new Date();
      const nextCount = row.ingestedCount + batch.ingested.length;

      const [updated] = await this.db
        .update(watchFolders)
        .set({
          lastScanAt: now,
          ingestedCount: nextCount,
          updatedAt: now,
        })
        .where(eq(watchFolders.id, row.id))
        .returning();

      if (batch.ingested.length > 0) {
        this.realtime.broadcast({
          type: 'folders.changed',
          payload: {
            projectId: project.id,
          },
        });
      }

      return {
        folder: this.toDto(updated ?? row, project.slug),
        ingestedCount: batch.ingested.length,
        skippedCount: batch.skipped.length,
        errors: batch.errors,
      };
    } finally {
      this.activeScans.delete(id);
    }
  }

  private async runPollTick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const enabledRows = await this.db
        .select()
        .from(watchFolders)
        .where(eq(watchFolders.enabled, true));

      const nowMs = Date.now();
      for (const row of enabledRows) {
        const lastMs = row.lastScanAt ? row.lastScanAt.getTime() : 0;
        if (nowMs - lastMs < row.pollIntervalSec * 1000) {
          continue;
        }
        try {
          await this.scanWatchFolder(row.id, { requireSettled: true });
        } catch {
          // Directory might temporarily be unmounted or empty; try again on next tick
        }
      }
    } catch {
      // Ignore transient DB errors during polling
    } finally {
      this.tickInProgress = false;
    }
  }

  private toDto(row: typeof watchFolders.$inferSelect, projectSlug: string): WatchFolderDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectSlug,
      relativeDir: row.relativeDir,
      folderPath: row.folderPath,
      glob: row.glob,
      storageMode: row.storageMode as StorageMode,
      qualityTier: row.qualityTier as QualityTier,
      tags: row.tags ?? [],
      enabled: row.enabled,
      pollIntervalSec: row.pollIntervalSec,
      lastScanAt: row.lastScanAt ? row.lastScanAt.toISOString() : null,
      ingestedCount: row.ingestedCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

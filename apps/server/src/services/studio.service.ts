import path from 'node:path';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import {
  buildAssetHandle,
  buildStudioUri,
  formatAssetRefCode,
  getParentFolderPath,
  normalizeFolderPath,
  parseStudioRef,
  slugifyProjectName,
  type ActivityDto,
  type Actor,
  type AgentTaskDto,
  type AgentTaskStatus,
  type AssetDto,
  type AssetRelationType,
  type AssetStatus,
  type AssetType,
  type CreateProjectInput,
  type JobDto,
  type JobStatus,
  type MediaFolderDto,
  type ProjectDto,
  type ProjectStatus,
  type ProjectType,
  type QcCheckValue,
  type QcOverallStatus,
  type QualityTier,
  type RecordQcInput,
  type StorageMode,
  type SyncAgentTasksInput,
  type UpdateAgentTaskInput,
  type UpdateAssetInput,
  type UpdateProjectInput,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import {
  activities,
  agentTasks,
  assets,
  jobs,
  mediaFolders,
  projectRulebookLinks,
  projects,
  rulebooks,
} from '../db/schema.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { WebhookService } from './webhook.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ListAssetsFilter {
  type?: AssetType;
  status?: AssetStatus;
  qualityTier?: QualityTier;
  folderPath?: string;
  recursive?: boolean;
  tag?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface CompactAssetDto {
  id: string;
  refCode: string;
  handle: string;
  originalFilename: string;
  folderPath: string;
  title: string;
  type: AssetType;
  status: AssetStatus;
  qualityTier: QualityTier;
  relationType: AssetRelationType;
  parentAssetId: string | null;
  versionNumber: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  qcStatus: QcOverallStatus;
  tags: string[];
  createdAt: string;
}

export interface ResolvedReferenceResult {
  entityType: 'project' | 'asset';
  project: ProjectDto;
  asset?: AssetDto;
  lineage?: {
    ancestors: AssetDto[];
    children: AssetDto[];
  };
}

export class StudioService {
  private readonly comfyPollers = new Map<string, NodeJS.Timeout>();
  private webhookService?: WebhookService;

  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
    private readonly comfyuiBaseUrl: string | null = null,
  ) {}

  setWebhookService(webhookService: WebhookService): void {
    this.webhookService = webhookService;
  }

  // --- Projects ---

  async listProjects(): Promise<ProjectDto[]> {
    const rows = await this.db
      .select({
        project: projects,
        assetCount: sql<number>`count(${assets.id})::int`,
      })
      .from(projects)
      .leftJoin(assets, eq(assets.projectId, projects.id))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));

    return rows.map((row) => this.toProjectDto(row.project, row.assetCount));
  }

  async getProjectByIdOrSlug(idOrSlug: string): Promise<ProjectDto | null> {
    const condition = UUID_REGEX.test(idOrSlug)
      ? eq(projects.id, idOrSlug)
      : eq(projects.slug, idOrSlug.toLowerCase());

    const rows = await this.db
      .select({
        project: projects,
        assetCount: sql<number>`count(${assets.id})::int`,
      })
      .from(projects)
      .leftJoin(assets, eq(assets.projectId, projects.id))
      .where(condition)
      .groupBy(projects.id)
      .limit(1);

    const match = rows[0];
    if (!match) return null;
    return this.toProjectDto(match.project, match.assetCount);
  }

  async createProject(input: CreateProjectInput, actor: Actor = 'user'): Promise<ProjectDto> {
    const baseSlug = input.slug ? input.slug.toLowerCase() : slugifyProjectName(input.name);
    const uniqueSlug = await this.ensureUniqueSlug(baseSlug);

    const [created] = await this.db
      .insert(projects)
      .values({
        slug: uniqueSlug,
        name: input.name,
        description: input.description,
        type: input.type,
        aspectRatio: input.aspectRatio,
        fps: input.fps,
        targetResolution: input.targetResolution,
        localPath: input.localPath ?? '',
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create project');
    }

    // Automatically attach default global rulebooks (e.g. Standards Production IA)
    await this.attachDefaultRulebooks(created.id);

    const dto = this.toProjectDto(created, 0);
    this.realtime.broadcast({ type: 'project.created', payload: dto });

    await this.logActivity({
      projectId: dto.id,
      projectSlug: dto.slug,
      actor,
      action: 'project.created',
      summary: `Projet créé : ${dto.name} (@proj-${dto.slug})`,
      entityType: 'project',
      entityId: dto.id,
      entityRef: `@proj-${dto.slug}`,
    });

    return dto;
  }

  async updateProject(
    idOrSlug: string,
    input: UpdateProjectInput,
    actor: Actor = 'user',
  ): Promise<ProjectDto | null> {
    const existing = await this.getProjectByIdOrSlug(idOrSlug);
    if (!existing) return null;

    const [updated] = await this.db
      .update(projects)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
        ...(input.fps !== undefined ? { fps: input.fps } : {}),
        ...(input.targetResolution !== undefined ? { targetResolution: input.targetResolution } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.localPath !== undefined ? { localPath: input.localPath } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, existing.id))
      .returning();

    if (!updated) return null;

    const dto = this.toProjectDto(updated, existing.assetCount);
    this.realtime.broadcast({ type: 'project.updated', payload: dto });

    await this.logActivity({
      projectId: dto.id,
      projectSlug: dto.slug,
      actor,
      action: 'project.updated',
      summary: `Projet mis à jour : ${dto.name}`,
      entityType: 'project',
      entityId: dto.id,
      entityRef: `@proj-${dto.slug}`,
    });

    return dto;
  }

  async deleteProject(idOrSlug: string): Promise<boolean> {
    const existing = await this.getProjectByIdOrSlug(idOrSlug);
    if (!existing) return false;

    const projectAssets = await this.db
      .select({
        filePath: assets.filePath,
        proxyPath: assets.proxyPath,
        thumbnailPath: assets.thumbnailPath,
      })
      .from(assets)
      .where(eq(assets.projectId, existing.id));

    await this.db.delete(projects).where(eq(projects.id, existing.id));

    const filesToRemove = projectAssets.flatMap((a) => [a.filePath, a.proxyPath, a.thumbnailPath]);
    await this.media.deleteMediaFiles(filesToRemove);

    this.realtime.broadcast({ type: 'project.deleted', payload: { id: existing.id } });
    return true;
  }

  // --- Media Folders ---

  async listMediaFolders(projectIdOrSlug: string): Promise<MediaFolderDto[]> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const [explicitRows, assetRows] = await Promise.all([
      this.db
        .select({ path: mediaFolders.path })
        .from(mediaFolders)
        .where(eq(mediaFolders.projectId, project.id)),
      this.db
        .select({ folderPath: assets.folderPath })
        .from(assets)
        .where(eq(assets.projectId, project.id)),
    ]);

    const folderSet = new Set<string>();
    const addWithAncestors = (raw: string) => {
      const norm = normalizeFolderPath(raw);
      if (!norm) return;
      const parts = norm.split('/');
      for (let i = 1; i <= parts.length; i += 1) {
        folderSet.add(parts.slice(0, i).join('/'));
      }
    };

    for (const r of explicitRows) addWithAncestors(r.path);
    for (const a of assetRows) addWithAncestors(a.folderPath);

    const counts = new Map<string, number>();
    for (const a of assetRows) {
      const norm = normalizeFolderPath(a.folderPath);
      if (!norm) continue;
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }

    return Array.from(folderSet)
      .sort((a, b) => a.localeCompare(b))
      .map((fullPath) => {
        const parts = fullPath.split('/');
        return {
          path: fullPath,
          name: parts[parts.length - 1] ?? fullPath,
          parentPath: getParentFolderPath(fullPath),
          assetCount: counts.get(fullPath) ?? 0,
        };
      });
  }

  async createMediaFolder(
    projectIdOrSlug: string,
    rawPath: string,
    actor: Actor = 'user',
  ): Promise<MediaFolderDto | null> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const norm = normalizeFolderPath(rawPath);
    if (!norm) {
      throw new Error('Folder path cannot be empty');
    }

    const parts = norm.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const ancestor = parts.slice(0, i).join('/');
      await this.db
        .insert(mediaFolders)
        .values({ projectId: project.id, path: ancestor })
        .onConflictDoNothing();
    }

    this.realtime.broadcast({ type: 'folders.changed', payload: { projectId: project.id } });
    await this.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'folder.created',
      summary: `Dossier média créé : /${norm}`,
      entityType: 'folder',
      entityRef: norm,
    });

    return {
      path: norm,
      name: parts[parts.length - 1] ?? norm,
      parentPath: getParentFolderPath(norm),
      assetCount: 0,
    };
  }

  async deleteMediaFolder(projectIdOrSlug: string, rawPath: string): Promise<boolean> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return false;

    const norm = normalizeFolderPath(rawPath);
    if (!norm) return false;
    const parent = getParentFolderPath(norm);

    // Non-destructive: move any assets inside this folder (or subfolders) up to parent
    const projectAssets = await this.db
      .select({ id: assets.id, folderPath: assets.folderPath })
      .from(assets)
      .where(eq(assets.projectId, project.id));

    for (const a of projectAssets) {
      if (a.folderPath === norm || a.folderPath.startsWith(`${norm}/`)) {
        await this.db
          .update(assets)
          .set({ folderPath: parent, updatedAt: new Date() })
          .where(eq(assets.id, a.id));
      }
    }

    const existingFolders = await this.db
      .select({ id: mediaFolders.id, path: mediaFolders.path })
      .from(mediaFolders)
      .where(eq(mediaFolders.projectId, project.id));

    for (const f of existingFolders) {
      if (f.path === norm || f.path.startsWith(`${norm}/`)) {
        await this.db.delete(mediaFolders).where(eq(mediaFolders.id, f.id));
      }
    }

    this.realtime.broadcast({ type: 'folders.changed', payload: { projectId: project.id } });
    return true;
  }

  // --- Assets ---

  async listAssets(projectIdOrSlug: string, filter: ListAssetsFilter = {}): Promise<AssetDto[]> {
    const page = await this.listAssetsPage(projectIdOrSlug, filter);
    return page.assets;
  }

  async listAssetsPage(
    projectIdOrSlug: string,
    filter: ListAssetsFilter = {},
  ): Promise<{ assets: AssetDto[]; nextCursor: string | null; total: number }> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return { assets: [], nextCursor: null, total: 0 };

    const baseConditions = [eq(assets.projectId, project.id)];
    if (filter.type) baseConditions.push(eq(assets.type, filter.type));
    if (filter.status) baseConditions.push(eq(assets.status, filter.status));
    if (filter.qualityTier) baseConditions.push(eq(assets.qualityTier, filter.qualityTier));
    if (filter.folderPath !== undefined && !filter.recursive) {
      baseConditions.push(eq(assets.folderPath, normalizeFolderPath(filter.folderPath)));
    }
    if (filter.search) {
      const pattern = `%${filter.search.trim()}%`;
      const searchCond = or(
        ilike(assets.title, pattern),
        ilike(assets.refCode, pattern),
        ilike(assets.originalFilename, pattern),
        ilike(assets.promptUsed, pattern),
        ilike(assets.notes, pattern),
      );
      if (searchCond) baseConditions.push(searchCond);
    }

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(...baseConditions));
    const total = countRows[0]?.count ?? 0;

    const pageConditions = [...baseConditions];
    if (filter.cursor) {
      const cursorDate = new Date(filter.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        pageConditions.push(lt(assets.createdAt, cursorDate));
      }
    }

    const pageLimit = Math.max(1, Math.min(filter.limit ?? 200, 500));
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(...pageConditions))
      .orderBy(desc(assets.createdAt))
      .limit(pageLimit + 1);

    const hasMore = rows.length > pageLimit;
    const slicedRows = hasMore ? rows.slice(0, pageLimit) : rows;
    let mapped = slicedRows.map((row) => this.toAssetDto(row, project.slug));

    if (filter.folderPath !== undefined && filter.recursive) {
      const prefix = normalizeFolderPath(filter.folderPath);
      if (prefix) {
        mapped = mapped.filter(
          (a) => a.folderPath === prefix || a.folderPath.startsWith(`${prefix}/`),
        );
      }
    }
    if (filter.tag) {
      const targetTag = filter.tag.toLowerCase();
      mapped = mapped.filter((a) => a.tags.some((t) => t.toLowerCase() === targetTag));
    }

    const nextCursor =
      hasMore && slicedRows.length > 0
        ? slicedRows[slicedRows.length - 1]!.createdAt.toISOString()
        : null;

    return { assets: mapped, nextCursor, total };
  }

  toCompactAssetDto(asset: AssetDto): CompactAssetDto {
    return {
      id: asset.id,
      refCode: asset.refCode,
      handle: asset.handle,
      originalFilename: asset.originalFilename,
      folderPath: asset.folderPath,
      title: asset.title,
      type: asset.type,
      status: asset.status,
      qualityTier: asset.qualityTier,
      relationType: asset.relationType,
      parentAssetId: asset.parentAssetId,
      versionNumber: asset.versionNumber,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
      qcStatus: asset.qcStatus,
      tags: asset.tags,
      createdAt: asset.createdAt,
    };
  }

  async getAssetById(assetId: string): Promise<{ asset: AssetDto; raw: typeof assets.$inferSelect } | null> {
    if (!UUID_REGEX.test(assetId)) return null;

    const rows = await this.db
      .select({ asset: assets, projectSlug: projects.slug })
      .from(assets)
      .innerJoin(projects, eq(projects.id, assets.projectId))
      .where(eq(assets.id, assetId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      asset: this.toAssetDto(row.asset, row.projectSlug),
      raw: row.asset,
    };
  }

  async ingestAssetFromBuffer(params: {
    projectIdOrSlug: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    explicitType?: AssetType;
    storageMode?: StorageMode;
    sourceLocalAbsPath?: string;
    ingestRelativePath?: string;
    referenceUri?: string;
    folderPath?: string;
    title?: string;
    qualityTier?: QualityTier;
    status?: AssetStatus;
    parentAssetId?: string;
    parentRef?: string;
    relationType?: AssetRelationType;
    promptUsed?: string;
    negativePrompt?: string;
    modelName?: string;
    seed?: string;
    tags?: string[];
    notes?: string;
    createdBy?: Actor;
  }): Promise<AssetDto> {
    const project = await this.getProjectByIdOrSlug(params.projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${params.projectIdOrSlug}`);
    }

    const folderPath = normalizeFolderPath(params.folderPath ?? '');
    if (folderPath) {
      const parts = folderPath.split('/');
      for (let i = 1; i <= parts.length; i += 1) {
        await this.db
          .insert(mediaFolders)
          .values({ projectId: project.id, path: parts.slice(0, i).join('/') })
          .onConflictDoNothing();
      }
    }

    const processed = await this.media.storeAndProcessMedia({
      projectSlug: project.slug,
      buffer: params.buffer,
      filename: params.filename,
      mimeType: params.mimeType,
      explicitType: params.explicitType,
      storageMode: params.storageMode,
      sourceLocalAbsPath: params.sourceLocalAbsPath,
      ingestRelativePath: params.ingestRelativePath,
      referenceUri: params.referenceUri,
    });

    // Resolve optional parent asset (for version stacking & derivations: upscale / crop / variant)
    const relationType: AssetRelationType = params.relationType ?? 'revision';
    let resolvedParentId: string | null = params.parentAssetId ?? null;
    let versionNumber = 1;

    if (!resolvedParentId && params.parentRef) {
      const resolvedParent = await this.resolveReference(params.parentRef, project.slug);
      if (resolvedParent?.asset) {
        resolvedParentId = resolvedParent.asset.id;
      }
    }

    if (resolvedParentId) {
      const parentInfo = await this.getAssetById(resolvedParentId);
      if (parentInfo && parentInfo.asset.projectId === project.id) {
        // Only increment versionNumber (-v2, -v3...) for true revisions; derivations (upscale/crop/variant) stay v1
        versionNumber = relationType === 'revision' ? parentInfo.asset.versionNumber + 1 : 1;
      } else {
        resolvedParentId = null;
      }
    }

    const refCode = await this.generateNextRefCode(project.id, processed.type, versionNumber);
    const title = params.title?.trim() || processed.originalFilename.replace(/\.[^.]+$/, '');

    const promptUsed = params.promptUsed ?? processed.comfyMetadata?.positivePrompt ?? null;
    const negativePrompt = params.negativePrompt ?? processed.comfyMetadata?.negativePrompt ?? null;
    const modelName = params.modelName ?? processed.comfyMetadata?.modelName ?? null;
    const seed =
      params.seed ??
      (processed.comfyMetadata?.seed !== undefined ? String(processed.comfyMetadata.seed) : null);

    const [created] = await this.db
      .insert(assets)
      .values({
        projectId: project.id,
        refCode,
        folderPath,
        title,
        type: processed.type,
        status: params.status ?? 'new',
        qualityTier: params.qualityTier ?? 'test',
        parentAssetId: resolvedParentId,
        relationType,
        versionNumber,
        originalFilename: processed.originalFilename,
        filePath: processed.filePath,
        proxyPath: processed.proxyPath,
        thumbnailPath: processed.thumbnailPath,
        mimeType: processed.mimeType,
        fileSize: processed.fileSize,
        width: processed.width,
        height: processed.height,
        durationSec: processed.durationSec,
        fps: processed.fps,
        promptUsed,
        negativePrompt,
        modelName,
        seed,
        comfyMetadata: processed.comfyMetadata,
        tags: params.tags ?? [],
        notes: params.notes ?? '',
        createdBy: params.createdBy ?? 'claude',
      })
      .returning();

    if (!created) {
      throw new Error('Failed to insert asset');
    }

    // Touch project updatedAt
    await this.db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    const dto = this.toAssetDto(created, project.slug);
    this.realtime.broadcast({ type: 'asset.created', payload: dto });
    if (folderPath) {
      this.realtime.broadcast({ type: 'folders.changed', payload: { projectId: project.id } });
    }

    const actor = params.createdBy ?? 'claude';
    await this.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'asset.created',
      summary: `${dto.type.toUpperCase()} ajouté : ${dto.title} (${dto.handle})${relationType !== 'revision' ? ` [${relationType}]` : ''}${folderPath ? ` dans /${folderPath}` : ''}`,
      entityType: 'asset',
      entityId: dto.id,
      entityRef: dto.handle,
      metadata: {
        qualityTier: dto.qualityTier,
        relationType,
        folderPath,
        hasComfyMetadata: Boolean(dto.comfyMetadata),
        versionNumber: dto.versionNumber,
      },
    });

    this.webhookService?.emit('asset.created', project.id, {
      assetId: dto.id,
      handle: dto.handle,
      title: dto.title,
      type: dto.type,
      qualityTier: dto.qualityTier,
      folderPath: dto.folderPath,
      actor,
    });

    return dto;
  }

  async ingestFolderBatch(params: {
    projectIdOrSlug: string;
    localDir: string;
    glob?: string;
    recursive?: boolean;
    folderPath?: string;
    storageMode?: StorageMode;
    qualityTier?: QualityTier;
    relationType?: AssetRelationType;
    parentMatch?: 'none' | 'suffix_strip' | string;
    tags?: string[];
    limit?: number;
    createdBy?: Actor;
  }): Promise<{
    ingested: CompactAssetDto[];
    skipped: Array<{ filename: string; reason: string; existingHandle?: string }>;
    errors: Array<{ filename: string; error: string }>;
  }> {
    const project = await this.getProjectByIdOrSlug(params.projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${params.projectIdOrSlug}`);
    }

    const scanned = await this.media.scanIngestFolder({
      localDir: params.localDir,
      glob: params.glob,
      recursive: params.recursive,
      limit: params.limit,
    });

    const existingRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, project.id));

    const byFilePath = new Map<string, typeof assets.$inferSelect>();
    const byStem = new Map<string, typeof assets.$inferSelect>();
    const byFolderFilename = new Map<string, typeof assets.$inferSelect>();

    for (const row of existingRows) {
      byFilePath.set(row.filePath, row);
      const stem = path.basename(row.originalFilename, path.extname(row.originalFilename)).toLowerCase();
      if (!byStem.has(stem)) byStem.set(stem, row);
      byFolderFilename.set(`${row.folderPath}::${row.originalFilename.toLowerCase()}`, row);
    }

    const baseFolder = normalizeFolderPath(params.folderPath ?? '');
    const storageMode: StorageMode = params.storageMode ?? 'reference';
    const parentMatchMode = params.parentMatch ?? 'none';

    const ingested: CompactAssetDto[] = [];
    const skipped: Array<{ filename: string; reason: string; existingHandle?: string }> = [];
    const errors: Array<{ filename: string; error: string }> = [];

    for (const entry of scanned) {
      const relSubdir = path.dirname(entry.relToDir);
      const targetFolder =
        relSubdir && relSubdir !== '.'
          ? normalizeFolderPath(baseFolder ? `${baseFolder}/${relSubdir}` : relSubdir)
          : baseFolder;

      // Idempotency check: skip if referenceUri or same filename in same folder already exists
      const existingByRef = byFilePath.get(entry.referenceUri);
      const existingByName = byFolderFilename.get(`${targetFolder}::${entry.filename.toLowerCase()}`);
      const duplicate = existingByRef ?? existingByName;
      if (duplicate) {
        skipped.push({
          filename: entry.filename,
          reason: 'already_ingested',
          existingHandle: buildAssetHandle(duplicate.refCode),
        });
        continue;
      }

      // Optional parent matching (e.g. S10_4k.png -> S10.png)
      let matchedParentId: string | undefined;
      if (parentMatchMode !== 'none') {
        const stem = path.basename(entry.filename, path.extname(entry.filename));
        let candidateParentStem: string | null = null;
        if (parentMatchMode === 'suffix_strip') {
          candidateParentStem = stem.replace(
            /(?:[_-](?:4k|2k|hq|upscale|upscaled|crop|cropped|v\d+|final|edit|variant\d*))+$/i,
            '',
          );
        } else {
          try {
            const re = new RegExp(parentMatchMode, 'i');
            const m = stem.match(re);
            candidateParentStem = m?.[1] ?? m?.[0] ?? null;
          } catch {
            candidateParentStem = null;
          }
        }
        if (candidateParentStem && candidateParentStem.toLowerCase() !== stem.toLowerCase()) {
          const parentRow = byStem.get(candidateParentStem.toLowerCase());
          if (parentRow) {
            matchedParentId = parentRow.id;
          }
        }
      }

      try {
        const fileData = await this.media.readLocalIngestFile(entry.absPath);
        const created = await this.ingestAssetFromBuffer({
          projectIdOrSlug: project.id,
          buffer: fileData.buffer,
          filename: fileData.filename,
          mimeType: fileData.mimeType,
          storageMode,
          sourceLocalAbsPath: fileData.resolvedAbsPath,
          ingestRelativePath: fileData.ingestRelativePath,
          referenceUri: fileData.referenceUri,
          folderPath: targetFolder,
          qualityTier: params.qualityTier ?? 'test',
          parentAssetId: matchedParentId,
          relationType:
            params.relationType ?? (matchedParentId ? 'upscale' : 'revision'),
          tags: params.tags ?? [],
          createdBy: params.createdBy ?? 'claude',
        });
        ingested.push(this.toCompactAssetDto(created));

        // Update in-memory maps so later files in same batch can match earlier ones as parents
        const stemLower = path
          .basename(created.originalFilename, path.extname(created.originalFilename))
          .toLowerCase();
        if (!byStem.has(stemLower)) {
          const rawInfo = await this.getAssetById(created.id);
          if (rawInfo) {
            byStem.set(stemLower, rawInfo.raw);
            byFilePath.set(rawInfo.raw.filePath, rawInfo.raw);
            byFolderFilename.set(
              `${targetFolder}::${created.originalFilename.toLowerCase()}`,
              rawInfo.raw,
            );
          }
        }
      } catch (err) {
        errors.push({
          filename: entry.filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ingested, skipped, errors };
  }

  async updateAsset(
    assetId: string,
    input: UpdateAssetInput,
    actor: Actor = 'user',
  ): Promise<AssetDto | null> {
    const existing = await this.getAssetById(assetId);
    if (!existing) return null;

    const normalizedFolder =
      input.folderPath !== undefined ? normalizeFolderPath(input.folderPath) : undefined;

    if (normalizedFolder) {
      const parts = normalizedFolder.split('/');
      for (let i = 1; i <= parts.length; i += 1) {
        await this.db
          .insert(mediaFolders)
          .values({ projectId: existing.asset.projectId, path: parts.slice(0, i).join('/') })
          .onConflictDoNothing();
      }
    }

    const [updated] = await this.db
      .update(assets)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(normalizedFolder !== undefined ? { folderPath: normalizedFolder } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.qualityTier !== undefined ? { qualityTier: input.qualityTier } : {}),
        ...(input.relationType !== undefined ? { relationType: input.relationType } : {}),
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.promptUsed !== undefined ? { promptUsed: input.promptUsed } : {}),
        ...(input.negativePrompt !== undefined ? { negativePrompt: input.negativePrompt } : {}),
        ...(input.parentAssetId !== undefined ? { parentAssetId: input.parentAssetId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assets.id, assetId))
      .returning();

    if (!updated) return null;

    const dto = this.toAssetDto(updated, existing.asset.projectSlug);
    this.realtime.broadcast({ type: 'asset.updated', payload: dto });
    if (normalizedFolder !== undefined) {
      this.realtime.broadcast({
        type: 'folders.changed',
        payload: { projectId: dto.projectId },
      });
    }

    await this.logActivity({
      projectId: dto.projectId,
      projectSlug: dto.projectSlug,
      actor,
      action: 'asset.updated',
      summary: `Mis à jour ${dto.handle} (${dto.status} · ${dto.qualityTier})`,
      entityType: 'asset',
      entityId: dto.id,
      entityRef: dto.handle,
    });

    if (input.status !== undefined && input.status !== existing.asset.status) {
      this.webhookService?.emit('asset.status_changed', dto.projectId, {
        assetId: dto.id,
        handle: dto.handle,
        title: dto.title,
        previousStatus: existing.asset.status,
        status: dto.status,
        qualityTier: dto.qualityTier,
        actor,
      });
    }

    return dto;
  }

  async recordAssetQc(
    assetIdOrRef: string,
    input: RecordQcInput,
    actor: Actor = 'claude',
    defaultProjectSlug?: string,
  ): Promise<AssetDto | null> {
    let existing = await this.getAssetById(assetIdOrRef);
    if (!existing) {
      const resolved = await this.resolveReference(assetIdOrRef, defaultProjectSlug);
      if (resolved?.asset) {
        existing = await this.getAssetById(resolved.asset.id);
      }
    }
    if (!existing) return null;

    const mergedChecks: Record<string, QcCheckValue> = {
      ...(existing.asset.qcChecks ?? {}),
      ...input.checks,
    };

    const computedStatus: QcOverallStatus = input.status ?? computeQcStatus(mergedChecks);

    const [updated] = await this.db
      .update(assets)
      .set({
        qcChecks: mergedChecks,
        qcStatus: computedStatus,
        ...(input.notes !== undefined ? { qcNotes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assets.id, existing.asset.id))
      .returning();

    if (!updated) return null;

    const dto = this.toAssetDto(updated, existing.asset.projectSlug);
    this.realtime.broadcast({ type: 'asset.updated', payload: dto });

    const checkSummary = Object.entries(mergedChecks)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    await this.logActivity({
      projectId: dto.projectId,
      projectSlug: dto.projectSlug,
      actor,
      action: 'asset.qc_recorded',
      summary: `QC ${computedStatus.toUpperCase()} sur ${dto.handle}${checkSummary ? ` (${checkSummary})` : ''}`,
      entityType: 'asset',
      entityId: dto.id,
      entityRef: dto.handle,
      metadata: { qcStatus: computedStatus, qcChecks: mergedChecks },
    });

    return dto;
  }

  async deleteAsset(assetId: string, actor: Actor = 'user'): Promise<boolean> {
    const existing = await this.getAssetById(assetId);
    if (!existing) return false;

    await this.db.delete(assets).where(eq(assets.id, assetId));
    await this.media.deleteMediaFiles([
      existing.raw.filePath,
      existing.raw.proxyPath,
      existing.raw.thumbnailPath,
    ]);

    this.realtime.broadcast({
      type: 'asset.deleted',
      payload: { id: assetId, projectId: existing.asset.projectId },
    });
    if (existing.asset.folderPath) {
      this.realtime.broadcast({
        type: 'folders.changed',
        payload: { projectId: existing.asset.projectId },
      });
    }

    await this.logActivity({
      projectId: existing.asset.projectId,
      projectSlug: existing.asset.projectSlug,
      actor,
      action: 'asset.deleted',
      summary: `Supprimé ${existing.asset.handle} (${existing.asset.title})`,
      entityType: 'asset',
      entityId: assetId,
      entityRef: existing.asset.handle,
    });

    return true;
  }

  async getAssetLineage(
    assetId: string,
  ): Promise<{ ancestors: AssetDto[]; children: AssetDto[] } | null> {
    const current = await this.getAssetById(assetId);
    if (!current) return null;

    const ancestors: AssetDto[] = [];
    let parentId = current.asset.parentAssetId;
    const seen = new Set<string>([assetId]);

    while (parentId && !seen.has(parentId) && ancestors.length < 20) {
      seen.add(parentId);
      const parent = await this.getAssetById(parentId);
      if (!parent) break;
      ancestors.unshift(parent.asset);
      parentId = parent.asset.parentAssetId;
    }

    const childRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.parentAssetId, assetId))
      .orderBy(desc(assets.createdAt));

    const children = childRows.map((c) => this.toAssetDto(c, current.asset.projectSlug));
    return { ancestors, children };
  }

  // --- Universal Reference Resolution ---

  async resolveReference(
    refInput: string,
    defaultProjectSlug?: string,
  ): Promise<ResolvedReferenceResult | null> {
    // Direct UUID lookup fallback
    if (UUID_REGEX.test(refInput.trim())) {
      const assetMatch = await this.getAssetById(refInput.trim());
      if (assetMatch) {
        const project = await this.getProjectByIdOrSlug(assetMatch.asset.projectId);
        if (!project) return null;
        const lineage = (await this.getAssetLineage(assetMatch.asset.id)) ?? undefined;
        return { entityType: 'asset', project, asset: assetMatch.asset, lineage };
      }
      const projMatch = await this.getProjectByIdOrSlug(refInput.trim());
      if (projMatch) {
        return { entityType: 'project', project: projMatch };
      }
      return null;
    }

    const parsed = parseStudioRef(refInput);
    if (!parsed) return null;

    if (parsed.entityType === 'project') {
      const project = await this.getProjectByIdOrSlug(parsed.refCode);
      if (!project) return null;
      return { entityType: 'project', project };
    }

    const targetSlug = parsed.projectSlug ?? defaultProjectSlug;
    if (targetSlug) {
      const project = await this.getProjectByIdOrSlug(targetSlug);
      if (!project) return null;

      const rows = await this.db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.refCode, parsed.refCode)))
        .limit(1);

      const match = rows[0];
      if (!match) return null;

      const assetDto = this.toAssetDto(match, project.slug);
      const lineage = (await this.getAssetLineage(assetDto.id)) ?? undefined;
      return { entityType: 'asset', project, asset: assetDto, lineage };
    }

    // Global lookup by refCode (most recently updated if ambiguous across projects)
    const rows = await this.db
      .select({ asset: assets, projectSlug: projects.slug })
      .from(assets)
      .innerJoin(projects, eq(projects.id, assets.projectId))
      .where(eq(assets.refCode, parsed.refCode))
      .orderBy(desc(assets.updatedAt))
      .limit(1);

    const match = rows[0];
    if (!match) return null;

    const project = await this.getProjectByIdOrSlug(match.asset.projectId);
    if (!project) return null;

    const assetDto = this.toAssetDto(match.asset, match.projectSlug);
    const lineage = (await this.getAssetLineage(assetDto.id)) ?? undefined;
    return { entityType: 'asset', project, asset: assetDto, lineage };
  }

  // --- Activities ---

  async logActivity(params: {
    projectId?: string | null;
    projectSlug?: string | null;
    actor: Actor;
    action: string;
    summary: string;
    entityType?: string | null;
    entityId?: string | null;
    entityRef?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ActivityDto> {
    const [created] = await this.db
      .insert(activities)
      .values({
        projectId: params.projectId ?? null,
        actor: params.actor,
        action: params.action,
        summary: params.summary,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        entityRef: params.entityRef ?? null,
        metadata: params.metadata ?? null,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to log activity');
    }

    const dto: ActivityDto = {
      id: created.id,
      projectId: created.projectId,
      projectSlug: params.projectSlug ?? null,
      actor: created.actor as Actor,
      action: created.action,
      summary: created.summary,
      entityType: created.entityType,
      entityId: created.entityId,
      entityRef: created.entityRef,
      metadata: created.metadata,
      createdAt: created.createdAt.toISOString(),
    };

    this.realtime.broadcast({ type: 'activity.logged', payload: dto });
    return dto;
  }

  async listActivities(projectIdOrSlug?: string, limit = 80): Promise<ActivityDto[]> {
    let projectId: string | undefined;
    if (projectIdOrSlug) {
      const proj = await this.getProjectByIdOrSlug(projectIdOrSlug);
      if (!proj) return [];
      projectId = proj.id;
    }

    const rows = await this.db
      .select({
        activity: activities,
        projectSlug: projects.slug,
      })
      .from(activities)
      .leftJoin(projects, eq(projects.id, activities.projectId))
      .where(projectId ? eq(activities.projectId, projectId) : undefined)
      .orderBy(desc(activities.createdAt))
      .limit(Math.min(limit, 200));

    return rows.map((row) => ({
      id: row.activity.id,
      projectId: row.activity.projectId,
      projectSlug: row.projectSlug ?? null,
      actor: row.activity.actor as Actor,
      action: row.activity.action,
      summary: row.activity.summary,
      entityType: row.activity.entityType,
      entityId: row.activity.entityId,
      entityRef: row.activity.entityRef,
      metadata: row.activity.metadata,
      createdAt: row.activity.createdAt.toISOString(),
    }));
  }

  // --- Live Jobs (Claude generation tracking + optional ComfyUI /history poller) ---

  async startJob(params: {
    projectIdOrSlug: string;
    type: string;
    title: string;
    stepCurrent?: number | null;
    stepTotal?: number | null;
    message?: string;
    comfyPromptIds?: string[];
    etaSeconds?: number | null;
    estimatedCompletionAt?: string | null;
  }): Promise<JobDto> {
    const project = await this.getProjectByIdOrSlug(params.projectIdOrSlug);
    if (!project) throw new Error(`Project not found: ${params.projectIdOrSlug}`);

    const etaDate = resolveEtaDate(params.etaSeconds, params.estimatedCompletionAt);
    const comfyPromptIds = params.comfyPromptIds ?? [];
    const stepTotal = params.stepTotal ?? (comfyPromptIds.length > 0 ? comfyPromptIds.length : null);
    const stepCurrent = params.stepCurrent ?? (comfyPromptIds.length > 0 ? 0 : null);

    const [created] = await this.db
      .insert(jobs)
      .values({
        projectId: project.id,
        type: params.type,
        title: params.title,
        status: 'running',
        progress: 5,
        stepCurrent,
        stepTotal,
        message: params.message ?? '',
        comfyPromptIds,
        etaSeconds: params.etaSeconds ?? null,
        estimatedCompletionAt: etaDate,
      })
      .returning();

    if (!created) throw new Error('Failed to create job');

    const dto = this.toJobDto(created, project.slug);
    this.realtime.broadcast({ type: 'job.updated', payload: dto });

    if (comfyPromptIds.length > 0 && this.comfyuiBaseUrl) {
      this.startComfyJobPoller(dto.id, comfyPromptIds);
    }

    await this.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor: 'claude',
      action: 'job.started',
      summary: `Génération lancée : ${dto.title}${stepTotal ? ` (0/${stepTotal})` : ''}`,
      entityType: 'job',
      entityId: dto.id,
    });

    return dto;
  }

  async updateJob(
    jobId: string,
    patch: {
      status?: JobStatus;
      progress?: number;
      stepCurrent?: number | null;
      stepTotal?: number | null;
      message?: string;
      comfyPromptIds?: string[];
      etaSeconds?: number | null;
      estimatedCompletionAt?: string | null;
      resultAssetId?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<JobDto | null> {
    if (!UUID_REGEX.test(jobId)) return null;

    const etaDate =
      patch.etaSeconds !== undefined || patch.estimatedCompletionAt !== undefined
        ? resolveEtaDate(patch.etaSeconds, patch.estimatedCompletionAt)
        : undefined;

    const computedProgress =
      patch.progress !== undefined
        ? Math.max(0, Math.min(100, patch.progress))
        : patch.stepCurrent != null && patch.stepTotal != null && patch.stepTotal > 0
          ? Math.max(0, Math.min(100, Math.round((patch.stepCurrent / patch.stepTotal) * 100)))
          : undefined;

    const [updated] = await this.db
      .update(jobs)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(computedProgress !== undefined ? { progress: computedProgress } : {}),
        ...(patch.stepCurrent !== undefined ? { stepCurrent: patch.stepCurrent } : {}),
        ...(patch.stepTotal !== undefined ? { stepTotal: patch.stepTotal } : {}),
        ...(patch.message !== undefined ? { message: patch.message } : {}),
        ...(patch.comfyPromptIds !== undefined ? { comfyPromptIds: patch.comfyPromptIds } : {}),
        ...(patch.etaSeconds !== undefined ? { etaSeconds: patch.etaSeconds } : {}),
        ...(etaDate !== undefined ? { estimatedCompletionAt: etaDate } : {}),
        ...(patch.resultAssetId !== undefined ? { resultAssetId: patch.resultAssetId } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    if (!updated) return null;

    if (patch.status === 'completed' || patch.status === 'failed') {
      this.stopComfyJobPoller(jobId);
    }

    const project = await this.getProjectByIdOrSlug(updated.projectId);
    const dto = this.toJobDto(updated, project?.slug ?? 'unknown');
    this.realtime.broadcast({ type: 'job.updated', payload: dto });

    if (patch.status === 'completed' || patch.status === 'failed') {
      this.webhookService?.emit(
        patch.status === 'completed' ? 'job.completed' : 'job.failed',
        updated.projectId,
        {
          jobId: dto.id,
          title: dto.title,
          status: dto.status,
          message: dto.message,
          errorMessage: dto.errorMessage,
          resultAssetId: dto.resultAssetId,
        },
      );
    }

    return dto;
  }

  private startComfyJobPoller(jobId: string, promptIds: string[]): void {
    const baseUrl = this.comfyuiBaseUrl;
    if (!baseUrl || promptIds.length === 0) return;

    this.stopComfyJobPoller(jobId);
    const startedAt = Date.now();
    const maxDurationMs = 60 * 60 * 1000; // 1 hour safety cap

    const timer = setInterval(async () => {
      try {
        if (Date.now() - startedAt > maxDurationMs) {
          this.stopComfyJobPoller(jobId);
          return;
        }

        let completedCount = 0;
        let failedMessage: string | null = null;

        for (const pid of promptIds) {
          const res = await fetch(`${baseUrl}/history/${encodeURIComponent(pid)}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) continue;
          const json = (await res.json()) as Record<
            string,
            { status?: { status_str?: string; completed?: boolean; messages?: unknown[] } }
          >;
          const entry = json[pid];
          if (!entry) continue;
          const statusStr = entry.status?.status_str;
          if (statusStr === 'error') {
            failedMessage = `ComfyUI prompt ${pid} failed`;
            break;
          }
          if (entry.status?.completed || statusStr === 'success') {
            completedCount += 1;
          }
        }

        if (failedMessage) {
          this.stopComfyJobPoller(jobId);
          await this.updateJob(jobId, {
            status: 'failed',
            stepCurrent: completedCount,
            stepTotal: promptIds.length,
            errorMessage: failedMessage,
            message: failedMessage,
            etaSeconds: 0,
          });
          return;
        }

        const progress = Math.round((completedCount / promptIds.length) * 100);
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const remainingEta =
          completedCount > 0 && completedCount < promptIds.length
            ? Math.round((elapsedSec / completedCount) * (promptIds.length - completedCount))
            : null;

        if (completedCount >= promptIds.length) {
          this.stopComfyJobPoller(jobId);
          await this.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            stepCurrent: promptIds.length,
            stepTotal: promptIds.length,
            message: `ComfyUI terminé (${promptIds.length}/${promptIds.length})`,
            etaSeconds: 0,
          });
        } else {
          await this.updateJob(jobId, {
            status: 'running',
            progress: Math.max(5, progress),
            stepCurrent: completedCount,
            stepTotal: promptIds.length,
            message: `ComfyUI ${completedCount}/${promptIds.length}`,
            ...(remainingEta !== null ? { etaSeconds: remainingEta } : {}),
          });
        }
      } catch {
        // Transient network hiccup to ComfyUI — retry next tick
      }
    }, 4000);

    timer.unref();
    this.comfyPollers.set(jobId, timer);
  }

  private stopComfyJobPoller(jobId: string): void {
    const existing = this.comfyPollers.get(jobId);
    if (existing) {
      clearInterval(existing);
      this.comfyPollers.delete(jobId);
    }
  }

  async listJobs(projectIdOrSlug?: string, limit = 30): Promise<JobDto[]> {
    let projectId: string | undefined;
    if (projectIdOrSlug) {
      const proj = await this.getProjectByIdOrSlug(projectIdOrSlug);
      if (!proj) return [];
      projectId = proj.id;
    }

    const rows = await this.db
      .select({ job: jobs, projectSlug: projects.slug })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(projectId ? eq(jobs.projectId, projectId) : undefined)
      .orderBy(desc(jobs.updatedAt))
      .limit(Math.min(limit, 100));

    return rows.map((row) => this.toJobDto(row.job, row.projectSlug));
  }

  // --- Agent Live Task List (Checklist / Plan Sync) ---

  async listAgentTasks(projectIdOrSlug: string): Promise<AgentTaskDto[]> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const rows = await this.db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.projectId, project.id))
      .orderBy(asc(agentTasks.sortOrder), asc(agentTasks.createdAt));

    return rows.map((r) => this.toAgentTaskDto(r));
  }

  async syncAgentTasks(
    projectIdOrSlug: string,
    input: SyncAgentTasksInput,
    actor: Actor = 'claude',
  ): Promise<AgentTaskDto[] | null> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    if (input.replace) {
      await this.db.delete(agentTasks).where(eq(agentTasks.projectId, project.id));

      for (let i = 0; i < input.tasks.length; i += 1) {
        const item = input.tasks[i]!;
        const etaDate = resolveEtaDate(item.etaSeconds, item.estimatedCompletionAt);
        await this.db.insert(agentTasks).values({
          projectId: project.id,
          externalKey: item.key ?? null,
          title: item.title,
          detail: item.detail ?? '',
          status: item.status ?? 'pending',
          progress: item.progress ?? null,
          groupName: item.groupName ?? '',
          assetRef: item.assetRef ?? null,
          etaSeconds: item.etaSeconds ?? null,
          estimatedCompletionAt: etaDate,
          sortOrder: item.sortOrder ?? i,
        });
      }
    } else {
      const existing = await this.db
        .select()
        .from(agentTasks)
        .where(eq(agentTasks.projectId, project.id))
        .orderBy(asc(agentTasks.sortOrder), asc(agentTasks.createdAt));

      const byKey = new Map<string, typeof agentTasks.$inferSelect>();
      let maxOrder = -1;
      for (const row of existing) {
        if (row.externalKey) byKey.set(row.externalKey, row);
        if (row.sortOrder > maxOrder) maxOrder = row.sortOrder;
      }

      for (const item of input.tasks) {
        const match = item.key ? byKey.get(item.key) : undefined;
        const etaDate =
          item.etaSeconds !== undefined || item.estimatedCompletionAt !== undefined
            ? resolveEtaDate(item.etaSeconds, item.estimatedCompletionAt)
            : undefined;
        if (match) {
          await this.db
            .update(agentTasks)
            .set({
              title: item.title,
              detail: item.detail ?? match.detail,
              status: item.status ?? match.status,
              progress: item.progress !== undefined ? item.progress : match.progress,
              groupName: item.groupName ?? match.groupName,
              assetRef: item.assetRef !== undefined ? item.assetRef : match.assetRef,
              ...(item.etaSeconds !== undefined ? { etaSeconds: item.etaSeconds } : {}),
              ...(etaDate !== undefined ? { estimatedCompletionAt: etaDate } : {}),
              sortOrder: item.sortOrder ?? match.sortOrder,
              updatedAt: new Date(),
            })
            .where(eq(agentTasks.id, match.id));
        } else {
          maxOrder += 1;
          await this.db.insert(agentTasks).values({
            projectId: project.id,
            externalKey: item.key ?? null,
            title: item.title,
            detail: item.detail ?? '',
            status: item.status ?? 'pending',
            progress: item.progress ?? null,
            groupName: item.groupName ?? '',
            assetRef: item.assetRef ?? null,
            etaSeconds: item.etaSeconds ?? null,
            estimatedCompletionAt: etaDate ?? null,
            sortOrder: item.sortOrder ?? maxOrder,
          });
        }
      }
    }

    const updatedList = await this.listAgentTasks(project.id);
    this.realtime.broadcast({
      type: 'tasks.changed',
      payload: { projectId: project.id, tasks: updatedList },
    });

    const active = updatedList.find((t) => t.status === 'in_progress');
    if (actor === 'claude' && updatedList.length > 0) {
      await this.logActivity({
        projectId: project.id,
        projectSlug: project.slug,
        actor,
        action: 'tasks.synced',
        summary: active
          ? `Plan Claude (${updatedList.length} tâches) · En cours : ${active.title}`
          : `Plan Claude mis à jour (${updatedList.length} tâches)`,
        entityType: 'project',
        entityId: project.id,
        entityRef: `@proj-${project.slug}`,
      });
    }

    return updatedList;
  }

  async updateAgentTask(
    projectIdOrSlug: string,
    taskIdOrKey: string,
    patch: UpdateAgentTaskInput,
    actor: Actor = 'claude',
  ): Promise<AgentTaskDto | null> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const cond = UUID_REGEX.test(taskIdOrKey)
      ? and(eq(agentTasks.projectId, project.id), eq(agentTasks.id, taskIdOrKey))
      : and(eq(agentTasks.projectId, project.id), eq(agentTasks.externalKey, taskIdOrKey));

    const etaDate =
      patch.etaSeconds !== undefined || patch.estimatedCompletionAt !== undefined
        ? resolveEtaDate(patch.etaSeconds, patch.estimatedCompletionAt)
        : undefined;

    const [updated] = await this.db
      .update(agentTasks)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.progress !== undefined
          ? {
              progress:
                patch.progress === null ? null : Math.max(0, Math.min(100, patch.progress)),
            }
          : {}),
        ...(patch.groupName !== undefined ? { groupName: patch.groupName } : {}),
        ...(patch.assetRef !== undefined ? { assetRef: patch.assetRef } : {}),
        ...(patch.etaSeconds !== undefined ? { etaSeconds: patch.etaSeconds } : {}),
        ...(etaDate !== undefined ? { estimatedCompletionAt: etaDate } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(cond)
      .returning();

    if (!updated) return null;

    const fullList = await this.listAgentTasks(project.id);
    this.realtime.broadcast({
      type: 'tasks.changed',
      payload: { projectId: project.id, tasks: fullList },
    });

    if (actor === 'claude' && (patch.status === 'completed' || patch.status === 'failed')) {
      await this.logActivity({
        projectId: project.id,
        projectSlug: project.slug,
        actor,
        action: `task.${patch.status}`,
        summary: `Tâche ${patch.status === 'completed' ? 'terminée' : 'en échec'} : ${updated.title}`,
        entityType: 'task',
        entityId: updated.id,
        entityRef: updated.assetRef ?? null,
      });
    }

    return this.toAgentTaskDto(updated);
  }

  async clearAgentTasks(
    projectIdOrSlug: string,
    scope: 'completed' | 'all' = 'completed',
  ): Promise<AgentTaskDto[] | null> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    if (scope === 'all') {
      await this.db.delete(agentTasks).where(eq(agentTasks.projectId, project.id));
    } else {
      await this.db
        .delete(agentTasks)
        .where(
          and(
            eq(agentTasks.projectId, project.id),
            inArray(agentTasks.status, ['completed', 'skipped']),
          ),
        );
    }

    const remaining = await this.listAgentTasks(project.id);
    this.realtime.broadcast({
      type: 'tasks.changed',
      payload: { projectId: project.id, tasks: remaining },
    });
    return remaining;
  }

  // --- Helpers ---

  private async attachDefaultRulebooks(projectId: string): Promise<void> {
    try {
      const defaults = await this.db
        .select({ id: rulebooks.id })
        .from(rulebooks)
        .where(eq(rulebooks.isDefault, true));

      for (const book of defaults) {
        await this.db
          .insert(projectRulebookLinks)
          .values({ projectId, rulebookId: book.id })
          .onConflictDoNothing();
      }
    } catch {
      // Safe fallback if rulebooks table is absent in isolated unit tests
    }
  }

  private async ensureUniqueSlug(baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
      const existing = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, candidate))
        .limit(1);

      if (existing.length === 0) {
        return candidate;
      }
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
  }

  private async generateNextRefCode(
    projectId: string,
    type: AssetType,
    versionNumber: number,
  ): Promise<string> {
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(eq(assets.projectId, projectId), eq(assets.type, type)));

    let seq = (countRows[0]?.count ?? 0) + 1;

    while (true) {
      const candidate = formatAssetRefCode(type, seq, versionNumber);
      const exists = await this.db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.projectId, projectId), eq(assets.refCode, candidate)))
        .limit(1);

      if (exists.length === 0) {
        return candidate;
      }
      seq += 1;
    }
  }

  private toProjectDto(row: typeof projects.$inferSelect, assetCount: number): ProjectDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      type: row.type as ProjectType,
      aspectRatio: row.aspectRatio,
      fps: row.fps,
      targetResolution: row.targetResolution,
      status: row.status as ProjectStatus,
      localPath: row.localPath ?? '',
      assetCount,
      uri: buildStudioUri(row.slug, 'project'),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toAssetDto(row: typeof assets.$inferSelect, projectSlug: string): AssetDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectSlug,
      refCode: row.refCode,
      handle: buildAssetHandle(row.refCode),
      uri: buildStudioUri(projectSlug, 'asset', row.refCode),
      folderPath: row.folderPath ?? '',
      title: row.title,
      type: row.type as AssetType,
      status: row.status as AssetStatus,
      qualityTier: row.qualityTier as QualityTier,
      rating: row.rating,
      parentAssetId: row.parentAssetId,
      relationType: (row.relationType ?? 'revision') as AssetRelationType,
      versionNumber: row.versionNumber,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      fileSize: Number(row.fileSize),
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      fps: row.fps,
      promptUsed: row.promptUsed,
      negativePrompt: row.negativePrompt,
      modelName: row.modelName,
      seed: row.seed,
      comfyMetadata: row.comfyMetadata,
      tags: row.tags ?? [],
      notes: row.notes,
      qcChecks: row.qcChecks ?? {},
      qcStatus: (row.qcStatus ?? 'pending') as QcOverallStatus,
      qcNotes: row.qcNotes ?? '',
      createdBy: row.createdBy as Actor,
      urls: {
        original: `/api/media/${row.id}/original`,
        proxy: row.proxyPath ? `/api/media/${row.id}/proxy` : null,
        thumbnail: row.thumbnailPath ? `/api/media/${row.id}/thumbnail` : null,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toJobDto(row: typeof jobs.$inferSelect, projectSlug: string): JobDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectSlug,
      type: row.type,
      title: row.title,
      status: row.status as JobStatus,
      progress: row.progress,
      stepCurrent: row.stepCurrent ?? null,
      stepTotal: row.stepTotal ?? null,
      message: row.message ?? '',
      comfyPromptIds: row.comfyPromptIds ?? [],
      etaSeconds: row.etaSeconds ?? null,
      estimatedCompletionAt: row.estimatedCompletionAt
        ? row.estimatedCompletionAt.toISOString()
        : null,
      resultAssetId: row.resultAssetId,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toAgentTaskDto(row: typeof agentTasks.$inferSelect): AgentTaskDto {
    return {
      id: row.id,
      projectId: row.projectId,
      externalKey: row.externalKey,
      title: row.title,
      detail: row.detail,
      status: row.status as AgentTaskStatus,
      progress: row.progress,
      groupName: row.groupName,
      assetRef: row.assetRef,
      etaSeconds: row.etaSeconds ?? null,
      estimatedCompletionAt: row.estimatedCompletionAt
        ? row.estimatedCompletionAt.toISOString()
        : null,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function resolveEtaDate(
  etaSeconds?: number | null,
  estimatedCompletionAt?: string | null,
): Date | null {
  if (estimatedCompletionAt) {
    const parsed = new Date(estimatedCompletionAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof etaSeconds === 'number' && Number.isFinite(etaSeconds)) {
    if (etaSeconds <= 0) return new Date();
    return new Date(Date.now() + etaSeconds * 1000);
  }
  return null;
}

function computeQcStatus(checks: Record<string, QcCheckValue>): QcOverallStatus {
  const values = Object.values(checks);
  if (values.length === 0) return 'pending';
  if (values.includes('fail')) return 'fail';
  if (values.includes('warn')) return 'warn';
  if (values.includes('ok')) return 'pass';
  return 'pending';
}

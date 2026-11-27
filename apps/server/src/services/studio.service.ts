import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  buildAssetHandle,
  buildStudioUri,
  formatAssetRefCode,
  parseStudioRef,
  slugifyProjectName,
  type ActivityDto,
  type Actor,
  type AssetDto,
  type AssetStatus,
  type AssetType,
  type CreateProjectInput,
  type JobDto,
  type JobStatus,
  type ProjectDto,
  type ProjectStatus,
  type ProjectType,
  type QualityTier,
  type UpdateAssetInput,
  type UpdateProjectInput,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { activities, assets, jobs, projects } from '../db/schema.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ListAssetsFilter {
  type?: AssetType;
  status?: AssetStatus;
  qualityTier?: QualityTier;
  tag?: string;
  search?: string;
  limit?: number;
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
  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
  ) {}

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
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create project');
    }

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

  // --- Assets ---

  async listAssets(projectIdOrSlug: string, filter: ListAssetsFilter = {}): Promise<AssetDto[]> {
    const project = await this.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const conditions = [eq(assets.projectId, project.id)];
    if (filter.type) conditions.push(eq(assets.type, filter.type));
    if (filter.status) conditions.push(eq(assets.status, filter.status));
    if (filter.qualityTier) conditions.push(eq(assets.qualityTier, filter.qualityTier));
    if (filter.search) {
      const pattern = `%${filter.search.trim()}%`;
      const searchCond = or(
        ilike(assets.title, pattern),
        ilike(assets.refCode, pattern),
        ilike(assets.promptUsed, pattern),
        ilike(assets.notes, pattern),
      );
      if (searchCond) conditions.push(searchCond);
    }

    const rows = await this.db
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(desc(assets.createdAt))
      .limit(filter.limit ?? 200);

    let mapped = rows.map((row) => this.toAssetDto(row, project.slug));
    if (filter.tag) {
      const targetTag = filter.tag.toLowerCase();
      mapped = mapped.filter((a) => a.tags.some((t) => t.toLowerCase() === targetTag));
    }
    return mapped;
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
    title?: string;
    qualityTier?: QualityTier;
    status?: AssetStatus;
    parentAssetId?: string;
    parentRef?: string;
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

    const processed = await this.media.storeAndProcessMedia({
      projectSlug: project.slug,
      buffer: params.buffer,
      filename: params.filename,
      mimeType: params.mimeType,
      explicitType: params.explicitType,
    });

    // Resolve optional parent asset (for version stacking & Draft -> HQ linking)
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
        versionNumber = parentInfo.asset.versionNumber + 1;
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
        title,
        type: processed.type,
        status: params.status ?? 'new',
        qualityTier: params.qualityTier ?? 'test',
        parentAssetId: resolvedParentId,
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

    const actor = params.createdBy ?? 'claude';
    await this.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'asset.created',
      summary: `${dto.type.toUpperCase()} ajouté : ${dto.title} (${dto.handle})`,
      entityType: 'asset',
      entityId: dto.id,
      entityRef: dto.handle,
      metadata: {
        qualityTier: dto.qualityTier,
        hasComfyMetadata: Boolean(dto.comfyMetadata),
        versionNumber: dto.versionNumber,
      },
    });

    return dto;
  }

  async updateAsset(
    assetId: string,
    input: UpdateAssetInput,
    actor: Actor = 'user',
  ): Promise<AssetDto | null> {
    const existing = await this.getAssetById(assetId);
    if (!existing) return null;

    const [updated] = await this.db
      .update(assets)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.qualityTier !== undefined ? { qualityTier: input.qualityTier } : {}),
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

  // --- Live Jobs (Claude generation tracking) ---

  async startJob(params: {
    projectIdOrSlug: string;
    type: string;
    title: string;
  }): Promise<JobDto> {
    const project = await this.getProjectByIdOrSlug(params.projectIdOrSlug);
    if (!project) throw new Error(`Project not found: ${params.projectIdOrSlug}`);

    const [created] = await this.db
      .insert(jobs)
      .values({
        projectId: project.id,
        type: params.type,
        title: params.title,
        status: 'running',
        progress: 5,
      })
      .returning();

    if (!created) throw new Error('Failed to create job');

    const dto = this.toJobDto(created, project.slug);
    this.realtime.broadcast({ type: 'job.updated', payload: dto });

    await this.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor: 'claude',
      action: 'job.started',
      summary: `Génération lancée : ${dto.title}`,
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
      resultAssetId?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<JobDto | null> {
    if (!UUID_REGEX.test(jobId)) return null;

    const [updated] = await this.db
      .update(jobs)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.progress !== undefined ? { progress: Math.max(0, Math.min(100, patch.progress)) } : {}),
        ...(patch.resultAssetId !== undefined ? { resultAssetId: patch.resultAssetId } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    if (!updated) return null;

    const project = await this.getProjectByIdOrSlug(updated.projectId);
    const dto = this.toJobDto(updated, project?.slug ?? 'unknown');
    this.realtime.broadcast({ type: 'job.updated', payload: dto });
    return dto;
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

  // --- Helpers ---

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
      title: row.title,
      type: row.type as AssetType,
      status: row.status as AssetStatus,
      qualityTier: row.qualityTier as QualityTier,
      rating: row.rating,
      parentAssetId: row.parentAssetId,
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
      resultAssetId: row.resultAssetId,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

import { desc, eq } from 'drizzle-orm';
import {
  buildAssetHandle,
  generateAiDirectorBrief,
  normalizeFolderPath,
  slugifyProjectName,
  type Actor,
  type SaveSketchInput,
  type SketchDto,
  type SketchMode,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { assets, projects, sketches } from '../db/schema.js';
import type { RealtimeHub } from './realtime.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodePngBase64(input: string): Buffer {
  const trimmed = input.trim();
  const base64Part = trimmed.startsWith('data:')
    ? trimmed.slice(trimmed.indexOf(',') + 1)
    : trimmed;
  const buf = Buffer.from(base64Part, 'base64');
  if (buf.length < 32) {
    throw new Error('Image PNG invalide ou vide');
  }
  return buf;
}

function buildSketchTags(mode: SketchMode, extra?: string[]): string[] {
  const base = ['sketch', mode === 'scene_plan' ? 'plan-scene' : 'croquis'];
  const merged = new Set<string>(base);
  for (const tag of extra ?? []) {
    const clean = tag.trim();
    if (clean) merged.add(clean);
  }
  return [...merged];
}

export class SketchService {
  constructor(
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly realtime: RealtimeHub,
  ) {}

  private toDto(
    row: typeof sketches.$inferSelect,
    projectSlug: string,
    linkedAsset?: {
      id: string;
      refCode: string;
      thumbnailPath: string | null;
    } | null,
  ): SketchDto {
    const assetRef = linkedAsset?.refCode ?? null;
    return {
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId ?? null,
      assetRef,
      assetHandle: assetRef ? buildAssetHandle(`${projectSlug}/${assetRef}`) : null,
      assetUrl: linkedAsset ? `/api/assets/${linkedAsset.id}/file` : null,
      assetThumbnailUrl: linkedAsset
        ? linkedAsset.thumbnailPath
          ? `/api/assets/${linkedAsset.id}/thumb`
          : `/api/assets/${linkedAsset.id}/file`
        : null,
      shotId: row.shotId ?? null,
      title: row.title,
      mode: (row.mode === 'storyboard_sketch' ? 'storyboard_sketch' : 'scene_plan') as SketchMode,
      aspectRatio: row.aspectRatio,
      folderPath: row.folderPath,
      sceneData: row.sceneData,
      aiDirectorBrief: row.aiDirectorBrief,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listSketches(projectIdOrSlug: string): Promise<SketchDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const rows = await this.db
      .select({
        sketch: sketches,
        assetId: assets.id,
        assetRefCode: assets.refCode,
        assetThumb: assets.thumbnailPath,
      })
      .from(sketches)
      .leftJoin(assets, eq(assets.id, sketches.assetId))
      .where(eq(sketches.projectId, project.id))
      .orderBy(desc(sketches.updatedAt));

    return rows.map((r) =>
      this.toDto(
        r.sketch,
        project.slug,
        r.assetId && r.assetRefCode
          ? { id: r.assetId, refCode: r.assetRefCode, thumbnailPath: r.assetThumb }
          : null,
      ),
    );
  }

  async getSketchById(sketchId: string): Promise<SketchDto | null> {
    if (!UUID_REGEX.test(sketchId)) return null;

    const rows = await this.db
      .select({
        sketch: sketches,
        projectSlug: projects.slug,
        assetId: assets.id,
        assetRefCode: assets.refCode,
        assetThumb: assets.thumbnailPath,
      })
      .from(sketches)
      .innerJoin(projects, eq(projects.id, sketches.projectId))
      .leftJoin(assets, eq(assets.id, sketches.assetId))
      .where(eq(sketches.id, sketchId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return this.toDto(
      row.sketch,
      row.projectSlug,
      row.assetId && row.assetRefCode
        ? { id: row.assetId, refCode: row.assetRefCode, thumbnailPath: row.assetThumb }
        : null,
    );
  }

  async getSketchByAssetId(assetId: string): Promise<SketchDto | null> {
    if (!UUID_REGEX.test(assetId)) return null;

    const directRows = await this.db
      .select({ id: sketches.id })
      .from(sketches)
      .where(eq(sketches.assetId, assetId))
      .limit(1);

    if (directRows[0]) {
      return this.getSketchById(directRows[0].id);
    }

    // If user selected an older revision (v1) whose descendant (v2/v3) is currently linked to a sketch,
    // check child assets in the lineage so older versions can also reopen the editable sketch.
    const lineage = await this.studio.getAssetLineage(assetId);
    if (lineage) {
      for (const child of lineage.children) {
        const match = await this.db
          .select({ id: sketches.id })
          .from(sketches)
          .where(eq(sketches.assetId, child.id))
          .limit(1);
        if (match[0]) {
          return this.getSketchById(match[0].id);
        }
      }
    }

    return null;
  }

  async createSketch(
    projectIdOrSlug: string,
    input: SaveSketchInput,
    actor: Actor = 'user',
  ): Promise<SketchDto> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${projectIdOrSlug}`);
    }

    const mode: SketchMode = input.mode ?? 'scene_plan';
    const aspectRatio = input.aspectRatio || project.aspectRatio || '16:9';
    const folderPath = normalizeFolderPath(
      input.folderPath !== undefined
        ? input.folderPath
        : mode === 'scene_plan'
          ? 'plans'
          : 'croquis',
    );
    const aiDirectorBrief =
      input.aiDirectorBrief?.trim() ||
      generateAiDirectorBrief(input.sceneData, {
        title: input.title,
        mode,
        aspectRatio,
      });

    let linkedAssetId: string | null = null;
    if (input.pngBase64) {
      const buffer = decodePngBase64(input.pngBase64);
      const safeName = slugifyProjectName(input.title) || 'croquis';
      const asset = await this.studio.ingestAssetFromBuffer({
        projectIdOrSlug: project.id,
        buffer,
        filename: `${safeName}.png`,
        mimeType: 'image/png',
        explicitType: 'image',
        folderPath,
        title: input.title.trim(),
        qualityTier: 'draft_lowres',
        status: 'in_review',
        promptUsed: aiDirectorBrief,
        notes: aiDirectorBrief,
        tags: buildSketchTags(mode, input.tags),
        createdBy: actor,
      });
      linkedAssetId = asset.id;
    }

    const inserted = await this.db
      .insert(sketches)
      .values({
        projectId: project.id,
        assetId: linkedAssetId,
        shotId: input.shotId ?? null,
        title: input.title.trim(),
        mode,
        aspectRatio,
        folderPath,
        sceneData: input.sceneData,
        aiDirectorBrief,
      })
      .returning();

    const row = inserted[0]!;
    await this.studio.logActivity({
      projectId: project.id,
      actor,
      action: 'sketch.created',
      summary: `${mode === 'scene_plan' ? 'Plan de scène' : 'Croquis'} « ${row.title} » enregistré${linkedAssetId ? ' dans Médias' : ''}`,
      entityType: 'sketch',
      entityId: row.id,
    });
    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: project.id, sketchId: row.id },
    });

    const dto = await this.getSketchById(row.id);
    if (!dto) throw new Error('Failed to load created sketch');
    return dto;
  }

  async updateSketch(
    sketchId: string,
    input: SaveSketchInput,
    actor: Actor = 'user',
  ): Promise<SketchDto | null> {
    if (!UUID_REGEX.test(sketchId)) return null;

    const existingRows = await this.db
      .select()
      .from(sketches)
      .where(eq(sketches.id, sketchId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return null;

    const mode: SketchMode = input.mode ?? (existing.mode as SketchMode);
    const aspectRatio = input.aspectRatio || existing.aspectRatio || '16:9';
    const folderPath = normalizeFolderPath(
      input.folderPath !== undefined ? input.folderPath : existing.folderPath,
    );
    const aiDirectorBrief =
      input.aiDirectorBrief?.trim() ||
      generateAiDirectorBrief(input.sceneData, {
        title: input.title,
        mode,
        aspectRatio,
      });

    let nextAssetId = existing.assetId;
    if (input.pngBase64) {
      const buffer = decodePngBase64(input.pngBase64);
      const safeName = slugifyProjectName(input.title) || 'croquis';
      const createdAsset = await this.studio.ingestAssetFromBuffer({
        projectIdOrSlug: existing.projectId,
        buffer,
        filename: `${safeName}.png`,
        mimeType: 'image/png',
        explicitType: 'image',
        folderPath,
        title: input.title.trim(),
        qualityTier: 'draft_lowres',
        status: 'in_review',
        parentAssetId:
          input.saveMode === 'new_version' && existing.assetId ? existing.assetId : undefined,
        relationType: 'revision',
        promptUsed: aiDirectorBrief,
        notes: aiDirectorBrief,
        tags: buildSketchTags(mode, input.tags),
        createdBy: actor,
      });
      const previousAssetId = existing.assetId;
      nextAssetId = createdAsset.id;

      // In 'replace' mode, remove superseded PNG asset once the replacement is safely persisted
      if (input.saveMode === 'replace' && previousAssetId && previousAssetId !== createdAsset.id) {
        await this.db
          .update(sketches)
          .set({ assetId: nextAssetId })
          .where(eq(sketches.id, existing.id));
        await this.studio.deleteAsset(previousAssetId, actor).catch(() => {});
      }
    } else if (existing.assetId) {
      await this.studio.updateAsset(
        existing.assetId,
        {
          title: input.title.trim(),
          folderPath,
          notes: aiDirectorBrief,
        },
        actor,
      );
    }

    await this.db
      .update(sketches)
      .set({
        assetId: nextAssetId,
        shotId: input.shotId !== undefined ? input.shotId : existing.shotId,
        title: input.title.trim(),
        mode,
        aspectRatio,
        folderPath,
        sceneData: input.sceneData,
        aiDirectorBrief,
        updatedAt: new Date(),
      })
      .where(eq(sketches.id, existing.id));

    await this.studio.logActivity({
      projectId: existing.projectId,
      actor,
      action: 'sketch.updated',
      summary: `${mode === 'scene_plan' ? 'Plan de scène' : 'Croquis'} « ${input.title.trim()} » mis à jour`,
      entityType: 'sketch',
      entityId: existing.id,
    });
    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: existing.projectId, sketchId: existing.id },
    });

    return this.getSketchById(existing.id);
  }

  async deleteSketch(
    sketchId: string,
    opts: { deleteLinkedAsset?: boolean; actor?: Actor } = {},
  ): Promise<boolean> {
    if (!UUID_REGEX.test(sketchId)) return false;

    const existingRows = await this.db
      .select()
      .from(sketches)
      .where(eq(sketches.id, sketchId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return false;

    await this.db.delete(sketches).where(eq(sketches.id, sketchId));

    if (opts.deleteLinkedAsset && existing.assetId) {
      await this.studio.deleteAsset(existing.assetId, opts.actor ?? 'user').catch(() => {});
    }

    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: existing.projectId, sketchId: existing.id },
    });
    return true;
  }
}

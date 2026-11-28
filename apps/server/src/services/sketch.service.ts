import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  buildAssetHandle,
  CAMERA_MOVEMENT_LABELS,
  generateAiDirectorBrief,
  normalizeFolderPath,
  slugifyProjectName,
  sortSketchesForBoard,
  type Actor,
  type LinkSketchToShotInput,
  type ReorderSketchBoardInput,
  type SaveSketchInput,
  type SketchDto,
  type SketchMode,
  type SyncSketchBoardToStoryboardInput,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { assets, projects, scenes, shots, sketches } from '../db/schema.js';
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

function summarizeCameraMovement(sketch: typeof sketches.$inferSelect): string {
  const cam = sketch.sceneData.cameras[0];
  if (!cam) return '';
  const move = CAMERA_MOVEMENT_LABELS[cam.movement] ?? cam.movement;
  return `${cam.shotSize} · ${cam.focalMm}mm · ${move}`;
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
    linkedShot?: {
      id: string;
      title: string;
      shotCode: string;
      sceneId: string;
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
      shotTitle: linkedShot?.title ?? null,
      shotHandle: linkedShot ? `@${linkedShot.shotCode}` : null,
      sceneId: linkedShot?.sceneId ?? null,
      inSketchBoard: row.inSketchBoard,
      boardOrder: row.boardOrder,
      durationSec: row.durationSec,
      caption: row.caption,
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

  private async nextShotCode(projectId: string): Promise<string> {
    const existing = await this.db
      .select({ shotCode: shots.shotCode })
      .from(shots)
      .where(eq(shots.projectId, projectId));
    let maxNum = 0;
    for (const row of existing) {
      const m = /(\d+)$/.exec(row.shotCode);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }
    }
    return `shot-${String(maxNum + 1).padStart(3, '0')}`;
  }

  private async syncLinkedShotKeyframe(
    projectId: string,
    shotId: string | null | undefined,
    assetId: string | null | undefined,
  ): Promise<void> {
    if (!shotId || !assetId || !UUID_REGEX.test(shotId)) return;
    await this.db
      .update(shots)
      .set({ keyframeAssetId: assetId, updatedAt: new Date() })
      .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId, domain: 'storyboard' },
    });
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
        shotId: shots.id,
        shotTitle: shots.title,
        shotCode: shots.shotCode,
        shotSceneId: shots.sceneId,
      })
      .from(sketches)
      .leftJoin(assets, eq(assets.id, sketches.assetId))
      .leftJoin(shots, eq(shots.id, sketches.shotId))
      .where(eq(sketches.projectId, project.id))
      .orderBy(asc(sketches.boardOrder), desc(sketches.updatedAt));

    return rows.map((r) =>
      this.toDto(
        r.sketch,
        project.slug,
        r.assetId && r.assetRefCode
          ? { id: r.assetId, refCode: r.assetRefCode, thumbnailPath: r.assetThumb }
          : null,
        r.shotId && r.shotTitle && r.shotCode && r.shotSceneId
          ? {
              id: r.shotId,
              title: r.shotTitle,
              shotCode: r.shotCode,
              sceneId: r.shotSceneId,
            }
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
        shotId: shots.id,
        shotTitle: shots.title,
        shotCode: shots.shotCode,
        shotSceneId: shots.sceneId,
      })
      .from(sketches)
      .innerJoin(projects, eq(projects.id, sketches.projectId))
      .leftJoin(assets, eq(assets.id, sketches.assetId))
      .leftJoin(shots, eq(shots.id, sketches.shotId))
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
      row.shotId && row.shotTitle && row.shotCode && row.shotSceneId
        ? {
            id: row.shotId,
            title: row.shotTitle,
            shotCode: row.shotCode,
            sceneId: row.shotSceneId,
          }
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

    // Compute next boardOrder so new sketches append neatly at the end of the Sketch Storyboard
    let nextOrder = input.boardOrder;
    if (nextOrder === undefined) {
      const maxRows = await this.db
        .select({ maxOrder: sql<number>`coalesce(max(${sketches.boardOrder}), -1)::int` })
        .from(sketches)
        .where(eq(sketches.projectId, project.id));
      nextOrder = (maxRows[0]?.maxOrder ?? -1) + 1;
    }

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
        notes: input.caption?.trim() ? `${input.caption.trim()}\n\n${aiDirectorBrief}` : aiDirectorBrief,
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
        inSketchBoard: input.inSketchBoard ?? true,
        boardOrder: nextOrder,
        durationSec: input.durationSec ?? 3,
        caption: input.caption?.trim() ?? '',
        title: input.title.trim(),
        mode,
        aspectRatio,
        folderPath,
        sceneData: input.sceneData,
        aiDirectorBrief,
      })
      .returning();

    const row = inserted[0]!;
    if (row.shotId && linkedAssetId) {
      await this.syncLinkedShotKeyframe(project.id, row.shotId, linkedAssetId);
    }

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
    const caption = input.caption !== undefined ? input.caption.trim() : existing.caption;
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
        notes: caption ? `${caption}\n\n${aiDirectorBrief}` : aiDirectorBrief,
        tags: buildSketchTags(mode, input.tags),
        createdBy: actor,
      });
      const previousAssetId = existing.assetId;
      nextAssetId = createdAsset.id;

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
          notes: caption ? `${caption}\n\n${aiDirectorBrief}` : aiDirectorBrief,
        },
        actor,
      );
    }

    const nextShotId = input.shotId !== undefined ? input.shotId : existing.shotId;

    await this.db
      .update(sketches)
      .set({
        assetId: nextAssetId,
        shotId: nextShotId,
        inSketchBoard:
          input.inSketchBoard !== undefined ? input.inSketchBoard : existing.inSketchBoard,
        boardOrder: input.boardOrder !== undefined ? input.boardOrder : existing.boardOrder,
        durationSec: input.durationSec !== undefined ? input.durationSec : existing.durationSec,
        caption,
        title: input.title.trim(),
        mode,
        aspectRatio,
        folderPath,
        sceneData: input.sceneData,
        aiDirectorBrief,
        updatedAt: new Date(),
      })
      .where(eq(sketches.id, existing.id));

    if (nextShotId && nextAssetId) {
      await this.syncLinkedShotKeyframe(existing.projectId, nextShotId, nextAssetId);
    }

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

  async reorderSketchBoard(
    projectIdOrSlug: string,
    input: ReorderSketchBoardInput,
  ): Promise<SketchDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${projectIdOrSlug}`);
    }

    for (let i = 0; i < input.items.length; i += 1) {
      const item = input.items[i]!;
      const patch: Partial<typeof sketches.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (item.inSketchBoard !== undefined) patch.inSketchBoard = item.inSketchBoard;
      if (item.boardOrder !== undefined) patch.boardOrder = item.boardOrder;
      if (item.durationSec !== undefined) patch.durationSec = item.durationSec;
      if (item.caption !== undefined) patch.caption = item.caption.trim();

      await this.db
        .update(sketches)
        .set(patch)
        .where(and(eq(sketches.id, item.sketchId), eq(sketches.projectId, project.id)));
    }

    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: project.id },
    });

    return this.listSketches(project.id);
  }

  private async ensureTargetScene(
    projectId: string,
    sceneId?: string,
    newSceneTitle = 'Storyboard Croquis',
  ): Promise<typeof scenes.$inferSelect> {
    if (sceneId && UUID_REGEX.test(sceneId)) {
      const found = await this.db
        .select()
        .from(scenes)
        .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)))
        .limit(1);
      if (found[0]) return found[0];
    }

    const existingScenes = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(asc(scenes.sortOrder), asc(scenes.sceneNumber));

    if (!sceneId && existingScenes.length > 0 && !newSceneTitle) {
      return existingScenes[0]!;
    }

    const nextNum =
      existingScenes.reduce((acc, s) => Math.max(acc, s.sceneNumber), 0) + 1;
    const inserted = await this.db
      .insert(scenes)
      .values({
        projectId,
        sceneNumber: nextNum,
        title: newSceneTitle.trim() || `Scène ${nextNum}`,
        summary: 'Scène liée au Storyboard Croquis',
        locationRef: '',
        sortOrder: existingScenes.length,
      })
      .returning();
    return inserted[0]!;
  }

  async linkSketchToShot(
    sketchId: string,
    input: LinkSketchToShotInput,
    actor: Actor = 'user',
  ): Promise<SketchDto | null> {
    if (!UUID_REGEX.test(sketchId)) return null;

    const existingRows = await this.db
      .select()
      .from(sketches)
      .where(eq(sketches.id, sketchId))
      .limit(1);
    const sketch = existingRows[0];
    if (!sketch) return null;

    // Unlink explicitly
    if (input.shotId === null && !input.createShotInSceneId && !input.newSceneTitle) {
      await this.db
        .update(sketches)
        .set({ shotId: null, updatedAt: new Date() })
        .where(eq(sketches.id, sketch.id));
      this.realtime.broadcast({
        type: 'sketches.changed',
        payload: { projectId: sketch.projectId, sketchId: sketch.id },
      });
      return this.getSketchById(sketch.id);
    }

    let targetShotId: string;

    if (input.shotId) {
      const shotRows = await this.db
        .select()
        .from(shots)
        .where(and(eq(shots.id, input.shotId), eq(shots.projectId, sketch.projectId)))
        .limit(1);
      const existingShot = shotRows[0];
      if (!existingShot) {
        throw new Error(`Shot not found in project: ${input.shotId}`);
      }
      targetShotId = existingShot.id;

      const shotPatch: Partial<typeof shots.$inferInsert> = { updatedAt: new Date() };
      if (input.syncKeyframe && sketch.assetId) {
        shotPatch.keyframeAssetId = sketch.assetId;
      }
      if (input.syncBrief) {
        if (!existingShot.visualDescription && sketch.caption) {
          shotPatch.visualDescription = sketch.caption;
        }
        if (!existingShot.prompt && sketch.aiDirectorBrief) {
          shotPatch.prompt = sketch.aiDirectorBrief;
        }
        const camSummary = summarizeCameraMovement(sketch);
        if (!existingShot.cameraMovement && camSummary) {
          shotPatch.cameraMovement = camSummary;
        }
      }
      await this.db.update(shots).set(shotPatch).where(eq(shots.id, existingShot.id));
    } else {
      // Create a brand new shot inside the specified scene (or auto-create scene)
      const targetScene = await this.ensureTargetScene(
        sketch.projectId,
        input.createShotInSceneId,
        input.newSceneTitle || 'Storyboard Croquis',
      );
      const countRows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(shots)
        .where(eq(shots.sceneId, targetScene.id));
      const sortOrder = countRows[0]?.count ?? 0;
      const shotCode = await this.nextShotCode(sketch.projectId);

      const createdShot = await this.db
        .insert(shots)
        .values({
          sceneId: targetScene.id,
          projectId: sketch.projectId,
          shotCode,
          title: sketch.title,
          visualDescription: sketch.caption || '',
          cameraMovement: summarizeCameraMovement(sketch),
          dialogue: '',
          prompt: input.syncBrief ? sketch.aiDirectorBrief : '',
          durationSec: sketch.durationSec || 3,
          status: 'planned',
          keyframeAssetId: input.syncKeyframe ? sketch.assetId : null,
          bibleEntityRefs: [],
          sortOrder,
        })
        .returning();
      targetShotId = createdShot[0]!.id;
    }

    await this.db
      .update(sketches)
      .set({ shotId: targetShotId, updatedAt: new Date() })
      .where(eq(sketches.id, sketch.id));

    await this.studio.logActivity({
      projectId: sketch.projectId,
      actor,
      action: 'sketch.linked_to_storyboard',
      summary: `Croquis « ${sketch.title} » lié au Storyboard Pré-prod`,
      entityType: 'sketch',
      entityId: sketch.id,
    });

    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: sketch.projectId, sketchId: sketch.id },
    });
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: sketch.projectId, domain: 'storyboard' },
    });

    return this.getSketchById(sketch.id);
  }

  async syncSketchBoardToStoryboard(
    projectIdOrSlug: string,
    input: SyncSketchBoardToStoryboardInput,
    actor: Actor = 'user',
  ): Promise<{
    sceneId: string;
    sceneTitle: string;
    createdCount: number;
    updatedCount: number;
    sketches: SketchDto[];
  }> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${projectIdOrSlug}`);
    }

    const all = await this.listSketches(project.id);
    const boardSketches = input.sketchIds?.length
      ? input.sketchIds
          .map((id) => all.find((s) => s.id === id))
          .filter((s): s is SketchDto => Boolean(s))
      : sortSketchesForBoard(all);

    const targetScene = await this.ensureTargetScene(
      project.id,
      input.sceneId,
      input.newSceneTitle || 'Storyboard Croquis',
    );

    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < boardSketches.length; i += 1) {
      const sk = boardSketches[i]!;
      if (sk.shotId) {
        await this.db
          .update(shots)
          .set({
            keyframeAssetId: sk.assetId ?? undefined,
            durationSec: sk.durationSec,
            visualDescription: sk.caption || undefined,
            updatedAt: new Date(),
          })
          .where(and(eq(shots.id, sk.shotId), eq(shots.projectId, project.id)));
        updatedCount += 1;
      } else {
        await this.linkSketchToShot(
          sk.id,
          {
            createShotInSceneId: targetScene.id,
            syncKeyframe: true,
            syncBrief: true,
          },
          actor,
        );
        createdCount += 1;
      }
    }

    await this.studio.logActivity({
      projectId: project.id,
      actor,
      action: 'sketch_board.synced_to_storyboard',
      summary: `Storyboard Croquis synchronisé vers Pré-prod (${createdCount} créé(s), ${updatedCount} mis à jour)`,
      entityType: 'scene',
      entityId: targetScene.id,
    });

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'storyboard' },
    });
    this.realtime.broadcast({
      type: 'sketches.changed',
      payload: { projectId: project.id },
    });

    return {
      sceneId: targetScene.id,
      sceneTitle: targetScene.title,
      createdCount,
      updatedCount,
      sketches: await this.listSketches(project.id),
    };
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

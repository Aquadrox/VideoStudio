import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  formatYoutubeChapters,
  lrcToSrt,
  selectInjectableRuleFragments,
  slugifyProjectName,
  sunoAlignmentToEnhancedLrc,
  type Actor,
  type AudioCategory,
  type AudioTrackDto,
  type BibleEntityDto,
  type BibleEntityType,
  type ChecklistItem,
  type CommitProjectRepoInput,
  type ConfigureProjectRepoInput,
  type CreateSceneInput,
  type CreateShotInput,
  type ProjectRepoStatusDto,
  type ProjectScriptDto,
  type SceneDto,
  type ShotDto,
  type ShotStatus,
  type UpdateScriptInput,
  type UpdateShotInput,
  type UpdateYouTubePackageInput,
  type UpsertAudioTrackInput,
  type UpsertBibleEntityInput,
  type UpsertStoryboardInput,
  type YouTubePackageDto,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import {
  audioTracks,
  bibleEntities,
  projectRepos,
  projectScripts,
  scenes,
  scriptVersions,
  shots,
  youtubePackages,
} from '../db/schema.js';
import { resolveSafePath } from '../utils/security.js';
import type { MediaService } from './media.service.js';
import type { ProjectGitService } from './project-git.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { Stage2Service } from './stage2.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_YT_CHECKLIST: ChecklistItem[] = [
  { id: 'chk-1', label: 'Vidéo finale haute résolution vérifiée (audio & synchro)', done: false },
  { id: 'chk-2', label: 'Miniatures A/B (1280×720, < 2 Mo, zone durée lisible)', done: false },
  { id: 'chk-3', label: 'Titres A/B vérifiés (< 60 caractères mobile)', done: false },
  { id: 'chk-4', label: 'Description, chapitres (00:00) et crédits prêts', done: false },
  { id: 'chk-5', label: 'Sous-titres .srt et mention IA vérifiés', done: false },
];

const BIBLE_PREFIX: Record<BibleEntityType, string> = {
  character: 'char',
  location: 'loc',
  prop: 'prop',
  style: 'style',
};

export class Stage3Service {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly stage2: Stage2Service,
    private readonly media: MediaService,
    private readonly git: ProjectGitService,
    private readonly realtime: RealtimeHub,
  ) {}

  // ==========================================================================
  // 1. Versioned Scripts
  // ==========================================================================

  async getProjectScript(projectIdOrSlug: string): Promise<ProjectScriptDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    let rows = await this.db
      .select()
      .from(projectScripts)
      .where(eq(projectScripts.projectId, project.id))
      .limit(1);

    let script = rows[0];
    if (!script) {
      const [created] = await this.db
        .insert(projectScripts)
        .values({
          projectId: project.id,
          title: `Scénario — ${project.name}`,
          content: `# ${project.name}\n\n## Synopsis\n\n## Scène 1\n`,
          version: 1,
        })
        .returning();
      if (!created) return null;
      script = created;
      await this.db.insert(scriptVersions).values({
        scriptId: script.id,
        version: 1,
        content: script.content,
        changeSummary: 'Initialisation du scénario',
        author: 'system',
      });
    }

    const versions = await this.db
      .select()
      .from(scriptVersions)
      .where(eq(scriptVersions.scriptId, script.id))
      .orderBy(desc(scriptVersions.version));

    return {
      id: script.id,
      projectId: script.projectId,
      title: script.title,
      content: script.content,
      version: script.version,
      updatedAt: script.updatedAt.toISOString(),
      versions: versions.map((v) => ({
        id: v.id,
        scriptId: v.scriptId,
        version: v.version,
        content: v.content,
        changeSummary: v.changeSummary,
        author: v.author as Actor,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async updateProjectScript(
    projectIdOrSlug: string,
    input: UpdateScriptInput,
  ): Promise<ProjectScriptDto | null> {
    const current = await this.getProjectScript(projectIdOrSlug);
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!current || !project) return null;

    const nextVersion = current.version + 1;
    await this.db
      .update(projectScripts)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        content: input.content,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(projectScripts.id, current.id));

    await this.db.insert(scriptVersions).values({
      scriptId: current.id,
      version: nextVersion,
      content: input.content,
      changeSummary: input.changeSummary,
      author: input.author,
    });

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'script' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor: input.author,
      action: 'script.updated',
      summary: `Scénario v${nextVersion} : ${input.changeSummary}`,
      entityType: 'script',
      entityId: current.id,
    });

    return this.getProjectScript(project.id);
  }

  // ==========================================================================
  // 2. Continuity Bible (Characters, Locations, Props, Styles)
  // ==========================================================================

  async listBibleEntities(projectIdOrSlug: string): Promise<BibleEntityDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const rows = await this.db
      .select()
      .from(bibleEntities)
      .where(eq(bibleEntities.projectId, project.id))
      .orderBy(asc(bibleEntities.entityType), asc(bibleEntities.name));

    return rows.map((r) => this.toBibleDto(r));
  }

  async upsertBibleEntity(
    projectIdOrSlug: string,
    input: UpsertBibleEntityInput,
    actor: Actor = 'user',
  ): Promise<BibleEntityDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const prefix = BIBLE_PREFIX[input.entityType];
    const refCode = (
      input.refCode ?? `${prefix}-${slugifyProjectName(input.name)}`
    ).toLowerCase();

    const existingRows = await this.db
      .select()
      .from(bibleEntities)
      .where(eq(bibleEntities.projectId, project.id));
    const existing = existingRows.find((e) => e.refCode === refCode);

    let row: typeof bibleEntities.$inferSelect;
    if (existing) {
      const [updated] = await this.db
        .update(bibleEntities)
        .set({
          entityType: input.entityType,
          name: input.name,
          description: input.description,
          visualPrompt: input.visualPrompt,
          loraName: input.loraName,
          referenceAssetIds: input.referenceAssetIds,
          tags: input.tags,
          updatedAt: new Date(),
        })
        .where(eq(bibleEntities.id, existing.id))
        .returning();
      if (!updated) return null;
      row = updated;
    } else {
      const [created] = await this.db
        .insert(bibleEntities)
        .values({
          projectId: project.id,
          entityType: input.entityType,
          refCode,
          name: input.name,
          description: input.description,
          visualPrompt: input.visualPrompt,
          loraName: input.loraName,
          referenceAssetIds: input.referenceAssetIds,
          tags: input.tags,
        })
        .returning();
      if (!created) return null;
      row = created;
    }

    const dto = this.toBibleDto(row);
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'bible' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'bible.upserted',
      summary: `Bible continuité : ${dto.name} (${dto.handle})`,
      entityType: 'bible',
      entityId: dto.id,
      entityRef: dto.handle,
    });

    return dto;
  }

  async deleteBibleEntity(entityId: string): Promise<boolean> {
    if (!UUID_REGEX.test(entityId)) return false;
    const [deleted] = await this.db
      .delete(bibleEntities)
      .where(eq(bibleEntities.id, entityId))
      .returning();
    if (!deleted) return false;
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: deleted.projectId, domain: 'bible' },
    });
    return true;
  }

  // ==========================================================================
  // 3. Storyboard (Scenes -> Shots)
  // ==========================================================================

  async getStoryboard(projectIdOrSlug: string): Promise<SceneDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const [sceneRows, shotRows] = await Promise.all([
      this.db
        .select()
        .from(scenes)
        .where(eq(scenes.projectId, project.id))
        .orderBy(asc(scenes.sortOrder), asc(scenes.sceneNumber)),
      this.db
        .select()
        .from(shots)
        .where(eq(shots.projectId, project.id))
        .orderBy(asc(shots.sortOrder), asc(shots.shotCode)),
    ]);

    const shotsByScene = new Map<string, Array<typeof shots.$inferSelect>>();
    for (const s of shotRows) {
      const list = shotsByScene.get(s.sceneId) ?? [];
      list.push(s);
      shotsByScene.set(s.sceneId, list);
    }

    // Compute cumulative absolute startSec across ordered scenes & shots when startSec is null
    let runningTimeSec = 0;
    return sceneRows.map((sc) => {
      const sceneShots = (shotsByScene.get(sc.id) ?? []).map((s) => {
        const effectiveStart = s.startSec ?? Math.round(runningTimeSec * 1000) / 1000;
        runningTimeSec = effectiveStart + Math.max(0.05, s.durationSec);
        return this.toShotDto(s, effectiveStart);
      });

      return {
        id: sc.id,
        projectId: sc.projectId,
        sceneNumber: sc.sceneNumber,
        title: sc.title,
        summary: sc.summary,
        locationRef: sc.locationRef,
        sortOrder: sc.sortOrder,
        shots: sceneShots,
        createdAt: sc.createdAt.toISOString(),
        updatedAt: sc.updatedAt.toISOString(),
      };
    });
  }

  toCompactStoryboard(storyboard: SceneDto[]): Array<{
    id: string;
    sceneNumber: number;
    title: string;
    locationRef: string;
    shotCount: number;
    shots: Array<{
      id: string;
      shotCode: string;
      externalId: string | null;
      handle: string;
      title: string;
      startSec: number | null;
      durationSec: number;
      status: ShotStatus;
      keyframeAssetId: string | null;
      videoAssetId: string | null;
      bibleEntityRefs: string[];
    }>;
  }> {
    return storyboard.map((sc) => ({
      id: sc.id,
      sceneNumber: sc.sceneNumber,
      title: sc.title,
      locationRef: sc.locationRef,
      shotCount: sc.shots.length,
      shots: sc.shots.map((sh) => ({
        id: sh.id,
        shotCode: sh.shotCode,
        externalId: sh.externalId,
        handle: sh.handle,
        title: sh.title,
        startSec: sh.startSec,
        durationSec: sh.durationSec,
        status: sh.status,
        keyframeAssetId: sh.keyframeAssetId,
        videoAssetId: sh.videoAssetId,
        bibleEntityRefs: sh.bibleEntityRefs,
      })),
    }));
  }

  /**
   * Idempotent batch upsert of scenes & shots keyed by sceneNumber and shot externalId (or shotCode).
   * Safe to re-run repeatedly without creating duplicates.
   */
  async upsertStoryboard(
    projectIdOrSlug: string,
    input: UpsertStoryboardInput,
    actor: Actor = 'claude',
  ): Promise<{
    scenes: SceneDto[];
    stats: {
      scenesCreated: number;
      scenesUpdated: number;
      shotsCreated: number;
      shotsUpdated: number;
      shotsPruned: number;
    };
  } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const existingScenes = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, project.id))
      .orderBy(asc(scenes.sortOrder), asc(scenes.sceneNumber));

    const existingShots = await this.db
      .select()
      .from(shots)
      .where(eq(shots.projectId, project.id));

    const sceneByNumber = new Map<number, typeof scenes.$inferSelect>();
    for (const sc of existingScenes) {
      sceneByNumber.set(sc.sceneNumber, sc);
    }

    const shotByExternalId = new Map<string, typeof shots.$inferSelect>();
    const shotByCode = new Map<string, typeof shots.$inferSelect>();
    for (const sh of existingShots) {
      if (sh.externalId) shotByExternalId.set(sh.externalId.toLowerCase(), sh);
      shotByCode.set(sh.shotCode.toLowerCase(), sh);
    }

    let scenesCreated = 0;
    let scenesUpdated = 0;
    let shotsCreated = 0;
    let shotsUpdated = 0;
    let shotsPruned = 0;
    const touchedShotIds = new Set<string>();

    const resolveOptionalAssetId = async (ref?: string | null): Promise<string | null | undefined> => {
      if (ref === undefined) return undefined;
      if (ref === null || ref.trim() === '') return null;
      if (UUID_REGEX.test(ref)) return ref;
      const resolved = await this.studio.resolveReference(ref, project.slug);
      return resolved?.asset?.id ?? null;
    };

    let runningTimeSec = 0;

    for (let sIdx = 0; sIdx < input.scenes.length; sIdx += 1) {
      const scInput = input.scenes[sIdx]!;
      const sceneNum = scInput.sceneNumber ?? sIdx + 1;
      const existingScene = sceneByNumber.get(sceneNum);

      let sceneRow: typeof scenes.$inferSelect;
      if (existingScene) {
        const [updated] = await this.db
          .update(scenes)
          .set({
            title: scInput.title,
            summary: scInput.summary ?? existingScene.summary,
            locationRef: scInput.locationRef ?? existingScene.locationRef,
            sortOrder: sIdx + 1,
            updatedAt: new Date(),
          })
          .where(eq(scenes.id, existingScene.id))
          .returning();
        sceneRow = updated ?? existingScene;
        scenesUpdated += 1;
      } else {
        const [created] = await this.db
          .insert(scenes)
          .values({
            projectId: project.id,
            sceneNumber: sceneNum,
            title: scInput.title,
            summary: scInput.summary ?? '',
            locationRef: scInput.locationRef ?? '',
            sortOrder: sIdx + 1,
          })
          .returning();
        if (!created) continue;
        sceneRow = created;
        sceneByNumber.set(sceneNum, created);
        scenesCreated += 1;
      }

      for (let shIdx = 0; shIdx < scInput.shots.length; shIdx += 1) {
        const shInput = scInput.shots[shIdx]!;
        const extKey = shInput.externalId.trim();
        const desiredStart = shInput.startSec ?? Math.round(runningTimeSec * 1000) / 1000;
        runningTimeSec = desiredStart + Math.max(0.05, shInput.durationSec);

        const match =
          shotByExternalId.get(extKey.toLowerCase()) ??
          shotByCode.get(extKey.toLowerCase());

        const keyframeId = await resolveOptionalAssetId(shInput.keyframeRef);
        const videoId = await resolveOptionalAssetId(shInput.videoRef);

        if (match) {
          const [updated] = await this.db
            .update(shots)
            .set({
              sceneId: sceneRow.id,
              externalId: extKey,
              title: shInput.title,
              visualDescription: shInput.visualDescription,
              cameraMovement: shInput.cameraMovement,
              dialogue: shInput.dialogue,
              prompt: shInput.prompt,
              startSec: desiredStart,
              durationSec: shInput.durationSec,
              status: shInput.status,
              ...(keyframeId !== undefined ? { keyframeAssetId: keyframeId } : {}),
              ...(videoId !== undefined ? { videoAssetId: videoId } : {}),
              bibleEntityRefs: shInput.bibleEntityRefs,
              sortOrder: shIdx + 1,
              updatedAt: new Date(),
            })
            .where(eq(shots.id, match.id))
            .returning();
          if (updated) {
            touchedShotIds.add(updated.id);
            shotsUpdated += 1;
          }
        } else {
          let seq = shIdx + 1;
          let candidateCode = extKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

          while (!candidateCode || shotByCode.has(candidateCode.toLowerCase())) {
            candidateCode = `s${String(sceneNum).padStart(2, '0')}-sh${String(seq).padStart(2, '0')}`;
            seq += 1;
          }

          const [created] = await this.db
            .insert(shots)
            .values({
              sceneId: sceneRow.id,
              projectId: project.id,
              shotCode: candidateCode,
              externalId: extKey,
              title: shInput.title,
              visualDescription: shInput.visualDescription,
              cameraMovement: shInput.cameraMovement,
              dialogue: shInput.dialogue,
              prompt: shInput.prompt,
              startSec: desiredStart,
              durationSec: shInput.durationSec,
              status: shInput.status,
              keyframeAssetId: keyframeId ?? null,
              videoAssetId: videoId ?? null,
              bibleEntityRefs: shInput.bibleEntityRefs,
              sortOrder: shIdx + 1,
            })
            .returning();
          if (created) {
            touchedShotIds.add(created.id);
            shotByCode.set(created.shotCode.toLowerCase(), created);
            if (created.externalId) shotByExternalId.set(created.externalId.toLowerCase(), created);
            shotsCreated += 1;
          }
        }
      }
    }

    if (input.pruneMissing) {
      const toDelete = existingShots.filter((sh) => !touchedShotIds.has(sh.id)).map((sh) => sh.id);
      if (toDelete.length > 0) {
        await this.db.delete(shots).where(inArray(shots.id, toDelete));
        shotsPruned = toDelete.length;
      }
    }

    const updatedBoard = await this.getStoryboard(project.id);
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'storyboard' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'storyboard.upserted',
      summary: `Storyboard synchronisé (+${shotsCreated} plans, ${shotsUpdated} mis à jour${shotsPruned ? `, -${shotsPruned} supprimés` : ''})`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return {
      scenes: updatedBoard,
      stats: { scenesCreated, scenesUpdated, shotsCreated, shotsUpdated, shotsPruned },
    };
  }

  /**
   * Compose final generation prompt for a shot: combines referenced Bible entities,
   * ordered reference assets, active project rules filtered by tags, and shot description/prompt.
   */
  async composeShotPrompt(
    projectIdOrSlug: string,
    shotIdOrCode: string,
    options: { extraTags?: string[]; extraPositive?: string; extraNegative?: string } = {},
  ): Promise<{
    shot: ShotDto;
    positivePrompt: string;
    negativePrompt: string;
    referenceAssets: Array<{
      order: number;
      entityHandle: string;
      entityName: string;
      assetId: string;
      assetHandle: string;
      originalFilename: string;
      url: string;
    }>;
    loras: string[];
    injectedRulesCount: number;
    informativeRules: Array<{ code: string; title: string; instruction: string }>;
  } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const cleanCode = shotIdOrCode.trim().replace(/^@/, '');
    const allShots = await this.db
      .select()
      .from(shots)
      .where(eq(shots.projectId, project.id));

    const match = allShots.find(
      (s) =>
        s.id === cleanCode ||
        s.shotCode.toLowerCase() === cleanCode.toLowerCase() ||
        (s.externalId && s.externalId.toLowerCase() === cleanCode.toLowerCase()),
    );
    if (!match) return null;

    const shotDto = this.toShotDto(match);
    const bibleList = await this.listBibleEntities(project.id);
    const wantedRefs = new Set(
      shotDto.bibleEntityRefs.map((r) => r.trim().replace(/^@/, '').toLowerCase()),
    );
    const matchedEntities = bibleList.filter(
      (e) =>
        wantedRefs.has(e.refCode.toLowerCase()) ||
        wantedRefs.has(e.name.toLowerCase()) ||
        wantedRefs.has(e.id.toLowerCase()),
    );

    const referenceAssets: Array<{
      order: number;
      entityHandle: string;
      entityName: string;
      assetId: string;
      assetHandle: string;
      originalFilename: string;
      url: string;
    }> = [];
    const seenAssetIds = new Set<string>();
    const loras: string[] = [];
    const tagSet = new Set<string>((options.extraTags ?? []).map((t) => t.toLowerCase()));

    for (const entity of matchedEntities) {
      if (entity.loraName.trim()) loras.push(entity.loraName.trim());
      for (const t of entity.tags) tagSet.add(t.toLowerCase());
      tagSet.add(entity.entityType.toLowerCase());
      tagSet.add(entity.name.toLowerCase());

      for (const assetId of entity.referenceAssetIds) {
        if (seenAssetIds.has(assetId)) continue;
        const found = await this.studio.getAssetById(assetId);
        if (found) {
          seenAssetIds.add(assetId);
          referenceAssets.push({
            order: referenceAssets.length + 1,
            entityHandle: entity.handle,
            entityName: entity.name,
            assetId: found.asset.id,
            assetHandle: found.asset.handle,
            originalFilename: found.asset.originalFilename,
            url: found.asset.urls.original,
          });
        }
      }
    }

    const tagsArray = Array.from(tagSet);
    const rulesBundle = await this.stage2.getResolvedProjectRules(project.id, tagsArray);
    const resolvedRules = rulesBundle?.resolvedRules ?? [];
    const injected = selectInjectableRuleFragments(resolvedRules, tagsArray);
    const informativeRules = resolvedRules
      .filter((r) => r.enabled && !r.autoInject)
      .map((r) => ({ code: r.code, title: r.title, instruction: r.instruction }));

    const positiveParts: string[] = [];
    if (shotDto.prompt.trim()) {
      positiveParts.push(shotDto.prompt.trim());
    } else if (shotDto.visualDescription.trim()) {
      positiveParts.push(shotDto.visualDescription.trim());
    }
    if (shotDto.cameraMovement.trim()) {
      positiveParts.push(`camera: ${shotDto.cameraMovement.trim()}`);
    }
    for (const entity of matchedEntities) {
      if (entity.visualPrompt.trim()) {
        positiveParts.push(`${entity.name}: ${entity.visualPrompt.trim()}`);
      }
    }
    if (options.extraPositive?.trim()) {
      positiveParts.push(options.extraPositive.trim());
    }
    if (injected.positive.trim()) {
      positiveParts.push(injected.positive.trim());
    }

    const negativeParts: string[] = [];
    if (options.extraNegative?.trim()) {
      negativeParts.push(options.extraNegative.trim());
    }
    if (injected.negative.trim()) {
      negativeParts.push(injected.negative.trim());
    }

    return {
      shot: shotDto,
      positivePrompt: positiveParts.join(', '),
      negativePrompt: negativeParts.join(', '),
      referenceAssets,
      loras: Array.from(new Set(loras)),
      injectedRulesCount: injected.injectedRulesCount,
      informativeRules,
    };
  }

  async createScene(
    projectIdOrSlug: string,
    input: CreateSceneInput,
    actor: Actor = 'user',
  ): Promise<SceneDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(scenes)
      .where(eq(scenes.projectId, project.id));
    const nextNum = (countRows[0]?.count ?? 0) + 1;

    const [created] = await this.db
      .insert(scenes)
      .values({
        projectId: project.id,
        sceneNumber: nextNum,
        title: input.title,
        summary: input.summary,
        locationRef: input.locationRef,
        sortOrder: input.sortOrder ?? nextNum,
      })
      .returning();

    if (!created) return null;

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'storyboard' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'scene.created',
      summary: `Scène ${created.sceneNumber} créée : ${created.title}`,
      entityType: 'scene',
      entityId: created.id,
    });

    return {
      id: created.id,
      projectId: created.projectId,
      sceneNumber: created.sceneNumber,
      title: created.title,
      summary: created.summary,
      locationRef: created.locationRef,
      sortOrder: created.sortOrder,
      shots: [],
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async deleteScene(sceneId: string): Promise<boolean> {
    if (!UUID_REGEX.test(sceneId)) return false;
    const [deleted] = await this.db.delete(scenes).where(eq(scenes.id, sceneId)).returning();
    if (!deleted) return false;
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: deleted.projectId, domain: 'storyboard' },
    });
    return true;
  }

  async createShot(
    projectIdOrSlug: string,
    input: CreateShotInput,
    actor: Actor = 'user',
  ): Promise<ShotDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const sceneRows = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.id, input.sceneId))
      .limit(1);
    const scene = sceneRows[0];
    if (!scene || scene.projectId !== project.id) return null;

    const existingShots = await this.db
      .select({ id: shots.id })
      .from(shots)
      .where(eq(shots.sceneId, scene.id));
    let seq = existingShots.length + 1;
    let shotCode = `s${String(scene.sceneNumber).padStart(2, '0')}-sh${String(seq).padStart(2, '0')}`;

    while (true) {
      const collision = await this.db
        .select({ id: shots.id })
        .from(shots)
        .where(and(eq(shots.projectId, project.id), eq(shots.shotCode, shotCode)))
        .limit(1);
      if (collision.length === 0) break;
      seq += 1;
      shotCode = `s${String(scene.sceneNumber).padStart(2, '0')}-sh${String(seq).padStart(2, '0')}`;
    }

    const [created] = await this.db
      .insert(shots)
      .values({
        sceneId: scene.id,
        projectId: project.id,
        shotCode,
        externalId: input.externalId ?? null,
        title: input.title,
        visualDescription: input.visualDescription,
        cameraMovement: input.cameraMovement,
        dialogue: input.dialogue,
        prompt: input.prompt,
        startSec: input.startSec ?? null,
        durationSec: input.durationSec,
        status: input.status,
        keyframeAssetId: input.keyframeAssetId ?? null,
        videoAssetId: input.videoAssetId ?? null,
        bibleEntityRefs: input.bibleEntityRefs,
        sortOrder: input.sortOrder ?? seq,
      })
      .returning();

    if (!created) return null;
    const dto = this.toShotDto(created);

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'storyboard' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'shot.created',
      summary: `Plan ${dto.handle} ajouté : ${dto.title}`,
      entityType: 'shot',
      entityId: dto.id,
      entityRef: dto.handle,
    });

    return dto;
  }

  async updateShot(
    shotId: string,
    input: UpdateShotInput,
    actor: Actor = 'user',
  ): Promise<ShotDto | null> {
    if (!UUID_REGEX.test(shotId)) return null;
    const [updated] = await this.db
      .update(shots)
      .set({
        ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
        ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.visualDescription !== undefined
          ? { visualDescription: input.visualDescription }
          : {}),
        ...(input.cameraMovement !== undefined ? { cameraMovement: input.cameraMovement } : {}),
        ...(input.dialogue !== undefined ? { dialogue: input.dialogue } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.startSec !== undefined ? { startSec: input.startSec } : {}),
        ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.keyframeAssetId !== undefined ? { keyframeAssetId: input.keyframeAssetId } : {}),
        ...(input.videoAssetId !== undefined ? { videoAssetId: input.videoAssetId } : {}),
        ...(input.bibleEntityRefs !== undefined ? { bibleEntityRefs: input.bibleEntityRefs } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(shots.id, shotId))
      .returning();

    if (!updated) return null;
    const dto = this.toShotDto(updated);

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: updated.projectId, domain: 'storyboard' },
    });

    if (actor === 'claude') {
      await this.studio.logActivity({
        projectId: updated.projectId,
        actor,
        action: 'shot.updated',
        summary: `Plan ${dto.handle} mis à jour (${dto.status})`,
        entityType: 'shot',
        entityId: dto.id,
        entityRef: dto.handle,
      });
    }

    return dto;
  }

  async deleteShot(shotId: string): Promise<boolean> {
    if (!UUID_REGEX.test(shotId)) return false;
    const [deleted] = await this.db.delete(shots).where(eq(shots.id, shotId)).returning();
    if (!deleted) return false;
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: deleted.projectId, domain: 'storyboard' },
    });
    return true;
  }

  // ==========================================================================
  // 4. Audio, Music, Lyrics & Lip-Sync Studio
  // ==========================================================================

  async listAudioTracks(projectIdOrSlug: string): Promise<AudioTrackDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const rows = await this.db
      .select()
      .from(audioTracks)
      .where(eq(audioTracks.projectId, project.id))
      .orderBy(desc(audioTracks.updatedAt));

    return rows.map((r) => this.toAudioTrackDto(r));
  }

  async upsertAudioTrack(
    projectIdOrSlug: string,
    input: UpsertAudioTrackInput,
    actor: Actor = 'user',
  ): Promise<AudioTrackDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const computedSrt =
      input.srtContent.trim() || (input.lrcContent.trim() ? lrcToSrt(input.lrcContent) : '');

    let row: typeof audioTracks.$inferSelect;
    if (input.id && UUID_REGEX.test(input.id)) {
      const [updated] = await this.db
        .update(audioTracks)
        .set({
          assetId: input.assetId ?? null,
          title: input.title,
          category: input.category,
          bpm: input.bpm ?? null,
          musicalKey: input.musicalKey,
          promptUsed: input.promptUsed,
          lyrics: input.lyrics,
          lrcContent: input.lrcContent,
          srtContent: computedSrt,
          markers: input.markers,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(eq(audioTracks.id, input.id))
        .returning();
      if (!updated) return null;
      row = updated;
    } else {
      const countRows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(audioTracks)
        .where(eq(audioTracks.projectId, project.id));
      let seq = (countRows[0]?.count ?? 0) + 1;
      let refCode = `track-${String(seq).padStart(3, '0')}`;
      while (true) {
        const exists = await this.db
          .select({ id: audioTracks.id })
          .from(audioTracks)
          .where(eq(audioTracks.refCode, refCode))
          .limit(1);
        if (exists.length === 0) break;
        seq += 1;
        refCode = `track-${String(seq).padStart(3, '0')}`;
      }

      const [created] = await this.db
        .insert(audioTracks)
        .values({
          projectId: project.id,
          assetId: input.assetId ?? null,
          refCode,
          title: input.title,
          category: input.category,
          bpm: input.bpm ?? null,
          musicalKey: input.musicalKey,
          promptUsed: input.promptUsed,
          lyrics: input.lyrics,
          lrcContent: input.lrcContent,
          srtContent: computedSrt,
          markers: input.markers,
          notes: input.notes,
        })
        .returning();
      if (!created) return null;
      row = created;
    }

    const dto = this.toAudioTrackDto(row);
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'audio' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'audio.upserted',
      summary: `Piste audio ${dto.handle} : ${dto.title} (${dto.category})`,
      entityType: 'audio',
      entityId: dto.id,
      entityRef: dto.handle,
    });

    return dto;
  }

  async importSunoAlignment(
    projectIdOrSlug: string,
    params: {
      trackId?: string;
      title?: string;
      words: Array<{ word: string; startS?: number; endS?: number; start_s?: number; end_s?: number }>;
      pauseThresholdSec?: number;
    },
    actor: Actor = 'claude',
  ): Promise<AudioTrackDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const normalizedWords = params.words.map((w) => ({
      word: w.word,
      start_s: w.start_s ?? w.startS ?? 0,
      end_s: w.end_s ?? w.endS,
    }));
    const enhancedLrc = sunoAlignmentToEnhancedLrc(normalizedWords);
    const plainLyrics = enhancedLrc
      .replace(/\[\d+:\d+(?:\.\d+)?\]/g, '')
      .replace(/<\d+:\d+(?:\.\d+)?>/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (params.trackId && UUID_REGEX.test(params.trackId)) {
      const existingRows = await this.db
        .select()
        .from(audioTracks)
        .where(and(eq(audioTracks.projectId, project.id), eq(audioTracks.id, params.trackId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return null;

      return this.upsertAudioTrack(
        project.id,
        {
          id: existing.id,
          assetId: existing.assetId,
          title: params.title ?? existing.title,
          category: existing.category as AudioCategory,
          bpm: existing.bpm,
          musicalKey: existing.musicalKey,
          promptUsed: existing.promptUsed,
          lyrics: existing.lyrics || plainLyrics,
          lrcContent: enhancedLrc,
          srtContent: lrcToSrt(enhancedLrc),
          markers: existing.markers ?? [],
          notes: existing.notes,
        },
        actor,
      );
    }

    return this.upsertAudioTrack(
      project.id,
      {
        title: params.title ?? 'Suno Aligned Track',
        category: 'music',
        musicalKey: '',
        promptUsed: '',
        lyrics: plainLyrics,
        lrcContent: enhancedLrc,
        srtContent: lrcToSrt(enhancedLrc),
        markers: [],
        notes: 'Importé depuis alignement Suno mot à mot',
      },
      actor,
    );
  }

  async deleteAudioTrack(trackId: string): Promise<boolean> {
    if (!UUID_REGEX.test(trackId)) return false;
    const [deleted] = await this.db
      .delete(audioTracks)
      .where(eq(audioTracks.id, trackId))
      .returning();
    if (!deleted) return false;
    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: deleted.projectId, domain: 'audio' },
    });
    return true;
  }

  // ==========================================================================
  // 5. YouTube Packaging Hub & Export Pack
  // ==========================================================================

  async getYouTubePackage(projectIdOrSlug: string): Promise<YouTubePackageDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const rows = await this.db
      .select()
      .from(youtubePackages)
      .where(eq(youtubePackages.projectId, project.id))
      .limit(1);

    let row = rows[0];
    if (!row) {
      const [created] = await this.db
        .insert(youtubePackages)
        .values({
          projectId: project.id,
          titles: [project.name],
          description: '',
          tags: [],
          hashtags: [],
          checklist: DEFAULT_YT_CHECKLIST,
        })
        .returning();
      if (!created) return null;
      row = created;
    }

    return this.toYouTubeDto(row);
  }

  async updateYouTubePackage(
    projectIdOrSlug: string,
    input: UpdateYouTubePackageInput,
    actor: Actor = 'user',
  ): Promise<YouTubePackageDto | null> {
    const existing = await this.getYouTubePackage(projectIdOrSlug);
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!existing || !project) return null;

    const [updated] = await this.db
      .update(youtubePackages)
      .set({
        ...(input.titles !== undefined ? { titles: input.titles } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.playlist !== undefined ? { playlist: input.playlist } : {}),
        ...(input.pinnedComment !== undefined ? { pinnedComment: input.pinnedComment } : {}),
        ...(input.aiDisclosure !== undefined ? { aiDisclosure: input.aiDisclosure } : {}),
        ...(input.thumbnailAssetIds !== undefined
          ? { thumbnailAssetIds: input.thumbnailAssetIds }
          : {}),
        ...(input.chapters !== undefined ? { chapters: input.chapters } : {}),
        ...(input.srtSubtitles !== undefined ? { srtSubtitles: input.srtSubtitles } : {}),
        ...(input.checklist !== undefined ? { checklist: input.checklist } : {}),
        updatedAt: new Date(),
      })
      .where(eq(youtubePackages.id, existing.id))
      .returning();

    if (!updated) return null;

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'youtube' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'youtube.updated',
      summary: `Packaging YouTube mis à jour pour @proj-${project.slug}`,
      entityType: 'youtube',
      entityId: updated.id,
    });

    return this.toYouTubeDto(updated);
  }

  async exportYouTubeReadyPack(projectIdOrSlug: string): Promise<{
    exportDir: string;
    files: string[];
    warnings: string[];
  } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    const pkg = await this.getYouTubePackage(projectIdOrSlug);
    if (!project || !pkg) return null;

    const exportRelDir = path.join('projects', project.slug, 'exports', 'youtube-pack');
    const exportAbsDir = resolveSafePath(this.config.dataDir, exportRelDir);
    await fs.mkdir(exportAbsDir, { recursive: true });

    const { text: chaptersText, warnings } = formatYoutubeChapters(pkg.chapters);
    const fullDescription = [
      pkg.description.trim(),
      chaptersText ? `\nChapitres :\n${chaptersText}` : '',
      pkg.hashtags.length > 0 ? `\n${pkg.hashtags.join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const metadataMd = [
      `# YouTube Ready Pack — ${project.name}`,
      '',
      '## Titres (A/B Variants)',
      ...pkg.titles.map((t, i) => `${i + 1}. ${t}`),
      '',
      '## Description complète (copier-coller)',
      '```text',
      fullDescription,
      '```',
      '',
      `## Tags`,
      pkg.tags.join(', '),
      '',
      `## Commentaire épinglé`,
      pkg.pinnedComment || '—',
      '',
      `## Déclaration contenu IA : ${pkg.aiDisclosure ? 'Oui' : 'Non'}`,
    ].join('\n');

    const writtenFiles: string[] = [];

    await fs.writeFile(path.join(exportAbsDir, 'metadata.md'), `${metadataMd}\n`, 'utf8');
    writtenFiles.push('metadata.md');

    await fs.writeFile(
      path.join(exportAbsDir, 'metadata.json'),
      `${JSON.stringify({ project: project.slug, ...pkg, fullDescription }, null, 2)}\n`,
      'utf8',
    );
    writtenFiles.push('metadata.json');

    if (pkg.srtSubtitles.trim()) {
      await fs.writeFile(path.join(exportAbsDir, 'subtitles.srt'), `${pkg.srtSubtitles}\n`, 'utf8');
      writtenFiles.push('subtitles.srt');
    }

    // Copy selected A/B thumbnail originals into the export pack
    for (let i = 0; i < pkg.thumbnailAssetIds.length; i += 1) {
      const thumbId = pkg.thumbnailAssetIds[i];
      if (!thumbId) continue;
      const found = await this.studio.getAssetById(thumbId);
      if (!found) continue;
      const srcAbs = this.media.resolveMediaFile(found.raw.filePath);
      const ext = path.extname(found.raw.originalFilename) || '.png';
      const destName = `thumbnail_variant_${String.fromCharCode(65 + i)}${ext}`;
      try {
        await fs.copyFile(srcAbs, path.join(exportAbsDir, destName));
        writtenFiles.push(destName);
      } catch {
        // Skip missing file on disk
      }
    }

    return {
      exportDir: exportRelDir,
      files: writtenFiles,
      warnings,
    };
  }

  // ==========================================================================
  // 6. Per-Project Local Git Repository & GitHub Integration (Issue #4)
  // ==========================================================================

  async getProjectRepoStatus(projectIdOrSlug: string): Promise<ProjectRepoStatusDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const rows = await this.db
      .select()
      .from(projectRepos)
      .where(eq(projectRepos.projectId, project.id))
      .limit(1);
    const dbRow = rows[0];

    const liveStatus = await this.git.inspectStatus(project.slug);
    return {
      projectId: project.id,
      projectSlug: project.slug,
      initialized: liveStatus.initialized,
      localPath: dbRow?.localPath ?? this.git.getRelativeRepoPath(project.slug),
      defaultBranch: dbRow?.defaultBranch ?? 'main',
      githubRemoteUrl: dbRow?.githubRemoteUrl ?? null,
      autoCommit: dbRow?.autoCommit ?? false,
      lastCommitSha: liveStatus.lastCommitSha ?? dbRow?.lastCommitSha ?? null,
      lastSyncedAt: dbRow?.lastSyncedAt ? dbRow.lastSyncedAt.toISOString() : null,
      dirtyFiles: liveStatus.dirtyFiles,
      recentCommits: liveStatus.recentCommits,
    };
  }

  async initOrConfigureProjectRepo(
    projectIdOrSlug: string,
    input: ConfigureProjectRepoInput,
    actor: Actor = 'user',
  ): Promise<ProjectRepoStatusDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const branch = input.defaultBranch ?? 'main';
    const initRes = await this.git.initRepo({
      projectSlug: project.slug,
      projectName: project.name,
      defaultBranch: branch,
      githubRemoteUrl: input.githubRemoteUrl ?? undefined,
    });

    let safeRemote: string | null | undefined = undefined;
    if (input.githubRemoteUrl !== undefined) {
      safeRemote = await this.git.setRemote(project.slug, input.githubRemoteUrl);
    }

    const existing = await this.db
      .select()
      .from(projectRepos)
      .where(eq(projectRepos.projectId, project.id))
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(projectRepos)
        .set({
          localPath: initRes.localPath,
          defaultBranch: branch,
          ...(safeRemote !== undefined ? { githubRemoteUrl: safeRemote } : {}),
          ...(input.autoCommit !== undefined ? { autoCommit: input.autoCommit } : {}),
          lastCommitSha: initRes.lastCommitSha,
          updatedAt: new Date(),
        })
        .where(eq(projectRepos.id, existing[0].id));
    } else {
      await this.db.insert(projectRepos).values({
        projectId: project.id,
        localPath: initRes.localPath,
        defaultBranch: branch,
        githubRemoteUrl: safeRemote ?? null,
        autoCommit: input.autoCommit ?? false,
        lastCommitSha: initRes.lastCommitSha,
      });
    }

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'git' },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'git.configured',
      summary: `Dépôt Git local initialisé pour @proj-${project.slug}${safeRemote ? ` (${safeRemote})` : ''}`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return this.getProjectRepoStatus(project.id);
  }

  async syncAndCommitProjectRepo(
    projectIdOrSlug: string,
    input: CommitProjectRepoInput,
    actor: Actor = 'user',
  ): Promise<{ status: ProjectRepoStatusDto; committed: boolean; sha: string | null } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const alreadyInit = await this.git.isInitialized(project.slug);
    if (!alreadyInit) {
      await this.initOrConfigureProjectRepo(project.id, {}, actor);
    }

    if (input.exportSnapshot) {
      const [script, bible, storyboard, resolvedRules, tracks, yt] = await Promise.all([
        this.getProjectScript(project.id),
        this.listBibleEntities(project.id),
        this.getStoryboard(project.id),
        this.stage2.getResolvedProjectRules(project.id),
        this.listAudioTracks(project.id),
        this.getYouTubePackage(project.id),
      ]);

      await this.git.writeSnapshot(project.slug, {
        projectMeta: project as unknown as Record<string, unknown>,
        scriptMarkdown: script?.content,
        bibleEntities: bible,
        storyboardScenes: storyboard,
        resolvedRules: resolvedRules as unknown as Record<string, unknown> | null,
        audioTracks: tracks as unknown as Array<{ refCode: string; lrcContent?: string }>,
        youtubePackage: yt as unknown as { description?: string } | null,
      });
    }

    const commitRes = await this.git.commitAll(project.slug, input.message);

    await this.db
      .update(projectRepos)
      .set({
        lastCommitSha: commitRes.sha,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.projectId, project.id));

    this.realtime.broadcast({
      type: 'stage3.changed',
      payload: { projectId: project.id, domain: 'git' },
    });

    if (commitRes.committed) {
      await this.studio.logActivity({
        projectId: project.id,
        projectSlug: project.slug,
        actor,
        action: 'git.committed',
        summary: `Commit Git sur @proj-${project.slug} : ${input.message}`,
        entityType: 'project',
        entityId: project.id,
        entityRef: `@proj-${project.slug}`,
      });
    }

    const status = await this.getProjectRepoStatus(project.id);
    if (!status) return null;
    return { status, committed: commitRes.committed, sha: commitRes.sha };
  }

  async pushProjectRepo(
    projectIdOrSlug: string,
  ): Promise<{ ok: boolean; output: string; status: ProjectRepoStatusDto } | null> {
    const statusBefore = await this.getProjectRepoStatus(projectIdOrSlug);
    if (!statusBefore) return null;

    const res = await this.git.pushToOrigin(statusBefore.projectSlug, statusBefore.defaultBranch);
    if (res.ok) {
      await this.db
        .update(projectRepos)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(projectRepos.projectId, statusBefore.projectId));
    }

    const status = (await this.getProjectRepoStatus(statusBefore.projectId)) ?? statusBefore;
    return { ok: res.ok, output: res.output, status };
  }

  // --- DTO Mappers ---

  private toBibleDto(row: typeof bibleEntities.$inferSelect): BibleEntityDto {
    return {
      id: row.id,
      projectId: row.projectId,
      entityType: row.entityType as BibleEntityType,
      refCode: row.refCode,
      handle: `@${row.refCode}`,
      name: row.name,
      description: row.description,
      visualPrompt: row.visualPrompt,
      loraName: row.loraName,
      referenceAssetIds: row.referenceAssetIds ?? [],
      tags: row.tags ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toShotDto(
    row: typeof shots.$inferSelect,
    computedStartSec?: number | null,
  ): ShotDto {
    return {
      id: row.id,
      sceneId: row.sceneId,
      projectId: row.projectId,
      shotCode: row.shotCode,
      externalId: row.externalId ?? null,
      handle: `@${row.shotCode}`,
      title: row.title,
      visualDescription: row.visualDescription,
      cameraMovement: row.cameraMovement,
      dialogue: row.dialogue,
      prompt: row.prompt,
      startSec: computedStartSec !== undefined && computedStartSec !== null ? computedStartSec : (row.startSec ?? 0),
      durationSec: row.durationSec,
      status: row.status as ShotStatus,
      keyframeAssetId: row.keyframeAssetId,
      videoAssetId: row.videoAssetId,
      bibleEntityRefs: row.bibleEntityRefs ?? [],
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toAudioTrackDto(row: typeof audioTracks.$inferSelect): AudioTrackDto {
    return {
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId,
      refCode: row.refCode,
      handle: `@${row.refCode}`,
      title: row.title,
      category: row.category as AudioCategory,
      bpm: row.bpm,
      musicalKey: row.musicalKey,
      promptUsed: row.promptUsed,
      lyrics: row.lyrics,
      lrcContent: row.lrcContent,
      srtContent: row.srtContent,
      markers: row.markers ?? [],
      notes: row.notes,
      audioUrl: row.assetId ? `/api/media/${row.assetId}/original` : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toYouTubeDto(row: typeof youtubePackages.$inferSelect): YouTubePackageDto {
    return {
      id: row.id,
      projectId: row.projectId,
      titles: row.titles ?? [],
      description: row.description,
      tags: row.tags ?? [],
      hashtags: row.hashtags ?? [],
      category: row.category,
      language: row.language,
      playlist: row.playlist,
      pinnedComment: row.pinnedComment,
      aiDisclosure: row.aiDisclosure,
      thumbnailAssetIds: row.thumbnailAssetIds ?? [],
      chapters: row.chapters ?? [],
      srtSubtitles: row.srtSubtitles,
      checklist: row.checklist ?? DEFAULT_YT_CHECKLIST,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import {
  buildAssetHandle,
  buildClipSegmentCacheSignature,
  buildDrawtextFilter,
  buildFfmpegSubtitleFilter,
  compileClipAudioFilterChain,
  compileClipVideoFilterChain,
  computeXfadeChainPlan,
  cuesFromLrc,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_SUBTITLE_STYLE,
  generateEdl,
  generateFcpxml,
  generateOtio,
  normalizeSubtitleCues,
  parseSrtOrVtt,
  serializeSrt,
  serializeVtt,
  splitClipAtTime,
  type Actor,
  type AddTimelineClipInput,
  type AssetDto,
  type AssetType,
  type ClipAppliedEffect,
  type ClipColorAdjust,
  type ClipKeyframe,
  type ClipTextOverlay,
  type ClipTransform,
  type NleExportFormat,
  type PatchTimelineClipInput,
  type ProjectSubtitlesDto,
  type QualityTier,
  type SaveProjectSubtitlesInput,
  type StartTimelineRenderInput,
  type SubtitleCue,
  type SubtitleStyle,
  type TimelineClipDto,
  type TimelineDto,
  type TimelineQualityMode,
  type TimelineRenderDto,
  type TimelineRenderStatus,
  type TimelineTrackDto,
  type TimelineTrackType,
  type TimelineTransition,
  type UpsertTimelineInput,
  type VideoEffectDto,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import {
  assets,
  projects,
  projectSubtitles,
  timelineClips,
  timelineRenders,
  timelineTracks,
} from '../db/schema.js';
import { resolveSafePath } from '../utils/security.js';
import type { EffectsService } from './effects.service.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { Stage3Service } from './stage3.service.js';
import type { StudioService } from './studio.service.js';
import type { WebhookService } from './webhook.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CACHED_SEGMENTS_PER_PROJECT = 200;

export class Stage4Service {
  private webhookService?: WebhookService;
  private effectsService?: EffectsService;

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly stage3: Stage3Service,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
  ) {}

  setWebhookService(webhookService: WebhookService): void {
    this.webhookService = webhookService;
  }

  setEffectsService(effectsService: EffectsService): void {
    this.effectsService = effectsService;
  }

  private normalizeTransform(raw?: Partial<ClipTransform> | null): ClipTransform {
    return {
      ...DEFAULT_CLIP_TRANSFORM,
      ...(raw ?? {}),
    };
  }

  private normalizeColorAdjust(raw?: Partial<ClipColorAdjust> | null): ClipColorAdjust {
    return {
      ...DEFAULT_CLIP_COLOR_ADJUST,
      ...(raw ?? {}),
    };
  }

  private toClipDto(
    c: typeof timelineClips.$inferSelect,
    asset?: typeof assets.$inferSelect,
  ): TimelineClipDto {
    return {
      id: c.id,
      trackId: c.trackId,
      projectId: c.projectId,
      assetId: c.assetId,
      assetRef: asset ? buildAssetHandle(asset.refCode) : null,
      assetTitle: asset ? asset.title : null,
      assetType: asset ? (asset.type as AssetType) : null,
      assetQualityTier: asset ? (asset.qualityTier as QualityTier) : null,
      title: c.title,
      startSec: c.startSec,
      durationSec: c.durationSec,
      inSec: c.inSec,
      outSec: c.outSec,
      speed: c.speed ?? 1,
      transition: c.transition as TimelineTransition,
      transitionDurationSec: c.transitionDurationSec,
      volume: c.volume,
      fadeInSec: c.fadeInSec ?? 0,
      fadeOutSec: c.fadeOutSec ?? 0,
      muted: c.muted,
      transform: this.normalizeTransform(c.transform),
      colorAdjust: this.normalizeColorAdjust(c.colorAdjust),
      effects: Array.isArray(c.effects) ? (c.effects as ClipAppliedEffect[]) : [],
      keyframes: Array.isArray(c.keyframes) ? (c.keyframes as ClipKeyframe[]) : [],
      textOverlay: (c.textOverlay as ClipTextOverlay | null | undefined) ?? null,
      notes: c.notes,
      sortOrder: c.sortOrder,
    };
  }

  async getTimeline(projectIdOrSlug: string): Promise<TimelineDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [projRows, trackRows, clipRows, renderRows, projectAssets] = await Promise.all([
      this.db
        .select({ timelineQualityMode: projects.timelineQualityMode })
        .from(projects)
        .where(eq(projects.id, project.id))
        .limit(1),
      this.db
        .select()
        .from(timelineTracks)
        .where(eq(timelineTracks.projectId, project.id))
        .orderBy(asc(timelineTracks.sortOrder), asc(timelineTracks.createdAt)),
      this.db
        .select()
        .from(timelineClips)
        .where(eq(timelineClips.projectId, project.id))
        .orderBy(asc(timelineClips.startSec), asc(timelineClips.sortOrder)),
      this.db
        .select()
        .from(timelineRenders)
        .where(eq(timelineRenders.projectId, project.id))
        .orderBy(desc(timelineRenders.createdAt))
        .limit(20),
      this.db
        .select()
        .from(assets)
        .where(eq(assets.projectId, project.id)),
    ]);

    const qualityMode = (projRows[0]?.timelineQualityMode ?? 'draft_proxy') as TimelineQualityMode;
    const assetMap = new Map<string, typeof assets.$inferSelect>();
    for (const a of projectAssets) {
      assetMap.set(a.id, a);
    }

    const clipsByTrack = new Map<string, TimelineClipDto[]>();
    let maxEndSec = 0;

    for (const c of clipRows) {
      const asset = c.assetId ? assetMap.get(c.assetId) : undefined;
      const clipEnd = c.startSec + c.durationSec;
      if (clipEnd > maxEndSec) maxEndSec = clipEnd;

      const dto = this.toClipDto(c, asset);
      const list = clipsByTrack.get(c.trackId) ?? [];
      list.push(dto);
      clipsByTrack.set(c.trackId, list);
    }

    const tracks: TimelineTrackDto[] = trackRows.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      type: t.trackType as TimelineTrackType,
      muted: t.muted,
      locked: t.locked,
      volume: t.volume,
      sortOrder: t.sortOrder,
      clips: clipsByTrack.get(t.id) ?? [],
    }));

    const renders: TimelineRenderDto[] = renderRows.map((r) => {
      const outAsset = r.outputAssetId ? assetMap.get(r.outputAssetId) : undefined;
      return {
        id: r.id,
        projectId: r.projectId,
        qualityMode: r.qualityMode as TimelineQualityMode,
        resolution: r.resolution,
        fps: r.fps,
        status: r.status as TimelineRenderStatus,
        progress: r.progress,
        outputAssetId: r.outputAssetId,
        outputAssetHandle: outAsset ? buildAssetHandle(outAsset.refCode) : null,
        durationSec: r.durationSec,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      };
    });

    return {
      projectId: project.id,
      projectSlug: project.slug,
      fps: project.fps,
      resolution: project.targetResolution,
      qualityMode,
      totalDurationSec: Math.round(maxEndSec * 1000) / 1000,
      tracks,
      renders,
    };
  }

  private async resolveClipAssetId(
    projectSlug: string,
    assetId?: string | null,
    assetRef?: string | null,
  ): Promise<string | null> {
    let resolvedAssetId: string | null = assetId ?? null;
    if (!resolvedAssetId && assetRef) {
      const resolved = await this.studio.resolveReference(assetRef, projectSlug);
      resolvedAssetId = resolved?.asset?.id ?? null;
    }
    if (resolvedAssetId && !UUID_REGEX.test(resolvedAssetId)) {
      resolvedAssetId = null;
    }
    return resolvedAssetId;
  }

  async saveTimeline(
    projectIdOrSlug: string,
    input: UpsertTimelineInput,
    actor: Actor = 'user',
  ): Promise<TimelineDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    if (input.qualityMode) {
      await this.db
        .update(projects)
        .set({ timelineQualityMode: input.qualityMode, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    }

    // Replace tracks & clips cleanly for this project
    await this.db.delete(timelineTracks).where(eq(timelineTracks.projectId, project.id));

    for (let tIdx = 0; tIdx < input.tracks.length; tIdx += 1) {
      const tr = input.tracks[tIdx]!;
      const [createdTrack] = await this.db
        .insert(timelineTracks)
        .values({
          projectId: project.id,
          trackType: tr.type,
          name: tr.name,
          sortOrder: tIdx,
          muted: tr.muted,
          locked: tr.locked,
          volume: tr.volume,
        })
        .returning();

      if (!createdTrack) continue;

      for (let cIdx = 0; cIdx < tr.clips.length; cIdx += 1) {
        const cl = tr.clips[cIdx]!;
        const resolvedAssetId = await this.resolveClipAssetId(project.slug, cl.assetId, cl.assetRef);

        await this.db.insert(timelineClips).values({
          projectId: project.id,
          trackId: createdTrack.id,
          assetId: resolvedAssetId,
          title: cl.title,
          startSec: cl.startSec,
          durationSec: cl.durationSec,
          inSec: cl.inSec,
          outSec: cl.outSec ?? null,
          speed: cl.speed ?? 1,
          transition: cl.transition,
          transitionDurationSec: cl.transitionDurationSec,
          volume: cl.volume,
          fadeInSec: cl.fadeInSec ?? 0,
          fadeOutSec: cl.fadeOutSec ?? 0,
          muted: cl.muted,
          transform: this.normalizeTransform(cl.transform),
          colorAdjust: this.normalizeColorAdjust(cl.colorAdjust),
          effects: cl.effects ?? [],
          keyframes: cl.keyframes ?? [],
          textOverlay: cl.textOverlay ?? null,
          notes: cl.notes,
          sortOrder: cIdx,
        });
      }
    }

    const dto = await this.getTimeline(project.id);
    if (!dto) return null;

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.saved',
      summary: `Timeline sauvegardée (${dto.tracks.length} pistes · ${dto.totalDurationSec.toFixed(1)}s)`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return dto;
  }

  // ============================================================================
  // Surgical CapCut Clip Editing Operations (Web UI + Claude MCP)
  // ============================================================================

  async addClip(
    projectIdOrSlug: string,
    input: AddTimelineClipInput,
    actor: Actor = 'user',
  ): Promise<{ timeline: TimelineDto; clip: TimelineClipDto } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const existingTracks = await this.db
      .select()
      .from(timelineTracks)
      .where(eq(timelineTracks.projectId, project.id))
      .orderBy(asc(timelineTracks.sortOrder), asc(timelineTracks.createdAt));

    let targetTrack = input.trackId
      ? existingTracks.find((t) => t.id === input.trackId)
      : existingTracks.find((t) => t.trackType === input.trackType);

    if (!targetTrack) {
      const defaultLabels: Record<TimelineTrackType, string> = {
        video: 'V1 · Vidéo Principale',
        overlay: 'V2 · Overlay / PiP',
        text: 'T1 · Titres & Textes',
        effect: 'FX1 · Effets',
        audio: 'A1 · Audio / Musique',
      };
      const [created] = await this.db
        .insert(timelineTracks)
        .values({
          projectId: project.id,
          trackType: input.trackType,
          name: input.trackName || defaultLabels[input.trackType],
          sortOrder: existingTracks.length,
          muted: false,
          locked: false,
          volume: 1,
        })
        .returning();
      targetTrack = created;
    }

    if (!targetTrack) throw new Error('Unable to resolve or create timeline track');

    const trackClips = await this.db
      .select()
      .from(timelineClips)
      .where(eq(timelineClips.trackId, targetTrack.id))
      .orderBy(asc(timelineClips.startSec));

    const autoStartSec = trackClips.reduce(
      (maxEnd, c) => Math.max(maxEnd, c.startSec + c.durationSec),
      0,
    );
    const startSec =
      input.startSec !== undefined ? input.startSec : Math.round(autoStartSec * 1000) / 1000;

    const resolvedAssetId = await this.resolveClipAssetId(project.slug, input.assetId, input.assetRef);

    const [createdClip] = await this.db
      .insert(timelineClips)
      .values({
        projectId: project.id,
        trackId: targetTrack.id,
        assetId: resolvedAssetId,
        title: input.title,
        startSec,
        durationSec: input.durationSec,
        inSec: input.inSec ?? 0,
        outSec: input.outSec ?? null,
        speed: input.speed ?? 1,
        transition: input.transition ?? 'cut',
        transitionDurationSec: input.transitionDurationSec ?? 0,
        volume: input.volume ?? 1,
        fadeInSec: input.fadeInSec ?? 0,
        fadeOutSec: input.fadeOutSec ?? 0,
        muted: input.muted ?? false,
        transform: this.normalizeTransform(input.transform),
        colorAdjust: this.normalizeColorAdjust(input.colorAdjust),
        effects: input.effects ?? [],
        keyframes: input.keyframes ?? [],
        textOverlay: input.textOverlay ?? null,
        notes: input.notes ?? '',
        sortOrder: trackClips.length,
      })
      .returning();

    if (!createdClip) throw new Error('Failed to create timeline clip');

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;
    const clipDto = timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === createdClip.id);
    if (!clipDto) throw new Error('Created clip not found in timeline');

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.clip_added',
      summary: `Clip ajouté : "${clipDto.title}" sur ${targetTrack.name} (${clipDto.startSec.toFixed(1)}s · ${clipDto.durationSec.toFixed(1)}s)`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return { timeline, clip: clipDto };
  }

  async updateClip(
    projectIdOrSlug: string,
    clipId: string,
    patch: PatchTimelineClipInput,
    actor: Actor = 'user',
  ): Promise<{ timeline: TimelineDto; clip: TimelineClipDto } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [existing] = await this.db
      .select()
      .from(timelineClips)
      .where(and(eq(timelineClips.id, clipId), eq(timelineClips.projectId, project.id)))
      .limit(1);
    if (!existing) return null;

    let nextAssetId = existing.assetId;
    if (patch.assetId !== undefined || patch.assetRef !== undefined) {
      nextAssetId = await this.resolveClipAssetId(project.slug, patch.assetId, patch.assetRef);
    }

    const nextTransform = patch.transform
      ? this.normalizeTransform({ ...existing.transform, ...patch.transform })
      : this.normalizeTransform(existing.transform);

    const nextColor = patch.colorAdjust
      ? this.normalizeColorAdjust({ ...existing.colorAdjust, ...patch.colorAdjust })
      : this.normalizeColorAdjust(existing.colorAdjust);

    await this.db
      .update(timelineClips)
      .set({
        trackId: patch.trackId ?? existing.trackId,
        assetId: nextAssetId,
        title: patch.title ?? existing.title,
        startSec: patch.startSec ?? existing.startSec,
        durationSec: patch.durationSec ?? existing.durationSec,
        inSec: patch.inSec ?? existing.inSec,
        outSec: patch.outSec !== undefined ? patch.outSec : existing.outSec,
        speed: patch.speed ?? existing.speed,
        transition: patch.transition ?? existing.transition,
        transitionDurationSec: patch.transitionDurationSec ?? existing.transitionDurationSec,
        volume: patch.volume ?? existing.volume,
        fadeInSec: patch.fadeInSec ?? existing.fadeInSec,
        fadeOutSec: patch.fadeOutSec ?? existing.fadeOutSec,
        muted: patch.muted ?? existing.muted,
        transform: nextTransform,
        colorAdjust: nextColor,
        effects: patch.effects ?? existing.effects,
        keyframes: patch.keyframes ?? existing.keyframes,
        textOverlay: patch.textOverlay !== undefined ? patch.textOverlay : existing.textOverlay,
        notes: patch.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(timelineClips.id, existing.id));

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;
    const clipDto = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === existing.id);
    if (!clipDto) return null;

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.clip_updated',
      summary: `Clip modifié : "${clipDto.title}" (${clipDto.startSec.toFixed(1)}s · ${clipDto.durationSec.toFixed(1)}s)`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return { timeline, clip: clipDto };
  }

  async splitClip(
    projectIdOrSlug: string,
    clipId: string,
    splitAtSec: number,
    actor: Actor = 'user',
  ): Promise<{ timeline: TimelineDto; leftClip: TimelineClipDto; rightClip: TimelineClipDto } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [existing] = await this.db
      .select()
      .from(timelineClips)
      .where(and(eq(timelineClips.id, clipId), eq(timelineClips.projectId, project.id)))
      .limit(1);
    if (!existing) return null;

    const split = splitClipAtTime(
      {
        title: existing.title,
        startSec: existing.startSec,
        durationSec: existing.durationSec,
        inSec: existing.inSec,
        outSec: existing.outSec,
        speed: existing.speed ?? 1,
        fadeInSec: existing.fadeInSec ?? 0,
        fadeOutSec: existing.fadeOutSec ?? 0,
        transition: existing.transition as TimelineTransition,
        transitionDurationSec: existing.transitionDurationSec,
        keyframes: Array.isArray(existing.keyframes) ? existing.keyframes : [],
      },
      splitAtSec,
    );

    if (!split) {
      throw new Error(
        `Impossible de couper à ${splitAtSec.toFixed(2)}s : la position doit être à l'intérieur du clip [${existing.startSec.toFixed(2)}s .. ${(existing.startSec + existing.durationSec).toFixed(2)}s] avec au moins 0.15s de marge.`,
      );
    }

    await this.db
      .update(timelineClips)
      .set({
        durationSec: split.left.durationSec,
        outSec: split.left.outSec,
        fadeOutSec: split.left.fadeOutSec,
        keyframes: split.left.keyframes,
        updatedAt: new Date(),
      })
      .where(eq(timelineClips.id, existing.id));

    const [createdRight] = await this.db
      .insert(timelineClips)
      .values({
        projectId: existing.projectId,
        trackId: existing.trackId,
        assetId: existing.assetId,
        title: split.right.title,
        startSec: split.right.startSec,
        durationSec: split.right.durationSec,
        inSec: split.right.inSec,
        outSec: split.right.outSec,
        speed: existing.speed ?? 1,
        transition: split.right.transition,
        transitionDurationSec: split.right.transitionDurationSec,
        volume: existing.volume,
        fadeInSec: 0,
        fadeOutSec: existing.fadeOutSec ?? 0,
        muted: existing.muted,
        transform: existing.transform,
        colorAdjust: existing.colorAdjust,
        effects: existing.effects,
        keyframes: split.right.keyframes,
        textOverlay: existing.textOverlay,
        notes: existing.notes,
        sortOrder: existing.sortOrder + 1,
      })
      .returning();

    if (!createdRight) throw new Error('Failed to create split right clip');

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;
    const allClips = timeline.tracks.flatMap((t) => t.clips);
    const leftClip = allClips.find((c) => c.id === existing.id);
    const rightClip = allClips.find((c) => c.id === createdRight.id);
    if (!leftClip || !rightClip) return null;

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.clip_split',
      summary: `Clip coupé à ${splitAtSec.toFixed(2)}s : "${existing.title}"`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return { timeline, leftClip, rightClip };
  }

  async deleteClip(
    projectIdOrSlug: string,
    clipId: string,
    options: { ripple?: boolean } = {},
    actor: Actor = 'user',
  ): Promise<{ timeline: TimelineDto; deletedClipId: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [existing] = await this.db
      .select()
      .from(timelineClips)
      .where(and(eq(timelineClips.id, clipId), eq(timelineClips.projectId, project.id)))
      .limit(1);
    if (!existing) return null;

    await this.db.delete(timelineClips).where(eq(timelineClips.id, existing.id));

    if (options.ripple) {
      const trailing = await this.db
        .select()
        .from(timelineClips)
        .where(
          and(
            eq(timelineClips.trackId, existing.trackId),
            gt(timelineClips.startSec, existing.startSec),
          ),
        );
      for (const tClip of trailing) {
        const nextStart = Math.max(
          0,
          Math.round((tClip.startSec - existing.durationSec) * 1000) / 1000,
        );
        await this.db
          .update(timelineClips)
          .set({ startSec: nextStart, updatedAt: new Date() })
          .where(eq(timelineClips.id, tClip.id));
      }
    }

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.clip_deleted',
      summary: `Clip supprimé : "${existing.title}"${options.ripple ? ' (ripple)' : ''}`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return { timeline, deletedClipId: existing.id };
  }

  async clearRenderCache(projectIdOrSlug: string): Promise<{ clearedFiles: number } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const cacheDir = resolveSafePath(
      this.config.dataDir,
      path.join('.render-cache', project.id),
    );
    let clearedFiles = 0;
    try {
      const files = await fs.readdir(cacheDir);
      clearedFiles = files.length;
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {
      // No cache directory yet
    }
    return { clearedFiles };
  }

  async buildTimelineFromStoryboard(
    projectIdOrSlug: string,
    options: { includeAudio?: boolean } = {},
    actor: Actor = 'user',
  ): Promise<TimelineDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const storyboard = await this.stage3.getStoryboard(project.id);
    const audioList = options.includeAudio !== false ? await this.stage3.listAudioTracks(project.id) : [];

    const videoClips: UpsertTimelineInput['tracks'][number]['clips'] = [];
    let cursorSec = 0;

    for (const scene of storyboard) {
      for (const shot of scene.shots) {
        const startSec = shot.startSec ?? Math.round(cursorSec * 1000) / 1000;
        const durationSec = Math.max(0.25, shot.durationSec);
        const chosenAssetId = shot.videoAssetId ?? shot.keyframeAssetId ?? null;

        videoClips.push({
          assetId: chosenAssetId,
          title: `${shot.externalId || shot.shotCode} · ${shot.title}`,
          startSec,
          durationSec,
          inSec: 0,
          outSec: null,
          speed: 1,
          transition: 'cut',
          transitionDurationSec: 0,
          volume: 1,
          fadeInSec: 0,
          fadeOutSec: 0,
          muted: false,
          notes: shot.cameraMovement || shot.visualDescription.slice(0, 140),
        });

        cursorSec = startSec + durationSec;
      }
    }

    const totalVisualSec = Math.max(4, cursorSec);
    const tracksInput: UpsertTimelineInput['tracks'] = [
      {
        type: 'video',
        name: 'V1 · Animatique / Plans',
        muted: false,
        locked: false,
        volume: 1,
        clips: videoClips,
      },
    ];

    const musicTrack =
      audioList.find((a) => a.category === 'music' && a.assetId) ??
      audioList.find((a) => a.assetId);
    if (musicTrack?.assetId) {
      const audioAsset = await this.studio.getAssetById(musicTrack.assetId);
      const audioDur = audioAsset?.asset.durationSec ?? totalVisualSec;
      tracksInput.push({
        type: 'audio',
        name: `A1 · ${musicTrack.title}`,
        muted: false,
        locked: false,
        volume: 0.9,
        clips: [
          {
            assetId: musicTrack.assetId,
            title: musicTrack.title,
            startSec: 0,
            durationSec: Math.min(Math.max(audioDur, 1), Math.max(totalVisualSec, audioDur)),
            inSec: 0,
            outSec: null,
            speed: 1,
            transition: 'cut',
            transitionDurationSec: 0,
            volume: 1,
            fadeInSec: 0,
            fadeOutSec: 0,
            muted: false,
            notes: musicTrack.bpm ? `${musicTrack.bpm} BPM` : '',
          },
        ],
      });
    } else {
      tracksInput.push({
        type: 'audio',
        name: 'A1 · Musique / Voix',
        muted: false,
        locked: false,
        volume: 1,
        clips: [],
      });
    }

    return this.saveTimeline(project.id, { tracks: tracksInput }, actor);
  }

  /**
   * Swap timeline clip assets between Draft Proxy (draft_proxy) and HQ Master (hq_master) versions.
   */
  async swapTimelineQualityMode(
    projectIdOrSlug: string,
    mode: TimelineQualityMode,
    actor: Actor = 'user',
  ): Promise<{ timeline: TimelineDto; swappedCount: number } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    await this.db
      .update(projects)
      .set({ timelineQualityMode: mode, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    const [clipRows, projectAssets] = await Promise.all([
      this.db.select().from(timelineClips).where(eq(timelineClips.projectId, project.id)),
      this.db
        .select()
        .from(assets)
        .where(eq(assets.projectId, project.id))
        .orderBy(desc(assets.createdAt)),
    ]);

    const byId = new Map(projectAssets.map((a) => [a.id, a]));
    const childrenByParent = new Map<string, Array<typeof assets.$inferSelect>>();
    for (const a of projectAssets) {
      if (a.parentAssetId) {
        const list = childrenByParent.get(a.parentAssetId) ?? [];
        list.push(a);
        childrenByParent.set(a.parentAssetId, list);
      }
    }

    let swappedCount = 0;

    for (const clip of clipRows) {
      if (!clip.assetId) continue;
      const current = byId.get(clip.assetId);
      if (!current) continue;

      let targetId: string | null = null;

      if (mode === 'hq_master') {
        const kids = childrenByParent.get(current.id) ?? [];
        const hqKid =
          kids.find((k) => k.qualityTier === 'final_master') ??
          kids.find((k) => k.qualityTier === 'hq_upscale') ??
          kids.find((k) => k.relationType === 'upscale');
        if (hqKid && hqKid.id !== current.id) {
          targetId = hqKid.id;
        }
      } else {
        if (
          (current.qualityTier === 'hq_upscale' ||
            current.qualityTier === 'final_master' ||
            current.relationType === 'upscale') &&
          current.parentAssetId
        ) {
          const parent = byId.get(current.parentAssetId);
          if (parent && (parent.qualityTier === 'draft_lowres' || parent.qualityTier === 'test')) {
            targetId = parent.id;
          }
        }
      }

      if (targetId) {
        await this.db
          .update(timelineClips)
          .set({ assetId: targetId, updatedAt: new Date() })
          .where(eq(timelineClips.id, clip.id));
        swappedCount += 1;
      }
    }

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'timeline.quality_swapped',
      summary: `Timeline basculée en mode ${mode === 'hq_master' ? 'HQ MASTER' : 'DRAFT PROXY'} (${swappedCount} clip(s) permutés)`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return { timeline, swappedCount };
  }

  async exportNle(
    projectIdOrSlug: string,
    format: NleExportFormat,
  ): Promise<{ filename: string; mimeType: string; content: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;
    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;

    const projectAssets = await this.db
      .select({ id: assets.id, originalFilename: assets.originalFilename })
      .from(assets)
      .where(eq(assets.projectId, project.id));
    const assetFileMap = new Map(projectAssets.map((a) => [a.id, a.originalFilename]));

    if (format === 'edl') {
      return {
        filename: `${project.slug}-timeline.edl`,
        mimeType: 'text/plain; charset=utf-8',
        content: generateEdl(timeline, project.name, assetFileMap),
      };
    }
    if (format === 'fcpxml') {
      return {
        filename: `${project.slug}-timeline.fcpxml`,
        mimeType: 'application/xml; charset=utf-8',
        content: generateFcpxml(timeline, project.name, assetFileMap),
      };
    }
    return {
      filename: `${project.slug}-timeline.otio`,
      mimeType: 'application/json; charset=utf-8',
      content: generateOtio(timeline, project.name, assetFileMap),
    };
  }

  async startServerRender(
    projectIdOrSlug: string,
    input: StartTimelineRenderInput,
    actor: Actor = 'user',
  ): Promise<{ render: TimelineRenderDto; jobId: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const timeline = await this.getTimeline(project.id);
    if (!timeline) return null;

    const videoClips = timeline.tracks
      .filter((t) => t.type === 'video' && !t.muted)
      .flatMap((t) => t.clips)
      .filter((c) => !c.muted && c.assetId)
      .sort((a, b) => a.startSec - b.startSec);

    if (videoClips.length === 0) {
      throw new Error('La timeline ne contient aucun clip vidéo ou image lié à un asset.');
    }

    const qualityMode: TimelineQualityMode = input.qualityMode ?? timeline.qualityMode ?? 'draft_proxy';
    const resolution =
      input.resolution ??
      (qualityMode === 'hq_master' ? project.targetResolution : '1280x720');
    const fps = input.fps ?? project.fps ?? 24;
    const estSeconds = Math.max(5, Math.round(videoClips.length * (qualityMode === 'hq_master' ? 3 : 1.5)));

    const job = await this.studio.startJob({
      projectIdOrSlug: project.id,
      type: 'timeline_render',
      title: `Rendu FFmpeg ${qualityMode === 'hq_master' ? 'HQ MASTER' : 'DRAFT'} (${resolution} @ ${fps}fps)`,
      stepCurrent: 0,
      stepTotal: videoClips.length + 1,
      message: 'Préparation du rendu incrémental FFmpeg...',
      etaSeconds: estSeconds,
    });

    const [createdRender] = await this.db
      .insert(timelineRenders)
      .values({
        projectId: project.id,
        jobId: job.id,
        qualityMode,
        resolution,
        fps,
        status: 'rendering',
        progress: 5,
        durationSec: timeline.totalDurationSec,
      })
      .returning();

    if (!createdRender) throw new Error('Failed to create timeline render record');

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    // Launch background CapCut FFmpeg pipeline with incremental per-segment caching
    void this.runFfmpegRenderPipeline({
      renderId: createdRender.id,
      jobId: job.id,
      projectId: project.id,
      projectSlug: project.slug,
      timeline,
      videoClips,
      qualityMode,
      resolution,
      fps,
      title: input.title,
      burnSubtitles: Boolean(input.burnSubtitles),
      bypassCache: Boolean(input.bypassCache),
      actor,
    });

    return {
      jobId: job.id,
      render: {
        id: createdRender.id,
        projectId: createdRender.projectId,
        qualityMode: createdRender.qualityMode as TimelineQualityMode,
        resolution: createdRender.resolution,
        fps: createdRender.fps,
        status: 'rendering',
        progress: createdRender.progress,
        outputAssetId: null,
        outputAssetHandle: null,
        durationSec: createdRender.durationSec,
        errorMessage: null,
        createdAt: createdRender.createdAt.toISOString(),
        completedAt: null,
      },
    };
  }

  private async pruneProjectRenderCache(cacheDir: string): Promise<void> {
    try {
      const names = await fs.readdir(cacheDir);
      if (names.length <= MAX_CACHED_SEGMENTS_PER_PROJECT) return;
      const stats = await Promise.all(
        names.map(async (name) => {
          const full = path.join(cacheDir, name);
          const st = await fs.stat(full).catch(() => null);
          return { full, mtimeMs: st?.mtimeMs ?? 0 };
        }),
      );
      stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toDelete = stats.slice(0, stats.length - MAX_CACHED_SEGMENTS_PER_PROJECT);
      await Promise.all(toDelete.map((f) => fs.rm(f.full, { force: true }).catch(() => undefined)));
    } catch {
      // Ignore cache prune errors
    }
  }

  private async runFfmpegRenderPipeline(params: {
    renderId: string;
    jobId: string;
    projectId: string;
    projectSlug: string;
    timeline: TimelineDto;
    videoClips: TimelineClipDto[];
    qualityMode: TimelineQualityMode;
    resolution: string;
    fps: number;
    title?: string;
    burnSubtitles?: boolean;
    bypassCache?: boolean;
    actor: Actor;
  }): Promise<void> {
    const tmpDir = resolveSafePath(
      this.config.dataDir,
      path.join('.tmp', `render-${crypto.randomUUID()}`),
    );
    const cacheDir = resolveSafePath(
      this.config.dataDir,
      path.join('.render-cache', params.projectId),
    );
    await Promise.all([
      fs.mkdir(tmpDir, { recursive: true }),
      fs.mkdir(cacheDir, { recursive: true }),
    ]);

    const [wStr, hStr] = params.resolution.split('x');
    const width = Math.max(320, Math.min(Number(wStr) || 1280, 3840));
    const height = Math.max(240, Math.min(Number(hStr) || 720, 2160));
    const crf = params.qualityMode === 'hq_master' ? '18' : '24';
    const preset = params.qualityMode === 'hq_master' ? 'medium' : 'veryfast';

    const startedAt = Date.now();
    const totalSteps = params.videoClips.length + 1;
    const effectCatalog: Map<string, VideoEffectDto> = this.effectsService
      ? await this.effectsService.getEffectsCatalogMap()
      : new Map();
    const usedEffectSlugs: string[] = [];

    let cacheHits = 0;
    let renderedSegments = 0;

    try {
      const renderedEntries: Array<{ clip: TimelineClipDto; segPath: string }> = [];

      // 1. Render or reuse cached video segments (Incremental Fast Re-Render!)
      for (let i = 0; i < params.videoClips.length; i += 1) {
        const clip = params.videoClips[i]!;
        if (!clip.assetId) continue;
        const assetInfo = await this.studio.getAssetById(clip.assetId);
        if (!assetInfo) continue;

        for (const fx of clip.effects ?? []) {
          if (fx.enabled) usedEffectSlugs.push(fx.effectSlug);
        }

        const sourcePath =
          params.qualityMode === 'draft_proxy' &&
          assetInfo.raw.proxyPath &&
          assetInfo.asset.type === 'video'
            ? this.media.resolveMediaFile(assetInfo.raw.proxyPath)
            : this.media.resolveMediaFile(assetInfo.raw.filePath);

        const sourceStat = await fs.stat(sourcePath).catch(() => null);
        const sourceFingerprint = `${assetInfo.asset.id}:${sourceStat?.size ?? 0}:${Math.round(sourceStat?.mtimeMs ?? 0)}`;
        const isImage = assetInfo.asset.type === 'image';

        const compiledVf = compileClipVideoFilterChain(clip, {
          width,
          height,
          fps: params.fps,
          isImage,
          effectCatalog,
        });

        const cacheSig = buildClipSegmentCacheSignature({
          sourceFingerprint,
          clip,
          width,
          height,
          fps: params.fps,
          qualityMode: params.qualityMode,
          compiledVideoFilter: compiledVf,
        });
        const segHash = crypto.createHash('sha256').update(cacheSig).digest('hex').slice(0, 24);
        const cachedSegPath = path.join(cacheDir, `${segHash}.mp4`);

        let segPath = cachedSegPath;
        let hit = false;
        if (!params.bypassCache) {
          const cachedStat = await fs.stat(cachedSegPath).catch(() => null);
          if (cachedStat && cachedStat.size > 0) {
            hit = true;
            cacheHits += 1;
            // Touch mtime for LRU retention
            const now = new Date();
            await fs.utimes(cachedSegPath, now, now).catch(() => undefined);
          }
        }

        if (!hit) {
          const segTmpOut = path.join(tmpDir, `seg-${String(i).padStart(4, '0')}.mp4`);
          const speed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
          const readDur = isImage
            ? Math.max(0.2, clip.durationSec)
            : Math.max(0.2, clip.durationSec * speed);

          if (isImage) {
            await this.media.executeFfmpeg([
              '-y',
              '-loop',
              '1',
              '-i',
              sourcePath,
              '-t',
              String(readDur),
              '-vf',
              compiledVf,
              '-c:v',
              'libx264',
              '-preset',
              preset,
              '-crf',
              crf,
              '-an',
              segTmpOut,
            ]);
          } else {
            await this.media.executeFfmpeg([
              '-y',
              '-ss',
              String(Math.max(0, clip.inSec)),
              '-i',
              sourcePath,
              '-t',
              String(readDur),
              '-vf',
              compiledVf,
              '-c:v',
              'libx264',
              '-preset',
              preset,
              '-crf',
              crf,
              '-an',
              segTmpOut,
            ]);
          }

          // Persist segment to project render cache for future fast re-renders
          await fs.copyFile(segTmpOut, cachedSegPath).catch(() => undefined);
          segPath = segTmpOut;
          renderedSegments += 1;
        }

        renderedEntries.push({ clip, segPath });

        const doneSteps = i + 1;
        const pct = Math.min(92, Math.round((doneSteps / totalSteps) * 100));
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const remainingEta = Math.max(
          1,
          Math.round((elapsedSec / doneSteps) * (totalSteps - doneSteps)),
        );

        await Promise.all([
          this.db
            .update(timelineRenders)
            .set({ progress: pct, updatedAt: new Date() })
            .where(eq(timelineRenders.id, params.renderId)),
          this.studio.updateJob(params.jobId, {
            status: 'running',
            progress: pct,
            stepCurrent: doneSteps,
            stepTotal: totalSteps,
            message: `${hit ? '⚡ Cache' : 'Encodage'} plan ${doneSteps}/${params.videoClips.length} (${clip.title}) · ${cacheHits} cache / ${renderedSegments} encodé(s)`,
            etaSeconds: remainingEta,
          }),
        ]);
      }

      if (renderedEntries.length === 0) {
        throw new Error('Aucun segment vidéo valide à assembler.');
      }

      void this.pruneProjectRenderCache(cacheDir);

      // 2. Collect global Text Track clips, Overlay Track clips, and Multi-Track Audio clips
      const textTrackClips = params.timeline.tracks
        .filter((t) => t.type === 'text' && !t.muted)
        .flatMap((t) => t.clips)
        .filter((c) => !c.muted && c.textOverlay?.text?.trim());

      const overlayTrackClips = params.timeline.tracks
        .filter((t) => t.type === 'overlay' && !t.muted)
        .flatMap((t) => t.clips)
        .filter((c) => !c.muted && c.assetId);

      const audioClipEntries: Array<{
        clip: TimelineClipDto;
        trackVolume: number;
        filePath: string;
      }> = [];
      for (const track of params.timeline.tracks) {
        if (track.type !== 'audio' || track.muted) continue;
        for (const aClip of track.clips) {
          if (aClip.muted || !aClip.assetId) continue;
          const aInfo = await this.studio.getAssetById(aClip.assetId);
          if (!aInfo) continue;
          for (const fx of aClip.effects ?? []) {
            if (fx.enabled) usedEffectSlugs.push(fx.effectSlug);
          }
          audioClipEntries.push({
            clip: aClip,
            trackVolume: track.volume,
            filePath: this.media.resolveMediaFile(aInfo.raw.filePath),
          });
        }
      }

      const overlayAssetEntries: Array<{
        clip: TimelineClipDto;
        filePath: string;
        isImage: boolean;
      }> = [];
      for (const ovClip of overlayTrackClips) {
        if (!ovClip.assetId) continue;
        const ovInfo = await this.studio.getAssetById(ovClip.assetId);
        if (!ovInfo) continue;
        overlayAssetEntries.push({
          clip: ovClip,
          filePath: this.media.resolveMediaFile(ovInfo.raw.filePath),
          isImage: ovInfo.asset.type === 'image',
        });
      }

      // Optional subtitle burn-in filter
      let subtitleBurnFilter: string | null = null;
      if (params.burnSubtitles) {
        const subs = await this.getSubtitles(params.projectId);
        if (subs && subs.cues.length > 0) {
          const srtContent = serializeSrt(subs.cues);
          if (srtContent.trim()) {
            const srtPath = path.join(tmpDir, 'subtitles.srt');
            await fs.writeFile(srtPath, srtContent, 'utf8');
            subtitleBurnFilter = buildFfmpegSubtitleFilter(srtPath, subs.style);
          }
        }
      }

      // 3. Assemble base video (fast concat if all cuts, or real FFmpeg xfade chain!)
      const xfadePlan = computeXfadeChainPlan(renderedEntries.map((e) => e.clip));
      const needsReencodePass =
        xfadePlan.hasTransitions ||
        textTrackClips.length > 0 ||
        overlayAssetEntries.length > 0 ||
        Boolean(subtitleBurnFilter);

      const finalOutPath = path.join(tmpDir, 'render-final.mp4');

      await this.studio.updateJob(params.jobId, {
        status: 'running',
        progress: 95,
        stepCurrent: params.videoClips.length,
        stepTotal: totalSteps,
        message: `Assemblage final MP4 (${cacheHits} en cache · ${xfadePlan.hasTransitions ? 'transitions xfade' : 'concat rapide'}${audioClipEntries.length > 1 ? ` · ${audioClipEntries.length} pistes audio` : ''})...`,
        etaSeconds: needsReencodePass ? 8 : 3,
      });

      const ffmpegArgs: string[] = ['-y'];
      const filterComplexParts: string[] = [];
      let currentVideoLabel = '';
      let nextInputIdx = 0;

      if (xfadePlan.hasTransitions && renderedEntries.length > 1) {
        for (const entry of renderedEntries) {
          ffmpegArgs.push('-i', entry.segPath);
        }
        nextInputIdx = renderedEntries.length;

        let prevLabel = '[0:v]';
        for (let s = 0; s < xfadePlan.steps.length; s += 1) {
          const step = xfadePlan.steps[s]!;
          const outLabel = `[vx${s}]`;
          filterComplexParts.push(
            `${prevLabel}[${step.toIndex}:v]xfade=transition=${step.transition}:duration=${step.durationSec}:offset=${step.offsetSec}${outLabel}`,
          );
          prevLabel = outLabel;
        }
        currentVideoLabel = prevLabel;
      } else {
        const concatListPath = path.join(tmpDir, 'concat.txt');
        const concatContent = renderedEntries
          .map((e) => `file '${e.segPath.replace(/'/g, "'\\''")}'`)
          .join('\n');
        await fs.writeFile(concatListPath, concatContent, 'utf8');
        ffmpegArgs.push('-f', 'concat', '-safe', '0', '-i', concatListPath);
        nextInputIdx = 1;
        currentVideoLabel = '[0:v]';
      }

      // Composite Overlay / PiP track clips over main video
      for (let oi = 0; oi < overlayAssetEntries.length; oi += 1) {
        const ov = overlayAssetEntries[oi]!;
        const ovInputIdx = nextInputIdx++;
        if (ov.isImage) {
          ffmpegArgs.push('-loop', '1', '-t', String(Math.max(0.2, ov.clip.durationSec)), '-i', ov.filePath);
        } else {
          ffmpegArgs.push(
            '-ss',
            String(Math.max(0, ov.clip.inSec)),
            '-t',
            String(Math.max(0.2, ov.clip.durationSec)),
            '-i',
            ov.filePath,
          );
        }

        const tr = this.normalizeTransform(ov.clip.transform);
        const ovW = Math.max(32, Math.round(width * Math.min(1, Math.max(0.1, tr.scale * 0.45))));
        const posX = `Math.round((W-w)/2 + (${tr.x})*(W/2))`.replace('Math.round', '');
        const xExpr = `(W-w)/2+(${tr.x})*(W/2)`;
        const yExpr = `(H-h)/2+(${tr.y})*(H/2)`;
        void posX;
        const startT = Math.max(0, ov.clip.startSec);
        const endT = startT + Math.max(0.1, ov.clip.durationSec);
        const prepLabel = `[ovp${oi}]`;
        const outLabel = `[vov${oi}]`;

        filterComplexParts.push(
          `[${ovInputIdx}:v]scale=${ovW}:-2,format=rgba,colorchannelmixer=aa=${tr.opacity.toFixed(3)},setpts=PTS-STARTPTS+${startT.toFixed(3)}/TB${prepLabel}`,
        );
        filterComplexParts.push(
          `${currentVideoLabel}${prepLabel}overlay=x=${xExpr}:y=${yExpr}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})':eof_action=pass${outLabel}`,
        );
        currentVideoLabel = outLabel;
      }

      // Apply Text track clips (`drawtext` with timed `enable='between(t,start,end)'`)
      if (textTrackClips.length > 0) {
        const drawtextChain = textTrackClips
          .map((tc) => {
            const base = buildDrawtextFilter(tc.textOverlay!, width, height);
            const startT = Math.max(0, tc.startSec);
            const endT = startT + Math.max(0.1, tc.durationSec);
            return `${base}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'`;
          })
          .join(',');
        const outLabel = '[vtxt]';
        filterComplexParts.push(`${currentVideoLabel}${drawtextChain}${outLabel}`);
        currentVideoLabel = outLabel;
      }

      // Apply Subtitle burn-in if requested
      if (subtitleBurnFilter) {
        const outLabel = '[vsub]';
        filterComplexParts.push(`${currentVideoLabel}${subtitleBurnFilter}${outLabel}`);
        currentVideoLabel = outLabel;
      }

      // Mix ALL Audio track clips with adelay + volume + afade + audio_fx + amix
      let finalAudioLabel: string | null = null;
      if (audioClipEntries.length > 0) {
        const audioOutLabels: string[] = [];
        for (let ai = 0; ai < audioClipEntries.length; ai += 1) {
          const entry = audioClipEntries[ai]!;
          const aInputIdx = nextInputIdx++;
          ffmpegArgs.push('-i', entry.filePath);
          const aChain = compileClipAudioFilterChain(entry.clip, entry.trackVolume, effectCatalog);
          const aLabel = `[aud${ai}]`;
          filterComplexParts.push(`[${aInputIdx}:a]${aChain}${aLabel}`);
          audioOutLabels.push(aLabel);
        }

        if (audioOutLabels.length === 1) {
          finalAudioLabel = audioOutLabels[0]!;
        } else {
          filterComplexParts.push(
            `${audioOutLabels.join('')}amix=inputs=${audioOutLabels.length}:duration=longest:dropout_transition=0:normalize=0[amixed]`,
          );
          finalAudioLabel = '[amixed]';
        }
      }

      // Map outputs cleanly
      if (filterComplexParts.length > 0) {
        ffmpegArgs.push('-filter_complex', filterComplexParts.join(';'));
        if (needsReencodePass) {
          ffmpegArgs.push(
            '-map',
            currentVideoLabel,
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-crf',
            crf,
            '-pix_fmt',
            'yuv420p',
          );
        } else {
          ffmpegArgs.push('-map', '0:v', '-c:v', 'copy');
        }
        if (finalAudioLabel) {
          ffmpegArgs.push(
            '-map',
            finalAudioLabel,
            '-c:a',
            'aac',
            '-b:a',
            params.qualityMode === 'hq_master' ? '256k' : '128k',
            '-shortest',
          );
        }
      } else {
        ffmpegArgs.push('-c:v', 'copy');
      }

      ffmpegArgs.push('-movflags', '+faststart', finalOutPath);
      await this.media.executeFfmpeg(ffmpegArgs);

      if (usedEffectSlugs.length > 0) {
        void this.effectsService?.incrementUsage(usedEffectSlugs);
      }

      const renderedBuffer = await fs.readFile(finalOutPath);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const renderFilename = `${params.projectSlug}-${params.qualityMode}-${stamp}.mp4`;

      const cacheNote = `⚡ ${cacheHits}/${renderedEntries.length} segment(s) du cache`;
      const registeredAsset = await this.studio.ingestAssetFromBuffer({
        projectIdOrSlug: params.projectId,
        buffer: renderedBuffer,
        filename: renderFilename,
        mimeType: 'video/mp4',
        explicitType: 'video',
        folderPath: 'renders',
        title:
          params.title?.trim() ||
          `Rendu ${params.qualityMode === 'hq_master' ? 'HQ MASTER' : 'DRAFT'} (${params.resolution})${subtitleBurnFilter ? ' · ST' : ''}`,
        qualityTier: params.qualityMode === 'hq_master' ? 'final_master' : 'draft_lowres',
        tags: [
          'render',
          'timeline',
          params.qualityMode,
          ...(subtitleBurnFilter ? ['subtitled'] : []),
          ...(usedEffectSlugs.length > 0 ? ['fx'] : []),
        ],
        notes: `Rendu serveur FFmpeg (${params.resolution} @ ${params.fps}fps, ${renderedEntries.length} clips, ${cacheNote}${subtitleBurnFilter ? ', sous-titres incrustés' : ''})`,
        createdBy: params.actor,
      });

      await this.db
        .update(timelineRenders)
        .set({
          status: 'completed',
          progress: 100,
          outputAssetId: registeredAsset.id,
          durationSec: registeredAsset.durationSec ?? xfadePlan.totalDurationSec,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timelineRenders.id, params.renderId));

      await this.studio.updateJob(params.jobId, {
        status: 'completed',
        progress: 100,
        stepCurrent: totalSteps,
        stepTotal: totalSteps,
        message: `Rendu terminé : ${registeredAsset.handle} (${cacheNote})`,
        etaSeconds: 0,
        resultAssetId: registeredAsset.id,
      });

      this.webhookService?.emit('timeline.rendered', params.projectId, {
        renderId: params.renderId,
        outputAssetId: registeredAsset.id,
        outputAssetHandle: registeredAsset.handle,
        qualityMode: params.qualityMode,
        resolution: params.resolution,
        fps: params.fps,
        cacheHits,
        renderedSegments,
      });

      this.realtime.broadcast({
        type: 'timeline.changed',
        payload: { projectId: params.projectId },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db
        .update(timelineRenders)
        .set({
          status: 'failed',
          errorMessage: msg.slice(0, 500),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timelineRenders.id, params.renderId));

      await this.studio.updateJob(params.jobId, {
        status: 'failed',
        errorMessage: msg.slice(0, 500),
        message: `Échec du rendu : ${msg.slice(0, 180)}`,
        etaSeconds: 0,
      });

      this.realtime.broadcast({
        type: 'timeline.changed',
        payload: { projectId: params.projectId },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ============================================================================
  // Synchronized Subtitles (SRT / VTT / LRC & FFmpeg Burn-in)
  // ============================================================================

  async getSubtitles(projectIdOrSlug: string): Promise<ProjectSubtitlesDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [row] = await this.db
      .select()
      .from(projectSubtitles)
      .where(eq(projectSubtitles.projectId, project.id))
      .limit(1);

    if (!row) {
      return {
        projectId: project.id,
        language: 'fr',
        cues: [],
        style: { ...DEFAULT_SUBTITLE_STYLE },
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      projectId: row.projectId,
      language: row.language,
      cues: Array.isArray(row.cues) ? row.cues : [],
      style: { ...DEFAULT_SUBTITLE_STYLE, ...(row.style ?? {}) },
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async saveSubtitles(
    projectIdOrSlug: string,
    input: SaveProjectSubtitlesInput,
    actor: Actor = 'user',
  ): Promise<ProjectSubtitlesDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const existing = await this.getSubtitles(project.id);
    const language = input.language?.trim() || existing?.language || 'fr';
    const cues = normalizeSubtitleCues(input.cues);
    const style: SubtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(existing?.style ?? {}),
      ...(input.style ?? {}),
    };
    const now = new Date();

    await this.db
      .insert(projectSubtitles)
      .values({
        projectId: project.id,
        language,
        cues,
        style,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectSubtitles.projectId,
        set: { language, cues, style, updatedAt: now },
      });

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'subtitles.saved',
      summary: `Sous-titres mis à jour (${cues.length} réplique(s) · ${language.toUpperCase()})`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return {
      projectId: project.id,
      language,
      cues,
      style,
      updatedAt: now.toISOString(),
    };
  }

  async importSubtitles(
    projectIdOrSlug: string,
    input: {
      source: 'raw' | 'audio_track' | 'storyboard';
      content?: string;
      audioTrackId?: string;
      replace?: boolean;
    },
    actor: Actor = 'user',
  ): Promise<{ subtitles: ProjectSubtitlesDto; importedCount: number } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const existing = await this.getSubtitles(project.id);
    let parsedCues: SubtitleCue[] = [];

    if (input.source === 'raw') {
      const raw = input.content ?? '';
      parsedCues = raw.includes('-->') ? parseSrtOrVtt(raw) : cuesFromLrc(raw);
    } else if (input.source === 'audio_track') {
      const tracks = await this.stage3.listAudioTracks(project.id);
      const track = input.audioTrackId
        ? tracks.find((t) => t.id === input.audioTrackId)
        : tracks.find((t) => t.lrcContent.trim() || t.srtContent.trim());
      if (track) {
        if (track.lrcContent.trim()) {
          parsedCues = cuesFromLrc(track.lrcContent);
        } else if (track.srtContent.trim()) {
          parsedCues = parseSrtOrVtt(track.srtContent);
        }
      }
    } else if (input.source === 'storyboard') {
      const scenes = await this.stage3.getStoryboard(project.id);
      let cursorSec = 0;
      let idx = 0;
      for (const scene of scenes) {
        for (const shot of scene.shots) {
          const start = shot.startSec >= 0 ? shot.startSec : cursorSec;
          const dur = Math.max(0.5, shot.durationSec || 3);
          const text = (shot.dialogue || shot.visualDescription || shot.title).trim();
          if (text) {
            parsedCues.push({
              id: `sb-cue-${++idx}`,
              startSec: Math.round(start * 1000) / 1000,
              endSec: Math.round((start + dur - 0.1) * 1000) / 1000,
              text: text.slice(0, 220),
              speaker: '',
            });
          }
          cursorSec = start + dur;
        }
      }
    }

    const merged =
      input.replace === false && existing ? [...existing.cues, ...parsedCues] : parsedCues;
    const saved = await this.saveSubtitles(
      project.id,
      {
        language: existing?.language ?? 'fr',
        cues: merged,
        style: existing?.style,
      },
      actor,
    );
    if (!saved) return null;

    return { subtitles: saved, importedCount: parsedCues.length };
  }

  async exportSubtitles(
    projectIdOrSlug: string,
    format: 'srt' | 'vtt' = 'srt',
  ): Promise<{ filename: string; mimeType: string; content: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;
    const subs = await this.getSubtitles(project.id);
    if (!subs) return null;

    if (format === 'vtt') {
      return {
        filename: `${project.slug}-${subs.language}.vtt`,
        mimeType: 'text/vtt; charset=utf-8',
        content: serializeVtt(subs.cues),
      };
    }

    return {
      filename: `${project.slug}-${subs.language}.srt`,
      mimeType: 'application/x-subrip; charset=utf-8',
      content: serializeSrt(subs.cues),
    };
  }

  async saveSubtitlesAsset(
    projectIdOrSlug: string,
    format: 'srt' | 'vtt' = 'srt',
    actor: Actor = 'user',
  ): Promise<{ asset: AssetDto; filename: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;
    const exported = await this.exportSubtitles(project.id, format);
    if (!exported) return null;

    const asset = await this.studio.ingestAssetFromBuffer({
      projectIdOrSlug: project.id,
      buffer: Buffer.from(exported.content, 'utf8'),
      filename: exported.filename,
      mimeType: 'text/plain',
      explicitType: 'document',
      folderPath: 'subtitles',
      title: `Sous-titres (${format.toUpperCase()}) — ${project.name}`,
      qualityTier: 'final_master',
      tags: ['subtitles', format],
      notes: `Export sous-titres synchronisés depuis Timeline NLE.`,
      createdBy: actor,
    });

    return { asset, filename: exported.filename };
  }
}

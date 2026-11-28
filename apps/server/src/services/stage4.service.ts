import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
  DEFAULT_CLIP_CINEMASCOPE,
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_SUBTITLE_STYLE,
  extractDownbeatTimesForClip,
  extractTimelineBeatMarkers,
  generateEdl,
  generateFcpxml,
  generateOtio,
  hasProceduralAmvFx,
  normalizeClipCamera,
  normalizeClipFx,
  normalizeSubtitleCues,
  parseSrtOrVtt,
  rippleTrackClips,
  serializeSrt,
  serializeVtt,
  sliceTimelineForRange,
  splitClipAtTime,
  type Actor,
  type AddTimelineClipInput,
  type AssetDto,
  type AssetType,
  type ClipAppliedEffect,
  type ClipCamera,
  type ClipCinemascope,
  type ClipColorAdjust,
  type ClipFx,
  type ClipKeyframe,
  type ClipTextOverlay,
  type ClipTransform,
  type NleExportFormat,
  type PatchTimelineClipInput,
  type PatchTimelineClipsInput,
  type ProjectSubtitlesDto,
  type QualityTier,
  type RenderTimelineRangeInput,
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
const MAX_CACHED_SEGMENTS_PER_PROJECT = 300;
const execFileAsync = promisify(execFile);
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_AMV_SCRIPT_CANDIDATES = [
  path.resolve(CURRENT_DIR, '../../scripts/render_amv_segment.py'),
  path.resolve(process.cwd(), 'apps/server/scripts/render_amv_segment.py'),
  path.resolve(process.cwd(), 'scripts/render_amv_segment.py'),
];

export class Stage4Service {
  private webhookService?: WebhookService;
  private effectsService?: EffectsService;
  private pythonAmvScriptPathPromise?: Promise<string | null>;

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

  private normalizeCamera(raw?: Partial<ClipCamera> | null): ClipCamera | null {
    return normalizeClipCamera(raw);
  }

  private normalizeCinemascope(raw?: Partial<ClipCinemascope> | null): ClipCinemascope | null {
    if (!raw) return null;
    return {
      ...DEFAULT_CLIP_CINEMASCOPE,
      ...raw,
    };
  }

  private normalizeFxValue(raw?: ClipFx | null): ClipFx {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return raw;
    return [];
  }

  private async resolvePythonAmvScript(): Promise<string | null> {
    if (process.env.VIDEOSTUDIO_DISABLE_PYTHON_AMV === '1') return null;
    if (!this.pythonAmvScriptPathPromise) {
      this.pythonAmvScriptPathPromise = (async () => {
        let scriptPath: string | null = null;
        for (const cand of PYTHON_AMV_SCRIPT_CANDIDATES) {
          const stat = await fs.stat(cand).catch(() => null);
          if (stat && stat.isFile()) {
            scriptPath = cand;
            break;
          }
        }
        if (!scriptPath) return null;
        try {
          await execFileAsync('python3', ['-c', 'import PIL, numpy'], { timeout: 3000 });
          await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
          return scriptPath;
        } catch {
          return null;
        }
      })();
    }
    return this.pythonAmvScriptPathPromise;
  }

  private getSegmentCacheDir(projectSlug: string): string {
    return resolveSafePath(
      this.config.dataDir,
      path.join('projects', projectSlug, 'cache', 'timeline_segments'),
    );
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
      camera: this.normalizeCamera(c.camera),
      cinemascope: this.normalizeCinemascope(c.cinemascope),
      fx: this.normalizeFxValue(c.fx as ClipFx | null | undefined),
      flashIn: c.flashIn ?? 0,
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
          camera: this.normalizeCamera(cl.camera),
          cinemascope: this.normalizeCinemascope(cl.cinemascope),
          fx: cl.fx ?? [],
          flashIn: cl.flashIn ?? 0,
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
        camera: this.normalizeCamera(input.camera),
        cinemascope: this.normalizeCinemascope(input.cinemascope),
        fx: input.fx ?? [],
        flashIn: input.flashIn ?? 0,
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

    const nextCamera =
      patch.camera === null
        ? null
        : patch.camera !== undefined
          ? this.normalizeCamera({ ...(existing.camera ?? {}), ...patch.camera })
          : this.normalizeCamera(existing.camera);

    const nextCinemascope =
      patch.cinemascope === null
        ? null
        : patch.cinemascope !== undefined
          ? this.normalizeCinemascope({ ...(existing.cinemascope ?? {}), ...patch.cinemascope })
          : this.normalizeCinemascope(existing.cinemascope);

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
        camera: nextCamera,
        cinemascope: nextCinemascope,
        fx: patch.fx !== undefined ? this.normalizeFxValue(patch.fx) : existing.fx,
        flashIn: patch.flashIn ?? existing.flashIn,
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

  /**
   * Batch surgical timeline editing (`patch_timeline_clips`):
   * Applies 1..N targeted operations (`replace_asset`, `update`, `move`, `reorder`, `insert`, `delete`)
   * matched by `clipId` or `title`, with optional `ripple: true` gap recalculation, without overwriting untouched tracks.
   */
  async patchTimelineClips(
    projectIdOrSlug: string,
    input: PatchTimelineClipsInput,
    actor: Actor = 'user',
  ): Promise<{
    timeline: TimelineDto;
    appliedCount: number;
    modifiedClipIds: string[];
    summary: string[];
  } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const existingTracks = await this.db
      .select()
      .from(timelineTracks)
      .where(eq(timelineTracks.projectId, project.id))
      .orderBy(asc(timelineTracks.sortOrder), asc(timelineTracks.createdAt));

    const existingClips = await this.db
      .select()
      .from(timelineClips)
      .where(eq(timelineClips.projectId, project.id))
      .orderBy(asc(timelineClips.startSec), asc(timelineClips.sortOrder));

    type WorkingClip = typeof timelineClips.$inferSelect;
    const clipsByTrack = new Map<string, WorkingClip[]>();
    for (const tr of existingTracks) clipsByTrack.set(tr.id, []);
    for (const c of existingClips) {
      const list = clipsByTrack.get(c.trackId) ?? [];
      list.push({ ...c });
      clipsByTrack.set(c.trackId, list);
    }

    const touchedTrackIds = new Set<string>();
    const deletedClipIds = new Set<string>();
    const insertedClips: WorkingClip[] = [];
    const modifiedClipIds = new Set<string>();
    const summary: string[] = [];

    const findClipLoc = (opts: {
      clipId?: string;
      title?: string;
      trackId?: string;
    }): { trackId: string; index: number; clip: WorkingClip } | null => {
      const trackIds = opts.trackId ? [opts.trackId] : Array.from(clipsByTrack.keys());
      // 1. Match by exact clipId
      if (opts.clipId) {
        for (const tid of trackIds) {
          const list = clipsByTrack.get(tid) ?? [];
          const idx = list.findIndex((c) => c.id === opts.clipId);
          if (idx >= 0) return { trackId: tid, index: idx, clip: list[idx]! };
        }
      }
      // 2. Match by exact title, then case-insensitive title
      if (opts.title) {
        const needle = opts.title.trim();
        const lower = needle.toLowerCase();
        for (const tid of trackIds) {
          const list = clipsByTrack.get(tid) ?? [];
          const exactIdx = list.findIndex((c) => c.title === needle);
          if (exactIdx >= 0) return { trackId: tid, index: exactIdx, clip: list[exactIdx]! };
        }
        for (const tid of trackIds) {
          const list = clipsByTrack.get(tid) ?? [];
          const ciIdx = list.findIndex((c) => c.title.toLowerCase() === lower);
          if (ciIdx >= 0) return { trackId: tid, index: ciIdx, clip: list[ciIdx]! };
        }
      }
      return null;
    };

    const ensureTrackId = async (
      trackId?: string,
      trackType: TimelineTrackType = 'video',
      trackName?: string,
    ): Promise<string> => {
      if (trackId && clipsByTrack.has(trackId)) return trackId;
      const matching = existingTracks.find((t) => t.trackType === trackType);
      if (matching) return matching.id;
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
          trackType,
          name: trackName || defaultLabels[trackType],
          sortOrder: existingTracks.length,
          muted: false,
          locked: false,
          volume: 1,
        })
        .returning();
      if (!created) throw new Error('Unable to create target timeline track');
      existingTracks.push(created);
      clipsByTrack.set(created.id, []);
      return created.id;
    };

    for (const op of input.operations) {
      if (op.op === 'replace_asset') {
        const loc = findClipLoc(op);
        if (!loc) {
          throw new Error(`Clip introuvable pour replace_asset (${op.clipId ?? op.title ?? '?'})`);
        }
        const resolvedAssetId = await this.resolveClipAssetId(project.slug, op.assetId, op.assetRef);
        loc.clip.assetId = resolvedAssetId;
        if (op.newTitle) loc.clip.title = op.newTitle;
        loc.clip.updatedAt = new Date();
        touchedTrackIds.add(loc.trackId);
        modifiedClipIds.add(loc.clip.id);
        summary.push(`replace_asset "${loc.clip.title}" -> ${op.assetRef ?? resolvedAssetId ?? 'null'}`);
      } else if (op.op === 'update') {
        const loc = findClipLoc(op);
        if (!loc) {
          throw new Error(`Clip introuvable pour update (${op.clipId ?? op.title ?? '?'})`);
        }
        const p = op.patch;
        if (p.assetId !== undefined || p.assetRef !== undefined) {
          loc.clip.assetId = await this.resolveClipAssetId(project.slug, p.assetId, p.assetRef);
        }
        if (p.title !== undefined) loc.clip.title = p.title;
        if (p.startSec !== undefined) loc.clip.startSec = p.startSec;
        if (p.durationSec !== undefined) loc.clip.durationSec = p.durationSec;
        if (p.inSec !== undefined) loc.clip.inSec = p.inSec;
        if (p.outSec !== undefined) loc.clip.outSec = p.outSec;
        if (p.speed !== undefined) loc.clip.speed = p.speed;
        if (p.transition !== undefined) loc.clip.transition = p.transition;
        if (p.transitionDurationSec !== undefined) loc.clip.transitionDurationSec = p.transitionDurationSec;
        if (p.volume !== undefined) loc.clip.volume = p.volume;
        if (p.fadeInSec !== undefined) loc.clip.fadeInSec = p.fadeInSec;
        if (p.fadeOutSec !== undefined) loc.clip.fadeOutSec = p.fadeOutSec;
        if (p.muted !== undefined) loc.clip.muted = p.muted;
        if (p.transform) loc.clip.transform = this.normalizeTransform({ ...loc.clip.transform, ...p.transform });
        if (p.colorAdjust) loc.clip.colorAdjust = this.normalizeColorAdjust({ ...loc.clip.colorAdjust, ...p.colorAdjust });
        if (p.effects !== undefined) loc.clip.effects = p.effects;
        if (p.keyframes !== undefined) loc.clip.keyframes = p.keyframes;
        if (p.textOverlay !== undefined) loc.clip.textOverlay = p.textOverlay;
        if (p.camera !== undefined) {
          loc.clip.camera =
            p.camera === null ? null : this.normalizeCamera({ ...(loc.clip.camera ?? {}), ...p.camera });
        }
        if (p.cinemascope !== undefined) {
          loc.clip.cinemascope =
            p.cinemascope === null
              ? null
              : this.normalizeCinemascope({ ...(loc.clip.cinemascope ?? {}), ...p.cinemascope });
        }
        if (p.fx !== undefined) loc.clip.fx = this.normalizeFxValue(p.fx);
        if (p.flashIn !== undefined) loc.clip.flashIn = p.flashIn;
        if (p.notes !== undefined) loc.clip.notes = p.notes;
        loc.clip.updatedAt = new Date();
        if (op.ripple) {
          const list = clipsByTrack.get(loc.trackId)!;
          clipsByTrack.set(loc.trackId, rippleTrackClips(list));
        }
        touchedTrackIds.add(loc.trackId);
        modifiedClipIds.add(loc.clip.id);
        summary.push(`update "${loc.clip.title}"`);
      } else if (op.op === 'move') {
        const loc = findClipLoc(op);
        if (!loc) {
          throw new Error(`Clip introuvable pour move (${op.clipId ?? op.title ?? '?'})`);
        }
        const sourceList = clipsByTrack.get(loc.trackId)!;
        const [moved] = sourceList.splice(loc.index, 1);
        const destTrackId =
          op.targetTrackId && clipsByTrack.has(op.targetTrackId) ? op.targetTrackId : loc.trackId;
        const destList = clipsByTrack.get(destTrackId)!;
        moved!.trackId = destTrackId;
        if (op.targetStartSec !== undefined) {
          moved!.startSec = op.targetStartSec;
        }
        if (op.targetIndex !== undefined) {
          const idx = Math.max(0, Math.min(destList.length, op.targetIndex));
          destList.splice(idx, 0, moved!);
        } else {
          destList.push(moved!);
          destList.sort((a, b) => a.startSec - b.startSec);
        }
        if (op.ripple) {
          clipsByTrack.set(loc.trackId, rippleTrackClips(sourceList));
          if (destTrackId !== loc.trackId) {
            clipsByTrack.set(destTrackId, rippleTrackClips(destList));
          } else {
            clipsByTrack.set(destTrackId, rippleTrackClips(destList));
          }
        }
        touchedTrackIds.add(loc.trackId);
        touchedTrackIds.add(destTrackId);
        modifiedClipIds.add(moved!.id);
        summary.push(`move "${moved!.title}"`);
      } else if (op.op === 'reorder') {
        const targetTrackId =
          op.trackId ??
          existingTracks.find((t) => (op.trackType ? t.trackType === op.trackType : t.trackType === 'video'))?.id;
        if (!targetTrackId || !clipsByTrack.has(targetTrackId)) {
          throw new Error('Piste introuvable pour reorder');
        }
        const list = clipsByTrack.get(targetTrackId)!;
        const ordered: WorkingClip[] = [];
        const usedIds = new Set<string>();

        if (op.clipIds && op.clipIds.length > 0) {
          for (const cid of op.clipIds) {
            const match = list.find((c) => c.id === cid && !usedIds.has(c.id));
            if (match) {
              ordered.push(match);
              usedIds.add(match.id);
            }
          }
        } else if (op.titles && op.titles.length > 0) {
          for (const title of op.titles) {
            const lower = title.trim().toLowerCase();
            const match = list.find(
              (c) => !usedIds.has(c.id) && c.title.toLowerCase() === lower,
            );
            if (match) {
              ordered.push(match);
              usedIds.add(match.id);
            }
          }
        }
        // Append any remaining clips not explicitly listed so nothing is ever lost
        for (const c of list) {
          if (!usedIds.has(c.id)) ordered.push(c);
        }
        const finalList = op.ripple !== false ? rippleTrackClips(ordered) : ordered;
        clipsByTrack.set(targetTrackId, finalList);
        touchedTrackIds.add(targetTrackId);
        for (const c of finalList) modifiedClipIds.add(c.id);
        summary.push(`reorder ${finalList.length} clips (ripple=${op.ripple !== false})`);
      } else if (op.op === 'insert') {
        const targetTrackId = await ensureTrackId(
          op.trackId ?? op.clip.trackId,
          op.trackType,
          op.trackName ?? op.clip.trackName,
        );
        const list = clipsByTrack.get(targetTrackId)!;
        const resolvedAssetId = await this.resolveClipAssetId(
          project.slug,
          op.clip.assetId,
          op.clip.assetRef,
        );

        let insertIdx = list.length;
        if (op.atIndex !== undefined) {
          insertIdx = Math.max(0, Math.min(list.length, op.atIndex));
        } else if (op.afterClipId) {
          const found = list.findIndex((c) => c.id === op.afterClipId);
          if (found >= 0) insertIdx = found + 1;
        } else if (op.afterTitle) {
          const lower = op.afterTitle.trim().toLowerCase();
          const found = list.findIndex((c) => c.title.toLowerCase() === lower);
          if (found >= 0) insertIdx = found + 1;
        }

        const prevClip = insertIdx > 0 ? list[insertIdx - 1] : undefined;
        const defaultStart = prevClip ? prevClip.startSec + prevClip.durationSec : 0;
        const now = new Date();
        const newClip: WorkingClip = {
          id: crypto.randomUUID(),
          projectId: project.id,
          trackId: targetTrackId,
          assetId: resolvedAssetId,
          title: op.clip.title,
          startSec: op.clip.startSec ?? Math.round(defaultStart * 1000) / 1000,
          durationSec: op.clip.durationSec,
          inSec: op.clip.inSec ?? 0,
          outSec: op.clip.outSec ?? null,
          speed: op.clip.speed ?? 1,
          transition: op.clip.transition ?? 'cut',
          transitionDurationSec: op.clip.transitionDurationSec ?? 0,
          volume: op.clip.volume ?? 1,
          fadeInSec: op.clip.fadeInSec ?? 0,
          fadeOutSec: op.clip.fadeOutSec ?? 0,
          muted: op.clip.muted ?? false,
          transform: this.normalizeTransform(op.clip.transform),
          colorAdjust: this.normalizeColorAdjust(op.clip.colorAdjust),
          effects: op.clip.effects ?? [],
          keyframes: op.clip.keyframes ?? [],
          textOverlay: op.clip.textOverlay ?? null,
          camera: this.normalizeCamera(op.clip.camera),
          cinemascope: this.normalizeCinemascope(op.clip.cinemascope),
          fx: op.clip.fx ?? [],
          flashIn: op.clip.flashIn ?? 0,
          notes: op.clip.notes ?? '',
          sortOrder: insertIdx,
          createdAt: now,
          updatedAt: now,
        };

        list.splice(insertIdx, 0, newClip);
        insertedClips.push(newClip);
        if (op.ripple !== false) {
          clipsByTrack.set(targetTrackId, rippleTrackClips(list));
        }
        touchedTrackIds.add(targetTrackId);
        modifiedClipIds.add(newClip.id);
        summary.push(`insert "${newClip.title}" at #${insertIdx}`);
      } else if (op.op === 'delete') {
        const loc = findClipLoc(op);
        if (!loc) {
          throw new Error(`Clip introuvable pour delete (${op.clipId ?? op.title ?? '?'})`);
        }
        const list = clipsByTrack.get(loc.trackId)!;
        const [removed] = list.splice(loc.index, 1);
        if (removed) {
          deletedClipIds.add(removed.id);
          modifiedClipIds.add(removed.id);
          if (op.ripple) {
            clipsByTrack.set(loc.trackId, rippleTrackClips(list));
          }
          touchedTrackIds.add(loc.trackId);
          summary.push(`delete "${removed.title}"${op.ripple ? ' (ripple)' : ''}`);
        }
      }
    }

    // Persist ONLY affected clips cleanly
    for (const delId of deletedClipIds) {
      await this.db.delete(timelineClips).where(eq(timelineClips.id, delId));
    }

    const insertedIdSet = new Set(insertedClips.map((c) => c.id));
    for (const trackId of touchedTrackIds) {
      const list = clipsByTrack.get(trackId) ?? [];
      for (let idx = 0; idx < list.length; idx += 1) {
        const c = list[idx]!;
        if (insertedIdSet.has(c.id)) {
          await this.db.insert(timelineClips).values({
            id: c.id,
            projectId: c.projectId,
            trackId: c.trackId,
            assetId: c.assetId,
            title: c.title,
            startSec: c.startSec,
            durationSec: c.durationSec,
            inSec: c.inSec,
            outSec: c.outSec,
            speed: c.speed,
            transition: c.transition,
            transitionDurationSec: c.transitionDurationSec,
            volume: c.volume,
            fadeInSec: c.fadeInSec,
            fadeOutSec: c.fadeOutSec,
            muted: c.muted,
            transform: c.transform,
            colorAdjust: c.colorAdjust,
            effects: c.effects,
            keyframes: c.keyframes,
            textOverlay: c.textOverlay,
            camera: c.camera,
            cinemascope: c.cinemascope,
            fx: c.fx,
            flashIn: c.flashIn,
            notes: c.notes,
            sortOrder: idx,
          });
        } else {
          await this.db
            .update(timelineClips)
            .set({
              trackId: c.trackId,
              assetId: c.assetId,
              title: c.title,
              startSec: c.startSec,
              durationSec: c.durationSec,
              inSec: c.inSec,
              outSec: c.outSec,
              speed: c.speed,
              transition: c.transition,
              transitionDurationSec: c.transitionDurationSec,
              volume: c.volume,
              fadeInSec: c.fadeInSec,
              fadeOutSec: c.fadeOutSec,
              muted: c.muted,
              transform: c.transform,
              colorAdjust: c.colorAdjust,
              effects: c.effects,
              keyframes: c.keyframes,
              textOverlay: c.textOverlay,
              camera: c.camera,
              cinemascope: c.cinemascope,
              fx: c.fx,
              flashIn: c.flashIn,
              notes: c.notes,
              sortOrder: idx,
              updatedAt: new Date(),
            })
            .where(eq(timelineClips.id, c.id));
        }
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
      action: 'timeline.patched',
      summary: `Patch chirurgical timeline (${input.operations.length} op : ${summary.slice(0, 3).join(', ')})`,
      entityType: 'project',
      entityId: project.id,
      entityRef: `@proj-${project.slug}`,
    });

    return {
      timeline,
      appliedCount: input.operations.length,
      modifiedClipIds: Array.from(modifiedClipIds),
      summary,
    };
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
        camera: existing.camera,
        cinemascope: existing.cinemascope,
        fx: existing.fx,
        flashIn: 0,
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

    const cacheDir = this.getSegmentCacheDir(project.slug);
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
          flashIn: 0,
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
            flashIn: 0,
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

  /**
   * Fast range preview render (`render_timeline_range`):
   * Slices only `[startSec, endSec]` with synchronized audio/overlays/text/subtitles,
   * reusing cached SHA-256 clip segments so a local tweak validates in ~5 seconds!
   */
  async startRangeRender(
    projectIdOrSlug: string,
    input: RenderTimelineRangeInput,
    actor: Actor = 'user',
  ): Promise<{
    render: TimelineRenderDto;
    jobId: string;
    startSec: number;
    endSec: number;
    clipCount: number;
  } | null> {
    if (input.endSec <= input.startSec + 0.1) {
      throw new Error('endSec doit être strictement supérieur à startSec (au moins 0.1s).');
    }

    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const fullTimeline = await this.getTimeline(project.id);
    if (!fullTimeline) return null;

    const slicedTimeline = sliceTimelineForRange(fullTimeline, input.startSec, input.endSec);
    const videoClips = slicedTimeline.tracks
      .filter((t) => t.type === 'video' && !t.muted)
      .flatMap((t) => t.clips)
      .filter((c) => !c.muted && c.assetId)
      .sort((a, b) => a.startSec - b.startSec);

    if (videoClips.length === 0) {
      throw new Error(
        `Aucun clip vidéo actif dans la plage [${input.startSec.toFixed(1)}s → ${input.endSec.toFixed(1)}s].`,
      );
    }

    const qualityMode: TimelineQualityMode = input.qualityMode ?? 'draft_proxy';
    const resolution = input.resolution || '1280x720';
    const fps = input.fps ?? project.fps ?? 24;
    const rangeLabel = `${input.startSec.toFixed(1)}s→${input.endSec.toFixed(1)}s`;
    const estSeconds = Math.max(3, Math.round(videoClips.length * 1.2));

    const job = await this.studio.startJob({
      projectIdOrSlug: project.id,
      type: 'timeline_render_range',
      title: `Preview rapide ${rangeLabel} (${resolution} @ ${fps}fps)`,
      stepCurrent: 0,
      stepTotal: videoClips.length + 1,
      message: `Préparation preview rapide ${rangeLabel}...`,
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
        durationSec: Math.round((input.endSec - input.startSec) * 1000) / 1000,
      })
      .returning();

    if (!createdRender) throw new Error('Failed to create range render record');

    this.realtime.broadcast({
      type: 'timeline.changed',
      payload: { projectId: project.id },
    });

    void this.runFfmpegRenderPipeline({
      renderId: createdRender.id,
      jobId: job.id,
      projectId: project.id,
      projectSlug: project.slug,
      timeline: slicedTimeline,
      videoClips,
      qualityMode,
      resolution,
      fps,
      title: input.title?.trim() || `Preview ${rangeLabel} (${resolution})`,
      burnSubtitles: Boolean(input.burnSubtitles),
      bypassCache: Boolean(input.bypassCache),
      rangeWindow: { startSec: input.startSec, endSec: input.endSec },
      actor,
    });

    return {
      jobId: job.id,
      startSec: input.startSec,
      endSec: input.endSec,
      clipCount: videoClips.length,
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
    rangeWindow?: { startSec: number; endSec: number };
    actor: Actor;
  }): Promise<void> {
    const tmpDir = resolveSafePath(
      this.config.dataDir,
      path.join('.tmp', `render-${crypto.randomUUID()}`),
    );
    const cacheDir = this.getSegmentCacheDir(params.projectSlug);
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

    // Load audio beat markers so `camera.beatPulseAmp` pulses automatically on downbeats
    const audioTracks =
      typeof this.stage3?.listAudioTracks === 'function'
        ? await this.stage3.listAudioTracks(params.projectId).catch(() => [])
        : [];
    const rangeOffsetSec = params.rangeWindow?.startSec ?? 0;
    const beatTimelineSpan = Math.max(
      params.timeline.totalDurationSec + rangeOffsetSec,
      params.rangeWindow?.endSec ?? 0,
      10,
    );
    const beatMarkers = extractTimelineBeatMarkers(audioTracks, beatTimelineSpan);

    let cacheHits = 0;
    let renderedSegments = 0;

    try {
      const renderedEntries: Array<{ clip: TimelineClipDto; segPath: string }> = [];

      // 1. Render or reuse cached video segments (`projects/<slug>/cache/timeline_segments/<sha256>.mp4`)
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
        const assetUpdatedAt = assetInfo.asset.updatedAt ?? '';
        const sourceFingerprint = `${assetInfo.asset.id}:${assetUpdatedAt}:${sourceStat?.size ?? 0}:${Math.round(sourceStat?.mtimeMs ?? 0)}`;
        const isImage = assetInfo.asset.type === 'image';
        const beatTimesInClip = extractDownbeatTimesForClip(
          beatMarkers,
          clip.startSec + rangeOffsetSec,
          clip.durationSec,
        );

        const compiledVf = compileClipVideoFilterChain(clip, {
          width,
          height,
          fps: params.fps,
          isImage,
          effectCatalog,
          beatTimesInClip,
        });

        const pythonAmvScript =
          hasProceduralAmvFx(clip.camera, clip.cinemascope, clip.fx, clip.flashIn) &&
          (clip.effects ?? []).filter((e) => e.enabled).length === 0
            ? await this.resolvePythonAmvScript()
            : null;
        const renderEngine: 'ffmpeg' | 'amv_py' = pythonAmvScript ? 'amv_py' : 'ffmpeg';

        const cacheSig = buildClipSegmentCacheSignature({
          sourceFingerprint,
          clip,
          width,
          height,
          fps: params.fps,
          qualityMode: params.qualityMode,
          compiledVideoFilter: compiledVf,
          renderEngine,
          beatTimesInClip,
        });
        const segHash = crypto.createHash('sha256').update(cacheSig).digest('hex');
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

          let renderedByPython = false;
          if (pythonAmvScript) {
            const specPath = path.join(tmpDir, `amv-spec-${String(i).padStart(4, '0')}.json`);
            await fs.writeFile(
              specPath,
              JSON.stringify({
                clipId: clip.id,
                sourcePath,
                outputPath: segTmpOut,
                isImage,
                width,
                height,
                fps: params.fps,
                durationSec: clip.durationSec,
                inSec: Math.max(0, clip.inSec),
                speed,
                preset,
                crf,
                camera: normalizeClipCamera(clip.camera),
                cinemascope: clip.cinemascope ?? null,
                normalizedFx: normalizeClipFx(clip.fx, clip.flashIn),
                beatTimesInClip,
                fadeInSec: clip.fadeInSec ?? 0,
                fadeOutSec: clip.fadeOutSec ?? 0,
                textOverlay: clip.textOverlay ?? null,
              }),
              'utf8',
            );
            try {
              await execFileAsync('python3', [pythonAmvScript, '--spec', specPath], {
                timeout: 180_000,
              });
              const outStat = await fs.stat(segTmpOut).catch(() => null);
              if (outStat && outStat.size > 0) {
                renderedByPython = true;
              }
            } catch {
              // Seamless fallback to pure FFmpeg pipeline below
              renderedByPython = false;
            }
          }

          if (!renderedByPython) {
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

      // Optional subtitle burn-in filter (shifted to rangeWindow if rendering a preview slice)
      let subtitleBurnFilter: string | null = null;
      if (params.burnSubtitles) {
        const subs = await this.getSubtitles(params.projectId);
        if (subs && subs.cues.length > 0) {
          const effectiveCues = params.rangeWindow
            ? subs.cues
                .filter(
                  (q) => q.endSec > params.rangeWindow!.startSec && q.startSec < params.rangeWindow!.endSec,
                )
                .map((q) => ({
                  ...q,
                  startSec: Math.max(0, q.startSec - params.rangeWindow!.startSec),
                  endSec: Math.min(
                    params.rangeWindow!.endSec - params.rangeWindow!.startSec,
                    q.endSec - params.rangeWindow!.startSec,
                  ),
                }))
            : subs.cues;
          const srtContent = serializeSrt(effectiveCues);
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
      const isRange = Boolean(params.rangeWindow);
      const rangeSuffix = params.rangeWindow
        ? `-range-${Math.round(params.rangeWindow.startSec)}s-${Math.round(params.rangeWindow.endSec)}s`
        : '';
      const renderFilename = `${params.projectSlug}-${params.qualityMode}${rangeSuffix}-${stamp}.mp4`;

      const cacheNote = `⚡ ${cacheHits}/${renderedEntries.length} segment(s) du cache`;
      const registeredAsset = await this.studio.ingestAssetFromBuffer({
        projectIdOrSlug: params.projectId,
        buffer: renderedBuffer,
        filename: renderFilename,
        mimeType: 'video/mp4',
        explicitType: 'video',
        folderPath: isRange ? 'renders/previews' : 'renders',
        title:
          params.title?.trim() ||
          `Rendu ${params.qualityMode === 'hq_master' ? 'HQ MASTER' : 'DRAFT'} (${params.resolution})${subtitleBurnFilter ? ' · ST' : ''}`,
        qualityTier: isRange
          ? 'test'
          : params.qualityMode === 'hq_master'
            ? 'final_master'
            : 'draft_lowres',
        tags: [
          'render',
          'timeline',
          params.qualityMode,
          ...(isRange ? ['preview', 'range'] : []),
          ...(subtitleBurnFilter ? ['subtitled'] : []),
          ...(usedEffectSlugs.length > 0 ? ['fx'] : []),
        ],
        notes: `Rendu serveur FFmpeg${params.rangeWindow ? ` [${params.rangeWindow.startSec.toFixed(1)}s→${params.rangeWindow.endSec.toFixed(1)}s]` : ''} (${params.resolution} @ ${params.fps}fps, ${renderedEntries.length} clips, ${cacheNote}${subtitleBurnFilter ? ', sous-titres incrustés' : ''})`,
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

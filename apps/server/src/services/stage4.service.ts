import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { asc, desc, eq } from 'drizzle-orm';
import {
  buildAssetHandle,
  generateEdl,
  generateFcpxml,
  generateOtio,
  type Actor,
  type AssetType,
  type NleExportFormat,
  type QualityTier,
  type StartTimelineRenderInput,
  type TimelineClipDto,
  type TimelineDto,
  type TimelineQualityMode,
  type TimelineRenderDto,
  type TimelineRenderStatus,
  type TimelineTrackDto,
  type TimelineTrackType,
  type TimelineTransition,
  type UpsertTimelineInput,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import {
  assets,
  projects,
  timelineClips,
  timelineRenders,
  timelineTracks,
} from '../db/schema.js';
import { resolveSafePath } from '../utils/security.js';
import type { MediaService } from './media.service.js';
import type { RealtimeHub } from './realtime.service.js';
import type { Stage3Service } from './stage3.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Stage4Service {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly stage3: Stage3Service,
    private readonly media: MediaService,
    private readonly realtime: RealtimeHub,
  ) {}

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

      const dto: TimelineClipDto = {
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
        transition: c.transition as TimelineTransition,
        transitionDurationSec: c.transitionDurationSec,
        volume: c.volume,
        muted: c.muted,
        notes: c.notes,
        sortOrder: c.sortOrder,
      };

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
        let resolvedAssetId: string | null = cl.assetId ?? null;
        if (!resolvedAssetId && cl.assetRef) {
          const resolved = await this.studio.resolveReference(cl.assetRef, project.slug);
          resolvedAssetId = resolved?.asset?.id ?? null;
        }
        if (resolvedAssetId && !UUID_REGEX.test(resolvedAssetId)) {
          resolvedAssetId = null;
        }

        await this.db.insert(timelineClips).values({
          projectId: project.id,
          trackId: createdTrack.id,
          assetId: resolvedAssetId,
          title: cl.title,
          startSec: cl.startSec,
          durationSec: cl.durationSec,
          inSec: cl.inSec,
          outSec: cl.outSec ?? null,
          transition: cl.transition,
          transitionDurationSec: cl.transitionDurationSec,
          volume: cl.volume,
          muted: cl.muted,
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
          transition: 'cut',
          transitionDurationSec: 0,
          volume: 1,
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
            transition: 'cut',
            transitionDurationSec: 0,
            volume: 1,
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
    const estSeconds = Math.max(8, Math.round(videoClips.length * (qualityMode === 'hq_master' ? 4 : 2)));

    const job = await this.studio.startJob({
      projectIdOrSlug: project.id,
      type: 'timeline_render',
      title: `Rendu FFmpeg ${qualityMode === 'hq_master' ? 'HQ MASTER' : 'DRAFT'} (${resolution} @ ${fps}fps)`,
      stepCurrent: 0,
      stepTotal: videoClips.length + 1,
      message: 'Préparation du rendu FFmpeg...',
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

    // Launch background FFmpeg pipeline without blocking HTTP/MCP response
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
    actor: Actor;
  }): Promise<void> {
    const tmpDir = resolveSafePath(
      this.config.dataDir,
      path.join('.tmp', `render-${crypto.randomUUID()}`),
    );
    await fs.mkdir(tmpDir, { recursive: true });

    const [wStr, hStr] = params.resolution.split('x');
    const width = Math.max(320, Math.min(Number(wStr) || 1280, 3840));
    const height = Math.max(240, Math.min(Number(hStr) || 720, 2160));
    const crf = params.qualityMode === 'hq_master' ? '18' : '24';
    const preset = params.qualityMode === 'hq_master' ? 'medium' : 'veryfast';

    const startedAt = Date.now();
    const totalSteps = params.videoClips.length + 1;

    try {
      const segmentPaths: string[] = [];

      for (let i = 0; i < params.videoClips.length; i += 1) {
        const clip = params.videoClips[i]!;
        if (!clip.assetId) continue;
        const assetInfo = await this.studio.getAssetById(clip.assetId);
        if (!assetInfo) continue;

        const sourcePath =
          params.qualityMode === 'draft_proxy' &&
          assetInfo.raw.proxyPath &&
          assetInfo.asset.type === 'video'
            ? this.media.resolveMediaFile(assetInfo.raw.proxyPath)
            : this.media.resolveMediaFile(assetInfo.raw.filePath);

        const segOut = path.join(tmpDir, `seg-${String(i).padStart(4, '0')}.mp4`);
        const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${params.fps},format=yuv420p`;

        if (assetInfo.asset.type === 'image') {
          await this.media.executeFfmpeg([
            '-y',
            '-loop',
            '1',
            '-i',
            sourcePath,
            '-t',
            String(Math.max(0.2, clip.durationSec)),
            '-vf',
            scaleFilter,
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-crf',
            crf,
            '-an',
            segOut,
          ]);
        } else {
          await this.media.executeFfmpeg([
            '-y',
            '-ss',
            String(Math.max(0, clip.inSec)),
            '-i',
            sourcePath,
            '-t',
            String(Math.max(0.2, clip.durationSec)),
            '-vf',
            scaleFilter,
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-crf',
            crf,
            '-an',
            segOut,
          ]);
        }

        segmentPaths.push(segOut);

        const doneSteps = i + 1;
        const pct = Math.min(95, Math.round((doneSteps / totalSteps) * 100));
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
            message: `Encodage plan ${doneSteps}/${params.videoClips.length} (${clip.title})`,
            etaSeconds: remainingEta,
          }),
        ]);
      }

      if (segmentPaths.length === 0) {
        throw new Error('Aucun segment vidéo valide à assembler.');
      }

      const concatListPath = path.join(tmpDir, 'concat.txt');
      const concatContent = segmentPaths
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join('\n');
      await fs.writeFile(concatListPath, concatContent, 'utf8');

      const audioClip = params.timeline.tracks
        .filter((t) => t.type === 'audio' && !t.muted)
        .flatMap((t) => t.clips)
        .find((c) => !c.muted && c.assetId);

      const audioAsset = audioClip?.assetId
        ? await this.studio.getAssetById(audioClip.assetId)
        : null;

      const finalOutPath = path.join(tmpDir, 'render-final.mp4');
      await this.studio.updateJob(params.jobId, {
        status: 'running',
        progress: 96,
        stepCurrent: params.videoClips.length,
        stepTotal: totalSteps,
        message: 'Assemblage final MP4 + mixage audio...',
        etaSeconds: 3,
      });

      if (audioAsset) {
        const audioAbs = this.media.resolveMediaFile(audioAsset.raw.filePath);
        await this.media.executeFfmpeg([
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-i',
          audioAbs,
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          params.qualityMode === 'hq_master' ? '256k' : '128k',
          '-shortest',
          '-movflags',
          '+faststart',
          finalOutPath,
        ]);
      } else {
        await this.media.executeFfmpeg([
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-c:v',
          'copy',
          '-movflags',
          '+faststart',
          finalOutPath,
        ]);
      }

      const renderedBuffer = await fs.readFile(finalOutPath);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const renderFilename = `${params.projectSlug}-${params.qualityMode}-${stamp}.mp4`;

      const registeredAsset = await this.studio.ingestAssetFromBuffer({
        projectIdOrSlug: params.projectId,
        buffer: renderedBuffer,
        filename: renderFilename,
        mimeType: 'video/mp4',
        explicitType: 'video',
        folderPath: 'renders',
        title:
          params.title?.trim() ||
          `Rendu ${params.qualityMode === 'hq_master' ? 'HQ MASTER' : 'DRAFT'} (${params.resolution})`,
        qualityTier: params.qualityMode === 'hq_master' ? 'final_master' : 'draft_lowres',
        tags: ['render', 'timeline', params.qualityMode],
        notes: `Rendu serveur FFmpeg (${params.resolution} @ ${params.fps}fps, ${segmentPaths.length} clips)`,
        createdBy: params.actor,
      });

      await this.db
        .update(timelineRenders)
        .set({
          status: 'completed',
          progress: 100,
          outputAssetId: registeredAsset.id,
          durationSec: registeredAsset.durationSec ?? params.timeline.totalDurationSec,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timelineRenders.id, params.renderId));

      await this.studio.updateJob(params.jobId, {
        status: 'completed',
        progress: 100,
        stepCurrent: totalSteps,
        stepTotal: totalSteps,
        message: `Rendu terminé : ${registeredAsset.handle}`,
        etaSeconds: 0,
        resultAssetId: registeredAsset.id,
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
}

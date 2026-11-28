import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AgentTaskStatusSchema,
  AssetRelationTypeSchema,
  AssetStatusSchema,
  AssetTypeSchema,
  AudioCategorySchema,
  AudioMarkerSchema,
  BibleEntityTypeSchema,
  ComfyWorkflowCategorySchema,
  JobStatusSchema,
  NleExportFormatSchema,
  ProjectStatusSchema,
  ProjectTypeSchema,
  PromptCategorySchema,
  QcCheckValueSchema,
  QcOverallStatusSchema,
  QualityTierSchema,
  RuleCategorySchema,
  RuleSeveritySchema,
  ShotStatusSchema,
  SketchModeSchema,
  SketchSceneDataSchema,
  SkillScopeSchema,
  StorageModeSchema,
  SyncAgentTaskItemSchema,
  TimelineQualityModeSchema,
  UpsertStoryboardInputSchema,
  UpsertTimelineInputSchema,
  WebhookEventTypeSchema,
  YouTubeChapterSchema,
} from '@videostudio/shared';
import type { MediaService } from '../services/media.service.js';
import type { OpsService } from '../services/ops.service.js';
import type { SketchService } from '../services/sketch.service.js';
import type { Stage2Service } from '../services/stage2.service.js';
import type { Stage3Service } from '../services/stage3.service.js';
import type { Stage4Service } from '../services/stage4.service.js';
import type { StudioService } from '../services/studio.service.js';
import type { WatchFolderService } from '../services/watch-folder.service.js';
import type { WebhookService } from '../services/webhook.service.js';
import type { YouTubeUploadService } from '../services/youtube-upload.service.js';

export interface Stage5McpDeps {
  ops: OpsService;
  watchFolders: WatchFolderService;
  webhooks: WebhookService;
  youtubeUpload: YouTubeUploadService;
  getInFlightRequests?: () => number;
}

export function createVideoStudioMcpServer(
  studio: StudioService,
  media: MediaService,
  stage2: Stage2Service,
  stage3: Stage3Service,
  stage4: Stage4Service,
  stage5?: Stage5McpDeps,
  sketches?: SketchService,
): McpServer {
  const server = new McpServer({
    name: 'videostudio',
    version: '0.6.0',
  });

  // --- MCP Resources ---

  server.resource('projects-list', 'studio://projects', async (uri) => {
    const items = await studio.listProjects();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(items, null, 2),
        },
      ],
    };
  });

  server.resource(
    'project-overview',
    new ResourceTemplate('studio://projects/{slug}/overview', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const project = await studio.getProjectByIdOrSlug(slug);
      if (!project) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Project not found: ${slug}` }),
            },
          ],
        };
      }
      const [projectAssets, recentActivities, activeJobs, agentTaskList] = await Promise.all([
        studio.listAssets(project.id, { limit: 50 }),
        studio.listActivities(project.id, 25),
        studio.listJobs(project.id, 15),
        studio.listAgentTasks(project.id),
      ]);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                project,
                assetsCount: projectAssets.length,
                recentAssets: projectAssets.slice(0, 20).map((a) => studio.toCompactAssetDto(a)),
                activeJobs,
                agentTasks: agentTaskList,
                recentActivities,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.resource(
    'project-tasks',
    new ResourceTemplate('studio://projects/{slug}/tasks', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const taskList = await studio.listAgentTasks(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(taskList, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'project-assets',
    new ResourceTemplate('studio://projects/{slug}/assets', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const projectAssets = await studio.listAssets(slug, { limit: 200 });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              projectAssets.map((a) => studio.toCompactAssetDto(a)),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.resource(
    'studio-reference',
    new ResourceTemplate('studio://ref/{ref}', { list: undefined }),
    async (uri, variables) => {
      const ref = decodeURIComponent(String(variables.ref ?? ''));
      const resolved = await studio.resolveReference(ref);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              resolved ?? { error: `Reference not found: ${ref}` },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- MCP Tools ---

  server.tool(
    'list_projects',
    'List all VideoStudio projects with their slugs, statuses, localPath, and asset counts.',
    {},
    async () => {
      const list = await studio.listProjects();
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    'create_project',
    'Create a new video production project in VideoStudio.',
    {
      name: z.string().min(1).max(120).describe('Human-readable project name'),
      slug: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .optional()
        .describe('Optional URL-safe slug (auto-generated if omitted)'),
      description: z.string().optional().describe('Project pitch or production notes'),
      type: ProjectTypeSchema.optional().describe('youtube_long, youtube_short, music_video, animation, commercial, experimental'),
      aspectRatio: z.string().optional().describe('Aspect ratio such as 16:9 or 9:16'),
      fps: z.number().int().min(1).max(120).optional().describe('Target FPS (e.g. 24, 30, 60)'),
      targetResolution: z.string().optional().describe('Target resolution such as 1920x1080 or 3840x2160'),
      localPath: z.string().optional().describe('Optional local host/container working directory path for this project'),
    },
    async (args) => {
      const created = await studio.createProject(
        {
          name: args.name,
          slug: args.slug,
          description: args.description ?? '',
          type: args.type ?? 'youtube_long',
          aspectRatio: args.aspectRatio ?? '16:9',
          fps: args.fps ?? 24,
          targetResolution: args.targetResolution ?? '1920x1080',
          localPath: args.localPath ?? '',
        },
        'claude',
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
      };
    },
  );

  server.tool(
    'update_project',
    'Update a project status (pre_production, production, editing, youtube_ready, published, archived) or metadata (name, description, type, aspectRatio, fps, targetResolution, localPath).',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      name: z.string().min(1).max(120).optional(),
      description: z.string().optional(),
      type: ProjectTypeSchema.optional(),
      aspectRatio: z.string().optional(),
      fps: z.number().int().min(1).max(120).optional(),
      targetResolution: z.string().optional(),
      status: ProjectStatusSchema.optional().describe(
        'pre_production, production, editing, youtube_ready, published, or archived',
      ),
      localPath: z.string().optional().describe('Local working directory path where this project files live'),
    },
    async (args) => {
      const updated = await studio.updateProject(
        args.project,
        {
          name: args.name,
          description: args.description,
          type: args.type,
          aspectRatio: args.aspectRatio,
          fps: args.fps,
          targetResolution: args.targetResolution,
          status: args.status,
          localPath: args.localPath,
        },
        'claude',
      );
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project not found: ${args.project}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  server.tool(
    'get_project_overview',
    'Get detailed overview, recent assets (compact), and live jobs for a project by slug or UUID.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
    },
    async ({ project: projectIdOrSlug }) => {
      const project = await studio.getProjectByIdOrSlug(projectIdOrSlug);
      if (!project) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project not found: ${projectIdOrSlug}` }],
        };
      }
      const [projectAssets, activeJobs, agentTaskList, recentActivities] = await Promise.all([
        studio.listAssets(project.id, { limit: 40 }),
        studio.listJobs(project.id, 15),
        studio.listAgentTasks(project.id),
        studio.listActivities(project.id, 20),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                project,
                assets: projectAssets.map((a) => studio.toCompactAssetDto(a)),
                jobs: activeJobs,
                agentTasks: agentTaskList,
                recentActivities,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'register_asset',
    'Ingest an image, video, audio, or document into a VideoStudio project (from a LAN ComfyUI URL, base64 payload, or mounted ingest path in INGEST_ALLOWED_DIR or INGEST_EXTRA_DIRS). Supports storageMode="reference" for zero-copy streaming, relationType ("revision" | "upscale" | "crop" | "variant") so derivations do not bump version numbers, folderPath, and ComfyUI metadata extraction.',
    {
      project: z.string().min(1).describe('Target project slug or UUID'),
      sourceUrl: z
        .string()
        .url()
        .optional()
        .describe('LAN HTTP(S) URL to fetch the media from (e.g. ComfyUI /view?filename=...)'),
      base64Data: z
        .string()
        .optional()
        .describe('Base64-encoded file payload (data URL prefix optional)'),
      localFilePath: z
        .string()
        .optional()
        .describe('Relative path inside INGEST_ALLOWED_DIR, or absolute path inside INGEST_ALLOWED_DIR / INGEST_EXTRA_DIRS'),
      storageMode: StorageModeSchema.optional().describe(
        'copy (default), hardlink, or reference (zero-copy direct read from mounted read-only roots)',
      ),
      folderPath: z
        .string()
        .optional()
        .describe('Optional subfolder inside the project media library (e.g. "characters/elena")'),
      filename: z.string().optional().describe('Original filename with extension (e.g. hero_01.png)'),
      mimeType: z.string().optional().describe('Optional MIME type override'),
      type: AssetTypeSchema.optional().describe('Optional explicit asset type (image, video, audio, document)'),
      title: z.string().optional().describe('Display title in VideoStudio'),
      qualityTier: QualityTierSchema.optional().describe('test, draft, hq, or final'),
      status: AssetStatusSchema.optional().describe('new, in_review, needs_revision, approved, winner, archived'),
      parentRef: z
        .string()
        .optional()
        .describe('Optional parent asset reference (e.g. @img-001 or UUID) to link lineage'),
      relationType: AssetRelationTypeSchema.optional().describe(
        'Relation to parentRef: revision (default, bumps -vN), upscale (e.g. 1080p -> 4K), crop, or variant (keeps v1)',
      ),
      promptUsed: z.string().optional().describe('Generation positive prompt (auto-filled from ComfyUI metadata if omitted)'),
      negativePrompt: z.string().optional().describe('Generation negative prompt'),
      modelName: z.string().optional().describe('Checkpoint / diffusion model name'),
      seed: z.string().optional().describe('Generation seed'),
      tags: z.array(z.string()).optional().describe('Tags for organization (e.g. ["hero", "scene-01"])'),
      notes: z.string().optional().describe('Notes from Claude about this generation'),
    },
    async (args) => {
      if (!args.sourceUrl && !args.base64Data && !args.localFilePath) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'You must provide one of: sourceUrl, base64Data, or localFilePath.',
            },
          ],
        };
      }

      try {
        let buffer: Buffer;
        let filename = args.filename ?? 'asset.bin';
        let mimeType = args.mimeType;
        let sourceLocalAbsPath: string | undefined;
        let ingestRelativePath: string | undefined;
        let referenceUri: string | undefined;

        if (args.sourceUrl) {
          const fetched = await media.fetchFromUrl(args.sourceUrl);
          buffer = fetched.buffer;
          filename = args.filename ?? fetched.filename;
          mimeType = args.mimeType ?? fetched.mimeType;
        } else if (args.localFilePath) {
          const loaded = await media.readLocalIngestFile(args.localFilePath);
          buffer = loaded.buffer;
          filename = args.filename ?? loaded.filename;
          mimeType = args.mimeType ?? loaded.mimeType;
          sourceLocalAbsPath = loaded.resolvedAbsPath;
          ingestRelativePath = loaded.ingestRelativePath;
          referenceUri = loaded.referenceUri;
        } else {
          const cleaned = (args.base64Data ?? '').replace(/^data:[^;]+;base64,/, '');
          buffer = Buffer.from(cleaned, 'base64');
        }

        const created = await studio.ingestAssetFromBuffer({
          projectIdOrSlug: args.project,
          buffer,
          filename,
          mimeType,
          explicitType: args.type,
          storageMode: args.storageMode,
          sourceLocalAbsPath,
          ingestRelativePath,
          referenceUri,
          folderPath: args.folderPath,
          title: args.title,
          qualityTier: args.qualityTier,
          status: args.status,
          parentRef: args.parentRef,
          relationType: args.relationType,
          promptUsed: args.promptUsed,
          negativePrompt: args.negativePrompt,
          modelName: args.modelName,
          seed: args.seed,
          tags: args.tags,
          notes: args.notes,
          createdBy: 'claude',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(studio.toCompactAssetDto(created), null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to register asset: ${message}` }],
        };
      }
    },
  );

  server.tool(
    'ingest_folder',
    'Batch-ingest files from an allowed read-only folder (INGEST_ALLOWED_DIR or INGEST_EXTRA_DIRS) idempotently. Skips already-ingested files and can automatically link derivations to parent assets by filename stem (e.g. parentMatch="suffix_strip" links S10_4k.png -> S10.png).',
    {
      project: z.string().min(1).describe('Target project slug or UUID'),
      localDir: z.string().min(1).describe('Directory path inside INGEST_ALLOWED_DIR or INGEST_EXTRA_DIRS'),
      glob: z.string().optional().describe('Optional glob filter such as "*.png" or "*_4k.png"'),
      recursive: z.boolean().default(false).describe('Scan nested subfolders and mirror folderPath structure'),
      folderPath: z.string().default('').describe('Target subfolder in VideoStudio media library'),
      storageMode: StorageModeSchema.default('reference').describe('Default "reference" (zero-copy)'),
      qualityTier: QualityTierSchema.default('test'),
      relationType: AssetRelationTypeSchema.optional().describe('Relation when linked to a parent (defaults to upscale if parent matched)'),
      parentMatch: z
        .string()
        .default('none')
        .describe('"none", "suffix_strip" (S10_4k.png -> S10.png), or custom regex with capture group 1 for parent stem'),
      tags: z.array(z.string()).default([]),
      limit: z.number().int().min(1).max(1000).default(200),
    },
    async (args) => {
      try {
        const res = await studio.ingestFolderBatch({
          projectIdOrSlug: args.project,
          localDir: args.localDir,
          glob: args.glob,
          recursive: args.recursive,
          folderPath: args.folderPath,
          storageMode: args.storageMode,
          qualityTier: args.qualityTier,
          relationType: args.relationType,
          parentMatch: args.parentMatch,
          tags: args.tags,
          limit: args.limit,
          createdBy: 'claude',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'list_assets',
    'List and filter assets inside a VideoStudio project with cursor pagination. Returns compact metadata by default (compact=true, without comfyMetadata/prompts) to stay lightweight; pass compact=false or use get_asset(ref) for full detail.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      type: AssetTypeSchema.optional(),
      status: AssetStatusSchema.optional(),
      qualityTier: QualityTierSchema.optional(),
      folderPath: z
        .string()
        .optional()
        .describe('Optional subfolder path ("" for root, or "characters/elena")'),
      recursive: z
        .boolean()
        .optional()
        .describe('If true and folderPath is set, include nested subfolders'),
      tag: z.string().optional(),
      search: z.string().optional(),
      compact: z
        .boolean()
        .default(true)
        .describe('Return compact fields only (default true: id, handle, filename, status, tier, relationType, parent, folder, qcStatus)'),
      cursor: z.string().optional().describe('Pagination cursor (ISO timestamp returned in nextCursor)'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async (args) => {
      const page = await studio.listAssetsPage(args.project, {
        type: args.type,
        status: args.status,
        qualityTier: args.qualityTier,
        folderPath: args.folderPath,
        recursive: args.recursive,
        tag: args.tag,
        search: args.search,
        cursor: args.cursor,
        limit: args.limit,
      });
      const payload = {
        total: page.total,
        count: page.assets.length,
        nextCursor: page.nextCursor,
        assets: args.compact
          ? page.assets.map((a) => studio.toCompactAssetDto(a))
          : page.assets,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    'get_asset',
    'Get full metadata for a single asset by @ref handle, studio:// URI, or UUID (including prompts, ComfyUI metadata, QC checks, and lineage).',
    {
      ref: z.string().min(1).describe('Asset reference (@img-001, slug/img-001, studio://...) or UUID'),
      project: z.string().optional().describe('Optional project slug to disambiguate short @ref'),
      includeComfyGraph: z
        .boolean()
        .default(false)
        .describe('Include full raw ComfyUI workflow graph (false by default to keep responses small)'),
    },
    async ({ ref, project, includeComfyGraph }) => {
      const resolved = await studio.resolveReference(ref, project);
      if (!resolved?.asset) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Asset not found: ${ref}` }],
        };
      }
      const asset = { ...resolved.asset };
      if (!includeComfyGraph && asset.comfyMetadata) {
        asset.comfyMetadata = {
          ...asset.comfyMetadata,
          rawPromptGraph: undefined,
          rawWorkflow: undefined,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                asset,
                lineage: resolved.lineage
                  ? {
                      ancestors: resolved.lineage.ancestors.map((a) => studio.toCompactAssetDto(a)),
                      children: resolved.lineage.children.map((a) => studio.toCompactAssetDto(a)),
                    }
                  : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'record_qc',
    'Record structured visual quality-control checks (e.g. {mains: "ok", yeux: "ok", doublon: "ok", age: "warn"}) on an asset. Displays a QC badge directly on the asset card in the Web UI gallery.',
    {
      ref: z.string().min(1).describe('Asset reference (@img-001, @vid-012) or UUID'),
      project: z.string().optional().describe('Optional project slug to disambiguate short @ref'),
      checks: z
        .record(QcCheckValueSchema)
        .describe('Key-value checks where each value is "ok", "warn", "fail", or "na"'),
      status: QcOverallStatusSchema.optional().describe('Optional overall override (auto-computed from checks if omitted)'),
      notes: z.string().max(2000).optional().describe('Optional QC summary notes'),
    },
    async (args) => {
      const updated = await studio.recordAssetQc(
        args.ref,
        { checks: args.checks, status: args.status, notes: args.notes },
        'claude',
        args.project,
      );
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Asset not found: ${args.ref}` }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                handle: updated.handle,
                qcStatus: updated.qcStatus,
                qcChecks: updated.qcChecks,
                qcNotes: updated.qcNotes,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'get_frame',
    'Extract a single frame from a video asset at timecode t (seconds) using server-side FFmpeg and return it directly as an inspectable image for visual QC.',
    {
      ref: z.string().min(1).describe('Asset reference (@vid-001, @img-001) or UUID'),
      project: z.string().optional(),
      timecodeSec: z.number().min(0).default(0).describe('Timestamp in seconds to extract'),
      maxWidth: z.number().int().min(160).max(1920).default(1024),
    },
    async ({ ref, project, timecodeSec, maxWidth }) => {
      const resolved = await studio.resolveReference(ref, project);
      if (!resolved?.asset) {
        return { isError: true, content: [{ type: 'text', text: `Asset not found: ${ref}` }] };
      }
      const rawInfo = await studio.getAssetById(resolved.asset.id);
      if (!rawInfo) {
        return { isError: true, content: [{ type: 'text', text: `Asset not found: ${ref}` }] };
      }
      try {
        const absPath = media.resolveMediaFile(rawInfo.raw.filePath);
        const frame = await media.extractVideoFrame({
          absPath,
          assetType: resolved.asset.type,
          timecodeSec,
          maxWidth,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                handle: resolved.asset.handle,
                timecodeSec,
                width: frame.width,
                height: frame.height,
              }),
            },
            {
              type: 'image',
              data: frame.buffer.toString('base64'),
              mimeType: frame.mimeType,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'contact_sheet',
    'Generate a visual inspection contact sheet (grid of frames sampled every N seconds) from a video asset using server-side FFmpeg and return it as an image for strict visual QC.',
    {
      ref: z.string().min(1).describe('Video asset reference (@vid-001) or UUID'),
      project: z.string().optional(),
      everySec: z.number().min(0.1).max(60).default(0.5).describe('Sampling interval in seconds (e.g. 0.25 or 0.5)'),
      columns: z.number().int().min(1).max(12).default(4),
      tileWidth: z.number().int().min(120).max(640).default(320),
      maxFrames: z.number().int().min(1).max(64).default(24),
    },
    async ({ ref, project, everySec, columns, tileWidth, maxFrames }) => {
      const resolved = await studio.resolveReference(ref, project);
      if (!resolved?.asset) {
        return { isError: true, content: [{ type: 'text', text: `Asset not found: ${ref}` }] };
      }
      const rawInfo = await studio.getAssetById(resolved.asset.id);
      if (!rawInfo) {
        return { isError: true, content: [{ type: 'text', text: `Asset not found: ${ref}` }] };
      }
      try {
        const absPath = media.resolveMediaFile(rawInfo.raw.filePath);
        const sheet = await media.generateContactSheet({
          absPath,
          assetType: resolved.asset.type,
          everySec,
          columns,
          tileWidth,
          maxFrames,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                handle: resolved.asset.handle,
                everySec: sheet.everySec,
                columns: sheet.columns,
                rows: sheet.rows,
                frameCount: sheet.frameCount,
                durationSec: sheet.durationSec,
                width: sheet.width,
                height: sheet.height,
              }),
            },
            {
              type: 'image',
              data: sheet.buffer.toString('base64'),
              mimeType: sheet.mimeType,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'update_asset',
    'Update metadata, folderPath, status, quality tier, relationType, rating, notes, or tags of an existing asset by reference (@img-001) or UUID.',
    {
      ref: z.string().min(1).describe('Asset reference (@img-001, slug/img-001, studio://...) or UUID'),
      project: z.string().optional().describe('Optional project slug to disambiguate short @ref'),
      title: z.string().optional(),
      folderPath: z
        .string()
        .optional()
        .describe('Move asset to another subfolder (use "" to move back to root)'),
      status: AssetStatusSchema.optional(),
      qualityTier: QualityTierSchema.optional(),
      relationType: AssetRelationTypeSchema.optional(),
      rating: z.number().int().min(0).max(5).optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      const resolved = await studio.resolveReference(args.ref, args.project);
      if (!resolved?.asset) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Asset reference not found: ${args.ref}` }],
        };
      }

      const updated = await studio.updateAsset(
        resolved.asset.id,
        {
          title: args.title,
          folderPath: args.folderPath,
          status: args.status,
          qualityTier: args.qualityTier,
          relationType: args.relationType,
          rating: args.rating,
          notes: args.notes,
          tags: args.tags,
        },
        'claude',
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  const isProtectedAsset = (asset: { status: string; qualityTier: string }): boolean =>
    asset.status === 'approved' ||
    asset.status === 'winner' ||
    asset.qualityTier === 'final_master';

  server.tool(
    'delete_asset',
    'Delete an asset by @ref handle, studio:// URI, or UUID (removes DB record and managed files in DATA_DIR; never touches read-only ingest:// source files). Protected assets (approved, winner, final_master) require force: true.',
    {
      ref: z.string().min(1).describe('Asset reference (@img-001, slug/img-001, studio://...) or UUID'),
      project: z.string().optional().describe('Optional project slug or UUID to disambiguate short @ref'),
      force: z
        .boolean()
        .default(false)
        .describe('Set true to allow deleting approved, winner, or final_master assets'),
    },
    async ({ ref, project, force }) => {
      const resolved = await studio.resolveReference(ref, project);
      if (!resolved?.asset) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Asset reference not found: ${ref}` }],
        };
      }

      const target = resolved.asset;
      if (!force && isProtectedAsset(target)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Refused to delete protected asset ${target.handle} (status=${target.status}, tier=${target.qualityTier}). Pass force: true to confirm deletion.`,
            },
          ],
        };
      }

      const deleted = await studio.deleteAsset(target.id, 'claude');
      if (!deleted) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Asset could not be deleted: ${target.handle}` }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                deleted: true,
                id: target.id,
                handle: target.handle,
                title: target.title,
                projectSlug: target.projectSlug,
                folderPath: target.folderPath,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_assets_batch',
    'Delete multiple assets in a single call by @ref handles or UUIDs. Protected assets (approved, winner, final_master) are skipped unless force: true.',
    {
      refs: z
        .array(z.string().min(1))
        .min(1)
        .max(100)
        .describe('List of asset references (@img-001, slug/img-001, studio://...) or UUIDs'),
      project: z.string().optional().describe('Optional project slug or UUID to disambiguate short @refs'),
      force: z
        .boolean()
        .default(false)
        .describe('Set true to allow deleting approved, winner, or final_master assets'),
    },
    async ({ refs, project, force }) => {
      const deleted: Array<{ id: string; handle: string; title: string }> = [];
      const skippedProtected: Array<{ ref: string; handle: string; status: string; qualityTier: string }> = [];
      const notFound: string[] = [];
      const seenIds = new Set<string>();

      for (const ref of refs) {
        const resolved = await studio.resolveReference(ref, project);
        if (!resolved?.asset) {
          notFound.push(ref);
          continue;
        }
        const target = resolved.asset;
        if (seenIds.has(target.id)) continue;
        seenIds.add(target.id);

        if (!force && isProtectedAsset(target)) {
          skippedProtected.push({
            ref,
            handle: target.handle,
            status: target.status,
            qualityTier: target.qualityTier,
          });
          continue;
        }

        const ok = await studio.deleteAsset(target.id, 'claude');
        if (ok) {
          deleted.push({ id: target.id, handle: target.handle, title: target.title });
        } else {
          notFound.push(ref);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                deletedCount: deleted.length,
                deleted,
                skippedProtected,
                notFound,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'list_media_folders',
    'List all media subfolders inside a project with their hierarchy and direct asset counts.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
    },
    async ({ project }) => {
      const folders = await studio.listMediaFolders(project);
      return {
        content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }],
      };
    },
  );

  server.tool(
    'create_media_folder',
    'Create a new media subfolder (and any missing parent folders) inside a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      path: z
        .string()
        .min(1)
        .max(200)
        .describe('Subfolder path (e.g. "characters/elena" or "scenes/sc01/drafts")'),
    },
    async ({ project, path }) => {
      try {
        const created = await studio.createMediaFolder(project, path, 'claude');
        if (!created) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project not found: ${project}` }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : 'Failed to create folder',
            },
          ],
        };
      }
    },
  );

  server.tool(
    'resolve_reference',
    'Resolve any VideoStudio reference (@img-001, @proj-slug, slug/vid-002-v2, studio://..., or UUID) into full metadata, ComfyUI workflow info, and version lineage.',
    {
      ref: z.string().min(1).describe('Reference handle, URI, or UUID'),
      project: z.string().optional().describe('Optional default project slug'),
    },
    async ({ ref, project }) => {
      const resolved = await studio.resolveReference(ref, project);
      if (!resolved) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Reference not found: ${ref}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(resolved, null, 2) }],
      };
    },
  );

  server.tool(
    'log_activity',
    'Emit a live status/progress entry into the VideoStudio real-time activity feed visible on the LAN UI.',
    {
      project: z.string().optional().describe('Optional project slug or UUID'),
      action: z.string().default('claude.note').describe('Short machine action key (e.g. comfy.prompt_queued)'),
      summary: z.string().min(1).max(500).describe('Human-readable summary shown in Live Feed'),
      entityRef: z.string().optional().describe('Optional related @ref handle'),
    },
    async (args) => {
      let projectId: string | null = null;
      let projectSlug: string | null = null;
      if (args.project) {
        const proj = await studio.getProjectByIdOrSlug(args.project);
        if (proj) {
          projectId = proj.id;
          projectSlug = proj.slug;
        }
      }
      const entry = await studio.logActivity({
        projectId,
        projectSlug,
        actor: 'claude',
        action: args.action,
        summary: args.summary,
        entityRef: args.entityRef ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
      };
    },
  );

  server.tool(
    'start_job',
    'Declare a long-running generation task (image, video draft, upscale, audio) so the user sees live progress, sub-steps (e.g. 41/62), status message, and countdown ETA in the CLAUDE LIVE bar. Optionally pass comfyPromptIds[] to let VideoStudio track ComfyUI /history automatically when COMFYUI_BASE_URL is configured.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      type: z.string().default('generation').describe('Job category (image_gen, video_draft, hq_upscale, audio_gen, timeline_render)'),
      title: z.string().min(1).max(200).describe('Short description shown in the live progress bar'),
      stepCurrent: z.number().int().min(0).optional().describe('Optional current sub-step (e.g. 0)'),
      stepTotal: z.number().int().min(1).optional().describe('Optional total sub-steps (e.g. 62)'),
      message: z.string().max(400).optional().describe('Optional live status message'),
      comfyPromptIds: z.array(z.string()).optional().describe('Optional ComfyUI prompt_id list to auto-track via /history'),
      etaSeconds: z.number().int().min(0).max(86400 * 7).optional().describe('Estimated remaining seconds (auto-computes live countdown ETA)'),
      estimatedCompletionAt: z.string().optional().describe('Optional ISO-8601 timestamp for target completion'),
    },
    async (args) => {
      try {
        const job = await studio.startJob({
          projectIdOrSlug: args.project,
          type: args.type,
          title: args.title,
          stepCurrent: args.stepCurrent,
          stepTotal: args.stepTotal,
          message: args.message,
          comfyPromptIds: args.comfyPromptIds,
          etaSeconds: args.etaSeconds,
          estimatedCompletionAt: args.estimatedCompletionAt,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'update_job',
    'Update progress, sub-steps (stepCurrent/stepTotal), status message, live countdown ETA (etaSeconds or estimatedCompletionAt), status (running/completed/failed), or attach the resulting asset UUID to an active live job.',
    {
      jobId: z.string().uuid().describe('Job UUID returned by start_job'),
      status: JobStatusSchema.optional(),
      progress: z.number().int().min(0).max(100).optional(),
      stepCurrent: z.number().int().min(0).nullable().optional(),
      stepTotal: z.number().int().min(1).nullable().optional(),
      message: z.string().max(400).optional(),
      comfyPromptIds: z.array(z.string()).optional(),
      etaSeconds: z.number().int().min(0).max(86400 * 7).nullable().optional(),
      estimatedCompletionAt: z.string().nullable().optional(),
      resultAssetId: z.string().uuid().optional(),
      errorMessage: z.string().optional(),
    },
    async (args) => {
      const updated = await studio.updateJob(args.jobId, {
        status: args.status,
        progress: args.progress,
        stepCurrent: args.stepCurrent,
        stepTotal: args.stepTotal,
        message: args.message,
        comfyPromptIds: args.comfyPromptIds,
        etaSeconds: args.etaSeconds,
        estimatedCompletionAt: args.estimatedCompletionAt,
        resultAssetId: args.resultAssetId,
        errorMessage: args.errorMessage,
      });
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Job not found: ${args.jobId}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  server.tool(
    'sync_agent_tasks',
    'Push or update your structured live task checklist (plan / todo list) for a project, including optional etaSeconds / estimatedCompletionAt per task. The Web UI displays the active in_progress task and live ETA countdown in the compact CLAUDE LIVE bar, and unfolds the full task list on click.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      tasks: z
        .array(SyncAgentTaskItemSchema)
        .max(200)
        .describe(
          'Ordered list of tasks. Each task has title, status (pending | in_progress | completed | failed | skipped), optional stable key, detail, progress (0-100), groupName, assetRef, etaSeconds, and estimatedCompletionAt.',
        ),
      replace: z
        .boolean()
        .default(true)
        .describe('If true (default), replaces the project task list cleanly; if false, upserts by key / appends.'),
    },
    async (args) => {
      const list = await studio.syncAgentTasks(
        args.project,
        { tasks: args.tasks, replace: args.replace },
        'claude',
      );
      if (!list) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project not found: ${args.project}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    'update_agent_task',
    'Update the status, progress (0-100), detail, live ETA (etaSeconds / estimatedCompletionAt), or linked @assetRef of a single live task by UUID or external key.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      task: z.string().min(1).describe('Task UUID or external key (e.g. "upscale-01")'),
      title: z.string().min(1).max(240).optional(),
      detail: z.string().max(1000).optional(),
      status: AgentTaskStatusSchema.optional(),
      progress: z.number().int().min(0).max(100).nullable().optional(),
      groupName: z.string().max(120).optional(),
      assetRef: z.string().max(120).nullable().optional(),
      etaSeconds: z.number().int().min(0).max(86400 * 7).nullable().optional(),
      estimatedCompletionAt: z.string().nullable().optional(),
      sortOrder: z.number().int().min(0).max(10000).optional(),
    },
    async (args) => {
      const updated = await studio.updateAgentTask(
        args.project,
        args.task,
        {
          title: args.title,
          detail: args.detail,
          status: args.status,
          progress: args.progress,
          groupName: args.groupName,
          assetRef: args.assetRef,
          etaSeconds: args.etaSeconds,
          estimatedCompletionAt: args.estimatedCompletionAt,
          sortOrder: args.sortOrder,
        },
        'claude',
      );
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project or task not found: ${args.task}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  server.tool(
    'list_agent_tasks',
    'List all current Claude live tasks and their statuses for a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
    },
    async ({ project }) => {
      const list = await studio.listAgentTasks(project);
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    'clear_agent_tasks',
    'Clear completed/skipped tasks (default) or all live tasks for a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      scope: z.enum(['completed', 'all']).default('completed'),
    },
    async ({ project, scope }) => {
      const remaining = await studio.clearAgentTasks(project, scope);
      if (!remaining) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project not found: ${project}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(remaining, null, 2) }],
      };
    },
  );

  // ==========================================================================
  // Stage 2 MCP Resources (Rules, Feedback, Prompts, Workflows, Skills)
  // ==========================================================================

  server.resource(
    'project-rules',
    new ResourceTemplate('studio://projects/{slug}/rules', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const bundle = await stage2.getResolvedProjectRules(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(bundle ?? { error: `Project not found: ${slug}` }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'project-feedback',
    new ResourceTemplate('studio://projects/{slug}/feedback', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const feedback = await stage2.listProjectFeedback(slug, 'open');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(feedback, null, 2),
          },
        ],
      };
    },
  );

  server.resource('prompt-templates', 'studio://prompts', async (uri) => {
    const items = await stage2.listPromptTemplates();
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(items, null, 2) }],
    };
  });

  server.resource('comfy-workflows', 'studio://workflows', async (uri) => {
    const items = await stage2.listComfyWorkflows();
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(items, null, 2) }],
    };
  });

  server.resource('claude-skills', 'studio://skills', async (uri) => {
    const items = await stage2.listSkills();
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(items, null, 2) }],
    };
  });

  // ==========================================================================
  // Stage 2 MCP Tools (Feedback Inbox, Rulebooks, Prompts, Workflows, Skills)
  // ==========================================================================

  server.tool(
    'get_pending_feedback',
    'Get all open visual annotations (with normalized x/y/w/h coordinates, video timecode, auto-linked storyboard shotCode, and optional incremental since ISO timestamp filter) and compact assets marked needs_revision for a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      since: z
        .string()
        .optional()
        .describe('Optional ISO-8601 timestamp to fetch only new annotations created after this time'),
    },
    async ({ project, since }) => {
      const [openAnnotations, needsRevisionAssets] = await Promise.all([
        stage2.listProjectFeedback(project, 'open', since),
        studio.listAssets(project, { status: 'needs_revision', limit: 100 }),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                checkedAt: new Date().toISOString(),
                openAnnotationsCount: openAnnotations.length,
                openAnnotations,
                needsRevisionAssets: needsRevisionAssets.map((a) => studio.toCompactAssetDto(a)),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'resolve_feedback',
    'Mark a visual annotation/feedback item as resolved once Claude has addressed it.',
    {
      annotationId: z.string().uuid().describe('Annotation UUID from get_pending_feedback'),
    },
    async ({ annotationId }) => {
      const updated = await stage2.updateAnnotation(
        annotationId,
        { status: 'resolved', resolvedBy: 'claude' },
        'claude',
      );
      if (!updated) {
        return { isError: true, content: [{ type: 'text', text: `Annotation not found: ${annotationId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'get_active_rules',
    'Get the fully resolved ruleset for a project (combining global rulebooks, per-project overrides like 5 fingers vs 4 fingers, and custom project rules) plus compiled positive/negative prompt fragments. Pass optional `tags` (e.g. ["elena"]) to compile fragments scoped to a specific character/scene; rules with `autoInject: false` remain informative-only.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional context tags (e.g. ["elena"] or ["caspian"]) to filter tag-scoped rule fragments'),
    },
    async ({ project, tags }) => {
      const bundle = await stage2.getResolvedProjectRules(project, tags);
      if (!bundle) {
        return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }] };
    },
  );

  server.tool(
    'list_rulebooks',
    'List all global reusable rulebooks and their default rules.',
    {},
    async () => {
      const books = await stage2.listRulebooks();
      return { content: [{ type: 'text', text: JSON.stringify(books, null, 2) }] };
    },
  );

  server.tool(
    'set_project_rule_override',
    'Override any rule (global rulebook rule OR project custom rule) for one project — e.g. changing hands-fingers from 5 to 4, setting autoInjectOverride=false for informative-only guidance, scoping appliesToTagsOverride=["elena"], or disabling a rule.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      ruleId: z.string().uuid().describe('Rule UUID from get_active_rules or list_rulebooks'),
      enabledOverride: z.boolean().nullable().optional(),
      severityOverride: RuleSeveritySchema.nullable().optional(),
      valueOverride: z.string().nullable().optional(),
      instructionOverride: z.string().nullable().optional(),
      positiveFragmentOverride: z.string().nullable().optional(),
      negativeFragmentOverride: z.string().nullable().optional(),
      autoInjectOverride: z
        .boolean()
        .nullable()
        .optional()
        .describe('Set false to make the rule informative-only (never auto-injected into prompts)'),
      appliesToTagsOverride: z
        .array(z.string())
        .nullable()
        .optional()
        .describe('Restrict auto-injection to prompts matching one of these tags (empty [] = global)'),
    },
    async (args) => {
      const bundle = await stage2.upsertProjectRuleOverride(
        args.project,
        args.ruleId,
        {
          enabledOverride: args.enabledOverride,
          severityOverride: args.severityOverride,
          valueOverride: args.valueOverride,
          instructionOverride: args.instructionOverride,
          positiveFragmentOverride: args.positiveFragmentOverride,
          negativeFragmentOverride: args.negativeFragmentOverride,
          autoInjectOverride: args.autoInjectOverride,
          appliesToTagsOverride: args.appliesToTagsOverride,
        },
        'claude',
      );
      if (!bundle) {
        return { isError: true, content: [{ type: 'text', text: 'Project or rule not found' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }] };
    },
  );

  server.tool(
    'add_project_custom_rule',
    'Add a project-specific custom rule that applies only to this project. Set autoInject=false for informative-only rules, or appliesToTags=["character"] to scope prompt fragment injection.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      code: z.string().regex(/^[a-z0-9-_]+$/).describe('Short machine code (e.g. noir-palette)'),
      title: z.string().min(1),
      category: RuleCategorySchema.default('style'),
      severity: RuleSeveritySchema.default('mandatory'),
      defaultValue: z.string().default(''),
      instruction: z.string().min(1),
      positiveFragment: z.string().default(''),
      negativeFragment: z.string().default(''),
      autoInject: z
        .boolean()
        .default(true)
        .describe('If false, the rule is informative-only and its fragments are NOT auto-injected into prompts'),
      appliesToTags: z
        .array(z.string())
        .default([])
        .describe('Optional tags (e.g. ["elena"]) restricting auto-injection to matching prompts; empty = all prompts'),
    },
    async (args) => {
      const created = await stage2.addProjectCustomRule(
        args.project,
        {
          code: args.code,
          title: args.title,
          category: args.category,
          severity: args.severity,
          defaultValue: args.defaultValue,
          instruction: args.instruction,
          positiveFragment: args.positiveFragment,
          negativeFragment: args.negativeFragment,
          autoInject: args.autoInject,
          appliesToTags: args.appliesToTags,
          enabled: true,
          sortOrder: 50,
        },
        'claude',
      );
      if (!created) {
        return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.tool(
    'update_rule',
    'Directly edit an existing rule (project custom rule or rulebook rule) by UUID — including instruction, positive/negative fragments, autoInject, appliesToTags, severity, or enabled flag.',
    {
      ruleId: z.string().uuid().describe('Rule UUID from get_active_rules or list_rulebooks'),
      code: z.string().regex(/^[a-z0-9-_]+$/).optional(),
      title: z.string().min(1).optional(),
      category: RuleCategorySchema.optional(),
      severity: RuleSeveritySchema.optional(),
      defaultValue: z.string().optional(),
      instruction: z.string().min(1).optional(),
      positiveFragment: z.string().optional(),
      negativeFragment: z.string().optional(),
      autoInject: z.boolean().optional(),
      appliesToTags: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
    },
    async (args) => {
      const updated = await stage2.updateRule(args.ruleId, {
        code: args.code,
        title: args.title,
        category: args.category,
        severity: args.severity,
        defaultValue: args.defaultValue,
        instruction: args.instruction,
        positiveFragment: args.positiveFragment,
        negativeFragment: args.negativeFragment,
        autoInject: args.autoInject,
        appliesToTags: args.appliesToTags,
        enabled: args.enabled,
        sortOrder: args.sortOrder,
      });
      if (!updated) {
        return { isError: true, content: [{ type: 'text', text: `Rule not found: ${args.ruleId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'delete_rule',
    'Delete a rule (such as a project-specific custom rule) by UUID.',
    {
      ruleId: z.string().uuid().describe('Rule UUID to delete'),
    },
    async ({ ruleId }) => {
      const deleted = await stage2.deleteRule(ruleId);
      if (!deleted) {
        return { isError: true, content: [{ type: 'text', text: `Rule not found: ${ruleId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, ruleId }) }] };
    },
  );

  server.tool(
    'list_prompt_templates',
    'List reusable prompt templates stored in VideoStudio.',
    {
      category: PromptCategorySchema.optional(),
    },
    async ({ category }) => {
      const list = await stage2.listPromptTemplates(category);
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.tool(
    'save_prompt_template',
    'Save a new reusable prompt template with {{variable}} placeholders.',
    {
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      category: PromptCategorySchema.default('image'),
      targetModel: z.string().default(''),
      positiveTemplate: z.string().min(1),
      negativeTemplate: z.string().default(''),
      tags: z.array(z.string()).default([]),
      notes: z.string().default(''),
    },
    async (args) => {
      const created = await stage2.createPromptTemplate(
        {
          name: args.name,
          slug: args.slug,
          category: args.category,
          targetModel: args.targetModel,
          positiveTemplate: args.positiveTemplate,
          negativeTemplate: args.negativeTemplate,
          variables: [],
          tags: args.tags,
          notes: args.notes,
        },
        'claude',
      );
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.tool(
    'render_prompt_with_rules',
    'Render a reusable prompt template by filling {{variables}} and automatically injecting eligible positive/negative fragments from a project ruleset (honoring autoInject and appliesToTags).',
    {
      template: z.string().min(1).describe('Prompt template slug or UUID'),
      project: z.string().optional().describe('Optional project slug/UUID to inject active project rules'),
      variables: z.record(z.string()).optional().describe('Key-value map for {{variables}}'),
      includeProjectRules: z.boolean().default(true),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional subject/character tags (e.g. ["elena"] or ["caspian"]) to activate matching tag-scoped rules'),
    },
    async (args) => {
      const rendered = await stage2.renderPromptWithProjectRules({
        templateIdOrSlug: args.template,
        projectIdOrSlug: args.project,
        variables: args.variables,
        includeProjectRules: args.includeProjectRules,
        tags: args.tags,
      });
      if (!rendered) {
        return { isError: true, content: [{ type: 'text', text: `Prompt template not found: ${args.template}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(rendered, null, 2) }] };
    },
  );

  server.tool(
    'list_comfy_workflows',
    'List saved reusable ComfyUI workflows (.json templates) stored in VideoStudio.',
    {
      category: ComfyWorkflowCategorySchema.optional(),
    },
    async ({ category }) => {
      const list = await stage2.listComfyWorkflows(category);
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.tool(
    'save_comfy_workflow',
    'Save a reusable ComfyUI workflow JSON graph to the studio library.',
    {
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      description: z.string().default(''),
      category: ComfyWorkflowCategorySchema.default('image_gen'),
      workflowJson: z.record(z.unknown()),
      inputNotes: z.string().default(''),
      tags: z.array(z.string()).default([]),
    },
    async (args) => {
      const saved = await stage2.createComfyWorkflow(args, 'claude');
      return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
    },
  );

  server.tool(
    'list_skills',
    'List Claude Code skills stored in the VideoStudio Skills Hub (global or project-scoped).',
    {
      project: z.string().optional().describe('Optional project slug to include project-scoped skills'),
    },
    async ({ project }) => {
      const items = await stage2.listSkills(project);
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  server.tool(
    'read_skill',
    'Read the full SKILL.md instructions and version history of a skill by slug or UUID.',
    {
      skill: z.string().min(1).describe('Skill slug or UUID'),
    },
    async ({ skill }) => {
      const detail = await stage2.getSkillWithVersions(skill);
      if (!detail) {
        return { isError: true, content: [{ type: 'text', text: `Skill not found: ${skill}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
    },
  );

  server.tool(
    'save_skill',
    'Create or update a versioned Claude Code skill (SKILL.md) in VideoStudio and sync it to disk on the local server.',
    {
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      name: z.string().min(1),
      description: z.string().min(1),
      scope: SkillScopeSchema.default('global'),
      project: z.string().optional().describe('Project slug/UUID when scope is "project"'),
      content: z.string().min(1).describe('Markdown body of SKILL.md'),
      changeSummary: z.string().default('Mis à jour par Claude Code'),
      syncEnabled: z.boolean().default(true),
    },
    async (args) => {
      let projectId: string | null = null;
      if (args.scope === 'project' && args.project) {
        const proj = await studio.getProjectByIdOrSlug(args.project);
        projectId = proj?.id ?? null;
      }
      const saved = await stage2.upsertSkill({
        slug: args.slug,
        name: args.name,
        description: args.description,
        scope: args.scope,
        projectId,
        content: args.content,
        changeSummary: args.changeSummary,
        syncEnabled: args.syncEnabled,
        author: 'claude',
      });
      return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
    },
  );

  // ==========================================================================
  // Stage 3 MCP Resources (Script, Bible, Storyboard, Audio, YouTube, Git)
  // ==========================================================================

  server.resource(
    'project-script',
    new ResourceTemplate('studio://projects/{slug}/script', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const script = await stage3.getProjectScript(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(script ?? { error: `Project not found: ${slug}` }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'project-bible',
    new ResourceTemplate('studio://projects/{slug}/bible', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const entities = await stage3.listBibleEntities(slug);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(entities, null, 2) }],
      };
    },
  );

  server.resource(
    'project-storyboard',
    new ResourceTemplate('studio://projects/{slug}/storyboard', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const storyboard = await stage3.getStoryboard(slug);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(storyboard, null, 2) }],
      };
    },
  );

  server.resource(
    'project-audio',
    new ResourceTemplate('studio://projects/{slug}/audio', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const tracks = await stage3.listAudioTracks(slug);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tracks, null, 2) }],
      };
    },
  );

  server.resource(
    'project-youtube',
    new ResourceTemplate('studio://projects/{slug}/youtube', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const pkg = await stage3.getYouTubePackage(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(pkg ?? { error: `Project not found: ${slug}` }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'project-git',
    new ResourceTemplate('studio://projects/{slug}/git', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const status = await stage3.getProjectRepoStatus(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(status ?? { error: `Project not found: ${slug}` }, null, 2),
          },
        ],
      };
    },
  );

  // ==========================================================================
  // Stage 3 MCP Tools (Script, Bible, Storyboard, Audio, YouTube, Project Git)
  // ==========================================================================

  server.tool(
    'get_script',
    'Read the current project script and version history.',
    { project: z.string().min(1) },
    async ({ project }) => {
      const script = await stage3.getProjectScript(project);
      if (!script) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(script, null, 2) }] };
    },
  );

  server.tool(
    'update_script',
    'Save a new version of the project screenplay/script with a change summary.',
    {
      project: z.string().min(1),
      title: z.string().optional(),
      content: z.string(),
      changeSummary: z.string().default('Mis à jour par Claude Code'),
    },
    async (args) => {
      const updated = await stage3.updateProjectScript(args.project, {
        title: args.title,
        content: args.content,
        changeSummary: args.changeSummary,
        author: 'claude',
      });
      if (!updated) return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'upsert_bible_entity',
    'Create or update a Continuity Bible entry (character, location, prop, or visual style) with its canonical @ref and consistent visual prompt/LoRA.',
    {
      project: z.string().min(1),
      refCode: z.string().regex(/^[a-z0-9-]+$/).optional(),
      entityType: BibleEntityTypeSchema.default('character'),
      name: z.string().min(1),
      description: z.string().default(''),
      visualPrompt: z.string().default(''),
      loraName: z.string().default(''),
      referenceAssetIds: z.array(z.string().uuid()).default([]),
      tags: z.array(z.string()).default([]),
    },
    async (args) => {
      const saved = await stage3.upsertBibleEntity(
        args.project,
        {
          refCode: args.refCode,
          entityType: args.entityType,
          name: args.name,
          description: args.description,
          visualPrompt: args.visualPrompt,
          loraName: args.loraName,
          referenceAssetIds: args.referenceAssetIds,
          tags: args.tags,
        },
        'claude',
      );
      if (!saved) return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
    },
  );

  server.tool(
    'get_storyboard',
    'Get all scenes and shots (storyboard breakdown with absolute startSec timecodes) for a project. Returns compact fields by default (compact=true) to stay lightweight; pass compact=false for full prompts and dialogue.',
    {
      project: z.string().min(1),
      compact: z.boolean().default(true).describe('Return compact shot list without full prompt/dialogue text (default true)'),
    },
    async ({ project, compact }) => {
      const storyboard = await stage3.getStoryboard(project);
      const data = compact ? stage3.toCompactStoryboard(storyboard) : storyboard;
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'upsert_storyboard',
    'Idempotent batch upsert of the full storyboard (scenes and shots) keyed by sceneNumber and shot externalId (e.g. "S04") or shotCode. Safe to re-run repeatedly without creating duplicates; automatically computes cumulative startSec timecodes.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      scenes: UpsertStoryboardInputSchema.shape.scenes,
      pruneMissing: z
        .boolean()
        .default(false)
        .describe('If true, deletes existing shots not present in this payload'),
    },
    async ({ project, scenes, pruneMissing }) => {
      const res = await stage3.upsertStoryboard(project, { scenes, pruneMissing }, 'claude');
      if (!res) {
        return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                stats: res.stats,
                scenes: stage3.toCompactStoryboard(res.scenes),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'compose_prompt',
    'Compose the exact final generation prompt for a storyboard shot by combining referenced Continuity Bible entries, ordered reference asset images, active project rules filtered by tags, and the shot prompt/camera movement.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      shot: z.string().min(1).describe('Shot UUID, shotCode (e.g. s01-sh01), or externalId (e.g. S04)'),
      extraTags: z.array(z.string()).optional().describe('Additional context tags for rule filtering'),
      extraPositive: z.string().optional(),
      extraNegative: z.string().optional(),
    },
    async ({ project, shot, extraTags, extraPositive, extraNegative }) => {
      const composed = await stage3.composeShotPrompt(project, shot, {
        extraTags,
        extraPositive,
        extraNegative,
      });
      if (!composed) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Project or shot not found: ${shot}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(composed, null, 2) }] };
    },
  );

  server.tool(
    'create_scene',
    'Create a new scene in the project storyboard.',
    {
      project: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().default(''),
      locationRef: z.string().default(''),
    },
    async (args) => {
      const created = await stage3.createScene(
        args.project,
        { title: args.title, summary: args.summary, locationRef: args.locationRef },
        'claude',
      );
      if (!created) return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.tool(
    'create_shot',
    'Create a new shot inside a scene with externalId, absolute startSec, visual description, camera movement, dialogue, prompt, duration, and linked assets/bible entities.',
    {
      project: z.string().min(1),
      sceneId: z.string().uuid(),
      externalId: z.string().max(64).optional().describe('Optional stable external key (e.g. "S04") for idempotent upserts'),
      title: z.string().min(1),
      visualDescription: z.string().default(''),
      cameraMovement: z.string().default(''),
      dialogue: z.string().default(''),
      prompt: z.string().default(''),
      startSec: z.number().min(0).optional().describe('Optional absolute start timecode in seconds'),
      durationSec: z.number().min(0.2).max(300).default(4),
      status: ShotStatusSchema.default('planned'),
      keyframeAssetId: z.string().uuid().optional(),
      videoAssetId: z.string().uuid().optional(),
      bibleEntityRefs: z.array(z.string()).default([]),
    },
    async (args) => {
      const created = await stage3.createShot(args.project, args, 'claude');
      if (!created) return { isError: true, content: [{ type: 'text', text: 'Project or scene not found' }] };
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.tool(
    'update_shot',
    'Update a storyboard shot (externalId, startSec, keyframe/video asset UUID, prompt, status, duration).',
    {
      shotId: z.string().uuid(),
      externalId: z.string().max(64).nullable().optional(),
      title: z.string().optional(),
      visualDescription: z.string().optional(),
      cameraMovement: z.string().optional(),
      dialogue: z.string().optional(),
      prompt: z.string().optional(),
      startSec: z.number().min(0).nullable().optional(),
      durationSec: z.number().min(0.2).max(300).optional(),
      status: ShotStatusSchema.optional(),
      keyframeAssetId: z.string().uuid().nullable().optional(),
      videoAssetId: z.string().uuid().nullable().optional(),
    },
    async ({ shotId, ...patch }) => {
      const updated = await stage3.updateShot(shotId, patch, 'claude');
      if (!updated) return { isError: true, content: [{ type: 'text', text: `Shot not found: ${shotId}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'upsert_audio_track',
    'Register or update a music, stem, voiceover, dialogue, or SFX track with structured lyrics, standard or word-level Enhanced LRC (<mm:ss.xx>), auto-generated SRT, BPM, and beat/lip-sync markers.',
    {
      project: z.string().min(1),
      id: z.string().uuid().optional(),
      assetId: z.string().uuid().nullable().optional(),
      title: z.string().min(1),
      category: AudioCategorySchema.default('music'),
      bpm: z.number().min(20).max(300).nullable().optional(),
      musicalKey: z.string().default(''),
      promptUsed: z.string().default(''),
      lyrics: z.string().default(''),
      lrcContent: z.string().default(''),
      srtContent: z.string().default(''),
      markers: z.array(AudioMarkerSchema).default([]),
      notes: z.string().default(''),
    },
    async ({ project, ...payload }) => {
      const saved = await stage3.upsertAudioTrack(project, payload, 'claude');
      if (!saved) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
    },
  );

  server.tool(
    'import_suno_alignment',
    'Import Suno word-level alignment JSON ({word, start_s, end_s}[]) directly into an audio track as Enhanced LRC (<mm:ss.xx>) + auto-generated SRT subtitles.',
    {
      project: z.string().min(1),
      trackId: z.string().uuid().optional().describe('Optional existing audio track UUID to update'),
      title: z.string().min(1).max(200).optional(),
      pauseThresholdSec: z.number().min(0.2).max(10).default(1.2),
      words: z.array(
        z.object({
          word: z.string(),
          startS: z.number().optional(),
          endS: z.number().optional(),
          start_s: z.number().optional(),
          end_s: z.number().optional(),
        }),
      ),
    },
    async ({ project, ...payload }) => {
      const track = await stage3.importSunoAlignment(project, payload, 'claude');
      if (!track) return { isError: true, content: [{ type: 'text', text: `Project or track not found` }] };
      return { content: [{ type: 'text', text: JSON.stringify(track, null, 2) }] };
    },
  );

  server.tool(
    'update_youtube_package',
    'Update YouTube packaging (up to 3 A/B titles & thumbnail asset UUIDs, description, tags, hashtags, chapters, subtitles, AI disclosure).',
    {
      project: z.string().min(1),
      titles: z.array(z.string()).max(3).optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      hashtags: z.array(z.string()).optional(),
      pinnedComment: z.string().optional(),
      aiDisclosure: z.boolean().optional(),
      thumbnailAssetIds: z.array(z.string().uuid()).max(3).optional(),
      chapters: z.array(YouTubeChapterSchema).optional(),
      srtSubtitles: z.string().optional(),
    },
    async ({ project, ...patch }) => {
      const updated = await stage3.updateYouTubePackage(project, patch, 'claude');
      if (!updated) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'prepare_youtube_pack',
    'Export the complete YouTube Ready Pack (metadata.md, metadata.json, subtitles.srt, A/B thumbnail files) into the project exports folder.',
    { project: z.string().min(1) },
    async ({ project }) => {
      const pack = await stage3.exportYouTubeReadyPack(project);
      if (!pack) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(pack, null, 2) }] };
    },
  );

  server.tool(
    'init_project_git_repo',
    'Initialize or configure the dedicated local Git repository and optional GitHub remote URL (no embedded tokens) for a VideoStudio project.',
    {
      project: z.string().min(1),
      githubRemoteUrl: z.string().nullable().optional(),
      defaultBranch: z.string().default('main'),
      autoCommit: z.boolean().optional(),
    },
    async (args) => {
      try {
        const status = await stage3.initOrConfigureProjectRepo(
          args.project,
          {
            githubRemoteUrl: args.githubRemoteUrl,
            defaultBranch: args.defaultBranch,
            autoCommit: args.autoCommit,
          },
          'claude',
        );
        if (!status) return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
      }
    },
  );

  server.tool(
    'sync_and_commit_project_repo',
    'Export the project snapshot (script, bible, storyboard, resolved rules, audio lyrics, YouTube metadata) to its local Git repository and commit.',
    {
      project: z.string().min(1),
      message: z.string().min(1),
      exportSnapshot: z.boolean().default(true),
    },
    async (args) => {
      const res = await stage3.syncAndCommitProjectRepo(
        args.project,
        { message: args.message, exportSnapshot: args.exportSnapshot },
        'claude',
      );
      if (!res) return { isError: true, content: [{ type: 'text', text: `Project not found: ${args.project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    'get_project_git_status',
    'Inspect local Git repository status, configured GitHub remote, dirty files, and recent commits for a project.',
    { project: z.string().min(1) },
    async ({ project }) => {
      const status = await stage3.getProjectRepoStatus(project);
      if (!status) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    },
  );

  // ==========================================================================
  // Stage 4 MCP Resource & Tools (Multi-Track Timeline, Animatic, Render, NLE)
  // ==========================================================================

  server.resource(
    'project-timeline',
    new ResourceTemplate('studio://projects/{slug}/timeline', { list: undefined }),
    async (uri, variables) => {
      const slug = String(variables.slug ?? '');
      const timeline = await stage4.getTimeline(slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(timeline ?? { error: `Project not found: ${slug}` }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'get_timeline',
    'Get the multi-track NLE timeline (video & audio tracks, clips with timing/trim/asset refs, and render history) for a project.',
    { project: z.string().min(1) },
    async ({ project }) => {
      const timeline = await stage4.getTimeline(project);
      if (!timeline) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(timeline, null, 2) }] };
    },
  );

  server.tool(
    'save_timeline',
    'Save or replace the project multi-track NLE timeline tracks and clips (supports assetId or assetRef like @vid-001).',
    {
      project: z.string().min(1),
      tracks: UpsertTimelineInputSchema.shape.tracks,
    },
    async ({ project, tracks }) => {
      const saved = await stage4.saveTimeline(project, { tracks }, 'claude');
      if (!saved) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
    },
  );

  server.tool(
    'build_animatic_from_storyboard',
    'Automatically build a playable multi-track animatic timeline from the project storyboard shots (keyframes/videos) + primary audio track.',
    {
      project: z.string().min(1),
      includeAudio: z.boolean().default(true),
    },
    async ({ project, includeAudio }) => {
      const timeline = await stage4.buildTimelineFromStoryboard(project, { includeAudio }, 'claude');
      if (!timeline) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(timeline, null, 2) }] };
    },
  );

  server.tool(
    'switch_timeline_quality',
    'Swap timeline clips automatically between Draft Proxy (draft_proxy) and HQ Master (hq_master) versions.',
    {
      project: z.string().min(1),
      mode: TimelineQualityModeSchema.describe('"draft_proxy" or "hq_master"'),
    },
    async ({ project, mode }) => {
      const res = await stage4.swapTimelineQualityMode(project, mode, 'claude');
      if (!res) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    'render_timeline',
    'Start a server-side FFmpeg MP4 render of the project timeline (animatic draft_proxy or hq_master) with live Job progress + ETA and automatic registration in /renders.',
    {
      project: z.string().min(1),
      qualityMode: TimelineQualityModeSchema.default('draft_proxy'),
      resolution: z.string().optional().describe('Optional override e.g. "1280x720" or "1920x1080"'),
      fps: z.number().int().min(1).max(120).optional(),
      title: z.string().optional(),
    },
    async ({ project, ...input }) => {
      try {
        const res = await stage4.startServerRender(project, input, 'claude');
        if (!res) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'export_nle',
    'Export the project timeline to a standard NLE interchange format: OpenTimelineIO (.otio), Final Cut Pro XML (.fcpxml), or DaVinci Resolve / Premiere CMX 3600 (.edl).',
    {
      project: z.string().min(1),
      format: NleExportFormatSchema.default('otio'),
    },
    async ({ project, format }) => {
      const exported = await stage4.exportNle(project, format);
      if (!exported) return { isError: true, content: [{ type: 'text', text: `Project not found: ${project}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(exported, null, 2) }] };
    },
  );

  // ==========================================================================
  // Stage 5 MCP Tools (Ops Monitoring, Disk Cleanup, Backups, Watch Folders,
  // Outgoing Webhooks & Optional YouTube Draft Upload)
  // ==========================================================================

  if (stage5) {
    server.tool(
      'get_system_health_and_disk',
      'Get live VideoStudio server health metrics (CPU, RAM, uptime, DB, FFmpeg, active Blue/Green slot) and per-project disk usage summary.',
      {},
      async () => {
        const [metrics, disk] = await Promise.all([
          stage5.ops.getSystemMetrics(stage5.getInFlightRequests?.() ?? 0),
          stage5.ops.getDiskUsageSummary(),
        ]);
        return { content: [{ type: 'text', text: JSON.stringify({ metrics, disk }, null, 2) }] };
      },
    );

    server.tool(
      'preview_disk_cleanup',
      'Dry-run preview of selective disk cleanup for old rejected/archived test assets. NEVER touches approved, winner, final_master, or zero-copy ingest references.',
      {
        projectId: z.string().uuid().optional(),
        olderThanDays: z.number().int().min(0).max(3650).default(7),
        statuses: z.array(AssetStatusSchema).default(['needs_revision', 'archived']),
        qualityTiers: z.array(QualityTierSchema).default(['test', 'draft_lowres']),
        includeTempFiles: z.boolean().default(true),
      },
      async (args) => {
        const result = await stage5.ops.previewCleanup(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      'run_disk_cleanup',
      'Execute selective disk cleanup of old rejected/archived test assets and temporary files. Strictly protects approved, winner, final_master, and zero-copy ingest references.',
      {
        projectId: z.string().uuid().optional(),
        olderThanDays: z.number().int().min(0).max(3650).default(7),
        statuses: z.array(AssetStatusSchema).default(['needs_revision', 'archived']),
        qualityTiers: z.array(QualityTierSchema).default(['test', 'draft_lowres']),
        includeTempFiles: z.boolean().default(true),
      },
      async (args) => {
        const result = await stage5.ops.runCleanup(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      'create_backup',
      'Create a compressed backup archive (PostgreSQL dump + full JSON metadata + skills) in BACKUP_DIR.',
      {
        notes: z.string().max(500).default(''),
      },
      async ({ notes }) => {
        const backup = await stage5.ops.createBackup(notes);
        return { content: [{ type: 'text', text: JSON.stringify(backup, null, 2) }] };
      },
    );

    server.tool(
      'list_watch_folders',
      'List configured ComfyUI -> VideoStudio auto-ingest watch folders.',
      {
        project: z.string().optional().describe('Optional project slug or UUID filter'),
      },
      async ({ project }) => {
        const folders = await stage5.watchFolders.listWatchFolders(project);
        return { content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }] };
      },
    );

    server.tool(
      'create_watch_folder',
      'Register an auto-ingest watch folder pointing to an allowed read-only ComfyUI output directory.',
      {
        project: z.string().min(1).describe('Project slug or UUID'),
        relativeDir: z.string().min(1).max(400),
        folderPath: z.string().max(200).default(''),
        glob: z.string().max(120).default('*'),
        storageMode: StorageModeSchema.default('reference'),
        qualityTier: QualityTierSchema.default('test'),
        tags: z.array(z.string()).default([]),
        enabled: z.boolean().default(true),
        pollIntervalSec: z.number().int().min(5).max(3600).default(15),
      },
      async ({ project, ...rest }) => {
        try {
          const created = await stage5.watchFolders.createWatchFolder({
            projectId: project,
            ...rest,
          });
          return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );

    server.tool(
      'list_webhooks',
      'List configured outgoing webhooks (secrets are never returned).',
      {
        projectId: z.string().uuid().optional(),
      },
      async ({ projectId }) => {
        const items = await stage5.webhooks.listWebhooks(projectId);
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      },
    );

    server.tool(
      'create_webhook',
      'Create an outgoing HTTP POST webhook (optional HMAC-SHA256 signing secret) for studio events.',
      {
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).max(120),
        url: z.string().url().max(600),
        events: z.array(WebhookEventTypeSchema).min(1),
        secret: z.string().max(256).optional(),
        enabled: z.boolean().default(true),
      },
      async (args) => {
        try {
          const created = await stage5.webhooks.createWebhook(args);
          return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );

    server.tool(
      'upload_youtube_draft',
      'Upload a project video as a private or unlisted YouTube draft via YouTube Data API v3 using the project YouTube package metadata and optional A/B thumbnail.',
      {
        project: z.string().min(1).describe('Project slug or UUID'),
        videoAssetId: z.string().uuid().optional(),
        videoAssetRef: z.string().optional().describe('Optional @ref handle (e.g. @vid-001)'),
        titleIndex: z.number().int().min(0).max(2).default(0),
        thumbnailIndex: z.number().int().min(0).max(2).nullable().default(0),
        privacyStatus: z.enum(['private', 'unlisted']).default('private'),
      },
      async ({ project, ...rest }) => {
        try {
          const uploaded = await stage5.youtubeUpload.uploadDraftVideo(project, rest);
          return { content: [{ type: 'text', text: JSON.stringify(uploaded, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );
  }

  // ==========================================================================
  // Scene Blocking Plans & Storyboard Sketches MCP Tools
  // ==========================================================================

  if (sketches) {
    server.tool(
      'list_sketches',
      'List all scene blocking plans and freehand storyboard sketches in a project with their AI Director Briefs and linked Media @ref handles.',
      {
        project: z.string().min(1).describe('Project slug or UUID'),
      },
      async ({ project }) => {
        const list = await sketches.listSketches(project);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                list.map((s) => ({
                  id: s.id,
                  title: s.title,
                  mode: s.mode,
                  aspectRatio: s.aspectRatio,
                  folderPath: s.folderPath,
                  assetId: s.assetId,
                  assetRef: s.assetRef,
                  assetHandle: s.assetHandle,
                  aiDirectorBrief: s.aiDirectorBrief,
                  camerasCount: s.sceneData.cameras.length,
                  charactersCount: s.sceneData.characters.length,
                  arrowsCount: s.sceneData.arrows.length,
                  strokesCount: s.sceneData.strokes.length,
                  updatedAt: s.updatedAt,
                })),
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.tool(
      'get_sketch',
      'Get the full structured sceneData (cameras, focal lengths, movements, characters, lights, props, motion arrows, strokes) and AI Director Brief of a sketch by sketch UUID or linked asset @ref.',
      {
        sketchIdOrRef: z
          .string()
          .min(1)
          .describe('Sketch UUID, Asset UUID, or Asset @ref handle (e.g. @img-012)'),
        project: z.string().optional().describe('Optional project slug/UUID when using @ref'),
      },
      async ({ sketchIdOrRef, project }) => {
        let sketch = await sketches.getSketchById(sketchIdOrRef);
        if (!sketch) {
          sketch = await sketches.getSketchByAssetId(sketchIdOrRef);
        }
        if (!sketch) {
          const resolved = await studio.resolveReference(sketchIdOrRef, project);
          if (resolved?.asset) {
            sketch = await sketches.getSketchByAssetId(resolved.asset.id);
          }
        }
        if (!sketch) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Sketch not found: ${sketchIdOrRef}` }],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(sketch, null, 2) }] };
      },
    );

    server.tool(
      'save_sketch',
      'Create or update a scene blocking plan or storyboard sketch programmatically (the user can then open, inspect, tweak, and export it in the Sketch Studio UI).',
      {
        project: z.string().min(1).describe('Project slug or UUID'),
        sketchId: z.string().uuid().optional().describe('Existing sketch UUID to update; omit to create new'),
        title: z.string().min(1).max(140),
        mode: SketchModeSchema.default('scene_plan'),
        aspectRatio: z.string().default('16:9'),
        folderPath: z.string().optional(),
        sceneData: SketchSceneDataSchema,
        aiDirectorBrief: z.string().optional(),
        pngBase64: z.string().optional().describe('Optional rendered PNG base64 to save in Media'),
      },
      async ({ project, sketchId, ...rest }) => {
        try {
          const saved = sketchId
            ? await sketches.updateSketch(
                sketchId,
                { ...rest, saveMode: 'new_version' },
                'claude',
              )
            : await sketches.createSketch(
                project,
                { ...rest, saveMode: 'new_version' },
                'claude',
              );
          if (!saved) {
            return { isError: true, content: [{ type: 'text', text: `Sketch not found: ${sketchId}` }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );
  }

  return server;
}

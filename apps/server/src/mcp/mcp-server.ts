import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AssetStatusSchema,
  AssetTypeSchema,
  JobStatusSchema,
  ProjectTypeSchema,
  QualityTierSchema,
} from '@videostudio/shared';
import type { MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';

export function createVideoStudioMcpServer(
  studio: StudioService,
  media: MediaService,
): McpServer {
  const server = new McpServer({
    name: 'videostudio',
    version: '0.1.0',
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
      const [projectAssets, recentActivities, activeJobs] = await Promise.all([
        studio.listAssets(project.id, { limit: 50 }),
        studio.listActivities(project.id, 25),
        studio.listJobs(project.id, 15),
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
                recentAssets: projectAssets.slice(0, 20),
                activeJobs,
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
            text: JSON.stringify(projectAssets, null, 2),
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
    'List all VideoStudio projects with their slugs, statuses, and asset counts.',
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
        },
        'claude',
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
      };
    },
  );

  server.tool(
    'get_project_overview',
    'Get detailed overview, recent assets, and live jobs for a project by slug or UUID.',
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
      const [projectAssets, activeJobs, recentActivities] = await Promise.all([
        studio.listAssets(project.id, { limit: 40 }),
        studio.listJobs(project.id, 15),
        studio.listActivities(project.id, 20),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { project, assets: projectAssets, jobs: activeJobs, recentActivities },
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
    'Ingest an image, video, audio, or document into a VideoStudio project (from a LAN ComfyUI URL, base64 payload, or mounted ingest path). Automatically extracts ComfyUI PNG/MP4 metadata, generates thumbnails/proxies, links parent versions, and updates the Web UI in real time.',
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
        .describe('Relative path inside the mounted INGEST_ALLOWED_DIR'),
      filename: z.string().optional().describe('Original filename with extension (e.g. hero_01.png)'),
      mimeType: z.string().optional().describe('Optional MIME type override'),
      type: AssetTypeSchema.optional().describe('Optional explicit asset type (image, video, audio, document)'),
      title: z.string().optional().describe('Display title in VideoStudio'),
      qualityTier: QualityTierSchema.optional().describe('test, draft_lowres, hq_upscale, or final_master'),
      status: AssetStatusSchema.optional().describe('new, in_review, needs_revision, approved, winner, archived'),
      parentRef: z
        .string()
        .optional()
        .describe('Optional parent asset reference (e.g. @img-001 or UUID) to link version lineage or Draft -> HQ'),
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
          title: args.title,
          qualityTier: args.qualityTier,
          status: args.status,
          parentRef: args.parentRef,
          promptUsed: args.promptUsed,
          negativePrompt: args.negativePrompt,
          modelName: args.modelName,
          seed: args.seed,
          tags: args.tags,
          notes: args.notes,
          createdBy: 'claude',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
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
    'list_assets',
    'List and filter assets inside a VideoStudio project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      type: AssetTypeSchema.optional(),
      status: AssetStatusSchema.optional(),
      qualityTier: QualityTierSchema.optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
      const list = await studio.listAssets(args.project, {
        type: args.type,
        status: args.status,
        qualityTier: args.qualityTier,
        tag: args.tag,
        search: args.search,
        limit: args.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    'update_asset',
    'Update metadata, status, quality tier, rating, notes, or tags of an existing asset by reference (@img-001) or UUID.',
    {
      ref: z.string().min(1).describe('Asset reference (@img-001, slug/img-001, studio://...) or UUID'),
      project: z.string().optional().describe('Optional project slug to disambiguate short @ref'),
      title: z.string().optional(),
      status: AssetStatusSchema.optional(),
      qualityTier: QualityTierSchema.optional(),
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
          status: args.status,
          qualityTier: args.qualityTier,
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
    'Declare a long-running generation task (image, video draft, upscale, audio) so the user sees live progress in VideoStudio.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      type: z.string().default('generation').describe('Job category (image_gen, video_draft, hq_upscale, audio_gen)'),
      title: z.string().min(1).max(200).describe('Short description shown in the live progress bar'),
    },
    async (args) => {
      try {
        const job = await studio.startJob({
          projectIdOrSlug: args.project,
          type: args.type,
          title: args.title,
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
    'Update progress, status (running/completed/failed), or attach the resulting asset UUID to an active live job.',
    {
      jobId: z.string().uuid().describe('Job UUID returned by start_job'),
      status: JobStatusSchema.optional(),
      progress: z.number().int().min(0).max(100).optional(),
      resultAssetId: z.string().uuid().optional(),
      errorMessage: z.string().optional(),
    },
    async (args) => {
      const updated = await studio.updateJob(args.jobId, {
        status: args.status,
        progress: args.progress,
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

  return server;
}

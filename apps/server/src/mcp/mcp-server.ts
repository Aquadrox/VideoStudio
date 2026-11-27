import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AssetStatusSchema,
  AssetTypeSchema,
  AudioCategorySchema,
  AudioMarkerSchema,
  BibleEntityTypeSchema,
  ComfyWorkflowCategorySchema,
  JobStatusSchema,
  ProjectTypeSchema,
  PromptCategorySchema,
  QualityTierSchema,
  RuleCategorySchema,
  RuleSeveritySchema,
  ShotStatusSchema,
  SkillScopeSchema,
  YouTubeChapterSchema,
} from '@videostudio/shared';
import type { MediaService } from '../services/media.service.js';
import type { Stage2Service } from '../services/stage2.service.js';
import type { Stage3Service } from '../services/stage3.service.js';
import type { StudioService } from '../services/studio.service.js';

export function createVideoStudioMcpServer(
  studio: StudioService,
  media: MediaService,
  stage2: Stage2Service,
  stage3: Stage3Service,
): McpServer {
  const server = new McpServer({
    name: 'videostudio',
    version: '0.3.0',
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
    'Get all open visual annotations (with normalized x/y/w/h coordinates and exact video frame/timecode) and assets marked needs_revision for a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
    },
    async ({ project }) => {
      const [openAnnotations, needsRevisionAssets] = await Promise.all([
        stage2.listProjectFeedback(project, 'open'),
        studio.listAssets(project, { status: 'needs_revision', limit: 100 }),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                openAnnotationsCount: openAnnotations.length,
                openAnnotations,
                needsRevisionAssets,
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
    'Get the fully resolved ruleset for a project (combining global rulebooks, per-project overrides like 5 fingers vs 4 fingers, and custom project rules) plus compiled positive/negative prompt fragments. ALWAYS call this before generating media for a project.',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
    },
    async ({ project }) => {
      const bundle = await stage2.getResolvedProjectRules(project);
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
    'Override a global rule specifically for one project (e.g. changing hands-fingers from 5 fingers to 4 fingers for a cartoon project, or disabling a rule).',
    {
      project: z.string().min(1).describe('Project slug or UUID'),
      ruleId: z.string().uuid().describe('Rule UUID from get_active_rules or list_rulebooks'),
      enabledOverride: z.boolean().nullable().optional(),
      severityOverride: RuleSeveritySchema.nullable().optional(),
      valueOverride: z.string().nullable().optional(),
      instructionOverride: z.string().nullable().optional(),
      positiveFragmentOverride: z.string().nullable().optional(),
      negativeFragmentOverride: z.string().nullable().optional(),
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
    'Add a project-specific custom rule that applies only to this project.',
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
    'Render a reusable prompt template by filling {{variables}} and automatically injecting the active positive/negative prompt fragments from a project ruleset.',
    {
      template: z.string().min(1).describe('Prompt template slug or UUID'),
      project: z.string().optional().describe('Optional project slug/UUID to inject active project rules'),
      variables: z.record(z.string()).optional().describe('Key-value map for {{variables}}'),
      includeProjectRules: z.boolean().default(true),
    },
    async (args) => {
      const rendered = await stage2.renderPromptWithProjectRules({
        templateIdOrSlug: args.template,
        projectIdOrSlug: args.project,
        variables: args.variables,
        includeProjectRules: args.includeProjectRules,
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
    'Get all scenes and shots (storyboard breakdown) for a project.',
    { project: z.string().min(1) },
    async ({ project }) => {
      const storyboard = await stage3.getStoryboard(project);
      return { content: [{ type: 'text', text: JSON.stringify(storyboard, null, 2) }] };
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
    'Create a new shot inside a scene with visual description, camera movement, dialogue, prompt, duration, and linked assets/bible entities.',
    {
      project: z.string().min(1),
      sceneId: z.string().uuid(),
      title: z.string().min(1),
      visualDescription: z.string().default(''),
      cameraMovement: z.string().default(''),
      dialogue: z.string().default(''),
      prompt: z.string().default(''),
      durationSec: z.number().min(0.5).max(300).default(4),
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
    'Update a storyboard shot (attach keyframe/video asset UUID, refine prompt, update status or duration).',
    {
      shotId: z.string().uuid(),
      title: z.string().optional(),
      visualDescription: z.string().optional(),
      cameraMovement: z.string().optional(),
      dialogue: z.string().optional(),
      prompt: z.string().optional(),
      durationSec: z.number().min(0.5).max(300).optional(),
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
    'Register or update a music, stem, voiceover, dialogue, or SFX track with structured lyrics, LRC timing, auto-generated SRT, BPM, and beat/lip-sync markers.',
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

  return server;
}

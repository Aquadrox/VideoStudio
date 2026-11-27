import { z } from 'zod';

// --- Enums ---

export const ProjectTypeSchema = z.enum([
  'youtube_long',
  'youtube_short',
  'music_video',
  'animation',
  'commercial',
  'experimental',
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const ProjectStatusSchema = z.enum([
  'pre_production',
  'production',
  'editing',
  'youtube_ready',
  'published',
  'archived',
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const AssetTypeSchema = z.enum(['image', 'video', 'audio', 'document']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetStatusSchema = z.enum([
  'new',
  'in_review',
  'needs_revision',
  'approved',
  'winner',
  'archived',
]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const QualityTierSchema = z.enum([
  'test',
  'draft_lowres',
  'hq_upscale',
  'final_master',
]);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const ActorSchema = z.enum(['claude', 'user', 'system']);
export type Actor = z.infer<typeof ActorSchema>;

export const JobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

// --- ComfyUI Extracted Metadata ---

export const ComfyMetadataSchema = z.object({
  source: z.enum(['png_chunks', 'media_tags', 'manual']).default('png_chunks'),
  positivePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  modelName: z.string().optional(),
  loras: z.array(z.string()).default([]),
  seed: z.union([z.number(), z.string()]).optional(),
  steps: z.number().optional(),
  cfg: z.number().optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  rawPromptGraph: z.record(z.unknown()).optional(),
  rawWorkflow: z.record(z.unknown()).optional(),
});
export type ComfyMetadata = z.infer<typeof ComfyMetadataSchema>;

// --- Project Schemas ---

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .min(1)
    .max(64)
    .optional(),
  description: z.string().max(4000).default(''),
  type: ProjectTypeSchema.default('youtube_long'),
  aspectRatio: z.string().trim().min(1).max(16).default('16:9'),
  fps: z.number().int().min(1).max(120).default(24),
  targetResolution: z.string().trim().min(1).max(32).default('1920x1080'),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  type: ProjectTypeSchema.optional(),
  aspectRatio: z.string().trim().min(1).max(16).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  targetResolution: z.string().trim().min(1).max(32).optional(),
  status: ProjectStatusSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const ProjectDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  type: ProjectTypeSchema,
  aspectRatio: z.string(),
  fps: z.number().int(),
  targetResolution: z.string(),
  status: ProjectStatusSchema,
  assetCount: z.number().int().default(0),
  uri: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

// --- Asset Schemas ---

export const StorageModeSchema = z.enum(['copy', 'hardlink', 'reference']);
export type StorageMode = z.infer<typeof StorageModeSchema>;

export const UpdateAssetInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folderPath: z.string().max(300).optional(),
  status: AssetStatusSchema.optional(),
  qualityTier: QualityTierSchema.optional(),
  rating: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(8000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  promptUsed: z.string().max(16000).nullable().optional(),
  negativePrompt: z.string().max(16000).nullable().optional(),
  parentAssetId: z.string().uuid().nullable().optional(),
});
export type UpdateAssetInput = z.infer<typeof UpdateAssetInputSchema>;

export const IngestAssetJsonInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    folderPath: z.string().max(300).default(''),
    filename: z.string().trim().min(1).max(255).optional(),
    type: AssetTypeSchema.optional(),
    sourceUrl: z.string().url().optional(),
    base64Data: z.string().min(1).optional(),
    localFilePath: z.string().min(1).optional(),
    storageMode: StorageModeSchema.default('copy'),
    mimeType: z.string().optional(),
    qualityTier: QualityTierSchema.default('test'),
    status: AssetStatusSchema.default('new'),
    parentAssetId: z.string().uuid().optional(),
    parentRef: z.string().optional(),
    promptUsed: z.string().max(16000).optional(),
    negativePrompt: z.string().max(16000).optional(),
    modelName: z.string().max(255).optional(),
    seed: z.string().max(128).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    notes: z.string().max(8000).default(''),
    createdBy: ActorSchema.default('claude'),
  })
  .refine((data) => Boolean(data.sourceUrl || data.base64Data || data.localFilePath), {
    message: 'One of sourceUrl, base64Data, or localFilePath must be provided',
  });
export type IngestAssetJsonInput = z.infer<typeof IngestAssetJsonInputSchema>;

export const MediaFolderDtoSchema = z.object({
  path: z.string(),
  name: z.string(),
  parentPath: z.string(),
  assetCount: z.number().int(),
});
export type MediaFolderDto = z.infer<typeof MediaFolderDtoSchema>;

export const AssetDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  refCode: z.string(),
  handle: z.string(),
  uri: z.string(),
  folderPath: z.string(),
  title: z.string(),
  type: AssetTypeSchema,
  status: AssetStatusSchema,
  qualityTier: QualityTierSchema,
  rating: z.number().int().min(0).max(5),
  parentAssetId: z.string().uuid().nullable(),
  versionNumber: z.number().int(),
  originalFilename: z.string(),
  mimeType: z.string(),
  fileSize: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  fps: z.number().nullable(),
  promptUsed: z.string().nullable(),
  negativePrompt: z.string().nullable(),
  modelName: z.string().nullable(),
  seed: z.string().nullable(),
  comfyMetadata: ComfyMetadataSchema.nullable(),
  tags: z.array(z.string()),
  notes: z.string(),
  createdBy: ActorSchema,
  urls: z.object({
    original: z.string(),
    proxy: z.string().nullable(),
    thumbnail: z.string().nullable(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetDto = z.infer<typeof AssetDtoSchema>;

// --- Activity & Job Schemas ---

export const ActivityDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  projectSlug: z.string().nullable(),
  actor: ActorSchema,
  action: z.string(),
  summary: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  entityRef: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type ActivityDto = z.infer<typeof ActivityDtoSchema>;

export const JobDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  type: z.string(),
  title: z.string(),
  status: JobStatusSchema,
  progress: z.number().int().min(0).max(100),
  resultAssetId: z.string().uuid().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobDto = z.infer<typeof JobDtoSchema>;

// --- Realtime WebSocket Events ---

export const RealtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.created'), payload: ProjectDtoSchema }),
  z.object({ type: z.literal('project.updated'), payload: ProjectDtoSchema }),
  z.object({ type: z.literal('project.deleted'), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ type: z.literal('asset.created'), payload: AssetDtoSchema }),
  z.object({ type: z.literal('asset.updated'), payload: AssetDtoSchema }),
  z.object({
    type: z.literal('asset.deleted'),
    payload: z.object({ id: z.string().uuid(), projectId: z.string().uuid() }),
  }),
  z.object({ type: z.literal('activity.logged'), payload: ActivityDtoSchema }),
  z.object({ type: z.literal('job.updated'), payload: JobDtoSchema }),
  z.object({
    type: z.literal('annotation.changed'),
    payload: z.object({ assetId: z.string().uuid(), projectId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('rules.changed'),
    payload: z.object({ projectId: z.string().uuid().nullable() }),
  }),
  z.object({
    type: z.literal('library.changed'),
    payload: z.object({ kind: z.enum(['prompt', 'workflow', 'skill']) }),
  }),
  z.object({
    type: z.literal('stage3.changed'),
    payload: z.object({
      projectId: z.string().uuid(),
      domain: z.enum(['script', 'bible', 'storyboard', 'audio', 'youtube', 'git']),
    }),
  }),
  z.object({
    type: z.literal('folders.changed'),
    payload: z.object({ projectId: z.string().uuid() }),
  }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

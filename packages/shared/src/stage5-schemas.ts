import { z } from 'zod';
import { AssetStatusSchema, QualityTierSchema, StorageModeSchema } from './schemas.js';

// ============================================================================
// Stage 5 Schemas: Disk Cleanup, Automated Backups, Monitoring, Watch Folders,
// Outgoing Webhooks & Optional YouTube Data API v3 Draft Upload
// ============================================================================

// --- Disk Usage & Selective Cleanup ---

export const ProjectDiskUsageDtoSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  projectName: z.string(),
  assetCount: z.number().int(),
  originalsBytes: z.number(),
  proxiesBytes: z.number(),
  thumbnailsBytes: z.number(),
  totalBytes: z.number(),
  reclaimableRejectedTestBytes: z.number(),
});
export type ProjectDiskUsageDto = z.infer<typeof ProjectDiskUsageDtoSchema>;

export const DiskUsageSummaryDtoSchema = z.object({
  dataDir: z.string(),
  totalManagedBytes: z.number(),
  originalsBytes: z.number(),
  proxiesBytes: z.number(),
  thumbnailsBytes: z.number(),
  tempBytes: z.number(),
  backupsBytes: z.number(),
  filesystemTotalBytes: z.number().nullable(),
  filesystemFreeBytes: z.number().nullable(),
  projects: z.array(ProjectDiskUsageDtoSchema),
});
export type DiskUsageSummaryDto = z.infer<typeof DiskUsageSummaryDtoSchema>;

export const CleanupFilterInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  olderThanDays: z.number().int().min(0).max(3650).default(7),
  statuses: z.array(AssetStatusSchema).default(['needs_revision', 'archived']),
  qualityTiers: z.array(QualityTierSchema).default(['test', 'draft_lowres']),
  includeTempFiles: z.boolean().default(true),
});
export type CleanupFilterInput = z.infer<typeof CleanupFilterInputSchema>;

export const CleanupCandidateDtoSchema = z.object({
  assetId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  handle: z.string(),
  title: z.string(),
  status: AssetStatusSchema,
  qualityTier: QualityTierSchema,
  reclaimableBytes: z.number(),
  createdAt: z.string(),
});
export type CleanupCandidateDto = z.infer<typeof CleanupCandidateDtoSchema>;

export const CleanupResultDtoSchema = z.object({
  dryRun: z.boolean(),
  candidatesCount: z.number().int(),
  deletedAssetsCount: z.number().int(),
  freedAssetBytes: z.number(),
  freedTempBytes: z.number(),
  totalFreedBytes: z.number(),
  candidates: z.array(CleanupCandidateDtoSchema),
});
export type CleanupResultDto = z.infer<typeof CleanupResultDtoSchema>;

// --- Automated Backups ---

export const BackupEntryDtoSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  sizeBytes: z.number(),
  includesDb: z.boolean(),
  includesSkills: z.boolean(),
  includesMetadata: z.boolean(),
  status: z.enum(['completed', 'failed']),
  notes: z.string(),
  downloadUrl: z.string(),
  createdAt: z.string(),
});
export type BackupEntryDto = z.infer<typeof BackupEntryDtoSchema>;

export const CreateBackupInputSchema = z.object({
  notes: z.string().max(500).default(''),
});
export type CreateBackupInput = z.infer<typeof CreateBackupInputSchema>;

// --- Watch Folders (ComfyUI -> VideoStudio auto-ingest) ---

export const WatchFolderDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  relativeDir: z.string(),
  folderPath: z.string(),
  glob: z.string(),
  storageMode: StorageModeSchema,
  qualityTier: QualityTierSchema,
  tags: z.array(z.string()),
  enabled: z.boolean(),
  pollIntervalSec: z.number().int(),
  lastScanAt: z.string().nullable(),
  ingestedCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WatchFolderDto = z.infer<typeof WatchFolderDtoSchema>;

export const CreateWatchFolderInputSchema = z.object({
  projectId: z.string().min(1),
  relativeDir: z.string().trim().min(1).max(400),
  folderPath: z.string().max(200).default(''),
  glob: z.string().max(120).default('*'),
  storageMode: StorageModeSchema.default('reference'),
  qualityTier: QualityTierSchema.default('test'),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  enabled: z.boolean().default(true),
  pollIntervalSec: z.number().int().min(5).max(3600).default(15),
});
export type CreateWatchFolderInput = z.infer<typeof CreateWatchFolderInputSchema>;

export const UpdateWatchFolderInputSchema = z.object({
  folderPath: z.string().max(200).optional(),
  glob: z.string().max(120).optional(),
  storageMode: StorageModeSchema.optional(),
  qualityTier: QualityTierSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  enabled: z.boolean().optional(),
  pollIntervalSec: z.number().int().min(5).max(3600).optional(),
});
export type UpdateWatchFolderInput = z.infer<typeof UpdateWatchFolderInputSchema>;

// --- Outgoing Webhooks ---

export const WebhookEventTypeSchema = z.enum([
  'annotation.created',
  'asset.created',
  'asset.status_changed',
  'job.completed',
  'job.failed',
  'timeline.rendered',
  'backup.completed',
]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string(),
  url: z.string(),
  events: z.array(WebhookEventTypeSchema),
  hasSecret: z.boolean(),
  enabled: z.boolean(),
  lastStatusCode: z.number().int().nullable(),
  lastTriggeredAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebhookDto = z.infer<typeof WebhookDtoSchema>;

export const CreateWebhookInputSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(600),
  events: z.array(WebhookEventTypeSchema).min(1),
  secret: z.string().max(256).optional(),
  enabled: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

export const UpdateWebhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().url().max(600).optional(),
  events: z.array(WebhookEventTypeSchema).min(1).optional(),
  secret: z.string().max(256).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookInputSchema>;

// --- System Monitoring ---

export const SystemMetricsDtoSchema = z.object({
  version: z.string(),
  slot: z.string(),
  uptimeSec: z.number(),
  inFlightRequests: z.number().int(),
  websocketClients: z.number().int(),
  database: z.enum(['up', 'down']),
  ffmpeg: z.enum(['available', 'unavailable']),
  cpuLoad1m: z.number(),
  cpuCores: z.number().int(),
  memoryUsedBytes: z.number(),
  memoryTotalBytes: z.number(),
  processRssBytes: z.number(),
  diskFreeBytes: z.number().nullable(),
  diskTotalBytes: z.number().nullable(),
  activeWatchFolders: z.number().int(),
  activeWebhooks: z.number().int(),
  backupsCount: z.number().int(),
  youtubeApiConfigured: z.boolean(),
  timestamp: z.string(),
});
export type SystemMetricsDto = z.infer<typeof SystemMetricsDtoSchema>;

// --- Optional YouTube Data API v3 Draft Upload ---

export const YouTubeUploadStatusDtoSchema = z.object({
  configured: z.boolean(),
  missingEnvVars: z.array(z.string()),
});
export type YouTubeUploadStatusDto = z.infer<typeof YouTubeUploadStatusDtoSchema>;

export const UploadYouTubeDraftInputSchema = z.object({
  videoAssetId: z.string().uuid().optional(),
  videoAssetRef: z.string().trim().max(120).optional(),
  titleIndex: z.number().int().min(0).max(2).default(0),
  thumbnailIndex: z.number().int().min(0).max(2).nullable().default(0),
  privacyStatus: z.enum(['private', 'unlisted']).default('private'),
});
export type UploadYouTubeDraftInput = z.infer<typeof UploadYouTubeDraftInputSchema>;

export const YouTubeUploadResultDtoSchema = z.object({
  videoId: z.string(),
  studioUrl: z.string(),
  watchUrl: z.string(),
  title: z.string(),
  privacyStatus: z.enum(['private', 'unlisted']),
  thumbnailUploaded: z.boolean(),
  uploadedAt: z.string(),
});
export type YouTubeUploadResultDto = z.infer<typeof YouTubeUploadResultDtoSchema>;

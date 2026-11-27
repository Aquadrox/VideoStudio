import { z } from 'zod';

// ============================================================================
// Stage 4 Schemas: Multi-track Timeline, Animatic, FFmpeg Render & NLE Export
// ============================================================================

export const TimelineTrackTypeSchema = z.enum(['video', 'audio', 'overlay']);
export type TimelineTrackType = z.infer<typeof TimelineTrackTypeSchema>;

export const TimelineQualityModeSchema = z.enum(['draft_proxy', 'hq_master']);
export type TimelineQualityMode = z.infer<typeof TimelineQualityModeSchema>;

export const TimelineTransitionSchema = z.enum(['cut', 'crossfade', 'fade_black']);
export type TimelineTransition = z.infer<typeof TimelineTransitionSchema>;

export const TimelineRenderStatusSchema = z.enum(['queued', 'rendering', 'completed', 'failed']);
export type TimelineRenderStatus = z.infer<typeof TimelineRenderStatusSchema>;

export const NleExportFormatSchema = z.enum(['otio', 'fcpxml', 'edl']);
export type NleExportFormat = z.infer<typeof NleExportFormatSchema>;

export const TimelineClipDtoSchema = z.object({
  id: z.string().uuid(),
  trackId: z.string().uuid(),
  projectId: z.string().uuid(),
  assetId: z.string().uuid().nullable(),
  assetRef: z.string().nullable(),
  assetTitle: z.string().nullable(),
  assetType: z.enum(['image', 'video', 'audio', 'document']).nullable(),
  assetQualityTier: z.enum(['test', 'draft_lowres', 'hq_upscale', 'final_master']).nullable(),
  title: z.string(),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  inSec: z.number().min(0),
  outSec: z.number().positive().nullable(),
  transition: TimelineTransitionSchema,
  transitionDurationSec: z.number().min(0).max(5),
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  notes: z.string(),
  sortOrder: z.number().int(),
});
export type TimelineClipDto = z.infer<typeof TimelineClipDtoSchema>;

export const TimelineTrackDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  type: TimelineTrackTypeSchema,
  muted: z.boolean(),
  locked: z.boolean(),
  volume: z.number().min(0).max(2),
  sortOrder: z.number().int(),
  clips: z.array(TimelineClipDtoSchema),
});
export type TimelineTrackDto = z.infer<typeof TimelineTrackDtoSchema>;

export const TimelineRenderDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  qualityMode: TimelineQualityModeSchema,
  resolution: z.string(),
  fps: z.number().int(),
  status: TimelineRenderStatusSchema,
  progress: z.number().int().min(0).max(100),
  outputAssetId: z.string().uuid().nullable(),
  outputAssetHandle: z.string().nullable(),
  durationSec: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type TimelineRenderDto = z.infer<typeof TimelineRenderDtoSchema>;

export const TimelineDtoSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  fps: z.number().int(),
  resolution: z.string(),
  qualityMode: TimelineQualityModeSchema,
  totalDurationSec: z.number().min(0),
  tracks: z.array(TimelineTrackDtoSchema),
  renders: z.array(TimelineRenderDtoSchema),
});
export type TimelineDto = z.infer<typeof TimelineDtoSchema>;

export const UpsertTimelineClipInputSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().uuid().nullable().optional(),
  assetRef: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  startSec: z.number().min(0),
  durationSec: z.number().min(0.1).max(7200),
  inSec: z.number().min(0).default(0),
  outSec: z.number().positive().nullable().optional(),
  transition: TimelineTransitionSchema.default('cut'),
  transitionDurationSec: z.number().min(0).max(5).default(0),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  notes: z.string().max(1000).default(''),
});
export type UpsertTimelineClipInput = z.infer<typeof UpsertTimelineClipInputSchema>;

export const UpsertTimelineTrackInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  type: TimelineTrackTypeSchema,
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1),
  clips: z.array(UpsertTimelineClipInputSchema).max(500).default([]),
});
export type UpsertTimelineTrackInput = z.infer<typeof UpsertTimelineTrackInputSchema>;

export const UpsertTimelineInputSchema = z.object({
  qualityMode: TimelineQualityModeSchema.optional(),
  tracks: z.array(UpsertTimelineTrackInputSchema).max(20),
});
export type UpsertTimelineInput = z.infer<typeof UpsertTimelineInputSchema>;

export const StartTimelineRenderInputSchema = z.object({
  qualityMode: TimelineQualityModeSchema.optional(),
  resolution: z.string().trim().regex(/^\d{3,5}x\d{3,5}$/).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  title: z.string().trim().max(180).optional(),
});
export type StartTimelineRenderInput = z.infer<typeof StartTimelineRenderInputSchema>;

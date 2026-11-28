import { z } from 'zod';

// ============================================================================
// CapCut-Grade Video Editing & Custom AI/User Effects Schemas (v0.11.0)
// ============================================================================

export const VideoEffectCategorySchema = z.enum([
  'video_fx',
  'color_grade',
  'motion',
  'overlay',
  'audio_fx',
  'transition',
]);
export type VideoEffectCategory = z.infer<typeof VideoEffectCategorySchema>;

export const EffectParamTypeSchema = z.enum(['number', 'boolean', 'color', 'select']);
export type EffectParamType = z.infer<typeof EffectParamTypeSchema>;

export const EffectParamValueSchema = z.union([z.number(), z.boolean(), z.string()]);
export type EffectParamValue = z.infer<typeof EffectParamValueSchema>;

export const EffectParamSpecSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Param key must be alphanumeric/underscore'),
  label: z.string().trim().min(1).max(80),
  type: EffectParamTypeSchema.default('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  default: EffectParamValueSchema,
  options: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type EffectParamSpec = z.infer<typeof EffectParamSpecSchema>;

export const EffectCreatorSchema = z.enum(['system', 'claude', 'user']);
export type EffectCreator = z.infer<typeof EffectCreatorSchema>;

export const VideoEffectDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: VideoEffectCategorySchema,
  description: z.string(),
  icon: z.string(),
  ffmpegFilterTemplate: z.string(),
  cssPreviewFilter: z.string(),
  paramsSchema: z.array(EffectParamSpecSchema),
  defaultParams: z.record(z.string(), EffectParamValueSchema),
  createdBy: EffectCreatorSchema,
  isBuiltin: z.boolean(),
  tags: z.array(z.string()),
  usageCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VideoEffectDto = z.infer<typeof VideoEffectDtoSchema>;

export const CreateVideoEffectInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, digits and hyphens')
    .optional(),
  name: z.string().trim().min(2).max(120),
  category: VideoEffectCategorySchema.default('video_fx'),
  description: z.string().trim().max(600).default(''),
  icon: z.string().trim().max(16).default('✨'),
  ffmpegFilterTemplate: z.string().trim().min(1).max(1000),
  cssPreviewFilter: z.string().trim().max(400).default(''),
  paramsSchema: z.array(EffectParamSpecSchema).max(12).default([]),
  defaultParams: z.record(z.string(), EffectParamValueSchema).default({}),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type CreateVideoEffectInput = z.infer<typeof CreateVideoEffectInputSchema>;

export const UpdateVideoEffectInputSchema = CreateVideoEffectInputSchema.partial().omit({
  slug: true,
});
export type UpdateVideoEffectInput = z.infer<typeof UpdateVideoEffectInputSchema>;

// --- Clip-level CapCut Compositing Properties ---

export const ClipTransformSchema = z.object({
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  scale: z.number().min(0.1).max(5).default(1),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
});
export type ClipTransform = z.infer<typeof ClipTransformSchema>;

export const ClipColorAdjustSchema = z.object({
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(0).max(3).default(1),
  saturation: z.number().min(0).max(3).default(1),
  gamma: z.number().min(0.2).max(3).default(1),
  blur: z.number().min(0).max(20).default(0),
  vignette: z.number().min(0).max(1).default(0),
  sharpen: z.number().min(0).max(2).default(0),
});
export type ClipColorAdjust = z.infer<typeof ClipColorAdjustSchema>;

export const ClipAppliedEffectSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  effectSlug: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  intensity: z.number().min(0).max(2).default(1),
  params: z.record(z.string(), EffectParamValueSchema).default({}),
});
export type ClipAppliedEffect = z.infer<typeof ClipAppliedEffectSchema>;

export const KeyframePropertySchema = z.enum(['scale', 'x', 'y', 'rotation', 'opacity']);
export type KeyframeProperty = z.infer<typeof KeyframePropertySchema>;

export const KeyframeEasingSchema = z.enum(['linear', 'ease_in', 'ease_out', 'ease_in_out']);
export type KeyframeEasing = z.infer<typeof KeyframeEasingSchema>;

export const ClipKeyframeSchema = z.object({
  id: z.string().trim().min(1).max(64),
  timeOffsetSec: z.number().min(0).max(7200),
  property: KeyframePropertySchema,
  value: z.number(),
  easing: KeyframeEasingSchema.default('ease_in_out'),
});
export type ClipKeyframe = z.infer<typeof ClipKeyframeSchema>;

export const TextOverlayAnimationSchema = z.enum(['none', 'fade', 'pop', 'slide_up', 'typewriter']);
export type TextOverlayAnimation = z.infer<typeof TextOverlayAnimationSchema>;

export const ClipTextOverlaySchema = z.object({
  text: z.string().min(1).max(500),
  fontSize: z.number().min(12).max(180).default(48),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#FFFFFF'),
  bgColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#000000'),
  bgOpacity: z.number().min(0).max(1).default(0.45),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(82),
  bold: z.boolean().default(true),
  animation: TextOverlayAnimationSchema.default('fade'),
});
export type ClipTextOverlay = z.infer<typeof ClipTextOverlaySchema>;

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipH: false,
  flipV: false,
};

export const DEFAULT_CLIP_COLOR_ADJUST: ClipColorAdjust = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  blur: 0,
  vignette: 0,
  sharpen: 0,
};

export const DEFAULT_TEXT_OVERLAY: ClipTextOverlay = {
  text: 'Nouveau titre',
  fontSize: 48,
  color: '#FFFFFF',
  bgColor: '#000000',
  bgOpacity: 0.45,
  x: 50,
  y: 82,
  bold: true,
  animation: 'fade',
};

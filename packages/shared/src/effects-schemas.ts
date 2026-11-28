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
  subtitle: z.string().max(500).optional(),
  fontFamily: z.string().trim().max(120).optional(),
  fontSize: z.number().min(12).max(180).default(48),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#FFFFFF'),
  strokeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  glowColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  bgColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#000000'),
  bgOpacity: z.number().min(0).max(1).default(0.45),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(82),
  bold: z.boolean().default(true),
  fadeInSec: z.number().min(0).max(15).optional(),
  fadeOutSec: z.number().min(0).max(15).optional(),
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
  subtitle: '',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 48,
  color: '#FFFFFF',
  strokeColor: '#000000',
  glowColor: null,
  bgColor: '#000000',
  bgOpacity: 0.45,
  x: 50,
  y: 82,
  bold: true,
  fadeInSec: 0.25,
  fadeOutSec: 0.25,
  animation: 'fade',
};

// --- Native Camera Motion, Cinemascope Bars & AMV FX (WYSIWYG Web Canvas + Server Render) ---

export const ClipCameraModeSchema = z.enum([
  'static',
  'push',
  'ease',
  'pull_back',
  'power_pullback',
  'crash_zoom',
  'p05_vertigo',
  'pan',
]);
export type ClipCameraMode = z.infer<typeof ClipCameraModeSchema>;

export const ClipCameraSchema = z.object({
  mode: ClipCameraModeSchema.default('static'),
  z0: z.number().min(0.5).max(4).default(1),
  z1: z.number().min(0.5).max(4).default(1),
  cx0: z.number().min(0).max(1).default(0.5),
  cx1: z.number().min(0).max(1).default(0.5),
  cy0: z.number().min(0).max(1).default(0.5),
  cy1: z.number().min(0).max(1).default(0.5),
  rotDeg: z.number().min(-45).max(45).default(0),
  beatPulseAmp: z.number().min(0).max(0.35).default(0),
  shakeAmp: z.number().min(0).max(1).default(0),
  tremorAmp: z.number().min(0).max(1).default(0),
});
export type ClipCamera = z.infer<typeof ClipCameraSchema>;

export const ClipCinemascopeSchema = z.object({
  bar0: z.number().min(0).max(0.45).default(0),
  bar1: z.number().min(0).max(0.45).default(0),
});
export type ClipCinemascope = z.infer<typeof ClipCinemascopeSchema>;

export const AmvFxTagSchema = z.enum([
  'shake',
  'power_tremor',
  'manga_ink_blink',
  'radial_speed_lines',
  'horiz_speed_lines',
  'flash_white',
  'flash_gold',
  'particles_gold',
]);
export type AmvFxTag = z.infer<typeof AmvFxTagSchema>;

const FxHexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Color must be a hex color like #FFFFFF');

export const RadialSpeedLinesFxSchema = z.object({
  color: FxHexColorSchema.default('#FFFFFF'),
  intensity: z.number().min(0).max(2).default(0.75),
  count: z.number().int().min(4).max(200).default(48),
});
export type RadialSpeedLinesFx = z.infer<typeof RadialSpeedLinesFxSchema>;

export const HorizSpeedLinesDirectionSchema = z.enum(['left', 'right', 'diag_up', 'vert_down']);
export type HorizSpeedLinesDirection = z.infer<typeof HorizSpeedLinesDirectionSchema>;

export const HorizSpeedLinesFxSchema = z.object({
  color: FxHexColorSchema.default('#FFFFFF'),
  direction: HorizSpeedLinesDirectionSchema.default('left'),
  intensity: z.number().min(0).max(2).default(0.75),
});
export type HorizSpeedLinesFx = z.infer<typeof HorizSpeedLinesFxSchema>;

export const ParticlesFxSchema = z.object({
  color: FxHexColorSchema.default('#F5B942'),
  count: z.number().int().min(1).max(200).default(32),
  intensity: z.number().min(0).max(2).default(0.85),
});
export type ParticlesFx = z.infer<typeof ParticlesFxSchema>;

export const FlashInFxSchema = z.object({
  alpha: z.number().min(0).max(1).default(0.85),
  color: FxHexColorSchema.default('#FFFFFF'),
  frames: z.number().int().min(1).max(60).default(6),
});
export type FlashInFx = z.infer<typeof FlashInFxSchema>;

export const FadeOutBlackFxSchema = z.object({
  durationSec: z.number().min(0).max(15).default(0.6),
});
export type FadeOutBlackFx = z.infer<typeof FadeOutBlackFxSchema>;

export const ClipAmvFxObjectSchema = z.object({
  mangaBlink: z.boolean().optional(),
  radialSpeedLines: RadialSpeedLinesFxSchema.nullable().optional(),
  horizSpeedLines: HorizSpeedLinesFxSchema.nullable().optional(),
  particles: ParticlesFxSchema.nullable().optional(),
  flashIn: FlashInFxSchema.nullable().optional(),
  fadeOutBlack: FadeOutBlackFxSchema.nullable().optional(),
});
export type ClipAmvFxObject = z.infer<typeof ClipAmvFxObjectSchema>;

/**
 * Supports BOTH legacy compact AMV FX tag arrays (`["shake", "manga_ink_blink", "flash_gold"]`)
 * AND the full structured WYSIWYG AMV FX object (`{ mangaBlink, radialSpeedLines, horizSpeedLines, particles, flashIn, fadeOutBlack }`).
 */
export const ClipFxSchema = z.union([z.array(AmvFxTagSchema).max(16), ClipAmvFxObjectSchema]);
export type ClipFx = z.infer<typeof ClipFxSchema>;

export const DEFAULT_CLIP_CAMERA: ClipCamera = {
  mode: 'static',
  z0: 1,
  z1: 1,
  cx0: 0.5,
  cx1: 0.5,
  cy0: 0.5,
  cy1: 0.5,
  rotDeg: 0,
  beatPulseAmp: 0,
  shakeAmp: 0,
  tremorAmp: 0,
};

export const DEFAULT_CLIP_CINEMASCOPE: ClipCinemascope = {
  bar0: 0,
  bar1: 0,
};


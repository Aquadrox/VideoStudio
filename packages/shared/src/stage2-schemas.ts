import { z } from 'zod';
import { ActorSchema } from './schemas.js';

// ============================================================================
// 1. Visual Annotations & Feedback Inbox (Images & Video Frames)
// ============================================================================

export const AnnotationShapeTypeSchema = z.enum(['pin', 'rect']);
export type AnnotationShapeType = z.infer<typeof AnnotationShapeTypeSchema>;

export const AnnotationStatusSchema = z.enum(['open', 'resolved']);
export type AnnotationStatus = z.infer<typeof AnnotationStatusSchema>;

export const CreateAnnotationInputSchema = z.object({
  frameNumber: z.number().int().min(0).nullable().optional(),
  timecodeSec: z.number().min(0).nullable().optional(),
  shapeType: AnnotationShapeTypeSchema.default('pin'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1).nullable().optional(),
  h: z.number().min(0).max(1).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e5a038'),
  comment: z.string().trim().min(1).max(4000),
  author: ActorSchema.default('user'),
});
export type CreateAnnotationInput = z.infer<typeof CreateAnnotationInputSchema>;

export const UpdateAnnotationInputSchema = z.object({
  comment: z.string().trim().min(1).max(4000).optional(),
  status: AnnotationStatusSchema.optional(),
  resolvedBy: ActorSchema.optional(),
});
export type UpdateAnnotationInput = z.infer<typeof UpdateAnnotationInputSchema>;

export const AnnotationDtoSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  projectId: z.string().uuid(),
  assetRef: z.string(),
  assetTitle: z.string(),
  author: ActorSchema,
  frameNumber: z.number().int().nullable(),
  timecodeSec: z.number().nullable(),
  shapeType: AnnotationShapeTypeSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().nullable(),
  h: z.number().nullable(),
  color: z.string(),
  comment: z.string(),
  status: AnnotationStatusSchema,
  resolvedBy: ActorSchema.nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AnnotationDto = z.infer<typeof AnnotationDtoSchema>;

// ============================================================================
// 2. Rulebooks, Rules & Per-Project Overrides (e.g. 5 fingers vs 4 fingers)
// ============================================================================

export const RuleCategorySchema = z.enum([
  'anatomy',
  'style',
  'framing',
  'prompt_positive',
  'prompt_negative',
  'audio',
  'editing',
  'youtube',
]);
export type RuleCategory = z.infer<typeof RuleCategorySchema>;

export const RuleSeveritySchema = z.enum(['mandatory', 'recommended', 'forbidden']);
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>;

export const CreateRulebookInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64)
    .optional(),
  description: z.string().max(2000).default(''),
  isDefault: z.boolean().default(false),
});
export type CreateRulebookInput = z.infer<typeof CreateRulebookInputSchema>;

export const CreateRuleInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9-_]+$/, 'Rule code must be lowercase alphanumeric with hyphens/underscores')
    .min(1)
    .max(64),
  title: z.string().trim().min(1).max(160),
  category: RuleCategorySchema.default('style'),
  severity: RuleSeveritySchema.default('mandatory'),
  defaultValue: z.string().max(500).default(''),
  instruction: z.string().trim().min(1).max(4000),
  positiveFragment: z.string().max(2000).default(''),
  negativeFragment: z.string().max(2000).default(''),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type CreateRuleInput = z.infer<typeof CreateRuleInputSchema>;

export const UpdateRuleInputSchema = CreateRuleInputSchema.partial();
export type UpdateRuleInput = z.infer<typeof UpdateRuleInputSchema>;

export const UpsertProjectRuleOverrideInputSchema = z.object({
  enabledOverride: z.boolean().nullable().optional(),
  severityOverride: RuleSeveritySchema.nullable().optional(),
  valueOverride: z.string().max(500).nullable().optional(),
  instructionOverride: z.string().max(4000).nullable().optional(),
  positiveFragmentOverride: z.string().max(2000).nullable().optional(),
  negativeFragmentOverride: z.string().max(2000).nullable().optional(),
});
export type UpsertProjectRuleOverrideInput = z.infer<typeof UpsertProjectRuleOverrideInputSchema>;

export const RuleDtoSchema = z.object({
  id: z.string().uuid(),
  rulebookId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  code: z.string(),
  title: z.string(),
  category: RuleCategorySchema,
  severity: RuleSeveritySchema,
  defaultValue: z.string(),
  instruction: z.string(),
  positiveFragment: z.string(),
  negativeFragment: z.string(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RuleDto = z.infer<typeof RuleDtoSchema>;

export const RulebookDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  rules: z.array(RuleDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RulebookDto = z.infer<typeof RulebookDtoSchema>;

export const ProjectRuleOverrideDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  ruleId: z.string().uuid(),
  enabledOverride: z.boolean().nullable(),
  severityOverride: RuleSeveritySchema.nullable(),
  valueOverride: z.string().nullable(),
  instructionOverride: z.string().nullable(),
  positiveFragmentOverride: z.string().nullable(),
  negativeFragmentOverride: z.string().nullable(),
  updatedAt: z.string(),
});
export type ProjectRuleOverrideDto = z.infer<typeof ProjectRuleOverrideDtoSchema>;

export const ResolvedProjectRuleSchema = z.object({
  ruleId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  category: RuleCategorySchema,
  severity: RuleSeveritySchema,
  value: z.string(),
  instruction: z.string(),
  positiveFragment: z.string(),
  negativeFragment: z.string(),
  enabled: z.boolean(),
  source: z.enum(['rulebook', 'override', 'project_custom']),
  rulebookName: z.string().nullable(),
  isOverridden: z.boolean(),
});
export type ResolvedProjectRule = z.infer<typeof ResolvedProjectRuleSchema>;

export const ProjectRulesBundleSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  attachedRulebookIds: z.array(z.string().uuid()),
  resolvedRules: z.array(ResolvedProjectRuleSchema),
  activeRulesCount: z.number().int(),
  mergedPositiveFragments: z.string(),
  mergedNegativeFragments: z.string(),
});
export type ProjectRulesBundle = z.infer<typeof ProjectRulesBundleSchema>;

// ============================================================================
// 3. Prompt Templates & ComfyUI Workflows Library
// ============================================================================

export const PromptCategorySchema = z.enum([
  'image',
  'video',
  'music',
  'voice',
  'script',
  'thumbnail',
]);
export type PromptCategory = z.infer<typeof PromptCategorySchema>;

export const PromptVariableSchema = z.object({
  name: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120).optional(),
  defaultValue: z.string().max(1000).default(''),
});
export type PromptVariable = z.infer<typeof PromptVariableSchema>;

export const CreatePromptTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64)
    .optional(),
  category: PromptCategorySchema.default('image'),
  targetModel: z.string().max(120).default(''),
  positiveTemplate: z.string().trim().min(1).max(16000),
  negativeTemplate: z.string().max(16000).default(''),
  variables: z.array(PromptVariableSchema).default([]),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  notes: z.string().max(4000).default(''),
});
export type CreatePromptTemplateInput = z.infer<typeof CreatePromptTemplateInputSchema>;

export const UpdatePromptTemplateInputSchema = CreatePromptTemplateInputSchema.partial();
export type UpdatePromptTemplateInput = z.infer<typeof UpdatePromptTemplateInputSchema>;

export const PromptTemplateDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  handle: z.string(),
  name: z.string(),
  category: PromptCategorySchema,
  targetModel: z.string(),
  positiveTemplate: z.string(),
  negativeTemplate: z.string(),
  variables: z.array(PromptVariableSchema),
  tags: z.array(z.string()),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PromptTemplateDto = z.infer<typeof PromptTemplateDtoSchema>;

export const ComfyWorkflowCategorySchema = z.enum([
  'image_gen',
  'img2vid',
  'upscale',
  'inpaint',
  'audio',
  'other',
]);
export type ComfyWorkflowCategory = z.infer<typeof ComfyWorkflowCategorySchema>;

export const CreateComfyWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64)
    .optional(),
  description: z.string().max(2000).default(''),
  category: ComfyWorkflowCategorySchema.default('image_gen'),
  workflowJson: z.record(z.unknown()),
  inputNotes: z.string().max(4000).default(''),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
});
export type CreateComfyWorkflowInput = z.infer<typeof CreateComfyWorkflowInputSchema>;

export const UpdateComfyWorkflowInputSchema = CreateComfyWorkflowInputSchema.partial();
export type UpdateComfyWorkflowInput = z.infer<typeof UpdateComfyWorkflowInputSchema>;

export const ComfyWorkflowDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  category: ComfyWorkflowCategorySchema,
  version: z.number().int(),
  workflowJson: z.record(z.unknown()),
  inputNotes: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ComfyWorkflowDto = z.infer<typeof ComfyWorkflowDtoSchema>;

// ============================================================================
// 4. Claude Code Skills Hub (SKILL.md versioning & local sync)
// ============================================================================

export const SkillScopeSchema = z.enum(['global', 'project']);
export type SkillScope = z.infer<typeof SkillScopeSchema>;

export const UpsertSkillInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Skill slug must contain only lowercase letters, numbers, and hyphens')
    .min(1)
    .max(80)
    .optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  scope: SkillScopeSchema.default('global'),
  projectId: z.string().uuid().nullable().optional(),
  content: z.string().trim().min(1).max(100000),
  syncEnabled: z.boolean().default(true),
  changeSummary: z.string().max(500).default('Mise à jour du skill'),
  author: ActorSchema.default('user'),
});
export type UpsertSkillInput = z.infer<typeof UpsertSkillInputSchema>;

export const SkillVersionDtoSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  version: z.number().int(),
  content: z.string(),
  changeSummary: z.string(),
  author: ActorSchema,
  createdAt: z.string(),
});
export type SkillVersionDto = z.infer<typeof SkillVersionDtoSchema>;

export const SkillDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  scope: SkillScopeSchema,
  projectId: z.string().uuid().nullable(),
  projectSlug: z.string().nullable(),
  content: z.string(),
  version: z.number().int(),
  syncEnabled: z.boolean(),
  syncedPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillDto = z.infer<typeof SkillDtoSchema>;

import { z } from 'zod';
import { ActorSchema, ProjectTypeSchema } from './schemas.js';
import {
  ComfyWorkflowDtoSchema,
  PromptTemplateDtoSchema,
  RulebookDtoSchema,
  SkillDtoSchema,
} from './stage2-schemas.js';

// ============================================================================
// Shared Studio Knowledge & AI Cross-Project Memory (v0.10.0)
// ============================================================================

export const KnowledgeKindSchema = z.enum(['rule', 'prompt', 'skill', 'lesson', 'preset']);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const KnowledgeProjectTypeSchema = z.union([z.literal('all'), ProjectTypeSchema]);
export type KnowledgeProjectType = z.infer<typeof KnowledgeProjectTypeSchema>;

export const KnowledgePrioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
export type KnowledgePriority = z.infer<typeof KnowledgePrioritySchema>;

export const StudioKnowledgeEntryDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  kind: KnowledgeKindSchema,
  projectTypes: z.array(KnowledgeProjectTypeSchema).min(1),
  priority: KnowledgePrioritySchema,
  content: z.string(),
  positiveFragment: z.string(),
  negativeFragment: z.string(),
  recommendedModel: z.string(),
  linkedSkillSlug: z.string().nullable(),
  tags: z.array(z.string()),
  learnedBy: ActorSchema,
  verified: z.boolean(),
  pinned: z.boolean(),
  sourceProjectSlug: z.string().nullable(),
  usageCount: z.number().int().min(0),
  lastRecalledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudioKnowledgeEntryDto = z.infer<typeof StudioKnowledgeEntryDtoSchema>;

export const UpsertStudioKnowledgeInputSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-_]+$/, 'Slug must contain lowercase letters, numbers, hyphens, or underscores')
    .min(1)
    .max(96)
    .optional(),
  title: z.string().trim().min(1).max(180),
  kind: KnowledgeKindSchema.default('lesson'),
  projectTypes: z.array(KnowledgeProjectTypeSchema).min(1).max(10).default(['all']),
  priority: KnowledgePrioritySchema.default('normal'),
  content: z.string().trim().min(1).max(12000),
  positiveFragment: z.string().max(4000).default(''),
  negativeFragment: z.string().max(4000).default(''),
  recommendedModel: z.string().max(180).default(''),
  linkedSkillSlug: z.string().trim().max(96).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  verified: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sourceProjectSlug: z.string().trim().max(96).nullable().optional(),
});
export type UpsertStudioKnowledgeInput = z.infer<typeof UpsertStudioKnowledgeInputSchema>;

export const UpdateStudioKnowledgeInputSchema = UpsertStudioKnowledgeInputSchema.partial();
export type UpdateStudioKnowledgeInput = z.infer<typeof UpdateStudioKnowledgeInputSchema>;

export const ProjectPlaybookDtoSchema = z.object({
  projectType: KnowledgeProjectTypeSchema,
  projectSlug: z.string().nullable(),
  recalledAt: z.string(),
  totalEntries: z.number().int().min(0),
  entries: z.array(StudioKnowledgeEntryDtoSchema),
  byKind: z.object({
    rule: z.array(StudioKnowledgeEntryDtoSchema),
    prompt: z.array(StudioKnowledgeEntryDtoSchema),
    skill: z.array(StudioKnowledgeEntryDtoSchema),
    lesson: z.array(StudioKnowledgeEntryDtoSchema),
    preset: z.array(StudioKnowledgeEntryDtoSchema),
  }),
  rulebooks: z.array(RulebookDtoSchema),
  promptTemplates: z.array(PromptTemplateDtoSchema),
  comfyWorkflows: z.array(ComfyWorkflowDtoSchema),
  skills: z.array(SkillDtoSchema),
  compiledBrief: z.string(),
});
export type ProjectPlaybookDto = z.infer<typeof ProjectPlaybookDtoSchema>;

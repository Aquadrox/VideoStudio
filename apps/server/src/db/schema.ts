import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { ComfyMetadata, PromptVariable } from '@videostudio/shared';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    type: text('type').notNull().default('youtube_long'),
    aspectRatio: text('aspect_ratio').notNull().default('16:9'),
    fps: integer('fps').notNull().default(24),
    targetResolution: text('target_resolution').notNull().default('1920x1080'),
    status: text('status').notNull().default('pre_production'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('projects_slug_uidx').on(table.slug)],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    refCode: text('ref_code').notNull(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('new'),
    qualityTier: text('quality_tier').notNull().default('test'),
    rating: integer('rating').notNull().default(0),
    parentAssetId: uuid('parent_asset_id').references((): AnyPgColumn => assets.id, {
      onDelete: 'set null',
    }),
    versionNumber: integer('version_number').notNull().default(1),
    originalFilename: text('original_filename').notNull(),
    filePath: text('file_path').notNull(),
    proxyPath: text('proxy_path'),
    thumbnailPath: text('thumbnail_path'),
    mimeType: text('mime_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    durationSec: doublePrecision('duration_sec'),
    fps: doublePrecision('fps'),
    promptUsed: text('prompt_used'),
    negativePrompt: text('negative_prompt'),
    modelName: text('model_name'),
    seed: text('seed'),
    comfyMetadata: jsonb('comfy_metadata').$type<ComfyMetadata | null>(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    notes: text('notes').notNull().default(''),
    createdBy: text('created_by').notNull().default('claude'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assets_project_ref_uidx').on(table.projectId, table.refCode),
    index('assets_project_created_idx').on(table.projectId, table.createdAt),
    index('assets_parent_idx').on(table.parentAssetId),
  ],
);

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull().default('claude'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    entityRef: text('entity_ref'),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('activities_created_idx').on(table.createdAt)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('pending'),
    progress: integer('progress').notNull().default(0),
    resultAssetId: uuid('result_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('jobs_project_status_idx').on(table.projectId, table.status)],
);

// --- Stage 2 Tables ---

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    author: text('author').notNull().default('user'),
    frameNumber: integer('frame_number'),
    timecodeSec: doublePrecision('timecode_sec'),
    shapeType: text('shape_type').notNull().default('pin'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w'),
    h: doublePrecision('h'),
    color: text('color').notNull().default('#e5a038'),
    comment: text('comment').notNull(),
    status: text('status').notNull().default('open'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('annotations_asset_idx').on(table.assetId, table.createdAt),
    index('annotations_project_status_idx').on(table.projectId, table.status),
  ],
);

export const rulebooks = pgTable(
  'rulebooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('rulebooks_slug_uidx').on(table.slug)],
);

export const rules = pgTable(
  'rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rulebookId: uuid('rulebook_id').references(() => rulebooks.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull().default('style'),
    severity: text('severity').notNull().default('mandatory'),
    defaultValue: text('default_value').notNull().default(''),
    instruction: text('instruction').notNull(),
    positiveFragment: text('positive_fragment').notNull().default(''),
    negativeFragment: text('negative_fragment').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('rules_rulebook_idx').on(table.rulebookId),
    index('rules_project_idx').on(table.projectId),
  ],
);

export const projectRulebookLinks = pgTable(
  'project_rulebook_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    rulebookId: uuid('rulebook_id')
      .notNull()
      .references(() => rulebooks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_rulebook_link_uidx').on(table.projectId, table.rulebookId)],
);

export const projectRuleOverrides = pgTable(
  'project_rule_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    enabledOverride: boolean('enabled_override'),
    severityOverride: text('severity_override'),
    valueOverride: text('value_override'),
    instructionOverride: text('instruction_override'),
    positiveFragmentOverride: text('positive_fragment_override'),
    negativeFragmentOverride: text('negative_fragment_override'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_rule_override_uidx').on(table.projectId, table.ruleId)],
);

export const promptTemplates = pgTable(
  'prompt_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('image'),
    targetModel: text('target_model').notNull().default(''),
    positiveTemplate: text('positive_template').notNull(),
    negativeTemplate: text('negative_template').notNull().default(''),
    variables: jsonb('variables').$type<PromptVariable[]>().notNull().default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('prompt_templates_slug_uidx').on(table.slug)],
);

export const comfyWorkflows = pgTable(
  'comfy_workflows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('image_gen'),
    version: integer('version').notNull().default(1),
    workflowJson: jsonb('workflow_json').$type<Record<string, unknown>>().notNull(),
    inputNotes: text('input_notes').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('comfy_workflows_slug_uidx').on(table.slug)],
);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    scope: text('scope').notNull().default('global'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    syncedPath: text('synced_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('skills_slug_uidx').on(table.slug)],
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    changeSummary: text('change_summary').notNull().default(''),
    author: text('author').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('skill_versions_skill_idx').on(table.skillId, table.version)],
);

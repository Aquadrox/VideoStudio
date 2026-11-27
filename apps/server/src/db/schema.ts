import {
  bigint,
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
import type { ComfyMetadata } from '@videostudio/shared';

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

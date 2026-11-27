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
import type {
  AudioMarker,
  ChecklistItem,
  ComfyMetadata,
  PromptVariable,
  YouTubeChapter,
} from '@videostudio/shared';

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
    folderPath: text('folder_path').notNull().default(''),
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
    autoInject: boolean('auto_inject').notNull().default(true),
    appliesToTags: jsonb('applies_to_tags').$type<string[]>().notNull().default([]),
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
    autoInjectOverride: boolean('auto_inject_override'),
    appliesToTagsOverride: jsonb('applies_to_tags_override').$type<string[] | null>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_rule_override_uidx').on(table.projectId, table.ruleId)],
);

export const mediaFolders = pgTable(
  'media_folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('media_folders_project_path_uidx').on(table.projectId, table.path)],
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

// --- Stage 3 Tables (Pre-production, Audio/Lyrics, YouTube Hub, Project Git Repos) ---

export const projectScripts = pgTable(
  'project_scripts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Scénario principal'),
    content: text('content').notNull().default(''),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_scripts_project_uidx').on(table.projectId)],
);

export const scriptVersions = pgTable(
  'script_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scriptId: uuid('script_id')
      .notNull()
      .references(() => projectScripts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    changeSummary: text('change_summary').notNull().default(''),
    author: text('author').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('script_versions_script_idx').on(table.scriptId, table.version)],
);

export const bibleEntities = pgTable(
  'bible_entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull().default('character'),
    refCode: text('ref_code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visualPrompt: text('visual_prompt').notNull().default(''),
    loraName: text('lora_name').notNull().default(''),
    referenceAssetIds: jsonb('reference_asset_ids').$type<string[]>().notNull().default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('bible_entities_project_ref_uidx').on(table.projectId, table.refCode)],
);

export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneNumber: integer('scene_number').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    locationRef: text('location_ref').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('scenes_project_sort_idx').on(table.projectId, table.sortOrder)],
);

export const shots = pgTable(
  'shots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    shotCode: text('shot_code').notNull(),
    title: text('title').notNull(),
    visualDescription: text('visual_description').notNull().default(''),
    cameraMovement: text('camera_movement').notNull().default(''),
    dialogue: text('dialogue').notNull().default(''),
    prompt: text('prompt').notNull().default(''),
    durationSec: doublePrecision('duration_sec').notNull().default(4),
    status: text('status').notNull().default('planned'),
    keyframeAssetId: uuid('keyframe_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    videoAssetId: uuid('video_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    bibleEntityRefs: jsonb('bible_entity_refs').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('shots_project_code_uidx').on(table.projectId, table.shotCode),
    index('shots_scene_sort_idx').on(table.sceneId, table.sortOrder),
  ],
);

export const audioTracks = pgTable(
  'audio_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    refCode: text('ref_code').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull().default('music'),
    bpm: doublePrecision('bpm'),
    musicalKey: text('musical_key').notNull().default(''),
    promptUsed: text('prompt_used').notNull().default(''),
    lyrics: text('lyrics').notNull().default(''),
    lrcContent: text('lrc_content').notNull().default(''),
    srtContent: text('srt_content').notNull().default(''),
    markers: jsonb('markers').$type<AudioMarker[]>().notNull().default([]),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('audio_tracks_project_ref_uidx').on(table.projectId, table.refCode)],
);

export const youtubePackages = pgTable(
  'youtube_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    titles: jsonb('titles').$type<string[]>().notNull().default([]),
    description: text('description').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
    category: text('category').notNull().default('Entertainment'),
    language: text('language').notNull().default('fr'),
    playlist: text('playlist').notNull().default(''),
    pinnedComment: text('pinned_comment').notNull().default(''),
    aiDisclosure: boolean('ai_disclosure').notNull().default(true),
    thumbnailAssetIds: jsonb('thumbnail_asset_ids').$type<string[]>().notNull().default([]),
    chapters: jsonb('chapters').$type<YouTubeChapter[]>().notNull().default([]),
    srtSubtitles: text('srt_subtitles').notNull().default(''),
    checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('youtube_packages_project_uidx').on(table.projectId)],
);

export const projectRepos = pgTable(
  'project_repos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    localPath: text('local_path').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    githubRemoteUrl: text('github_remote_url'),
    autoCommit: boolean('auto_commit').notNull().default(false),
    lastCommitSha: text('last_commit_sha'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_repos_project_uidx').on(table.projectId)],
);

import { z } from 'zod';
import { ActorSchema } from './schemas.js';

// ============================================================================
// 1. Versioned Script, Continuity Bible & Storyboard (Scenes -> Shots)
// ============================================================================

export const UpdateScriptInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200000),
  changeSummary: z.string().max(500).default('Mise à jour du scénario'),
  author: ActorSchema.default('user'),
});
export type UpdateScriptInput = z.infer<typeof UpdateScriptInputSchema>;

export const ScriptVersionDtoSchema = z.object({
  id: z.string().uuid(),
  scriptId: z.string().uuid(),
  version: z.number().int(),
  content: z.string(),
  changeSummary: z.string(),
  author: ActorSchema,
  createdAt: z.string(),
});
export type ScriptVersionDto = z.infer<typeof ScriptVersionDtoSchema>;

export const ProjectScriptDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
  versions: z.array(ScriptVersionDtoSchema),
});
export type ProjectScriptDto = z.infer<typeof ProjectScriptDtoSchema>;

export const BibleEntityTypeSchema = z.enum(['character', 'location', 'prop', 'style']);
export type BibleEntityType = z.infer<typeof BibleEntityTypeSchema>;

export const UpsertBibleEntityInputSchema = z.object({
  refCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64)
    .optional(),
  entityType: BibleEntityTypeSchema.default('character'),
  name: z.string().trim().min(1).max(140),
  description: z.string().max(8000).default(''),
  visualPrompt: z.string().max(4000).default(''),
  loraName: z.string().max(200).default(''),
  referenceAssetIds: z.array(z.string().uuid()).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
});
export type UpsertBibleEntityInput = z.infer<typeof UpsertBibleEntityInputSchema>;

export const BibleEntityDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  entityType: BibleEntityTypeSchema,
  refCode: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  visualPrompt: z.string(),
  loraName: z.string(),
  referenceAssetIds: z.array(z.string().uuid()),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BibleEntityDto = z.infer<typeof BibleEntityDtoSchema>;

export const ShotStatusSchema = z.enum([
  'planned',
  'generating',
  'draft_ready',
  'hq_ready',
  'approved',
]);
export type ShotStatus = z.infer<typeof ShotStatusSchema>;

export const CreateSceneInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().max(4000).default(''),
  locationRef: z.string().max(120).default(''),
  sortOrder: z.number().int().optional(),
});
export type CreateSceneInput = z.infer<typeof CreateSceneInputSchema>;

export const CreateShotInputSchema = z.object({
  sceneId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  visualDescription: z.string().max(4000).default(''),
  cameraMovement: z.string().max(200).default(''),
  dialogue: z.string().max(4000).default(''),
  prompt: z.string().max(8000).default(''),
  durationSec: z.number().min(0.5).max(300).default(4),
  status: ShotStatusSchema.default('planned'),
  keyframeAssetId: z.string().uuid().nullable().optional(),
  videoAssetId: z.string().uuid().nullable().optional(),
  bibleEntityRefs: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  sortOrder: z.number().int().optional(),
});
export type CreateShotInput = z.infer<typeof CreateShotInputSchema>;

export const UpdateShotInputSchema = CreateShotInputSchema.omit({ sceneId: true }).partial().extend({
  sceneId: z.string().uuid().optional(),
});
export type UpdateShotInput = z.infer<typeof UpdateShotInputSchema>;

export const ShotDtoSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  projectId: z.string().uuid(),
  shotCode: z.string(),
  handle: z.string(),
  title: z.string(),
  visualDescription: z.string(),
  cameraMovement: z.string(),
  dialogue: z.string(),
  prompt: z.string(),
  durationSec: z.number(),
  status: ShotStatusSchema,
  keyframeAssetId: z.string().uuid().nullable(),
  videoAssetId: z.string().uuid().nullable(),
  bibleEntityRefs: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShotDto = z.infer<typeof ShotDtoSchema>;

export const SceneDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sceneNumber: z.number().int(),
  title: z.string(),
  summary: z.string(),
  locationRef: z.string(),
  sortOrder: z.number().int(),
  shots: z.array(ShotDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SceneDto = z.infer<typeof SceneDtoSchema>;

// ============================================================================
// 2. Audio, Music, Lyrics & Lip-Sync Studio
// ============================================================================

export const AudioCategorySchema = z.enum(['music', 'stem', 'voiceover', 'dialogue', 'sfx']);
export type AudioCategory = z.infer<typeof AudioCategorySchema>;

export const AudioMarkerTypeSchema = z.enum(['beat', 'section', 'lipsync', 'cut']);
export type AudioMarkerType = z.infer<typeof AudioMarkerTypeSchema>;

export const AudioMarkerSchema = z.object({
  id: z.string().min(1),
  timeSec: z.number().min(0),
  label: z.string().trim().min(1).max(120),
  type: AudioMarkerTypeSchema.default('section'),
});
export type AudioMarker = z.infer<typeof AudioMarkerSchema>;

export const UpsertAudioTrackInputSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  category: AudioCategorySchema.default('music'),
  bpm: z.number().min(20).max(300).nullable().optional(),
  musicalKey: z.string().max(32).default(''),
  promptUsed: z.string().max(8000).default(''),
  lyrics: z.string().max(40000).default(''),
  lrcContent: z.string().max(80000).default(''),
  srtContent: z.string().max(80000).default(''),
  markers: z.array(AudioMarkerSchema).max(500).default([]),
  notes: z.string().max(4000).default(''),
});
export type UpsertAudioTrackInput = z.infer<typeof UpsertAudioTrackInputSchema>;

export const AudioTrackDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  assetId: z.string().uuid().nullable(),
  refCode: z.string(),
  handle: z.string(),
  title: z.string(),
  category: AudioCategorySchema,
  bpm: z.number().nullable(),
  musicalKey: z.string(),
  promptUsed: z.string(),
  lyrics: z.string(),
  lrcContent: z.string(),
  srtContent: z.string(),
  markers: z.array(AudioMarkerSchema),
  notes: z.string(),
  audioUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AudioTrackDto = z.infer<typeof AudioTrackDtoSchema>;

// ============================================================================
// 3. YouTube Packaging Hub (A/B Thumbnails, Titles, Chapters, Export Pack)
// ============================================================================

export const YouTubeChapterSchema = z.object({
  timeSec: z.number().min(0),
  title: z.string().trim().min(1).max(100),
});
export type YouTubeChapter = z.infer<typeof YouTubeChapterSchema>;

export const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const UpdateYouTubePackageInputSchema = z.object({
  titles: z.array(z.string().max(120)).max(3).optional(),
  description: z.string().max(10000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  hashtags: z.array(z.string().trim().min(1).max(64)).max(15).optional(),
  category: z.string().max(80).optional(),
  language: z.string().max(16).optional(),
  playlist: z.string().max(120).optional(),
  pinnedComment: z.string().max(4000).optional(),
  aiDisclosure: z.boolean().optional(),
  thumbnailAssetIds: z.array(z.string().uuid()).max(3).optional(),
  chapters: z.array(YouTubeChapterSchema).max(100).optional(),
  srtSubtitles: z.string().max(200000).optional(),
  checklist: z.array(ChecklistItemSchema).max(30).optional(),
});
export type UpdateYouTubePackageInput = z.infer<typeof UpdateYouTubePackageInputSchema>;

export const YouTubePackageDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  titles: z.array(z.string()),
  description: z.string(),
  tags: z.array(z.string()),
  hashtags: z.array(z.string()),
  category: z.string(),
  language: z.string(),
  playlist: z.string(),
  pinnedComment: z.string(),
  aiDisclosure: z.boolean(),
  thumbnailAssetIds: z.array(z.string().uuid()),
  chapters: z.array(YouTubeChapterSchema),
  srtSubtitles: z.string(),
  checklist: z.array(ChecklistItemSchema),
  updatedAt: z.string(),
});
export type YouTubePackageDto = z.infer<typeof YouTubePackageDtoSchema>;

// ============================================================================
// 4. Per-Project Local Git Repository & GitHub Integration (Issue #4)
// ============================================================================

export const ConfigureProjectRepoInputSchema = z.object({
  githubRemoteUrl: z.string().trim().max(300).nullable().optional(),
  defaultBranch: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._/-]+$/)
    .min(1)
    .max(64)
    .optional(),
  autoCommit: z.boolean().optional(),
});
export type ConfigureProjectRepoInput = z.infer<typeof ConfigureProjectRepoInputSchema>;

export const CommitProjectRepoInputSchema = z.object({
  message: z.string().trim().min(1).max(200),
  exportSnapshot: z.boolean().default(true),
});
export type CommitProjectRepoInput = z.infer<typeof CommitProjectRepoInputSchema>;

export const ProjectGitCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  date: z.string(),
  message: z.string(),
});
export type ProjectGitCommit = z.infer<typeof ProjectGitCommitSchema>;

export const ProjectRepoStatusDtoSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  initialized: z.boolean(),
  localPath: z.string(),
  defaultBranch: z.string(),
  githubRemoteUrl: z.string().nullable(),
  autoCommit: z.boolean(),
  lastCommitSha: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  dirtyFiles: z.array(z.string()),
  recentCommits: z.array(ProjectGitCommitSchema),
});
export type ProjectRepoStatusDto = z.infer<typeof ProjectRepoStatusDtoSchema>;

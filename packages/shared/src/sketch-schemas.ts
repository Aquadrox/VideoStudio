import { z } from 'zod';

export const SketchModeSchema = z.enum(['scene_plan', 'storyboard_sketch']);
export type SketchMode = z.infer<typeof SketchModeSchema>;

export const SketchGuideTypeSchema = z.enum([
  'thirds',
  'golden',
  'crosshair',
  'safe_frames',
  'grid',
]);
export type SketchGuideType = z.infer<typeof SketchGuideTypeSchema>;

export const SketchCameraMovementSchema = z.enum([
  'static',
  'dolly_in',
  'dolly_out',
  'truck_left',
  'truck_right',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'orbit',
  'crane',
  'handheld',
  'zoom_in',
  'zoom_out',
]);
export type SketchCameraMovement = z.infer<typeof SketchCameraMovementSchema>;

export const SketchShotSizeSchema = z.enum(['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'INSERT']);
export type SketchShotSize = z.infer<typeof SketchShotSizeSchema>;

export const SketchLightKindSchema = z.enum(['key', 'fill', 'rim', 'practical']);
export type SketchLightKind = z.infer<typeof SketchLightKindSchema>;

export const SketchPropKindSchema = z.enum([
  'wall',
  'table',
  'door',
  'window',
  'mark',
  'zone',
  'vehicle',
]);
export type SketchPropKind = z.infer<typeof SketchPropKindSchema>;

export const SketchMotionTargetSchema = z.enum(['camera', 'character', 'object']);
export type SketchMotionTarget = z.infer<typeof SketchMotionTargetSchema>;

export const SketchShapeKindSchema = z.enum([
  'line',
  'arrow',
  'rect',
  'ellipse',
  'zoom_in',
  'zoom_out',
]);
export type SketchShapeKind = z.infer<typeof SketchShapeKindSchema>;

export const SketchPointSchema = z.object({
  x: z.number().min(-0.2).max(1.2),
  y: z.number().min(-0.2).max(1.2),
});
export type SketchPoint = z.infer<typeof SketchPointSchema>;

export const SketchCameraNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64).default('Cam A'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  angleDeg: z.number().min(-360).max(360).default(-90),
  focalMm: z.number().min(12).max(200).default(35),
  shotSize: SketchShotSizeSchema.default('MS'),
  movement: SketchCameraMovementSchema.default('static'),
  color: z.string().min(3).max(32).default('#e5a038'),
  notes: z.string().max(300).default(''),
});
export type SketchCameraNode = z.infer<typeof SketchCameraNodeSchema>;

export const SketchCharacterNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  bibleEntityId: z.string().max(64).nullable().optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  angleDeg: z.number().min(-360).max(360).default(90),
  color: z.string().min(3).max(32).default('#4ea8de'),
  action: z.string().max(240).default(''),
  pose: z.string().max(120).default(''),
});
export type SketchCharacterNode = z.infer<typeof SketchCharacterNodeSchema>;

export const SketchLightNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64).default('Key'),
  kind: SketchLightKindSchema.default('key'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  angleDeg: z.number().min(-360).max(360).default(45),
  color: z.string().min(3).max(32).default('#fbbf24'),
  intensity: z.number().min(0).max(100).default(80),
});
export type SketchLightNode = z.infer<typeof SketchLightNodeSchema>;

export const SketchPropNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64).default('Décor'),
  kind: SketchPropKindSchema.default('table'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.02).max(0.95).default(0.14),
  h: z.number().min(0.015).max(0.95).default(0.08),
  angleDeg: z.number().min(-360).max(360).default(0),
  color: z.string().min(3).max(32).default('#94a3b8'),
});
export type SketchPropNode = z.infer<typeof SketchPropNodeSchema>;

export const SketchMotionArrowSchema = z.object({
  id: z.string().min(1).max(64),
  target: SketchMotionTargetSchema.default('camera'),
  label: z.string().max(160).default(''),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  cx: z.number().min(0).max(1).optional(),
  cy: z.number().min(0).max(1).optional(),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
  color: z.string().min(3).max(32).default('#f97316'),
  dashed: z.boolean().default(false),
  width: z.number().min(1).max(16).default(4),
});
export type SketchMotionArrow = z.infer<typeof SketchMotionArrowSchema>;

export const SketchStrokeSchema = z.object({
  id: z.string().min(1).max(64),
  tool: z.enum(['pen', 'marker']).default('pen'),
  color: z.string().min(3).max(32).default('#f8fafc'),
  width: z.number().min(1).max(40).default(3),
  opacity: z.number().min(0.05).max(1).default(1),
  points: z.array(SketchPointSchema).min(1).max(4000),
});
export type SketchStroke = z.infer<typeof SketchStrokeSchema>;

export const SketchShapeSchema = z.object({
  id: z.string().min(1).max(64),
  kind: SketchShapeKindSchema,
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
  color: z.string().min(3).max(32).default('#f8fafc'),
  width: z.number().min(1).max(20).default(3),
  fill: z.boolean().default(false),
  dashed: z.boolean().default(false),
});
export type SketchShape = z.infer<typeof SketchShapeSchema>;

export const SketchTextNoteSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(240),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  color: z.string().min(3).max(32).default('#fef08a'),
  fontSize: z.number().min(10).max(64).default(18),
  badge: z.boolean().default(true),
});
export type SketchTextNote = z.infer<typeof SketchTextNoteSchema>;

export const SketchUnderlaySchema = z.object({
  assetId: z.string().min(1).max(64),
  assetRef: z.string().max(64).optional(),
  opacity: z.number().min(0.05).max(1).default(0.45),
});
export type SketchUnderlay = z.infer<typeof SketchUnderlaySchema>;

export const SketchSceneDataSchema = z.object({
  version: z.literal(1).default(1),
  backgroundColor: z.string().min(3).max(32).default('#14171f'),
  guides: z.array(SketchGuideTypeSchema).default(['grid']),
  show180Line: z.boolean().default(false),
  line180CharAId: z.string().max(64).nullable().optional(),
  line180CharBId: z.string().max(64).nullable().optional(),
  underlay: SketchUnderlaySchema.nullable().optional(),
  cameras: z.array(SketchCameraNodeSchema).max(16).default([]),
  characters: z.array(SketchCharacterNodeSchema).max(32).default([]),
  lights: z.array(SketchLightNodeSchema).max(24).default([]),
  props: z.array(SketchPropNodeSchema).max(64).default([]),
  arrows: z.array(SketchMotionArrowSchema).max(64).default([]),
  strokes: z.array(SketchStrokeSchema).max(500).default([]),
  shapes: z.array(SketchShapeSchema).max(200).default([]),
  notes: z.array(SketchTextNoteSchema).max(64).default([]),
});
export type SketchSceneData = z.infer<typeof SketchSceneDataSchema>;

export const SaveSketchSchema = z.object({
  title: z.string().min(1).max(140),
  mode: SketchModeSchema.default('scene_plan'),
  aspectRatio: z.string().min(3).max(20).default('16:9'),
  folderPath: z.string().max(240).optional(),
  shotId: z.string().uuid().nullable().optional(),
  inSketchBoard: z.boolean().optional(),
  boardOrder: z.number().int().min(0).max(10000).optional(),
  durationSec: z.number().min(0.5).max(300).optional(),
  caption: z.string().max(1000).optional(),
  sceneData: SketchSceneDataSchema,
  aiDirectorBrief: z.string().max(8000).optional(),
  /** Optional rendered PNG (data URL or raw base64) to store/update in Media */
  pngBase64: z.string().max(25_000_000).optional(),
  /** When updating an existing sketch with a linked asset: create a new revision (v2) or replace the PNG? */
  saveMode: z.enum(['new_version', 'replace']).default('new_version'),
  tags: z.array(z.string().max(48)).max(24).optional(),
});
export type SaveSketchInput = z.infer<typeof SaveSketchSchema>;

export const ReorderSketchBoardItemSchema = z.object({
  sketchId: z.string().uuid(),
  inSketchBoard: z.boolean().optional(),
  boardOrder: z.number().int().min(0).max(10000).optional(),
  durationSec: z.number().min(0.5).max(300).optional(),
  caption: z.string().max(1000).optional(),
});
export type ReorderSketchBoardItem = z.infer<typeof ReorderSketchBoardItemSchema>;

export const ReorderSketchBoardSchema = z.object({
  items: z.array(ReorderSketchBoardItemSchema).min(1).max(200),
});
export type ReorderSketchBoardInput = z.infer<typeof ReorderSketchBoardSchema>;

export const LinkSketchToShotSchema = z.object({
  /** Existing Pre-prod Shot UUID to link (or null to unlink) */
  shotId: z.string().uuid().nullable().optional(),
  /** Alternatively create a new Shot inside this Scene UUID and link it */
  createShotInSceneId: z.string().uuid().optional(),
  /** Optional title for an auto-created scene if project has no scene yet */
  newSceneTitle: z.string().min(1).max(160).optional(),
  /** Attach the sketch PNG asset as the shot keyframe */
  syncKeyframe: z.boolean().default(true),
  /** Copy caption / AI Director Brief into the shot visual description & prompt when empty */
  syncBrief: z.boolean().default(true),
});
export type LinkSketchToShotInput = z.infer<typeof LinkSketchToShotSchema>;

export const SyncSketchBoardToStoryboardSchema = z.object({
  sceneId: z.string().uuid().optional(),
  newSceneTitle: z.string().min(1).max(160).default('Storyboard Croquis'),
  sketchIds: z.array(z.string().uuid()).max(200).optional(),
});
export type SyncSketchBoardToStoryboardInput = z.infer<typeof SyncSketchBoardToStoryboardSchema>;

export interface SketchDto {
  id: string;
  projectId: string;
  assetId: string | null;
  assetRef: string | null;
  assetHandle: string | null;
  assetUrl: string | null;
  assetThumbnailUrl: string | null;
  shotId: string | null;
  shotTitle: string | null;
  shotHandle: string | null;
  sceneId: string | null;
  inSketchBoard: boolean;
  boardOrder: number;
  durationSec: number;
  caption: string;
  title: string;
  mode: SketchMode;
  aspectRatio: string;
  folderPath: string;
  sceneData: SketchSceneData;
  aiDirectorBrief: string;
  createdAt: string;
  updatedAt: string;
}


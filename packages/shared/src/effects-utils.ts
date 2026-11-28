import {
  DEFAULT_CLIP_COLOR_ADJUST,
  DEFAULT_CLIP_TRANSFORM,
  type ClipAppliedEffect,
  type ClipCamera,
  type ClipCinemascope,
  type ClipColorAdjust,
  type ClipFx,
  type ClipKeyframe,
  type ClipTextOverlay,
  type ClipTransform,
  type CreateVideoEffectInput,
  type EffectParamValue,
  type VideoEffectDto,
} from './effects-schemas.js';
import {
  evaluateCinemascopeBar,
  evaluateClipCameraFrame,
  evaluateFadeOutBlackAlpha,
  evaluateFlashInState,
  evaluateMangaBlinkState,
  normalizeClipFx,
  resolveClipCamera,
} from './amv-engine.js';
import type { TimelineClipDto, TimelineDto, TimelineTransition } from './stage4-schemas.js';
import type { TimelineBeatMarker } from './timeline-v2-utils.js';

// ============================================================================
// CapCut-Grade Effects Compiler, Security Validator, Keyframe & Render Helpers
// ============================================================================

export interface BuiltinEffectSeed extends CreateVideoEffectInput {
  slug: string;
}

/**
 * 12 curated CapCut-style built-in video, color, motion & audio effects.
 * Seeded once into `video_effects` and usable by both Claude Code (MCP) and users (UI).
 */
export const BUILTIN_VIDEO_EFFECTS: BuiltinEffectSeed[] = [
  {
    slug: 'cinema-teal-orange',
    name: 'Cinéma Teal & Orange',
    category: 'color_grade',
    icon: '🎬',
    description: 'Étalonnage cinéma hollywoodien : ombres sarcelle profondes, hautes lumières chaudes ambrées.',
    ffmpegFilterTemplate:
      'colorbalance=rs={{warmth}}:gs=0.02:bs=-{{cool}}:rm=0.05:bm=-0.04:rh={{warmth}}:bh=-{{cool}},eq=contrast={{contrast}}:saturation={{saturation}}',
    cssPreviewFilter: 'contrast({{contrast}}) saturate({{saturation}}) sepia(0.14)',
    paramsSchema: [
      { key: 'warmth', label: 'Chaleur Ambre', type: 'number', min: 0, max: 0.4, step: 0.02, default: 0.14 },
      { key: 'cool', label: 'Ombres Teal', type: 'number', min: 0, max: 0.4, step: 0.02, default: 0.14 },
      { key: 'contrast', label: 'Contraste', type: 'number', min: 0.8, max: 1.6, step: 0.05, default: 1.15 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0.6, max: 1.8, step: 0.05, default: 1.2 },
    ],
    defaultParams: { warmth: 0.14, cool: 0.14, contrast: 1.15, saturation: 1.2 },
    tags: ['cinema', 'teal-orange', 'color', 'film'],
  },
  {
    slug: 'film-noir-bw',
    name: 'Film Noir N&B',
    category: 'color_grade',
    icon: '🎞️',
    description: 'Noir et blanc contrasté façon pellicule 35mm avec vignette subtile.',
    ffmpegFilterTemplate: 'hue=s=0,eq=contrast={{contrast}}:brightness={{brightness}},vignette=PI/{{vignette}}',
    cssPreviewFilter: 'grayscale(1) contrast({{contrast}})',
    paramsSchema: [
      { key: 'contrast', label: 'Contraste', type: 'number', min: 0.8, max: 2.2, step: 0.05, default: 1.35 },
      { key: 'brightness', label: 'Luminosité', type: 'number', min: -0.3, max: 0.3, step: 0.02, default: -0.02 },
      { key: 'vignette', label: 'Vignette', type: 'number', min: 2, max: 8, step: 0.5, default: 4 },
    ],
    defaultParams: { contrast: 1.35, brightness: -0.02, vignette: 4 },
    tags: ['bw', 'noir', 'monochrome', 'vintage'],
  },
  {
    slug: 'vhs-retro',
    name: 'VHS Rétro & Grain',
    category: 'video_fx',
    icon: '📼',
    description: 'Effet cassette VHS analogique avec grain pellicule, dérive chromatique et léger décalage RGB.',
    ffmpegFilterTemplate:
      'rgbashift=rh={{shift}}:bh=-{{shift}},noise=alls={{grain}}:allf=t+u,eq=saturation={{saturation}}:contrast=1.08',
    cssPreviewFilter: 'contrast(1.1) saturate({{saturation}}) sepia(0.22)',
    paramsSchema: [
      { key: 'shift', label: 'Décalage RGB (px)', type: 'number', min: 0, max: 14, step: 1, default: 4 },
      { key: 'grain', label: 'Grain Analogique', type: 'number', min: 0, max: 45, step: 2, default: 18 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0.5, max: 1.6, step: 0.05, default: 0.88 },
    ],
    defaultParams: { shift: 4, grain: 18, saturation: 0.88 },
    tags: ['vhs', 'retro', 'grain', 'analog'],
  },
  {
    slug: 'glitch-rgb',
    name: 'Glitch RGB Shift',
    category: 'video_fx',
    icon: '⚡',
    description: 'Séparation chromatique cyberpunk rouge/bleu intense pour les transitions et impacts musicaux.',
    ffmpegFilterTemplate:
      'rgbashift=rh={{shiftX}}:rv={{shiftY}}:bh=-{{shiftX}}:bv=-{{shiftY}},eq=contrast=1.18:saturation=1.25',
    cssPreviewFilter: 'contrast(1.18) saturate(1.3) hue-rotate(-8deg)',
    paramsSchema: [
      { key: 'shiftX', label: 'Split Horizontal', type: 'number', min: 1, max: 30, step: 1, default: 10 },
      { key: 'shiftY', label: 'Split Vertical', type: 'number', min: 0, max: 16, step: 1, default: 3 },
    ],
    defaultParams: { shiftX: 10, shiftY: 3 },
    tags: ['glitch', 'cyberpunk', 'rgb', 'music'],
  },
  {
    slug: 'dream-glow',
    name: 'Rêve / Soft Glow',
    category: 'video_fx',
    icon: '✨',
    description: 'Adoucit l image avec un halo lumineux onirique pour les flashbacks et séquences émotionnelles.',
    ffmpegFilterTemplate: 'gblur=sigma={{sigma}},eq=brightness={{glow}}:saturation={{saturation}}',
    cssPreviewFilter: 'blur({{sigma}}px) brightness(1.08) saturate({{saturation}})',
    paramsSchema: [
      { key: 'sigma', label: 'Douceur Flou', type: 'number', min: 0.5, max: 8, step: 0.5, default: 1.8 },
      { key: 'glow', label: 'Luminosité', type: 'number', min: 0, max: 0.25, step: 0.02, default: 0.06 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0.7, max: 1.5, step: 0.05, default: 1.15 },
    ],
    defaultParams: { sigma: 1.8, glow: 0.06, saturation: 1.15 },
    tags: ['dream', 'soft', 'glow', 'flashback'],
  },
  {
    slug: 'dramatic-vignette',
    name: 'Vignette Dramatique',
    category: 'color_grade',
    icon: '🕶️',
    description: 'Assombrit progressivement les bords pour focaliser l attention sur le sujet central.',
    ffmpegFilterTemplate: 'vignette=PI/{{strength}}:mode=forward,eq=contrast={{contrast}}',
    cssPreviewFilter: 'contrast({{contrast}}) brightness(0.95)',
    paramsSchema: [
      { key: 'strength', label: 'Ouverture (2=fort, 6=doux)', type: 'number', min: 2, max: 6, step: 0.25, default: 3.2 },
      { key: 'contrast', label: 'Contraste', type: 'number', min: 0.9, max: 1.5, step: 0.05, default: 1.1 },
    ],
    defaultParams: { strength: 3.2, contrast: 1.1 },
    tags: ['vignette', 'drama', 'focus'],
  },
  {
    slug: 'warm-golden-hour',
    name: 'Golden Hour Doré',
    category: 'color_grade',
    icon: '🌅',
    description: 'Lumière chaude de fin d après-midi avec teintes dorées et contraste doux.',
    ffmpegFilterTemplate:
      'colorbalance=rs={{gold}}:gs={{midGold}}:bs=-0.08:rh={{gold}}:bh=-0.1,eq=saturation={{saturation}}:gamma=1.04',
    cssPreviewFilter: 'sepia(0.24) saturate({{saturation}}) brightness(1.04)',
    paramsSchema: [
      { key: 'gold', label: 'Intensité Or', type: 'number', min: 0.04, max: 0.35, step: 0.02, default: 0.16 },
      { key: 'midGold', label: 'Tons Moyens', type: 'number', min: 0, max: 0.2, step: 0.02, default: 0.06 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0.8, max: 1.6, step: 0.05, default: 1.18 },
    ],
    defaultParams: { gold: 0.16, midGold: 0.06, saturation: 1.18 },
    tags: ['golden-hour', 'warm', 'sunset', 'color'],
  },
  {
    slug: 'neon-cyberpunk',
    name: 'Néon Cyberpunk',
    category: 'color_grade',
    icon: '🟣',
    description: 'Teintes magenta/cyan saturées et contraste nerveux pour clips musicaux et sci-fi.',
    ffmpegFilterTemplate:
      'colorbalance=rs=0.14:gs=-0.08:bs=0.2:rh=0.18:gh=-0.05:bh=0.18,eq=contrast={{contrast}}:saturation={{saturation}}',
    cssPreviewFilter: 'contrast({{contrast}}) saturate({{saturation}}) hue-rotate(12deg)',
    paramsSchema: [
      { key: 'contrast', label: 'Contraste', type: 'number', min: 1, max: 1.8, step: 0.05, default: 1.25 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 1, max: 2.2, step: 0.05, default: 1.45 },
    ],
    defaultParams: { contrast: 1.25, saturation: 1.45 },
    tags: ['neon', 'cyberpunk', 'scifi', 'clip'],
  },
  {
    slug: 'pro-sharpen',
    name: 'Netteté Pro 4K',
    category: 'video_fx',
    icon: '🔍',
    description: 'Accentue les micro-détails sans créer de halo excessif (ideal après génération IA).',
    ffmpegFilterTemplate: 'unsharp=5:5:{{amount}}:5:5:0.0',
    cssPreviewFilter: 'contrast(1.06)',
    paramsSchema: [
      { key: 'amount', label: 'Force Netteté', type: 'number', min: 0.2, max: 2.0, step: 0.1, default: 0.9 },
    ],
    defaultParams: { amount: 0.9 },
    tags: ['sharpen', 'clarity', 'detail', 'upscale'],
  },
  {
    slug: 'flash-cinema',
    name: 'Flash Impact',
    category: 'overlay',
    icon: '💥',
    description: 'Flash blanc cinématique à l entrée du clip pour accentuer un cut sur un beat.',
    ffmpegFilterTemplate: 'fade=t=in:st=0:d={{flashSec}}:color=white',
    cssPreviewFilter: 'brightness(1.12)',
    paramsSchema: [
      { key: 'flashSec', label: 'Durée Flash (s)', type: 'number', min: 0.08, max: 1.2, step: 0.05, default: 0.25 },
    ],
    defaultParams: { flashSec: 0.25 },
    tags: ['flash', 'beat', 'impact', 'cut'],
  },
  {
    slug: 'audio-radio-voice',
    name: 'Voix Radio / Talkie',
    category: 'audio_fx',
    icon: '📻',
    description: 'Filtre passe-bande 300Hz–3200Hz pour voix radio, téléphone ou narration lo-fi.',
    ffmpegFilterTemplate: 'highpass=f={{lowCut}},lowpass=f={{highCut}},acompressor=threshold=-16dB:ratio=4',
    cssPreviewFilter: '',
    paramsSchema: [
      { key: 'lowCut', label: 'Coupe-bas (Hz)', type: 'number', min: 150, max: 800, step: 25, default: 320 },
      { key: 'highCut', label: 'Coupe-haut (Hz)', type: 'number', min: 1800, max: 6000, step: 100, default: 3200 },
    ],
    defaultParams: { lowCut: 320, highCut: 3200 },
    tags: ['audio', 'radio', 'voice', 'lofi'],
  },
  {
    slug: 'audio-cinema-echo',
    name: 'Écho Cathédrale',
    category: 'audio_fx',
    icon: '🔊',
    description: 'Réverbération / écho spatial ample pour voix-off dramatique ou SFX.',
    ffmpegFilterTemplate: 'aecho=0.8:0.85:{{delayMs}}:{{decay}}',
    cssPreviewFilter: '',
    paramsSchema: [
      { key: 'delayMs', label: 'Délai (ms)', type: 'number', min: 40, max: 600, step: 20, default: 180 },
      { key: 'decay', label: 'Déclin', type: 'number', min: 0.1, max: 0.7, step: 0.05, default: 0.35 },
    ],
    defaultParams: { delayMs: 180, decay: 0.35 },
    tags: ['audio', 'echo', 'reverb', 'sfx'],
  },
];

// ============================================================================
// Security Validator for Custom AI / User FFmpeg Filter Templates
// ============================================================================

const FORBIDDEN_FILTER_NAMES = new Set([
  'movie',
  'amovie',
  'lavfi',
  'sendcmd',
  'asendcmd',
  'zmq',
  'azmq',
  'openclsrc',
  'frei0r',
  'frei0r_src',
  'ladspa',
  'lv2',
  'vapoursynth',
  'subtitles',
  'ass',
  'libplacebo',
  'system',
  'exec',
  'shell',
]);

export interface FilterValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Strictly validates an FFmpeg filter template created by AI (Claude) or users.
 * Prevents filtergraph escaping (`;`), shell-like characters, path traversal, and file-I/O filters.
 */
export function validateFfmpegFilterTemplate(template: string): FilterValidationResult {
  const trimmed = template.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Le template FFmpeg ne peut pas être vide.' };
  }
  if (trimmed.length > 1000) {
    return { valid: false, reason: 'Le template FFmpeg dépasse 1000 caractères.' };
  }
  if (/[\r\n\0`$|;&<>]/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Caractères interdits détectés dans le filtre FFmpeg (pas de retours ligne, `;`, `|`, `$`, backticks).',
    };
  }
  if (trimmed.includes('..') || /(?:^|[\s:,=])(?:file|filename|fontfile|textfile)\s*=/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Les accès fichiers (file=, filename=, fontfile=, ..) sont interdits dans un effet custom.',
    };
  }

  // Split by top-level commas (outside single quotes or parentheses)
  const parts = splitTopLevelComma(trimmed);
  if (parts.length === 0) {
    return { valid: false, reason: 'Aucun filtre FFmpeg valide trouvé.' };
  }

  for (const part of parts) {
    const token = part.trim();
    if (!token) {
      return { valid: false, reason: 'Segment de filtre vide détecté.' };
    }
    const filterNameMatch = token.match(/^([a-zA-Z][a-zA-Z0-9_]*)/);
    if (!filterNameMatch) {
      return { valid: false, reason: `Nom de filtre FFmpeg invalide: "${token.slice(0, 32)}"` };
    }
    const filterName = filterNameMatch[1]!.toLowerCase();
    if (FORBIDDEN_FILTER_NAMES.has(filterName)) {
      return {
        valid: false,
        reason: `Le filtre FFmpeg "${filterName}" n'est pas autorisé pour des raisons de sécurité.`,
      };
    }
  }

  return { valid: true };
}

function splitTopLevelComma(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === "'" && input[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        result.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) result.push(current);
  return result;
}

export function slugifyEffectName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'custom-effect';
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(4)).toString();
}

function resolveEffectParams(
  effect: Pick<VideoEffectDto, 'paramsSchema' | 'defaultParams'>,
  applied: Pick<ClipAppliedEffect, 'intensity' | 'params'>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const intensity = Number.isFinite(applied.intensity) ? Math.max(0, Math.min(2, applied.intensity)) : 1;
  resolved.intensity = formatNum(intensity);

  const schemaByKey = new Map(effect.paramsSchema.map((p) => [p.key, p]));
  const allKeys = new Set([
    ...Object.keys(effect.defaultParams ?? {}),
    ...effect.paramsSchema.map((p) => p.key),
    ...Object.keys(applied.params ?? {}),
  ]);

  for (const key of allKeys) {
    const spec = schemaByKey.get(key);
    const raw: EffectParamValue | undefined =
      applied.params?.[key] !== undefined
        ? applied.params[key]
        : effect.defaultParams?.[key] !== undefined
          ? effect.defaultParams[key]
          : spec?.default;

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      let val = raw;
      if (spec?.min !== undefined) val = Math.max(spec.min, val);
      if (spec?.max !== undefined) val = Math.min(spec.max, val);
      resolved[key] = formatNum(val);
    } else if (typeof raw === 'boolean') {
      resolved[key] = raw ? '1' : '0';
    } else if (typeof raw === 'string') {
      // Strictly strip unsafe chars for string/color/select interpolation
      const safe = raw.replace(/[^#a-zA-Z0-9._-]/g, '');
      resolved[key] = safe || '0';
    } else {
      resolved[key] = '0';
    }
  }

  return resolved;
}

/**
 * Compiles a VideoEffect + ClipAppliedEffect instance into a validated FFmpeg filter chain.
 */
export function compileEffectFfmpegFilter(
  effect: Pick<VideoEffectDto, 'ffmpegFilterTemplate' | 'paramsSchema' | 'defaultParams'>,
  applied: Pick<ClipAppliedEffect, 'enabled' | 'intensity' | 'params'>,
): string | null {
  if (!applied.enabled || applied.intensity <= 0) return null;
  const check = validateFfmpegFilterTemplate(effect.ffmpegFilterTemplate);
  if (!check.valid) return null;

  const vars = resolveEffectParams(effect, applied);
  const compiled = effect.ffmpegFilterTemplate.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_m, key: string) => vars[key] ?? '0',
  );

  // Double-check compiled output as well
  if (!validateFfmpegFilterTemplate(compiled).valid) return null;
  return compiled;
}

/**
 * Safely escapes text for FFmpeg's `drawtext` filter.
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ');
}

/**
 * Builds the FFmpeg `drawtext` filter string(s) for a ClipTextOverlay (supporting subtitle, strokeColor, glowColor shadow & fadeIn/fadeOut).
 */
export function buildDrawtextFilter(
  overlay: ClipTextOverlay,
  width: number,
  height: number,
  clipDurationSec?: number,
): string {
  const safeText = escapeDrawtext(overlay.text);
  const fontSize = Math.round(Math.max(12, Math.min(180, (overlay.fontSize * height) / 720)));
  const xNorm = overlay.x > 0 && overlay.x <= 1 ? overlay.x : overlay.x / 100;
  const yNorm = overlay.y > 0 && overlay.y <= 1 ? overlay.y : overlay.y / 100;
  const xExpr = `(w*${formatNum(xNorm)}-text_w/2)`;
  const yExpr = `(h*${formatNum(yNorm)}-text_h/2)`;
  const fontColor = overlay.color.replace('#', '0x');
  const strokeHex = (overlay.strokeColor || '#000000').replace('#', '0x');
  const boxColor = `${overlay.bgColor.replace('#', '0x')}@${formatNum(overlay.bgOpacity)}`;

  const parts = [
    `text='${safeText}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `borderw=2`,
    `bordercolor=${strokeHex}@0.85`,
  ];

  if (overlay.glowColor) {
    parts.push(`shadowcolor=${overlay.glowColor.replace('#', '0x')}@0.75`, `shadowx=0`, `shadowy=0`);
  }

  if (overlay.bgOpacity > 0.02) {
    parts.push(`box=1`, `boxcolor=${boxColor}`, `boxborderw=14`);
  }

  if (clipDurationSec && clipDurationSec > 0.1) {
    const fadeIn = overlay.fadeInSec ?? 0;
    const fadeOut = overlay.fadeOutSec ?? 0;
    if (fadeIn > 0.02 || fadeOut > 0.02) {
      const inExpr = fadeIn > 0.02 ? `min(1,t/${formatNum(fadeIn)})` : '1';
      const outExpr =
        fadeOut > 0.02
          ? `min(1,max(0,(${formatNum(clipDurationSec)}-t)/${formatNum(fadeOut)}))`
          : '1';
      parts.push(`alpha='min(${inExpr},${outExpr})'`);
    }
  }

  const mainDraw = `drawtext=${parts.join(':')}`;

  if (overlay.subtitle && overlay.subtitle.trim().length > 0) {
    const subSize = Math.max(12, Math.round(fontSize * 0.6));
    const subParts = [
      `text='${escapeDrawtext(overlay.subtitle.trim())}'`,
      `fontsize=${subSize}`,
      `fontcolor=${fontColor}@0.9`,
      `x=(w*${formatNum(xNorm)}-text_w/2)`,
      `y=(h*${formatNum(yNorm)}+${Math.round(fontSize * 0.65)})`,
      `borderw=1`,
      `bordercolor=${strokeHex}@0.8`,
    ];
    return `${mainDraw},drawtext=${subParts.join(':')}`;
  }

  return mainDraw;
}

export interface CompileClipVideoFilterOptions {
  width: number;
  height: number;
  fps: number;
  isImage: boolean;
  effectCatalog: Map<string, VideoEffectDto>;
  extraTextOverlays?: ClipTextOverlay[];
  beatTimesInClip?: number[];
}

/**
 * Extracts local downbeat/beat timestamps (relative to clip start: 0 .. clipDurationSec)
 * from project audio beat markers so `camera.beatPulseAmp` pulses strictly on downbeats.
 */
export function extractDownbeatTimesForClip(
  beatMarkers: TimelineBeatMarker[],
  clipStartSec: number,
  clipDurationSec: number,
): number[] {
  if (!beatMarkers || beatMarkers.length === 0 || clipDurationSec <= 0) return [];
  const clipEnd = clipStartSec + clipDurationSec;
  const raw = beatMarkers
    .filter((m) => m.timeSec >= clipStartSec - 0.02 && m.timeSec <= clipEnd + 0.02)
    .filter((m) => m.kind === 'beat' || /downbeat|drop|chorus|impact|beat/i.test(m.label))
    .map((m) => Math.max(0, Math.round((m.timeSec - clipStartSec) * 1000) / 1000));

  // Deduplicate within 80ms and cap to 16 pulses per clip for fast FFmpeg expression evaluation
  const unique: number[] = [];
  for (const t of raw.sort((a, b) => a - b)) {
    if (unique.length === 0 || t - unique[unique.length - 1]! >= 0.08) {
      unique.push(t);
    }
    if (unique.length >= 16) break;
  }
  return unique;
}

/**
 * Resolves effective camera parameters from mode defaults + explicit overrides.
 */
export function normalizeClipCamera(camera?: Partial<ClipCamera> | null): ClipCamera | null {
  return resolveClipCamera(camera);
}

/**
 * Compiles native dynamic camera motion (`push`, `ease`, `pull_back`, `power_pullback`,
 * `crash_zoom`, `p05_vertigo`, `pan`, `static` + `rotDeg` + `beatPulseAmp` + `shakeAmp` + `tremorAmp`)
 * into a frame-accurate FFmpeg scale + crop + rotate + scale chain compatible with BOTH videos and looped images.
 */
export function compileCameraFilter(
  camera: Partial<ClipCamera> | null | undefined,
  durationSec: number,
  width: number,
  height: number,
  beatTimesInClip: number[] = [],
): string | null {
  const cam = normalizeClipCamera(camera);
  if (!cam) return null;

  const hasMotion =
    cam.mode !== 'static' ||
    Math.abs(cam.z0 - 1) > 0.005 ||
    Math.abs(cam.z1 - 1) > 0.005 ||
    Math.abs(cam.cx0 - 0.5) > 0.005 ||
    Math.abs(cam.cx1 - 0.5) > 0.005 ||
    Math.abs(cam.cy0 - 0.5) > 0.005 ||
    Math.abs(cam.cy1 - 0.5) > 0.005 ||
    Math.abs(cam.rotDeg) > 0.05 ||
    cam.beatPulseAmp > 0.005 ||
    cam.shakeAmp > 0.005 ||
    cam.tremorAmp > 0.005;

  if (!hasMotion) return null;

  const dur = Math.max(0.1, durationSec);
  const pExpr = `min(1,max(0,t/${formatNum(dur)}))`;

  // Progress shaping curve depending on camera mode
  let curveExpr = pExpr;
  if (cam.mode === 'crash_zoom') {
    curveExpr = `pow(${pExpr},2.4)`;
  } else if (cam.mode === 'power_pullback') {
    curveExpr = `(1-pow(1-${pExpr},3))`;
  } else if (
    cam.mode === 'ease' ||
    cam.mode === 'push' ||
    cam.mode === 'pull_back' ||
    cam.mode === 'pan' ||
    cam.mode === 'p05_vertigo'
  ) {
    curveExpr = `(3*pow(${pExpr},2)-2*pow(${pExpr},3))`;
  }

  const extraSafetyZoom =
    (cam.shakeAmp > 0.005 ? cam.shakeAmp * 0.08 : 0) +
    (cam.tremorAmp > 0.005 ? cam.tremorAmp * 0.07 : 0);
  const z0 = Math.max(1, cam.z0 + extraSafetyZoom);
  const z1 = Math.max(1, cam.z1 + extraSafetyZoom);
  let zoomExpr = `(${formatNum(z0)}+(${formatNum(z1 - z0)})*${curveExpr})`;

  if (cam.mode === 'p05_vertigo') {
    zoomExpr = `(${zoomExpr}+0.04*sin(t*3.14159))`;
  }

  // Beat pulse synchronized to downbeat timestamps from audio_tracks.markers
  if (cam.beatPulseAmp > 0.005) {
    if (beatTimesInClip.length > 0) {
      const pulses = beatTimesInClip
        .map((bt) => `(${formatNum(cam.beatPulseAmp)}*exp(-16*max(0,t-${formatNum(bt)}))*gte(t,${formatNum(bt)}))`)
        .join('+');
      zoomExpr = `(${zoomExpr}+${pulses})`;
    } else {
      zoomExpr = `(${zoomExpr}+${formatNum(cam.beatPulseAmp)}*exp(-14*mod(t,0.5)))`;
    }
  }

  const maxZoom = Math.min(
    4.5,
    Math.max(1.15, Math.max(z0, z1) + cam.beatPulseAmp + (cam.mode === 'p05_vertigo' ? 0.06 : 0)),
  );
  const workW = Math.ceil((width * maxZoom) / 2) * 2;
  const workH = Math.ceil((height * maxZoom) / 2) * 2;

  let cxExpr = `(${formatNum(cam.cx0)}+(${formatNum(cam.cx1 - cam.cx0)})*${curveExpr})`;
  let cyExpr = `(${formatNum(cam.cy0)}+(${formatNum(cam.cy1 - cam.cy0)})*${curveExpr})`;

  if (cam.shakeAmp > 0.005) {
    const sAmp = formatNum(cam.shakeAmp * 0.032);
    cxExpr = `(${cxExpr}+${sAmp}*exp(-7*t)*sin(t*42))`;
    cyExpr = `(${cyExpr}+${sAmp}*exp(-7*t)*cos(t*49))`;
  }
  if (cam.tremorAmp > 0.005) {
    const tAmp = formatNum(cam.tremorAmp * 0.02);
    cxExpr = `(${cxExpr}+${tAmp}*sin(t*76))`;
    cyExpr = `(${cyExpr}+${tAmp}*cos(t*83))`;
  }

  const cropW = `min(iw,max(32,iw/(${zoomExpr})))`;
  const cropH = `min(ih,max(32,ih/(${zoomExpr})))`;
  const cropX = `clip(iw*${cxExpr}-(${cropW})/2,0,iw-(${cropW}))`;
  const cropY = `clip(ih*${cyExpr}-(${cropH})/2,0,ih-(${cropH}))`;

  const chain = [
    `scale=${workW}:${workH}:flags=bicubic`,
    `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}'`,
    `scale=${width}:${height}:flags=bicubic`,
  ];

  if (Math.abs(cam.rotDeg) > 0.05) {
    const rad = (cam.rotDeg * Math.PI) / 180;
    const rotExpr =
      cam.mode === 'p05_vertigo'
        ? `${formatNum(rad)}*sin(${pExpr}*3.14159)`
        : `${formatNum(rad)}*${curveExpr}`;
    chain.push(`rotate='${rotExpr}':fillcolor=black@1`);
  }

  return chain.join(',');
}

/**
 * Compiles Cinemascope letterbox bars (`bar0`, `bar1` = fraction of frame height top & bottom, e.g. 0.125 for 2.39:1, 0.25 for eye-slit).
 * Uses ultra-fast `drawbox` when static, and smooth ease-in-out `geq` when animated (`bar0 !== bar1`).
 */
export function compileCinemascopeFilter(
  cinemascope: Partial<ClipCinemascope> | null | undefined,
  durationSec: number,
  _width: number,
  height: number,
): string | null {
  if (!cinemascope) return null;
  const bar0 = Math.max(0, Math.min(0.45, cinemascope.bar0 ?? 0));
  const bar1 = Math.max(0, Math.min(0.45, cinemascope.bar1 ?? bar0));
  if (bar0 < 0.002 && bar1 < 0.002) return null;

  if (Math.abs(bar0 - bar1) < 0.002) {
    const barPx = Math.max(2, Math.round(height * bar0));
    return [
      `drawbox=x=0:y=0:w=iw:h=${barPx}:color=black:t=fill`,
      `drawbox=x=0:y=ih-${barPx}:w=iw:h=${barPx}:color=black:t=fill`,
    ].join(',');
  }

  const dur = Math.max(0.1, durationSec);
  const p = `clip(T/${formatNum(dur)},0,1)`;
  const ease = `(3*${p}*${p}-2*${p}*${p}*${p})`;
  const barExpr = `(${formatNum(bar0)}+(${formatNum(bar1 - bar0)})*${ease})`;
  return `format=rgb24,geq=r='if(lt(Y,H*${barExpr})+gt(Y,H*(1-${barExpr})),0,r(X,Y))':g='if(lt(Y,H*${barExpr})+gt(Y,H*(1-${barExpr})),0,g(X,Y))':b='if(lt(Y,H*${barExpr})+gt(Y,H*(1-${barExpr})),0,b(X,Y))'`;
}

/**
 * Compiles native AMV FX (BOTH legacy tag arrays AND structured WYSIWYG FX objects) + `flashIn`
 * into FFmpeg filter stages (used when Python Pillow/NumPy renderer is unavailable or bypassed).
 */
export function compileAmvFxFilters(
  fx: ClipFx | null | undefined,
  flashIn: number | undefined,
  durationSec: number,
  width: number,
  height: number,
  fps = 24,
): string[] {
  const out: string[] = [];
  const nfx = normalizeClipFx(fx, flashIn);

  if (nfx.legacyShakeAmp > 0) {
    out.push(
      `crop=w=iw*0.95:h=ih*0.95:x='clip((iw-ow)/2+sin(t*38)*8*exp(-7*t),0,iw-ow)':y='clip((ih-oh)/2+cos(t*43)*6*exp(-7*t),0,ih-oh)'`,
      `scale=${width}:${height}`,
    );
  }
  if (nfx.legacyTremorAmp > 0) {
    out.push(
      `crop=w=iw*0.91:h=ih*0.91:x='clip((iw-ow)/2+sin(t*72)*16,0,iw-ow)':y='clip((ih-oh)/2+cos(t*81)*14,0,ih-oh)'`,
      `scale=${width}:${height}`,
    );
  }
  if (nfx.mangaBlink) {
    // High-contrast monochrome ink + invert every 2 frames
    out.push(
      'hue=s=0',
      'eq=contrast=2.25:brightness=0.04',
      "negate=enable='eq(mod(floor(n/2),2),1)'",
    );
  }
  if (nfx.radialSpeedLines) {
    out.push('unsharp=7:7:1.8:7:7:0.0', 'vignette=PI/2.6:eval=frame');
  }
  if (nfx.horizSpeedLines) {
    out.push('boxblur=lr=5:lp=1:cr=1:cp=1', 'unsharp=5:5:1.35:5:5:0.0', 'noise=alls=10:allf=u');
  }
  if (nfx.particles) {
    out.push(
      'colorbalance=rs=0.14:gs=0.07:bs=-0.08:rh=0.18:gh=0.10:bh=-0.06',
      'noise=alls=12:allf=t+u',
    );
  }
  if (nfx.flashIn && nfx.flashIn.alpha > 0.02) {
    const dur = Math.max(0.08, nfx.flashIn.frames / Math.max(1, fps));
    const hexColor = nfx.flashIn.color.replace('#', '0x');
    out.push(`fade=t=in:st=0:d=${formatNum(dur)}:color=${hexColor}`);
  }
  if (nfx.fadeOutBlack && nfx.fadeOutBlack.durationSec > 0.02) {
    const d = Math.min(nfx.fadeOutBlack.durationSec, Math.max(0.1, durationSec));
    const st = Math.max(0, durationSec - d);
    out.push(`fade=t=out:st=${formatNum(st)}:d=${formatNum(d)}:color=black`);
  }

  return out;
}

/**
 * Compiles the full FFmpeg `-vf` filter chain for a single timeline clip:
 * speed (`setpts`), scale/pad, native camera motion (with beatPulseAmp/rotDeg/shake/tremor), flip/transform/zoom,
 * color adjustments (`eq`, `gblur`, `unsharp`, `vignette`), native AMV FX, custom/built-in applied video effects,
 * Cinemascope bars, fade-in/out, and text overlays (`drawtext`).
 */
export function compileClipVideoFilterChain(
  clip: Pick<
    TimelineClipDto,
    | 'durationSec'
    | 'speed'
    | 'fadeInSec'
    | 'fadeOutSec'
    | 'transform'
    | 'colorAdjust'
    | 'effects'
    | 'textOverlay'
    | 'camera'
    | 'cinemascope'
    | 'fx'
    | 'flashIn'
  >,
  options: CompileClipVideoFilterOptions,
): string {
  const filters: string[] = [];
  const { width, height, fps, isImage, effectCatalog, beatTimesInClip } = options;

  // 1. Speed (for video sources)
  const rawSpeed = clip.speed ?? 1;
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.25, Math.min(4, rawSpeed)) : 1;
  if (!isImage && Math.abs(speed - 1) > 0.01) {
    filters.push(`setpts=${formatNum(1 / speed)}*PTS`);
  }

  // 2. Base scale + pad to target canvas
  filters.push(
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
  );

  // 2b. Native Camera Motion
  const cameraFilter = compileCameraFilter(
    clip.camera,
    clip.durationSec,
    width,
    height,
    beatTimesInClip ?? [],
  );
  if (cameraFilter) filters.push(cameraFilter);

  // 3. Transform (flip, zoom/pan, rotation)
  const tr: ClipTransform = { ...DEFAULT_CLIP_TRANSFORM, ...(clip.transform ?? {}) };
  if (tr.flipH) filters.push('hflip');
  if (tr.flipV) filters.push('vflip');

  if (Math.abs(tr.scale - 1) > 0.01 || Math.abs(tr.x) > 0.005 || Math.abs(tr.y) > 0.005) {
    const scaledW = Math.max(32, Math.round(width * tr.scale));
    const scaledH = Math.max(32, Math.round(height * tr.scale));
    if (tr.scale >= 1) {
      const offsetX = Math.round(((scaledW - width) / 2) - tr.x * (width / 2));
      const offsetY = Math.round(((scaledH - height) / 2) - tr.y * (height / 2));
      const clampedX = Math.max(0, Math.min(scaledW - width, offsetX));
      const clampedY = Math.max(0, Math.min(scaledH - height, offsetY));
      filters.push(`scale=${scaledW}:${scaledH}`, `crop=${width}:${height}:${clampedX}:${clampedY}`);
    } else {
      const padX = Math.max(0, Math.min(width - scaledW, Math.round((width - scaledW) / 2 + tr.x * (width / 2))));
      const padY = Math.max(0, Math.min(height - scaledH, Math.round((height - scaledH) / 2 + tr.y * (height / 2))));
      filters.push(`scale=${scaledW}:${scaledH}`, `pad=${width}:${height}:${padX}:${padY}:color=black`);
    }
  }

  if (Math.abs(tr.rotation) > 0.2) {
    const radians = (tr.rotation * Math.PI) / 180;
    filters.push(`rotate=${formatNum(radians)}:fillcolor=black@1`);
  }

  // 4. Color Grading Adjustments
  const color: ClipColorAdjust = { ...DEFAULT_CLIP_COLOR_ADJUST, ...(clip.colorAdjust ?? {}) };
  if (
    Math.abs(color.brightness) > 0.005 ||
    Math.abs(color.contrast - 1) > 0.005 ||
    Math.abs(color.saturation - 1) > 0.005 ||
    Math.abs(color.gamma - 1) > 0.005
  ) {
    filters.push(
      `eq=brightness=${formatNum(color.brightness)}:contrast=${formatNum(color.contrast)}:saturation=${formatNum(color.saturation)}:gamma=${formatNum(color.gamma)}`,
    );
  }
  if (color.blur > 0.05) {
    filters.push(`gblur=sigma=${formatNum(color.blur)}`);
  }
  if (color.sharpen > 0.05) {
    filters.push(`unsharp=5:5:${formatNum(color.sharpen)}:5:5:0.0`);
  }
  if (color.vignette > 0.02) {
    const angleDiv = Math.max(1.8, 6 - color.vignette * 4);
    filters.push(`vignette=PI/${formatNum(angleDiv)}`);
  }

  // 4b. Native AMV FX (tags or structured object) + flashIn
  const amvFilters = compileAmvFxFilters(clip.fx, clip.flashIn, clip.durationSec, width, height, fps);
  filters.push(...amvFilters);

  // 5. Applied Custom / Built-in Video Effects
  for (const applied of clip.effects ?? []) {
    if (!applied.enabled) continue;
    const def = effectCatalog.get(applied.effectSlug);
    if (!def || def.category === 'audio_fx' || def.category === 'transition') continue;
    const compiled = compileEffectFfmpegFilter(def, applied);
    if (compiled) filters.push(compiled);
  }

  // 6. Clip Fade-in / Fade-out
  const fadeIn = clip.fadeInSec ?? 0;
  const fadeOut = clip.fadeOutSec ?? 0;
  if (fadeIn > 0.02) {
    const d = Math.min(fadeIn, clip.durationSec / 2);
    filters.push(`fade=t=in:st=0:d=${formatNum(d)}`);
  }
  if (fadeOut > 0.02) {
    const d = Math.min(fadeOut, clip.durationSec / 2);
    const st = Math.max(0, clip.durationSec - d);
    filters.push(`fade=t=out:st=${formatNum(st)}:d=${formatNum(d)}`);
  }

  // 7. Text Overlays (inline on clip or extra overlays)
  if (clip.textOverlay && clip.textOverlay.text.trim().length > 0) {
    filters.push(buildDrawtextFilter(clip.textOverlay, width, height, clip.durationSec));
  }
  for (const extra of options.extraTextOverlays ?? []) {
    if (extra.text.trim().length > 0) {
      filters.push(buildDrawtextFilter(extra, width, height, clip.durationSec));
    }
  }

  // 7b. Native Cinemascope Letterbox Bars drawn LAST on top of everything
  const scopeFilter = compileCinemascopeFilter(clip.cinemascope, clip.durationSec, width, height);
  if (scopeFilter) filters.push(scopeFilter);

  // 8. Normalize FPS & pixel format
  filters.push(`fps=${fps}`, 'format=yuv420p');

  return filters.join(',');
}

/**
 * Builds an FFmpeg `atempo` chain for any speed in [0.25, 4.0].
 * FFmpeg's atempo only supports [0.5, 2.0] per stage, so we chain stages for 0.25x or 4x.
 */
export function buildAtempoChain(speed: number): string[] {
  const clamped = Math.max(0.25, Math.min(4, speed));
  if (Math.abs(clamped - 1) < 0.01) return [];
  const chain: string[] = [];
  let remaining = clamped;
  while (remaining > 2.0) {
    chain.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    chain.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) >= 0.01) {
    chain.push(`atempo=${formatNum(remaining)}`);
  }
  return chain;
}

/**
 * Compiles an FFmpeg audio filter chain for a clip on an audio track.
 */
export function compileClipAudioFilterChain(
  clip: Pick<
    TimelineClipDto,
    'startSec' | 'durationSec' | 'inSec' | 'speed' | 'volume' | 'fadeInSec' | 'fadeOutSec' | 'effects'
  >,
  trackVolume: number,
  effectCatalog: Map<string, VideoEffectDto>,
): string {
  const filters: string[] = [];
  const rawSpeed = clip.speed ?? 1;
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.25, Math.min(4, rawSpeed)) : 1;
  const srcDuration = clip.durationSec * speed;

  filters.push(`atrim=start=${formatNum(Math.max(0, clip.inSec))}:duration=${formatNum(Math.max(0.1, srcDuration))}`);
  filters.push('asetpts=PTS-STARTPTS');

  filters.push(...buildAtempoChain(speed));

  const effectiveVol = Math.max(0, Math.min(4, clip.volume * trackVolume));
  if (Math.abs(effectiveVol - 1) > 0.01) {
    filters.push(`volume=${formatNum(effectiveVol)}`);
  }

  for (const applied of clip.effects ?? []) {
    if (!applied.enabled) continue;
    const def = effectCatalog.get(applied.effectSlug);
    if (!def || def.category !== 'audio_fx') continue;
    const compiled = compileEffectFfmpegFilter(def, applied);
    if (compiled) filters.push(compiled);
  }

  const fadeIn = clip.fadeInSec ?? 0;
  const fadeOut = clip.fadeOutSec ?? 0;
  if (fadeIn > 0.02) {
    const d = Math.min(fadeIn, clip.durationSec / 2);
    filters.push(`afade=t=in:st=0:d=${formatNum(d)}`);
  }
  if (fadeOut > 0.02) {
    const d = Math.min(fadeOut, clip.durationSec / 2);
    const st = Math.max(0, clip.durationSec - d);
    filters.push(`afade=t=out:st=${formatNum(st)}:d=${formatNum(d)}`);
  }

  const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
  if (delayMs > 0) {
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }

  return filters.join(',');
}

// ============================================================================
// FFmpeg `xfade` Transition Mapping & Offset Calculation
// ============================================================================

export const TIMELINE_TRANSITION_META: Record<
  TimelineTransition,
  { label: string; ffmpegXfade: string | null; icon: string }
> = {
  cut: { label: 'Cut (Direct)', ffmpegXfade: null, icon: '✂️' },
  crossfade: { label: 'Fondu enchaîné', ffmpegXfade: 'fade', icon: '🌗' },
  fade_black: { label: 'Fondu au noir', ffmpegXfade: 'fadeblack', icon: '⬛' },
  fade_white: { label: 'Flash au blanc', ffmpegXfade: 'fadewhite', icon: '⬜' },
  wipe_left: { label: 'Balayage gauche', ffmpegXfade: 'wipeleft', icon: '⬅️' },
  wipe_right: { label: 'Balayage droite', ffmpegXfade: 'wiperight', icon: '➡️' },
  slide_left: { label: 'Glissement gauche', ffmpegXfade: 'slideleft', icon: '⏪' },
  slide_right: { label: 'Glissement droite', ffmpegXfade: 'slideright', icon: '⏩' },
  zoom_in: { label: 'Zoom avant', ffmpegXfade: 'zoomin', icon: '🔎' },
  circle_open: { label: 'Iris circulaire', ffmpegXfade: 'circleopen', icon: '⭕' },
  dissolve: { label: 'Dissolution', ffmpegXfade: 'dissolve', icon: '✨' },
};

export interface XfadeStep {
  fromIndex: number;
  toIndex: number;
  transition: string;
  durationSec: number;
  offsetSec: number;
}

export interface XfadeChainPlan {
  hasTransitions: boolean;
  steps: XfadeStep[];
  totalDurationSec: number;
}

/**
 * Computes exact chained `xfade` offsets for sequential clips.
 * Note: For `N` clips, each transition between clip `i-1` and `i` shortens total timeline by `d_i`.
 */
export function computeXfadeChainPlan(
  clips: Array<Pick<TimelineClipDto, 'durationSec' | 'transition' | 'transitionDurationSec'>>,
): XfadeChainPlan {
  if (clips.length === 0) {
    return { hasTransitions: false, steps: [], totalDurationSec: 0 };
  }

  const anyTransition = clips
    .slice(1)
    .some((c) => c.transition !== 'cut' && (c.transitionDurationSec ?? 0) > 0.05);

  if (!anyTransition || clips.length === 1) {
    const total = clips.reduce((acc, c) => acc + Math.max(0.1, c.durationSec), 0);
    return { hasTransitions: false, steps: [], totalDurationSec: Math.round(total * 1000) / 1000 };
  }

  const steps: XfadeStep[] = [];
  let cumulativeDuration = Math.max(0.2, clips[0]!.durationSec);

  for (let i = 1; i < clips.length; i += 1) {
    const prev = clips[i - 1]!;
    const curr = clips[i]!;
    const meta = TIMELINE_TRANSITION_META[curr.transition] ?? TIMELINE_TRANSITION_META.cut;
    const rawTransDur = meta.ffmpegXfade ? Math.max(0.05, curr.transitionDurationSec || 0.5) : 0.05;
    const maxSafeDur = Math.max(0.05, Math.min(prev.durationSec, curr.durationSec) * 0.45);
    const transDur = Math.min(rawTransDur, maxSafeDur);
    const offset = Math.max(0, cumulativeDuration - transDur);

    steps.push({
      fromIndex: i - 1,
      toIndex: i,
      transition: meta.ffmpegXfade ?? 'fade',
      durationSec: Math.round(transDur * 1000) / 1000,
      offsetSec: Math.round(offset * 1000) / 1000,
    });

    cumulativeDuration = offset + Math.max(0.2, curr.durationSec);
  }

  return {
    hasTransitions: true,
    steps,
    totalDurationSec: Math.round(cumulativeDuration * 1000) / 1000,
  };
}

// ============================================================================
// Keyframe Interpolation & Real-Time Browser CSS Preview Engine
// ============================================================================

function applyEasing(t: number, easing: ClipKeyframe['easing']): number {
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'ease_in':
      return x * x;
    case 'ease_out':
      return 1 - (1 - x) * (1 - x);
    case 'ease_in_out':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default:
      return x;
  }
}

/**
 * Evaluates a clip's transform at `localTimeSec` (0 .. clip.durationSec), interpolating any keyframes.
 */
export function evaluateClipTransformAtTime(
  transform: ClipTransform | undefined,
  keyframes: ClipKeyframe[] | undefined,
  localTimeSec: number,
): ClipTransform {
  const base: ClipTransform = { ...DEFAULT_CLIP_TRANSFORM, ...(transform ?? {}) };
  if (!keyframes || keyframes.length === 0) return base;

  const props: Array<'scale' | 'x' | 'y' | 'rotation' | 'opacity'> = [
    'scale',
    'x',
    'y',
    'rotation',
    'opacity',
  ];

  for (const prop of props) {
    const kfs = keyframes
      .filter((k) => k.property === prop)
      .sort((a, b) => a.timeOffsetSec - b.timeOffsetSec);
    if (kfs.length === 0) continue;
    if (localTimeSec <= kfs[0]!.timeOffsetSec) {
      base[prop] = kfs[0]!.value;
      continue;
    }
    const last = kfs[kfs.length - 1]!;
    if (localTimeSec >= last.timeOffsetSec) {
      base[prop] = last.value;
      continue;
    }
    for (let i = 0; i < kfs.length - 1; i += 1) {
      const a = kfs[i]!;
      const b = kfs[i + 1]!;
      if (localTimeSec >= a.timeOffsetSec && localTimeSec <= b.timeOffsetSec) {
        const span = Math.max(0.0001, b.timeOffsetSec - a.timeOffsetSec);
        const progress = applyEasing((localTimeSec - a.timeOffsetSec) / span, b.easing);
        base[prop] = a.value + (b.value - a.value) * progress;
        break;
      }
    }
  }

  return base;
}

export interface ClipCssPreviewStyle {
  filter: string;
  transform: string;
  opacity: number;
  vignetteOpacity: number;
  cinemascopeBarFraction: number;
  flashOverlayColor: string;
  flashOverlayOpacity: number;
}

/**
 * Computes real-time CSS preview styling for the browser monitor at `playheadSec`,
 * including keyframes, color grading, custom effects, native Camera motion (+ beatPulseAmp),
 * animated Cinemascope bars, and AMV FX tags.
 */
export function compileClipCssPreview(
  clip: Pick<
    TimelineClipDto,
    | 'startSec'
    | 'durationSec'
    | 'fadeInSec'
    | 'fadeOutSec'
    | 'transform'
    | 'colorAdjust'
    | 'effects'
    | 'keyframes'
    | 'camera'
    | 'cinemascope'
    | 'fx'
    | 'flashIn'
  > & { id?: string },
  playheadSec: number,
  effectCatalog: Map<string, VideoEffectDto>,
  beatTimesInClip: number[] = [],
  fps = 24,
): ClipCssPreviewStyle {
  const localTime = Math.max(0, Math.min(clip.durationSec, playheadSec - clip.startSec));
  const frameIndex = Math.max(0, Math.floor(localTime * fps + 1e-6));
  const tr = evaluateClipTransformAtTime(clip.transform, clip.keyframes, localTime);
  const color: ClipColorAdjust = { ...DEFAULT_CLIP_COLOR_ADJUST, ...(clip.colorAdjust ?? {}) };

  const filterParts: string[] = [];
  if (Math.abs(color.brightness) > 0.005) {
    filterParts.push(`brightness(${formatNum(Math.max(0.05, 1 + color.brightness))})`);
  }
  if (Math.abs(color.contrast - 1) > 0.005) {
    filterParts.push(`contrast(${formatNum(color.contrast)})`);
  }
  if (Math.abs(color.saturation - 1) > 0.005) {
    filterParts.push(`saturate(${formatNum(color.saturation)})`);
  }
  if (color.blur > 0.05) {
    filterParts.push(`blur(${formatNum(color.blur)}px)`);
  }

  for (const applied of clip.effects ?? []) {
    if (!applied.enabled || applied.intensity <= 0) continue;
    const def = effectCatalog.get(applied.effectSlug);
    if (!def || !def.cssPreviewFilter) continue;
    const vars = resolveEffectParams(def, applied);
    const css = def.cssPreviewFilter.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (_m, key: string) => vars[key] ?? '1',
    );
    if (css.trim()) filterParts.push(css.trim());
  }

  const nfx = normalizeClipFx(clip.fx, clip.flashIn);
  const mangaState = evaluateMangaBlinkState(nfx, frameIndex);
  if (mangaState.active) {
    filterParts.push(
      mangaState.inverted
        ? 'grayscale(1) contrast(2.25) invert(1)'
        : 'grayscale(1) contrast(2.25)',
    );
  }

  const flashState = evaluateFlashInState(nfx, localTime, fps);
  const camFrame = evaluateClipCameraFrame({
    clipId: clip.id ?? 'preview',
    camera: clip.camera,
    fx: clip.fx,
    legacyFlashIn: clip.flashIn,
    localTimeSec: localTime,
    durationSec: clip.durationSec,
    fps,
    beatTimesInClip,
  });

  const cinemascopeBarFraction = evaluateCinemascopeBar(clip.cinemascope, localTime, clip.durationSec);

  let opacity = Math.max(0, Math.min(1, tr.opacity));
  const cssFadeIn = clip.fadeInSec ?? 0;
  if (cssFadeIn > 0.02 && localTime < cssFadeIn) {
    opacity *= Math.max(0, localTime / cssFadeIn);
  }
  const fadeOutAlpha = evaluateFadeOutBlackAlpha(nfx, clip.fadeOutSec, localTime, clip.durationSec);
  if (fadeOutAlpha > 0) {
    opacity *= Math.max(0, 1 - fadeOutAlpha);
  }

  const totalTx = tr.x * 50 + (0.5 - camFrame.cx) * 40 + camFrame.dx * 100;
  const totalTy = tr.y * 50 + (0.5 - camFrame.cy) * 40 + camFrame.dy * 100;
  const transforms: string[] = [];
  if (Math.abs(totalTx) > 0.01 || Math.abs(totalTy) > 0.01) {
    transforms.push(`translate(${formatNum(totalTx)}%, ${formatNum(totalTy)}%)`);
  }
  const sx = tr.scale * camFrame.z * (tr.flipH ? -1 : 1);
  const sy = tr.scale * camFrame.z * (tr.flipV ? -1 : 1);
  if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
    transforms.push(`scale(${formatNum(sx)}, ${formatNum(sy)})`);
  }
  const totalRot = tr.rotation + camFrame.rotDeg;
  if (Math.abs(totalRot) > 0.05) {
    transforms.push(`rotate(${formatNum(totalRot)}deg)`);
  }

  return {
    filter: filterParts.join(' ') || 'none',
    transform: transforms.join(' ') || 'none',
    opacity: Math.round(opacity * 1000) / 1000,
    vignetteOpacity: Math.max(0, Math.min(1, color.vignette)),
    cinemascopeBarFraction: Math.round(cinemascopeBarFraction * 10000) / 10000,
    flashOverlayColor: flashState.color,
    flashOverlayOpacity: Math.round(flashState.alpha * 1000) / 1000,
  };
}

// ============================================================================
// CapCut Razor / Split Clip, Ripple & Range Slicing Helpers
// ============================================================================

export interface SplitClipResult<T> {
  left: T;
  right: T;
}

/**
 * Splits a clip cleanly at `splitAtSec` (timeline seconds), advancing `inSec` for the right clip
 * proportionally to `speed`, and splitting keyframes cleanly across the two halves.
 */
export function splitClipAtTime<
  T extends Pick<
    TimelineClipDto,
    'title' | 'startSec' | 'durationSec' | 'inSec' | 'outSec' | 'speed' | 'fadeInSec' | 'fadeOutSec' | 'transition' | 'transitionDurationSec' | 'keyframes'
  >,
>(clip: T, splitAtSec: number): SplitClipResult<T> | null {
  const minPiece = 0.15;
  const clipEnd = clip.startSec + clip.durationSec;
  if (splitAtSec <= clip.startSec + minPiece || splitAtSec >= clipEnd - minPiece) {
    return null;
  }

  const leftDur = Math.round((splitAtSec - clip.startSec) * 1000) / 1000;
  const rightDur = Math.round((clipEnd - splitAtSec) * 1000) / 1000;
  const rawSplitSpeed = clip.speed ?? 1;
  const speed = Number.isFinite(rawSplitSpeed) ? Math.max(0.25, Math.min(4, rawSplitSpeed)) : 1;
  const rightInSec = Math.round((clip.inSec + leftDur * speed) * 1000) / 1000;

  const leftKeyframes = (clip.keyframes ?? []).filter((k) => k.timeOffsetSec <= leftDur);
  const rightKeyframes = (clip.keyframes ?? [])
    .filter((k) => k.timeOffsetSec >= leftDur)
    .map((k) => ({
      ...k,
      timeOffsetSec: Math.round((k.timeOffsetSec - leftDur) * 1000) / 1000,
    }));

  const left: T = {
    ...clip,
    durationSec: leftDur,
    outSec: rightInSec,
    fadeOutSec: 0,
    keyframes: leftKeyframes,
  };

  const right: T = {
    ...clip,
    title: clip.title.endsWith(' (2)') ? clip.title : `${clip.title} (2)`,
    startSec: Math.round(splitAtSec * 1000) / 1000,
    durationSec: rightDur,
    inSec: rightInSec,
    outSec: clip.outSec,
    transition: 'cut',
    transitionDurationSec: 0,
    fadeInSec: 0,
    keyframes: rightKeyframes,
  };

  return { left, right };
}

/**
 * Recalculates consecutive `startSec` values across an ordered list of clips (Ripple close gaps).
 */
export function rippleTrackClips<T extends { startSec: number; durationSec: number }>(
  clips: T[],
  initialStartSec = 0,
): T[] {
  let cursor = Math.max(0, initialStartSec);
  return clips.map((clip) => {
    const startSec = Math.round(cursor * 1000) / 1000;
    cursor = startSec + Math.max(0.1, clip.durationSec);
    return { ...clip, startSec };
  });
}

/**
 * Slices an entire multi-track timeline down to `[startSec, endSec]` for fast range previews (`render_timeline_range`).
 * Clips completely inside the range preserve exact `inSec`/`durationSec`/FX so they hit the SHA-256 segment cache!
 */
export function sliceTimelineForRange(
  timeline: TimelineDto,
  startSec: number,
  endSec: number,
): TimelineDto {
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 0.2, endSec);
  const rangeDur = Math.round((safeEnd - safeStart) * 1000) / 1000;

  const slicedTracks = timeline.tracks.map((track) => {
    const slicedClips: TimelineClipDto[] = [];
    for (const clip of track.clips) {
      const clipStart = clip.startSec;
      const clipEnd = clip.startSec + clip.durationSec;
      if (clipEnd <= safeStart + 0.01 || clipStart >= safeEnd - 0.01) continue;

      const overlapStart = Math.max(clipStart, safeStart);
      const overlapEnd = Math.min(clipEnd, safeEnd);
      const leftTrim = Math.max(0, overlapStart - clipStart);
      const newDur = Math.round((overlapEnd - overlapStart) * 1000) / 1000;
      if (newDur < 0.05) continue;

      const speed = Math.max(0.25, Math.min(4, clip.speed ?? 1));
      const newInSec = Math.round((clip.inSec + leftTrim * speed) * 1000) / 1000;
      const newStartSec = Math.round((overlapStart - safeStart) * 1000) / 1000;

      slicedClips.push({
        ...clip,
        startSec: newStartSec,
        durationSec: newDur,
        inSec: newInSec,
        outSec: leftTrim > 0 || overlapEnd < clipEnd ? Math.round((newInSec + newDur * speed) * 1000) / 1000 : clip.outSec,
        transition: leftTrim > 0 ? 'cut' : clip.transition,
        transitionDurationSec: leftTrim > 0 ? 0 : clip.transitionDurationSec,
      });
    }
    return {
      ...track,
      clips: slicedClips,
    };
  });

  return {
    ...timeline,
    totalDurationSec: rangeDur,
    tracks: slicedTracks,
  };
}

/**
 * Deterministic signature string for content-addressed per-clip segment caching.
 * Depends strictly on `(assetId, assetUpdatedAt/sourceFingerprint, inSec, outSec, durationSec, speed,
 * camera, cinemascope, fx, flashIn, transform, colorAdjust, effects, beatTimes, resolution, fps, qualityMode, renderEngine)`.
 */
export function buildClipSegmentCacheSignature(params: {
  sourceFingerprint: string;
  clip: Pick<
    TimelineClipDto,
    | 'inSec'
    | 'durationSec'
    | 'speed'
    | 'fadeInSec'
    | 'fadeOutSec'
    | 'transform'
    | 'colorAdjust'
    | 'effects'
    | 'textOverlay'
    | 'camera'
    | 'cinemascope'
    | 'fx'
    | 'flashIn'
  > & { id?: string; outSec?: number | null };
  width: number;
  height: number;
  fps: number;
  qualityMode: string;
  compiledVideoFilter: string;
  renderEngine?: 'ffmpeg' | 'amv_py';
  beatTimesInClip?: number[];
}): string {
  return JSON.stringify({
    v: 3,
    eng: params.renderEngine ?? 'ffmpeg',
    src: params.sourceFingerprint,
    in: Math.round(params.clip.inSec * 1000),
    out: params.clip.outSec != null ? Math.round(params.clip.outSec * 1000) : null,
    dur: Math.round(params.clip.durationSec * 1000),
    spd: Math.round((params.clip.speed ?? 1) * 1000),
    cam: params.clip.camera ?? null,
    scope: params.clip.cinemascope ?? null,
    fx: params.clip.fx ?? null,
    flashIn: params.clip.flashIn ?? 0,
    beats: params.beatTimesInClip ?? [],
    w: params.width,
    h: params.height,
    fps: params.fps,
    q: params.qualityMode,
    vf: params.compiledVideoFilter,
  });
}

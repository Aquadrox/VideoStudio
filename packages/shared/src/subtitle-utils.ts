import { z } from 'zod';
import { formatSrtTimestamp, parseLrc } from './stage3-utils.js';

export const SubtitleCueSchema = z.object({
  id: z.string().min(1).max(80),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  text: z.string().max(1000),
  speaker: z.string().max(80).default(''),
});
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

export const SubtitlePositionSchema = z.enum(['bottom', 'middle', 'top']);
export type SubtitlePosition = z.infer<typeof SubtitlePositionSchema>;

export const SubtitleStyleSchema = z.object({
  fontSize: z.number().int().min(12).max(64).default(24),
  position: SubtitlePositionSchema.default('bottom'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
  backgroundOpacity: z.number().min(0).max(1).default(0.55),
});
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;

export const ProjectSubtitlesDtoSchema = z.object({
  projectId: z.string().uuid(),
  language: z.string().min(1).max(16).default('fr'),
  cues: z.array(SubtitleCueSchema),
  style: SubtitleStyleSchema,
  updatedAt: z.string(),
});
export type ProjectSubtitlesDto = z.infer<typeof ProjectSubtitlesDtoSchema>;

export const SaveProjectSubtitlesInputSchema = z.object({
  language: z.string().trim().min(1).max(16).optional(),
  cues: z.array(SubtitleCueSchema).max(2000),
  style: SubtitleStyleSchema.partial().optional(),
});
export type SaveProjectSubtitlesInput = z.infer<typeof SaveProjectSubtitlesInputSchema>;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 24,
  position: 'bottom',
  color: '#FFFFFF',
  outlineColor: '#000000',
  backgroundOpacity: 0.55,
};

function makeCueId(idx: number): string {
  return `cue-${idx + 1}-${Math.round(idx * 17 + 100)}`;
}

function parseClockTimestamp(raw: string): number | null {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      return Math.round((h * 3600 + m * 60 + s) * 1000) / 1000;
    }
  } else if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isFinite(m) && Number.isFinite(s)) {
      return Math.round((m * 60 + s) * 1000) / 1000;
    }
  }
  return null;
}

export function normalizeSubtitleCues(cues: SubtitleCue[]): SubtitleCue[] {
  return cues
    .map((cue, idx) => {
      const startSec = Math.max(0, Math.round(cue.startSec * 1000) / 1000);
      const endSec = Math.max(startSec + 0.1, Math.round(cue.endSec * 1000) / 1000);
      return {
        id: cue.id.trim() || makeCueId(idx),
        startSec,
        endSec,
        text: cue.text.replace(/\r\n/g, '\n').trim(),
        speaker: (cue.speaker ?? '').trim(),
      };
    })
    .filter((cue) => cue.text.length > 0)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

/**
 * Parses standard SRT or WebVTT subtitle content into normalized SubtitleCue[].
 */
export function parseSrtOrVtt(rawContent: string): SubtitleCue[] {
  const normalized = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0]!.trim()) || /^NOTE\b/i.test(lines[0]!.trim())) continue;

    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;

    const timingLine = lines[timingIdx]!;
    const [startRaw, endRest] = timingLine.split('-->');
    if (!startRaw || !endRest) continue;
    const endRaw = endRest.trim().split(/\s+/)[0] ?? '';

    const startSec = parseClockTimestamp(startRaw);
    const endSec = parseClockTimestamp(endRaw);
    if (startSec === null || endSec === null) continue;

    const bodyLines = lines.slice(timingIdx + 1);
    const rawText = bodyLines
      .join('\n')
      .replace(/<\/?(?:b|i|u|font|c)[^>]*>/gi, '')
      .trim();
    if (!rawText) continue;

    // Detect optional speaker prefix like "Elara: ..." or "<v Elara>..."
    let speaker = '';
    let text = rawText;
    const voiceMatch = /^<v\s+([^>]+)>([\s\S]*)$/i.exec(text);
    if (voiceMatch) {
      speaker = (voiceMatch[1] ?? '').trim();
      text = (voiceMatch[2] ?? '').trim();
    }

    cues.push({
      id: makeCueId(cues.length),
      startSec,
      endSec: Math.max(startSec + 0.1, endSec),
      text,
      speaker,
    });
  }

  return normalizeSubtitleCues(cues);
}

/**
 * Converts timed LRC (standard or Suno enhanced) lyrics into SubtitleCue[].
 */
export function cuesFromLrc(lrcText: string, defaultDurationSec = 3.2): SubtitleCue[] {
  const timed = parseLrc(lrcText);
  if (timed.length === 0) return [];

  const cues: SubtitleCue[] = timed.map((entry, idx) => {
    const next = timed[idx + 1];
    const endSec =
      next && next.timeSec > entry.timeSec
        ? Math.min(next.timeSec - 0.05, entry.timeSec + 8)
        : entry.timeSec + defaultDurationSec;
    return {
      id: makeCueId(idx),
      startSec: entry.timeSec,
      endSec: Math.max(entry.timeSec + 0.3, Math.round(endSec * 1000) / 1000),
      text: entry.text,
      speaker: '',
    };
  });

  return normalizeSubtitleCues(cues);
}

export function formatVttTimestamp(seconds: number): string {
  return formatSrtTimestamp(seconds).replace(',', '.');
}

export function serializeSrt(cues: SubtitleCue[]): string {
  const sorted = normalizeSubtitleCues(cues);
  return sorted
    .map((cue, idx) => {
      const body = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
      return `${idx + 1}\n${formatSrtTimestamp(cue.startSec)} --> ${formatSrtTimestamp(cue.endSec)}\n${body}`;
    })
    .join('\n\n');
}

export function serializeVtt(cues: SubtitleCue[]): string {
  const sorted = normalizeSubtitleCues(cues);
  const body = sorted
    .map((cue) => {
      const text = cue.speaker ? `<v ${cue.speaker}>${cue.text}` : cue.text;
      return `${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(cue.endSec)}\n${text}`;
    })
    .join('\n\n');
  return body ? `WEBVTT\n\n${body}\n` : 'WEBVTT\n';
}

/**
 * Returns active subtitle cues visible at playheadSec.
 */
export function findActiveSubtitleCues(cues: SubtitleCue[], playheadSec: number): SubtitleCue[] {
  return cues.filter((c) => playheadSec >= c.startSec && playheadSec <= c.endSec);
}

function hexToAssColor(hex: string, alpha01 = 1): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2) || 'FF';
  const g = clean.slice(2, 4) || 'FF';
  const b = clean.slice(4, 6) || 'FF';
  // ASS alpha: 00 = opaque, FF = fully transparent
  const aByte = Math.max(0, Math.min(255, Math.round((1 - alpha01) * 255)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${aByte}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

/**
 * Escapes an SRT file path and builds a safe FFmpeg subtitles video filter string.
 */
export function buildFfmpegSubtitleFilter(srtFilePath: string, styleInput?: Partial<SubtitleStyle>): string {
  const style: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    ...(styleInput ?? {}),
  };

  const escapedPath = srtFilePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

  // ASS Alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2;
  const primaryColour = hexToAssColor(style.color, 1);
  const outlineColour = hexToAssColor(style.outlineColor, 1);
  const backColour = hexToAssColor('#000000', style.backgroundOpacity);
  const borderStyle = style.backgroundOpacity > 0.05 ? 3 : 1;

  const forceStyle = [
    `FontName=DejaVu Sans`,
    `FontSize=${style.fontSize}`,
    `Alignment=${alignment}`,
    `PrimaryColour=${primaryColour}`,
    `OutlineColour=${outlineColour}`,
    `BackColour=${backColour}`,
    `BorderStyle=${borderStyle}`,
    `Outline=2`,
    `Shadow=0`,
    `MarginV=28`,
  ].join(',');

  return `subtitles='${escapedPath}':force_style='${forceStyle}'`;
}

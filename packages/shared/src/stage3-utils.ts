import type { YouTubeChapter } from './stage3-schemas.js';

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  text: string;
}

/**
 * Computes a clean LCS-based line diff between two script versions.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split(/\r?\n/);
  const b = newText === '' ? [] : newText.split(/\r?\n/);
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ type: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ type: 'removed', text: a[i]! });
    i += 1;
  }
  while (j < n) {
    out.push({ type: 'added', text: b[j]! });
    j += 1;
  }
  return out;
}

export interface TimedLyricWord {
  timeSec: number;
  word: string;
}

export interface TimedLyricLine {
  timeSec: number;
  text: string;
  words?: TimedLyricWord[];
}

function parseTimestampParts(minsStr: string, secsStr: string, fracRaw = '0'): number {
  const mins = Number(minsStr);
  const secs = Number(secsStr);
  const millis = Number(fracRaw.padEnd(3, '0').slice(0, 3));
  return Math.round((mins * 60 + secs + millis / 1000) * 1000) / 1000;
}

/**
 * Parses standard LRC (`[00:12.50] Neon rain`) AND Enhanced word-level LRC
 * (`[00:12.50] <00:12.50>Neon <00:12.90>rain <00:13.30>falls`).
 */
export function parseLrc(lrcText: string): TimedLyricLine[] {
  const lines = lrcText.split(/\r?\n/);
  const result: TimedLyricLine[] = [];
  const tagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const wordTagRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>\s*([^<\r\n]+)/g;

  for (const line of lines) {
    const matches = Array.from(line.matchAll(tagRegex));
    if (matches.length === 0) continue;
    const rawBody = line.replace(tagRegex, '').trim();
    if (!rawBody) continue;

    const wordMatches = Array.from(rawBody.matchAll(wordTagRegex));
    let words: TimedLyricWord[] | undefined;
    let cleanText = rawBody;
    if (wordMatches.length > 0) {
      words = wordMatches
        .map((wm) => ({
          timeSec: parseTimestampParts(wm[1]!, wm[2]!, wm[3]),
          word: (wm[4] ?? '').trim(),
        }))
        .filter((w) => w.word.length > 0);
      cleanText = words.map((w) => w.word).join(' ').trim();
    }
    if (!cleanText) continue;

    for (const m of matches) {
      const timeSec = parseTimestampParts(m[1]!, m[2]!, m[3]);
      result.push(words ? { timeSec, text: cleanText, words } : { timeSec, text: cleanText });
    }
  }

  return result.sort((a, b) => a.timeSec - b.timeSec);
}

export interface SunoAlignedWord {
  word: string;
  start_s: number;
  end_s?: number;
}

function formatLrcStamp(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const mins = Math.floor(totalCs / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Converts a Suno word-level alignment array (`[{ word, start_s, end_s }]`) into Enhanced LRC (`[mm:ss.xx] <mm:ss.xx>word ...`).
 */
export function sunoAlignmentToEnhancedLrc(alignedWords: SunoAlignedWord[]): string {
  if (alignedWords.length === 0) return '';
  const lines: SunoAlignedWord[][] = [[]];

  for (const entry of alignedWords) {
    const rawWord = entry.word ?? '';
    const hasNewline = rawWord.includes('\n');
    const clean = rawWord.replace(/\r?\n/g, ' ').trim();
    if (clean) {
      lines[lines.length - 1]!.push({ ...entry, word: clean });
    }
    if (hasNewline && lines[lines.length - 1]!.length > 0) {
      lines.push([]);
    }
  }

  return lines
    .filter((group) => group.length > 0)
    .map((group) => {
      const lineStart = formatLrcStamp(group[0]!.start_s);
      const body = group.map((w) => `<${formatLrcStamp(w.start_s)}>${w.word}`).join(' ');
      return `[${lineStart}] ${body}`;
    })
    .join('\n');
}

export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hrs = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Converts timed LRC (standard or enhanced word-level) lyrics into standard SRT subtitles.
 */
export function lrcToSrt(lrcText: string, defaultLineDurationSec = 3.5): string {
  const timed = parseLrc(lrcText);
  if (timed.length === 0) return '';

  return timed
    .map((entry, idx) => {
      const next = timed[idx + 1];
      const endSec =
        next && next.timeSec > entry.timeSec
          ? Math.min(next.timeSec, entry.timeSec + 10)
          : entry.timeSec + defaultLineDurationSec;
      return `${idx + 1}\n${formatSrtTimestamp(entry.timeSec)} --> ${formatSrtTimestamp(endSec)}\n${entry.text}`;
    })
    .join('\n\n');
}

export function formatYoutubeTimestamp(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats chapters for a YouTube description and validates YouTube's chapter rules.
 */
export function formatYoutubeChapters(chapters: YouTubeChapter[]): {
  text: string;
  warnings: string[];
} {
  const sorted = [...chapters].sort((a, b) => a.timeSec - b.timeSec);
  const warnings: string[] = [];

  if (sorted.length > 0 && sorted[0]!.timeSec !== 0) {
    warnings.push('Le premier chapitre YouTube doit commencer à 00:00.');
  }
  if (sorted.length > 0 && sorted.length < 3) {
    warnings.push('YouTube exige au moins 3 chapitres pour afficher le découpage.');
  }

  const text = sorted
    .map((ch) => `${formatYoutubeTimestamp(ch.timeSec)} ${ch.title.trim()}`)
    .join('\n');

  return { text, warnings };
}

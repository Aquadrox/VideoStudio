import { describe, expect, it } from 'vitest';
import {
  buildFfmpegSubtitleFilter,
  cuesFromLrc,
  findActiveSubtitleCues,
  parseSrtOrVtt,
  serializeSrt,
  serializeVtt,
} from './subtitle-utils.js';

describe('subtitle-utils', () => {
  it('parses SRT and serializes back cleanly', () => {
    const srt = `1
00:00:01,500 --> 00:00:04,250
Bonjour la taverne.

2
00:00:05,000 --> 00:00:07,500
Elara ouvre la porte.`;

    const cues = parseSrtOrVtt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.startSec).toBe(1.5);
    expect(cues[0]!.endSec).toBe(4.25);
    expect(cues[0]!.text).toBe('Bonjour la taverne.');

    const out = serializeSrt(cues);
    expect(out).toContain('00:00:01,500 --> 00:00:04,250');
    expect(out).toContain('Elara ouvre la porte.');
  });

  it('parses WebVTT with speaker voice tags and serializes VTT', () => {
    const vtt = `WEBVTT

00:02.000 --> 00:04.500
<v Elara>Où est la clé ?`;

    const cues = parseSrtOrVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.speaker).toBe('Elara');
    expect(cues[0]!.text).toBe('Où est la clé ?');

    const serialized = serializeVtt(cues);
    expect(serialized.startsWith('WEBVTT')).toBe(true);
    expect(serialized).toContain('<v Elara>Où est la clé ?');
  });

  it('converts LRC lyrics to subtitle cues and finds active cues', () => {
    const lrc = `[00:01.00] Sous la pluie froide
[00:04.50] La lanterne s'allume`;
    const cues = cuesFromLrc(lrc);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.startSec).toBe(1);
    expect(cues[0]!.endSec).toBeLessThanOrEqual(4.5);

    expect(findActiveSubtitleCues(cues, 2.0)).toHaveLength(1);
    expect(findActiveSubtitleCues(cues, 2.0)[0]!.text).toBe('Sous la pluie froide');
    expect(findActiveSubtitleCues(cues, 0.2)).toHaveLength(0);
  });

  it('builds escaped FFmpeg subtitles burn-in filter', () => {
    const filter = buildFfmpegSubtitleFilter("/tmp/render's/sub:1.srt", {
      fontSize: 28,
      position: 'top',
      color: '#F5B84B',
      backgroundOpacity: 0.6,
    });
    expect(filter).toContain("subtitles='/tmp/render\\'s/sub\\:1.srt'");
    expect(filter).toContain('FontSize=28');
    expect(filter).toContain('Alignment=8');
    expect(filter).toContain('BorderStyle=3');
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeLineDiff,
  formatYoutubeChapters,
  lrcToSrt,
  parseLrc,
  sunoAlignmentToEnhancedLrc,
} from './stage3-utils.js';

describe('computeLineDiff', () => {
  it('detects context, removed, and added lines cleanly', () => {
    const diff = computeLineDiff('INT. LABO - NUIT\nElena regarde la pluie.', 'INT. LABO - NUIT\nElena ouvre la fenêtre.\nLa pluie tombe.');
    expect(diff).toEqual([
      { type: 'context', text: 'INT. LABO - NUIT' },
      { type: 'removed', text: 'Elena regarde la pluie.' },
      { type: 'added', text: 'Elena ouvre la fenêtre.' },
      { type: 'added', text: 'La pluie tombe.' },
    ]);
  });
});

describe('LRC lyrics parser & SRT converter', () => {
  it('parses LRC timestamps and exports valid SRT subtitles', () => {
    const lrc = `[00:00.50] Néon sous la pluie\n[00:04.25] Les ombres s'allument`;
    const parsed = parseLrc(lrc);
    expect(parsed).toEqual([
      { timeSec: 0.5, text: 'Néon sous la pluie' },
      { timeSec: 4.25, text: "Les ombres s'allument" },
    ]);

    const srt = lrcToSrt(lrc, 3);
    expect(srt).toContain('1\n00:00:00,500 --> 00:00:04,250\nNéon sous la pluie');
    expect(srt).toContain("2\n00:00:04,250 --> 00:00:07,250\nLes ombres s'allument");
  });

  it('parses word-level Enhanced LRC (<mm:ss.xx>) and converts Suno alignment JSON', () => {
    const enhanced = sunoAlignmentToEnhancedLrc([
      { word: 'Néon', start_s: 0.5, end_s: 0.9 },
      { word: 'rouge\n', start_s: 1.0, end_s: 1.4 },
      { word: 'pluie', start_s: 2.25, end_s: 2.8 },
    ]);
    expect(enhanced).toBe('[00:00.50] <00:00.50>Néon <00:01.00>rouge\n[00:02.25] <00:02.25>pluie');

    const parsed = parseLrc(enhanced);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.text).toBe('Néon rouge');
    expect(parsed[0]?.words).toEqual([
      { timeSec: 0.5, word: 'Néon' },
      { timeSec: 1, word: 'rouge' },
    ]);
    expect(parsed[1]?.words).toEqual([{ timeSec: 2.25, word: 'pluie' }]);
  });
});

describe('formatYoutubeChapters', () => {
  it('formats sorted chapters and flags missing 00:00 or < 3 chapters', () => {
    const valid = formatYoutubeChapters([
      { timeSec: 0, title: 'Intro' },
      { timeSec: 45, title: 'Création du décor' },
      { timeSec: 125, title: 'Rendu final 4K' },
    ]);
    expect(valid.warnings).toEqual([]);
    expect(valid.text).toBe('00:00 Intro\n00:45 Création du décor\n02:05 Rendu final 4K');

    const invalid = formatYoutubeChapters([
      { timeSec: 10, title: 'Début tardif' },
      { timeSec: 60, title: 'Suite' },
    ]);
    expect(invalid.warnings).toHaveLength(2);
  });
});

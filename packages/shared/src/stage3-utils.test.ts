import { describe, expect, it } from 'vitest';
import {
  computeLineDiff,
  formatYoutubeChapters,
  lrcToSrt,
  parseLrc,
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

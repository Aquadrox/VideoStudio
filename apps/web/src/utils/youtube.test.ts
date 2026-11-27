import { describe, expect, it } from 'vitest';
import type { SceneDto } from '@videostudio/shared';
import { analyzeYoutubeTitle, buildChaptersFromStoryboard } from './youtube';

describe('YouTube packaging helpers', () => {
  it('analyzes title length against YouTube 60-char mobile & 100-char hard limits', () => {
    expect(analyzeYoutubeTitle('Court titre accrocheur')).toEqual({
      length: 22,
      exceedsMax: false,
      truncatesOnMobile: false,
    });

    const medium = 'A'.repeat(68);
    expect(analyzeYoutubeTitle(medium)).toEqual({
      length: 68,
      exceedsMax: false,
      truncatesOnMobile: true,
    });

    const tooLong = 'B'.repeat(105);
    expect(analyzeYoutubeTitle(tooLong)).toEqual({
      length: 105,
      exceedsMax: true,
      truncatesOnMobile: true,
    });
  });

  it('builds sequential YouTube chapters starting at 00:00 from storyboard scenes', () => {
    const scenes = [
      {
        id: 's1',
        sceneNumber: 1,
        title: 'Intro néon',
        shots: [{ durationSec: 5 }, { durationSec: 10 }],
      },
      {
        id: 's2',
        sceneNumber: 2,
        title: 'Rencontre au labo',
        shots: [{ durationSec: 20 }],
      },
      {
        id: 's3',
        sceneNumber: 3,
        title: 'Conclusion',
        shots: [],
      },
    ] as unknown as SceneDto[];

    expect(buildChaptersFromStoryboard(scenes)).toEqual([
      { timeSec: 0, title: 'Intro néon' },
      { timeSec: 15, title: 'Rencontre au labo' },
      { timeSec: 35, title: 'Conclusion' },
    ]);
  });
});

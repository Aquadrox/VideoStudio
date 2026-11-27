import type { SceneDto, YouTubeChapter } from '@videostudio/shared';

export interface TitleAnalysis {
  length: number;
  exceedsMax: boolean;
  truncatesOnMobile: boolean;
}

export function analyzeYoutubeTitle(title: string): TitleAnalysis {
  const length = title.trim().length;
  return {
    length,
    exceedsMax: length > 100,
    truncatesOnMobile: length > 60,
  };
}

/**
 * Generates sequential YouTube chapters starting at 00:00 by accumulating
 * scene shot durations from the project storyboard.
 */
export function buildChaptersFromStoryboard(scenes: SceneDto[]): YouTubeChapter[] {
  const chapters: YouTubeChapter[] = [];
  let cursorSec = 0;

  for (const scene of scenes) {
    chapters.push({
      timeSec: Math.round(cursorSec),
      title: scene.title.trim() || `Scène ${scene.sceneNumber}`,
    });
    const sceneDuration = scene.shots.reduce((sum, shot) => sum + (shot.durationSec || 0), 0);
    cursorSec += sceneDuration > 0 ? sceneDuration : 10;
  }

  return chapters;
}

import { describe, expect, it } from 'vitest';
import {
  buildScenePlanTemplate,
  createEmptySketchScene,
  createWhiteboardSketchScene,
  generateAiDirectorBrief,
  getCanvasDimensionsForAspectRatio,
  getFocalLengthFovDeg,
  isLightCanvasColor,
  sortSketchesForBoard,
} from './sketch-utils.js';

describe('sketch-utils', () => {
  it('computes accurate cinema focal length FOV angles', () => {
    expect(getFocalLengthFovDeg(24)).toBeGreaterThan(70);
    expect(getFocalLengthFovDeg(50)).toBeCloseTo(40, 0);
    expect(getFocalLengthFovDeg(85)).toBeLessThan(28);
    // Clamping extremes
    expect(getFocalLengthFovDeg(4)).toBe(getFocalLengthFovDeg(12));
    expect(getFocalLengthFovDeg(500)).toBe(getFocalLengthFovDeg(200));
  });

  it('returns matching export dimensions for aspect ratios', () => {
    expect(getCanvasDimensionsForAspectRatio('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(getCanvasDimensionsForAspectRatio('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(getCanvasDimensionsForAspectRatio('1:1')).toEqual({ width: 1280, height: 1280 });
    expect(getCanvasDimensionsForAspectRatio('2.39:1')).toEqual({ width: 1920, height: 804 });
  });

  it('synthesizes a rich AI Director Brief from blocking diagrams', () => {
    const { mode, scene } = buildScenePlanTemplate('dialogue_180', ['Elara', 'Wren']);
    const brief = generateAiDirectorBrief(scene, {
      title: 'S04 — Confrontation taverne',
      mode,
      aspectRatio: '16:9',
    });

    expect(brief).toContain('PLAN DE SCÈNE (BLOCKING)');
    expect(brief).toContain('S04 — Confrontation taverne');
    expect(brief).toContain('Cam A (OTS)');
    expect(brief).toContain('50mm');
    expect(brief).toContain('Elara');
    expect(brief).toContain('Wren');
    expect(brief).toContain('RÈGLE DES 180°');
    expect(brief).toContain('Key Light');
    expect(brief).toContain('Table');
  });

  it('includes movement arrows, zoom indicators, and freehand strokes in AI brief', () => {
    const scene = createEmptySketchScene('storyboard_sketch');
    scene.arrows.push({
      id: 'arr-1',
      target: 'character',
      label: 'Court vers la sortie',
      x1: 0.2,
      y1: 0.5,
      x2: 0.85,
      y2: 0.5,
      color: '#38bdf8',
      dashed: false,
      width: 4,
    });
    scene.shapes.push({
      id: 'zoom-1',
      kind: 'zoom_in',
      x1: 0.3,
      y1: 0.3,
      x2: 0.7,
      y2: 0.7,
      color: '#e5a038',
      width: 3,
      fill: false,
      dashed: false,
    });
    scene.strokes.push({
      id: 'st-1',
      tool: 'pen',
      color: '#ffffff',
      width: 3,
      opacity: 1,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.2 },
      ],
    });
    scene.underlay = { assetId: 'asset-1', assetRef: '@img-012', opacity: 0.5 };

    const brief = generateAiDirectorBrief(scene, {
      title: 'Croquis poursuite',
      mode: 'storyboard_sketch',
      aspectRatio: '16:9',
    });

    expect(brief).toContain('CROQUIS STORYBOARD');
    expect(brief).toContain('Court vers la sortie');
    expect(brief).toContain('vers la droite');
    expect(brief).toContain('Zoom avant (Push-in)');
    expect(brief).toContain('@img-012');
    expect(brief).toContain('1 tracé(s)');
  });

  it('supports whiteboard paper scenes, light color detection, and storyboard ordering', () => {
    const wb = createWhiteboardSketchScene('#ffffff');
    expect(wb.backgroundColor).toBe('#ffffff');
    expect(isLightCanvasColor('#ffffff')).toBe(true);
    expect(isLightCanvasColor('#f8f4e8')).toBe(true);
    expect(isLightCanvasColor('#131720')).toBe(false);

    const sorted = sortSketchesForBoard([
      { id: 'c', inSketchBoard: true, boardOrder: 2, createdAt: '2026-11-27T10:00:00Z' },
      { id: 'hidden', inSketchBoard: false, boardOrder: 0, createdAt: '2026-11-27T09:00:00Z' },
      { id: 'a', inSketchBoard: true, boardOrder: 0, createdAt: '2026-11-27T11:00:00Z' },
      { id: 'b', inSketchBoard: true, boardOrder: 1, createdAt: '2026-11-27T10:30:00Z' },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

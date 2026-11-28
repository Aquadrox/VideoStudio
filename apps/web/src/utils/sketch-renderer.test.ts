import { describe, expect, it } from 'vitest';
import { buildScenePlanTemplate } from '@videostudio/shared';
import {
  eraseStrokesNearPoint,
  getRotationHandlePos,
  hitTestSketchScene,
} from './sketch-renderer';

describe('sketch-renderer helpers', () => {
  it('hit-tests cameras, characters, arrows, and props accurately', () => {
    const { scene } = buildScenePlanTemplate('dolly_approach', ['Elara']);

    const hitHero = hitTestSketchScene(scene, 0.5, 0.32, 1280, 720);
    expect(hitHero).toEqual({ kind: 'character', id: 'char-hero' });

    const hitCam = hitTestSketchScene(scene, 0.5, 0.78, 1280, 720);
    expect(hitCam).toEqual({ kind: 'camera', id: 'cam-dolly' });

    const hitArrow = hitTestSketchScene(scene, 0.5, 0.58, 1280, 720);
    expect(hitArrow).toEqual({ kind: 'arrow', id: 'arr-dolly' });

    const hitEmpty = hitTestSketchScene(scene, 0.05, 0.05, 1280, 720);
    expect(hitEmpty).toBeNull();
  });

  it('computes rotation handle along the element aiming angle', () => {
    const { scene } = buildScenePlanTemplate('dolly_approach', ['Elara']);
    // cam-dolly is at (0.5, 0.78) pointing straight up (-90 deg)
    const handle = getRotationHandlePos(
      scene,
      { kind: 'camera', id: 'cam-dolly' },
      1280,
      720,
    );
    expect(handle).not.toBeNull();
    expect(handle!.x).toBeCloseTo(0.5, 3);
    expect(handle!.y).toBeLessThan(0.78);
  });

  it('erases only freehand strokes intersecting the eraser radius', () => {
    const strokes = [
      {
        id: 's1',
        tool: 'pen' as const,
        color: '#ffffff',
        width: 3,
        opacity: 1,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.15, y: 0.15 },
        ],
      },
      {
        id: 's2',
        tool: 'pen' as const,
        color: '#e5a038',
        width: 3,
        opacity: 1,
        points: [
          { x: 0.8, y: 0.8 },
          { x: 0.85, y: 0.82 },
        ],
      },
    ];
    const remaining = eraseStrokesNearPoint(strokes, 0.14, 0.14, 0.03);
    expect(remaining.map((s) => s.id)).toEqual(['s2']);
  });
});

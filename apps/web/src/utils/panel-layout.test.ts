import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  DEFAULT_PANEL_LAYOUT,
  LEFT_PANEL_MAX_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
  parseStoredPanelLayout,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from './panel-layout';

describe('panel-layout utilities', () => {
  it('clamps left and right widths within min/max bounds and preserves center space', () => {
    expect(clampPanelWidth('left', 100, 1600, 372)).toBe(LEFT_PANEL_MIN_WIDTH);
    expect(clampPanelWidth('left', 900, 1600, 372)).toBe(LEFT_PANEL_MAX_WIDTH);
    expect(clampPanelWidth('left', 320, 1600, 372)).toBe(320);

    expect(clampPanelWidth('right', 120, 1600, 268)).toBe(RIGHT_PANEL_MIN_WIDTH);
    expect(clampPanelWidth('right', 1200, 1600, 268)).toBe(RIGHT_PANEL_MAX_WIDTH);

    // Narrow viewport forces panel max down so center workspace retains >= 360px
    expect(clampPanelWidth('right', 600, 1000, 268)).toBe(372);
  });

  it('safely parses and sanitizes stored JSON layout state', () => {
    expect(parseStoredPanelLayout(null)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(parseStoredPanelLayout('not-json')).toEqual(DEFAULT_PANEL_LAYOUT);

    expect(
      parseStoredPanelLayout(
        JSON.stringify({ leftWidth: 310, rightWidth: 450, leftOpen: false, rightOpen: true }),
      ),
    ).toEqual({
      leftWidth: 310,
      rightWidth: 450,
      leftOpen: false,
      rightOpen: true,
    });

    // Out-of-range values are clamped
    expect(
      parseStoredPanelLayout(
        JSON.stringify({ leftWidth: 10, rightWidth: 9999, leftOpen: true, rightOpen: false }),
      ),
    ).toEqual({
      leftWidth: LEFT_PANEL_MIN_WIDTH,
      rightWidth: RIGHT_PANEL_MAX_WIDTH,
      leftOpen: true,
      rightOpen: false,
    });
  });
});

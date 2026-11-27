export const LEFT_PANEL_DEFAULT_WIDTH = 268;
export const LEFT_PANEL_MIN_WIDTH = 190;
export const LEFT_PANEL_MAX_WIDTH = 480;

export const RIGHT_PANEL_DEFAULT_WIDTH = 372;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 680;

export const CENTER_WORKSPACE_MIN_WIDTH = 360;

export interface PanelLayoutState {
  leftWidth: number;
  rightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  leftWidth: LEFT_PANEL_DEFAULT_WIDTH,
  rightWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  leftOpen: true,
  rightOpen: true,
};

/**
 * Clamps a requested sidebar/inspector width within safe min/max bounds while
 * always preserving at least `CENTER_WORKSPACE_MIN_WIDTH` for the center workspace.
 */
export function clampPanelWidth(
  side: 'left' | 'right',
  requestedWidth: number,
  viewportWidth: number,
  otherPanelOccupiedWidth: number,
): number {
  const min = side === 'left' ? LEFT_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
  const hardMax = side === 'left' ? LEFT_PANEL_MAX_WIDTH : RIGHT_PANEL_MAX_WIDTH;
  const availableMax = Math.max(
    min,
    Math.min(hardMax, viewportWidth - otherPanelOccupiedWidth - CENTER_WORKSPACE_MIN_WIDTH),
  );
  const rounded = Math.round(requestedWidth);
  return Math.max(min, Math.min(availableMax, rounded));
}

export function parseStoredPanelLayout(raw: string | null | undefined): PanelLayoutState {
  if (!raw) return { ...DEFAULT_PANEL_LAYOUT };
  try {
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    const leftWidth =
      typeof parsed.leftWidth === 'number' && Number.isFinite(parsed.leftWidth)
        ? Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, Math.round(parsed.leftWidth)))
        : LEFT_PANEL_DEFAULT_WIDTH;
    const rightWidth =
      typeof parsed.rightWidth === 'number' && Number.isFinite(parsed.rightWidth)
        ? Math.max(
            RIGHT_PANEL_MIN_WIDTH,
            Math.min(RIGHT_PANEL_MAX_WIDTH, Math.round(parsed.rightWidth)),
          )
        : RIGHT_PANEL_DEFAULT_WIDTH;
    return {
      leftWidth,
      rightWidth,
      leftOpen: typeof parsed.leftOpen === 'boolean' ? parsed.leftOpen : true,
      rightOpen: typeof parsed.rightOpen === 'boolean' ? parsed.rightOpen : true,
    };
  } catch {
    return { ...DEFAULT_PANEL_LAYOUT };
  }
}

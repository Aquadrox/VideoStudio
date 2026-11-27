/**
 * Normalizes a pointer click position inside a media container into clamped [0..1] coordinates.
 */
export function normalizeMediaCoordinates(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0.5, y: 0.5 };
  }
  const rawX = (clientX - rect.left) / rect.width;
  const rawY = (clientY - rect.top) / rect.height;
  return {
    x: Math.round(Math.max(0, Math.min(1, rawX)) * 10000) / 10000,
    y: Math.round(Math.max(0, Math.min(1, rawY)) * 10000) / 10000,
  };
}

/**
 * Converts a video playback timestamp in seconds into a frame number.
 */
export function timecodeToFrame(timecodeSec: number, fps: number | null): number {
  const effectiveFps = fps && fps > 0 ? fps : 24;
  return Math.max(0, Math.round(timecodeSec * effectiveFps));
}

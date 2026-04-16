export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Compute frame slice rects for a horizontal sprite sheet.
 * The sheet is assumed to be N square frames laid out left-to-right.
 * Throws if width is not an integer multiple of height.
 */
export function frameRects(width: number, height: number): FrameRect[] {
  if (width % height !== 0) {
    throw new Error(`Sprite sheet width/height ratio must be integer; got ${width}x${height}`);
  }
  const frameCount = width / height;
  const rects: FrameRect[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    rects.push({ x: i * height, y: 0, w: height, h: height });
  }
  return rects;
}

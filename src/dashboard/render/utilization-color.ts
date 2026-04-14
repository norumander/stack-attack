/**
 * Maps a 0..1 utilization value to an RGB color in the
 * green → yellow → red gradient. Values outside [0, 1] clamp.
 *
 * Gradient anchors:
 *   0.0 → #22c55e (green — healthy)
 *   0.7 → #fbbf24 (yellow — under stress)
 *   1.0 → #ef4444 (red — saturated)
 *
 * The component fill color encodes component HEALTH/utilization. Per-request
 * success/failure feedback uses an out-of-band expanding ring pulse (see
 * PixiTopologyRenderer.flashResponded / flashDrop) so it stays legible
 * regardless of the underlying utilization color.
 *
 * Returns a 24-bit integer (0xRRGGBB) suitable for Pixi's Graphics.fill().
 */
export function utilizationColor(utilization: number): number {
  if (utilization <= 0) return 0x22c55e;
  if (utilization >= 1) return 0xef4444;

  const GREEN = [0x22, 0xc5, 0x5e] as const;
  const YELLOW = [0xfb, 0xbf, 0x24] as const;
  const RED = [0xef, 0x44, 0x44] as const;

  if (utilization <= 0.7) {
    const t = utilization / 0.7;
    return packRgb(
      lerp(GREEN[0], YELLOW[0], t),
      lerp(GREEN[1], YELLOW[1], t),
      lerp(GREEN[2], YELLOW[2], t),
    );
  }
  const t = (utilization - 0.7) / 0.3;
  return packRgb(
    lerp(YELLOW[0], RED[0], t),
    lerp(YELLOW[1], RED[1], t),
    lerp(YELLOW[2], RED[2], t),
  );
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

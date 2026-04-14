/**
 * Maps a 0..1 utilization value to an RGB color in the
 * gray → green → yellow → red gradient. Values outside [0, 1] clamp.
 *
 * Gradient anchors:
 *   0.0 → #94a3b8 (slate-400, idle/dormant)
 *   0.3 → #22c55e (green, healthy under light load)
 *   0.7 → #fbbf24 (yellow, under stress)
 *   1.0 → #ef4444 (red, saturated)
 *
 * Why gray at 0: the Stage 3c renderer also overlays a transient green
 * "responded" flash on top of the sprite. A green idle base would render
 * that flash invisibly (green-on-green). Gray gives the flash contrast.
 *
 * Returns a 24-bit integer (0xRRGGBB) suitable for Pixi's Graphics.fill().
 */
export function utilizationColor(utilization: number): number {
  if (utilization <= 0) return 0x94a3b8;
  if (utilization >= 1) return 0xef4444;

  const GRAY = [0x94, 0xa3, 0xb8] as const;
  const GREEN = [0x22, 0xc5, 0x5e] as const;
  const YELLOW = [0xfb, 0xbf, 0x24] as const;
  const RED = [0xef, 0x44, 0x44] as const;

  if (utilization <= 0.3) {
    // gray → green over [0, 0.3]
    const t = utilization / 0.3;
    return packRgb(
      lerp(GRAY[0], GREEN[0], t),
      lerp(GRAY[1], GREEN[1], t),
      lerp(GRAY[2], GREEN[2], t),
    );
  }
  if (utilization <= 0.7) {
    // green → yellow over [0.3, 0.7]
    const t = (utilization - 0.3) / 0.4;
    return packRgb(
      lerp(GREEN[0], YELLOW[0], t),
      lerp(GREEN[1], YELLOW[1], t),
      lerp(GREEN[2], YELLOW[2], t),
    );
  }
  // yellow → red over [0.7, 1.0]
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

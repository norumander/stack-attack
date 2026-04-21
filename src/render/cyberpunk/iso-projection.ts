import { CYBERPUNK_TOKENS } from "./tokens.js";

/**
 * Offset from the iso lattice pivot to the visual tile center.
 *
 * The pico-8 tile PNGs (tile_dark/tile_light, 64×64) are anchored at
 * y=0.4 in board.ts, but the rendered diamond's visual center sits ~17px
 * below that pivot (scaled by tileScale=1.25 → ~21px world). The 15 used
 * historically was hand-tuned by eye; keeping 15 preserves the current
 * on-screen alignment that the tiles and sprites were visually tuned to.
 *
 * Baking this into gridToWorld makes the projection return the visual
 * tile center directly, so every caller (components, connections,
 * placement ghost, selection ring, hit-test) operates on one consistent
 * reference point instead of each patching in its own +15.
 */
const TILE_VISUAL_Y_OFFSET = 15;

/** Forward projection: grid (x, y) → world (x, y) at the visual tile center. */
export function gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: (gridX - gridY) * CYBERPUNK_TOKENS.scale.isoHalfWidth,
    y: (gridX + gridY) * CYBERPUNK_TOKENS.scale.isoHalfHeight + TILE_VISUAL_Y_OFFSET,
  };
}

/** Inverse projection: world (x, y) at the visual tile center → grid (x, y). */
export function worldToGrid(worldX: number, worldY: number): { x: number; y: number } {
  const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
  const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
  const y = worldY - TILE_VISUAL_Y_OFFSET;
  return {
    x: Math.round((worldX / halfW + y / halfH) / 2),
    y: Math.round((y / halfH - worldX / halfW) / 2),
  };
}

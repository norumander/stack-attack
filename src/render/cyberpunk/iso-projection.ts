import { CYBERPUNK_TOKENS } from "./tokens.js";

/** Forward projection: grid (x, y) → world (x, y) before world-center offset. */
export function gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: (gridX - gridY) * CYBERPUNK_TOKENS.scale.isoHalfWidth,
    y: (gridX + gridY) * CYBERPUNK_TOKENS.scale.isoHalfHeight,
  };
}

/** Inverse projection: world (x, y) relative to origin → grid (x, y). */
export function worldToGrid(worldX: number, worldY: number): { x: number; y: number } {
  const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
  const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
  return {
    x: Math.round((worldX / halfW + worldY / halfH) / 2),
    y: Math.round((worldY / halfH - worldX / halfW) / 2),
  };
}

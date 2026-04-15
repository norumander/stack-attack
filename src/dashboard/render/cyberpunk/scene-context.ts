/**
 * Shared state passed to each sub-layer. Allows sub-modules to query the
 * current world-center offset (which changes on resize) without owning it.
 */
export interface SceneContext {
  getWorldCenter(): { x: number; y: number };
  /** Forward: grid → screen = world + worldCenter. */
  gridToScreen(gridX: number, gridY: number): { x: number; y: number };
  /** Inverse: screen → grid. */
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };
}

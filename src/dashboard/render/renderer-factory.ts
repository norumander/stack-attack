import type { TopologyRenderer } from "./topology-renderer.js";
import { PixiTopologyRenderer } from "./pixi-topology-renderer.js";
import { CyberpunkTopologyRenderer } from "./cyberpunk-topology-renderer.js";

/**
 * Picks a renderer based on the URL query string.
 *
 * `?renderer=iso` → CyberpunkTopologyRenderer.
 * Anything else (including absent) → classic PixiTopologyRenderer.
 */
export function createRenderer(): TopologyRenderer {
  const params = new URLSearchParams(window.location.search);
  if (params.get("renderer") === "iso") {
    return new CyberpunkTopologyRenderer();
  }
  return new PixiTopologyRenderer();
}

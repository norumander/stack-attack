import { Container, Sprite } from "pixi.js";
import { gridToWorld, worldToGrid } from "./iso-projection.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import type { ComponentTextureMap } from "./component-layer.js";

export interface PlacementGhost {
  readonly container: Container;
  set(
    type: string | null,
    screenPos: { x: number; y: number } | null,
    worldCenterX: number,
    worldCenterY: number,
  ): void;
}

export function createPlacementGhost(textures: ComponentTextureMap): PlacementGhost {
  const container = new Container();
  let currentSprite: Sprite | null = null;
  let currentType: string | null = null;

  const set = (
    type: string | null,
    screenPos: { x: number; y: number } | null,
    worldCenterX: number,
    worldCenterY: number,
  ): void => {
    if (type === null || screenPos === null) {
      if (currentSprite) {
        container.removeChild(currentSprite);
        currentSprite.destroy();
        currentSprite = null;
      }
      currentType = null;
      return;
    }

    if (type !== currentType || !currentSprite) {
      if (currentSprite) {
        container.removeChild(currentSprite);
        currentSprite.destroy();
      }
      const split = textures[type] ?? textures.client!;
      // Ghost uses only the base layer tinted ghost-cyan — keeps it legible
      // and avoids the double-tint from stacking base + highlight.
      currentSprite = new Sprite(split.base);
      currentSprite.anchor.set(0.5, 0.75);
      currentSprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);
      currentSprite.alpha = 0.55;
      currentSprite.tint = CYBERPUNK_TOKENS.palette.ghost;
      container.addChild(currentSprite);
      currentType = type;
    }

    const grid = worldToGrid(screenPos.x - worldCenterX, screenPos.y - worldCenterY);
    const world = gridToWorld(grid.x, grid.y);
    currentSprite.x = world.x;
    currentSprite.y = world.y;
  };

  return { container, set };
}

import { Assets, Container, Sprite, Texture } from "pixi.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

const TILE_DARK_URL = new URL("../../assets/tile_dark.png", import.meta.url).href;
const TILE_LIGHT_URL = new URL("../../assets/tile_light.png", import.meta.url).href;

export interface BoardTextures {
  readonly dark: Texture;
  readonly light: Texture;
}

export async function loadBoardTextures(): Promise<BoardTextures> {
  const [dark, light] = await Promise.all([
    Assets.load<Texture>(TILE_DARK_URL),
    Assets.load<Texture>(TILE_LIGHT_URL),
  ]);
  dark.source.scaleMode = "nearest";
  light.source.scaleMode = "nearest";
  return { dark, light };
}

/**
 * Builds a finite N×N iso board into the given container. Grid (0, 0) is the
 * geometric center of the board. Call rebuild() to redraw (e.g. after resize).
 *
 * The container attaches to the renderer's `world` container which is
 * already offset to canvas center — so tile positions are in pre-offset world
 * coords and the origin sits at the world container's local origin.
 */
export function createBoard(
  container: Container,
  textures: BoardTextures,
): { rebuild: () => void } {
  const TILE_ANCHOR_X = 0.5;
  const TILE_ANCHOR_Y = 0.4;

  const rebuild = (): void => {
    container.removeChildren();

    const size = CYBERPUNK_TOKENS.board.size;
    const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
    const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
    const tileScale = CYBERPUNK_TOKENS.scale.tileScale;

    const halfSize = Math.floor(size / 2);
    const cells: { c: number; r: number }[] = [];
    for (let r = -halfSize; r < halfSize; r++) {
      for (let c = -halfSize; c < halfSize; c++) {
        cells.push({ c, r });
      }
    }
    cells.sort((a, b) => (a.c + a.r) - (b.c + b.r));

    for (const { c, r } of cells) {
      const parity = ((c + r) & 1) === 0;
      const texture = parity ? textures.dark : textures.light;
      const tile = new Sprite(texture);
      tile.anchor.set(TILE_ANCHOR_X, TILE_ANCHOR_Y);
      tile.scale.set(tileScale);
      tile.x = (c - r) * halfW;
      tile.y = (c + r) * halfH;
      container.addChild(tile);
    }
  };

  return { rebuild };
}

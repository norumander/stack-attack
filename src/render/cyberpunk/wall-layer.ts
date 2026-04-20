import { Container, Sprite, Texture, Assets } from "pixi.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";

const BACK_WALL_URL = new URL("../../assets/back_wall.png", import.meta.url).href;

const LOGO_URLS: Record<string, string> = {
  netflix: new URL("../../assets/logos/netflix.png", import.meta.url).href,
  "url-shortener": new URL("../../assets/logos/bitly.png", import.meta.url).href,
  instagram: new URL("../../assets/logos/instagram.png", import.meta.url).href,
};

export interface WallLayer {
  readonly root: Container;
  setLevel(levelId: string | null): Promise<void>;
  destroy(): void;
}

/**
 * Draws a back-wall strip behind row 0 of the iso board, plus a company logo
 * decal chosen by level id. If the wall PNG or logo PNG is missing (e.g. during
 * the retheme rollout), the layer silently renders nothing — game still plays.
 */
export function createWallLayer(): WallLayer {
  const root = new Container();
  root.label = "wall-layer";

  let wallSprite: Sprite | null = null;
  let logoSprite: Sprite | null = null;

  async function loadWall(): Promise<void> {
    try {
      const tex = await Assets.load<Texture>(BACK_WALL_URL);
      tex.source.scaleMode = "nearest";
      wallSprite = new Sprite(tex);
      // Position: behind row 0 of the board (negative iso y).
      const { x, y } = gridToWorld(CYBERPUNK_TOKENS.board.size / 2, -1);
      wallSprite.anchor.set(0.5, 1);
      wallSprite.position.set(x, y);
      root.addChildAt(wallSprite, 0);
    } catch {
      // Asset missing during rollout — silently skip.
    }
  }

  async function loadLogo(levelId: string): Promise<void> {
    if (logoSprite) {
      root.removeChild(logoSprite);
      logoSprite.destroy();
      logoSprite = null;
    }
    const url = LOGO_URLS[levelId];
    if (!url) return;
    try {
      const tex = await Assets.load<Texture>(url);
      tex.source.scaleMode = "nearest";
      logoSprite = new Sprite(tex);
      const { x, y } = gridToWorld(CYBERPUNK_TOKENS.board.size / 2, -1);
      logoSprite.anchor.set(0.5, 1);
      logoSprite.position.set(x, y - 40);
      root.addChild(logoSprite);
    } catch {
      // Asset missing — silently skip.
    }
  }

  async function setLevel(levelId: string | null): Promise<void> {
    if (wallSprite === null) await loadWall();
    if (levelId) await loadLogo(levelId);
  }

  function destroy(): void {
    if (logoSprite) {
      logoSprite.destroy();
      logoSprite = null;
    }
    if (wallSprite) {
      wallSprite.destroy();
      wallSprite = null;
    }
    root.destroy({ children: true });
  }

  return { root, setLevel, destroy };
}

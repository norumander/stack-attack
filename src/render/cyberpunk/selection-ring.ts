import { Container, Graphics } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentLayer } from "./component-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export interface SelectionRing {
  readonly container: Container;
  set(id: ComponentId | null): void;
  /** Re-render for a moved component. */
  refresh(): void;
}

export function createSelectionRing(components: ComponentLayer): SelectionRing {
  const container = new Container();
  const gfx = new Graphics();
  container.addChild(gfx);
  let selectedId: ComponentId | null = null;

  const render = (): void => {
    gfx.clear();
    if (selectedId === null) return;
    const state = components.get(selectedId);
    if (!state) return;
    const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
    const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
    const cx = state.container.x;
    const cy = state.container.y;
    gfx
      .moveTo(cx, cy - halfH)
      .lineTo(cx + halfW, cy)
      .lineTo(cx, cy + halfH)
      .lineTo(cx - halfW, cy)
      .closePath()
      .stroke({ color: CYBERPUNK_TOKENS.palette.selectionRing, width: 2, alpha: 1 });
  };

  const set = (id: ComponentId | null): void => {
    selectedId = id;
    render();
  };

  return { container, set, refresh: render };
}

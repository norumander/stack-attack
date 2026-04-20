import type { TopologyRenderer } from "../render/topology-renderer";
import type { Sim } from "@sim/sim";
import type { PhysicsCampaignController } from "./campaign-controller";
import {
  buildSimComponent,
  COMPONENT_SPRITE_TYPE,
  COMPONENT_COSTS,
} from "./component-factory";
import { setStatus } from "./hud-bridge";
import { CYBERPUNK_TOKENS } from "../render/cyberpunk/tokens";
import type { ComponentId } from "@core/types/ids";

/**
 * Board tile range matches src/render/cyberpunk/board.ts which draws tiles
 * from -halfSize through halfSize-1 inclusive. Placements outside this
 * range would sit on empty space next to the iso grid.
 */
const BOARD_HALF = Math.floor(CYBERPUNK_TOKENS.board.size / 2);
const BOARD_MIN = -BOARD_HALF;
const BOARD_MAX = BOARD_HALF - 1;

function isOnBoard(grid: { x: number; y: number }): boolean {
  return (
    grid.x >= BOARD_MIN &&
    grid.x <= BOARD_MAX &&
    grid.y >= BOARD_MIN &&
    grid.y <= BOARD_MAX
  );
}

/**
 * Placement UX — translates palette button clicks + grid clicks into
 * controller.tryPlace + sim/renderer mutations.
 *
 * Click palette → enters "placing mode" (renderer ghost follows cursor).
 * Click grid → controller.tryPlace; on success, applyPlacement mints the
 * SimComponent + adds to renderer, then exits placing mode. A failed place
 * (insufficient budget, occupied tile, etc.) keeps placing mode active so
 * the player can retry on a valid tile.
 * Click palette button while already placing the same type → cancels.
 */
export class PlacementUX {
  private placingType: string | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
    private readonly controller: PhysicsCampaignController,
  ) {
    this.renderer.onPointerMove((ev) => {
      if (!this.placingType) return;
      this.renderer.setPlacementGhost(this.placingType, {
        x: ev.screenX,
        y: ev.screenY,
      });
    });
    this.renderer.onPointerDown((ev) => {
      if (!this.placingType) return;
      // Clicking on an existing component while placing — cancel placement
      // so the connect UX gets the click instead of stacking on top.
      if (ev.hit) {
        this.exitPlacingMode();
        return;
      }
      const grid = this.renderer.screenToGrid(ev.screenX, ev.screenY);
      if (!isOnBoard(grid)) {
        setStatus("Cannot place: tile is outside the board");
        return;
      }
      const result = this.controller.tryPlace(this.placingType, grid);
      if (!result.ok) {
        setStatus(`Cannot place: ${result.reason}`);
        return;
      }
      this.exitPlacingMode();
    });
  }

  isPlacing(): boolean {
    return this.placingType !== null;
  }

  enterPlacingMode(type: string): void {
    if (!COMPONENT_COSTS.has(type)) return;
    if (this.placingType === type) {
      this.exitPlacingMode();
      return;
    }
    this.placingType = type;
    setStatus(`Placing ${type} — click grid to place, palette button again to cancel`);
  }

  exitPlacingMode(): void {
    this.placingType = null;
    this.renderer.setPlacementGhost(null, null);
    setStatus("Build phase — place components and click READY");
  }

  /**
   * Apply a successful tryPlace by minting the SimComponent + adding to
   * the renderer. Called from the controller's onPlaced callback.
   */
  applyPlacement(
    type: string,
    componentId: ComponentId,
    gridPos: { x: number; y: number },
    label?: string,
  ): void {
    const comp = buildSimComponent(
      type,
      componentId,
      this.controller.currentWaveRevenue(),
      undefined,
      label,
    );
    if (!comp) return;
    this.sim.addComponent(comp);
    const sprite = COMPONENT_SPRITE_TYPE.get(type) ?? "server";
    this.renderer.addComponent(componentId, {
      type: sprite,
      displayName: `${type}-${(componentId as unknown as string).slice(-3)}`,
      gridPosition: gridPos,
      ...(label !== undefined ? { label } : {}),
    });
  }
}

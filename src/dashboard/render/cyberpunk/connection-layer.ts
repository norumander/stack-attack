import { Container, Graphics } from "pixi.js";
import type { ComponentId, ConnectionId } from "@core/types/ids.js";
import type { ConnectionUpdate } from "../topology-renderer.js";
import type { ComponentLayer } from "./component-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ConnectionRenderState {
  sourceId: ComponentId;
  targetId: ComponentId;
  /** Forward = lane offset −LANE_OFFSET_PX along perpendicular; back = +LANE_OFFSET_PX. */
  direction: "forward" | "back";
  /** 0..1 utilization set by updateConnection; modulates core alpha. */
  loadUtilization: number;
  /** L-routed waypoints in world coords (already offset per `direction`): [start, corner, end]. */
  path: Point[];
}

export interface ConnectionLayer {
  readonly container: Container;
  add(
    id: ConnectionId,
    sourceId: ComponentId,
    targetId: ComponentId,
    direction?: "forward" | "back",
  ): void;
  remove(id: ConnectionId): void;
  update(id: ConnectionId, update: ConnectionUpdate): void;
  /** Returns the routed path for a connection (≥ 2 points), already lane-offset. */
  pathFor(id: ConnectionId): Point[] | null;
  /** Back-compat: first and last point of the (offset) path. */
  endpoints(id: ConnectionId): { fromX: number; fromY: number; toX: number; toY: number } | null;
  /**
   * Returns the offset endpoints (post-perpendicular shift) so consumers like
   * the packet-layer can place dots on the correct lane.
   */
  getEndpoints(id: ConnectionId): { sx: number; sy: number; tx: number; ty: number } | null;
  entries(): IterableIterator<[ConnectionId, ConnectionRenderState]>;
  /** Redraw everything from current component positions. */
  redraw(): void;
}

/** Perpendicular offset applied to each lane — total separation is 2× this. */
const LANE_OFFSET_PX = 6;

/**
 * Routes a connection from (fromGX, fromGY) → (toGX, toGY) as an L-shape
 * that follows the iso grid axes: first travels along the column axis, then
 * along the row axis. Returns the three waypoints in world coords
 * (start, corner, end). When from and to share a row or column the corner
 * coincides with one endpoint and the path degenerates to a straight line.
 */
function routePath(fromGX: number, fromGY: number, toGX: number, toGY: number): Point[] {
  const start = gridToWorld(fromGX, fromGY);
  const corner = gridToWorld(toGX, fromGY);
  const end = gridToWorld(toGX, toGY);
  return [start, corner, end];
}

export function createConnectionLayer(components: ComponentLayer): ConnectionLayer {
  const container = new Container();
  const states = new Map<ConnectionId, ConnectionRenderState>();
  const outer = new Graphics();
  const core = new Graphics();
  const highlight = new Graphics();
  container.addChild(outer);
  container.addChild(core);
  container.addChild(highlight);

  const recomputePath = (s: ConnectionRenderState): void => {
    const from = components.get(s.sourceId);
    const to = components.get(s.targetId);
    if (!from || !to) {
      s.path = [];
      return;
    }
    const raw = routePath(from.gridX, from.gridY, to.gridX, to.gridY);
    // Compute perpendicular against the overall start→end vector so the L-path
    // shifts uniformly into a parallel L (no zigzag).
    const start = raw[0]!;
    const end = raw[raw.length - 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      s.path = raw;
      return;
    }
    const perpX = -dy / len;
    const perpY = dx / len;
    const sign = s.direction === "forward" ? -1 : 1;
    const ox = perpX * LANE_OFFSET_PX * sign;
    const oy = perpY * LANE_OFFSET_PX * sign;
    s.path = raw.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  };

  const strokePath = (gfx: Graphics, path: Point[], width: number, color: number, alpha: number): void => {
    if (path.length < 2) return;
    gfx.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i < path.length; i++) {
      gfx.lineTo(path[i]!.x, path[i]!.y);
    }
    gfx.stroke({ color, width, alpha, cap: "butt", join: "miter" });
  };

  const redraw = (): void => {
    outer.clear();
    core.clear();
    highlight.clear();
    for (const [, s] of states) {
      recomputePath(s);
      if (s.path.length < 2) continue;
      strokePath(outer, s.path, CYBERPUNK_TOKENS.cable.outerWidth, CYBERPUNK_TOKENS.palette.tileLine, 1);
      strokePath(
        core,
        s.path,
        CYBERPUNK_TOKENS.cable.coreWidth,
        CYBERPUNK_TOKENS.palette.connection,
        0.65 + s.loadUtilization * 0.35,
      );
      strokePath(
        highlight,
        s.path,
        CYBERPUNK_TOKENS.cable.highlightWidth,
        CYBERPUNK_TOKENS.palette.packet,
        1,
      );
    }
  };

  const add = (
    id: ConnectionId,
    sourceId: ComponentId,
    targetId: ComponentId,
    direction: "forward" | "back" = "forward",
  ): void => {
    states.set(id, { sourceId, targetId, direction, loadUtilization: 0, path: [] });
    redraw();
  };
  const remove = (id: ConnectionId): void => {
    if (states.delete(id)) redraw();
  };
  const update = (id: ConnectionId, u: ConnectionUpdate): void => {
    const s = states.get(id);
    if (!s) return;
    if (u.loadUtilization !== undefined) s.loadUtilization = u.loadUtilization;
    redraw();
  };

  const pathFor = (id: ConnectionId): Point[] | null => {
    const s = states.get(id);
    return s && s.path.length > 0 ? s.path : null;
  };

  const endpoints = (id: ConnectionId) => {
    const s = states.get(id);
    if (!s || s.path.length < 2) return null;
    const start = s.path[0]!;
    const end = s.path[s.path.length - 1]!;
    return {
      fromX: start.x,
      fromY: start.y,
      toX: end.x,
      toY: end.y,
    };
  };

  const getEndpoints = (id: ConnectionId) => {
    const s = states.get(id);
    if (!s || s.path.length < 2) return null;
    const start = s.path[0]!;
    const end = s.path[s.path.length - 1]!;
    return { sx: start.x, sy: start.y, tx: end.x, ty: end.y };
  };

  return {
    container,
    add,
    remove,
    update,
    pathFor,
    endpoints,
    getEndpoints,
    entries: () => states.entries(),
    redraw,
  };
}

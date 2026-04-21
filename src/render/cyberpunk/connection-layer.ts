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
  /** Routing variant: false = X-first-then-Y (default), true = Y-first-then-X. */
  yFirst: boolean;
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
  /** Highlight connections touching this component (null = reset all to normal). */
  highlightComponent(id: ComponentId | null): void;
  /** Toggle a connection's L-routing between X-first and Y-first. */
  toggleRoute(id: ConnectionId): void;
}

/** Perpendicular offset applied to each lane — total separation is 2× this. */
const LANE_OFFSET_PX = 18;
/** Pico-8 palette — back (response) leg. Yellow core, darker yellow shadow. */
const CONNECTION_BACK_CORE = 0xffec27; // pi-yellow
const CONNECTION_BACK_HIGHLIGHT = 0xffec27; // same — no neon inner glow
/**
 * Inset applied to each end of whichever lane "overshoots" the canonical
 * endpoints along the canonical direction. With a fixed (+X / −X) lane offset,
 * the lane whose offset shares the sign of canonDx projects past the canonical
 * endpoint in the line direction — pulling it back by this inset keeps its
 * endpoint clean of the component sprite. The other lane already falls short
 * and is left full-length.
 */
const LANE_END_INSET_PX = 30;

/**
 * Returns a copy of `path` with its two end segments shortened by `inset`
 * pixels along their respective segment directions. No-op when a segment is
 * shorter than the inset (avoids crossing its own midpoint).
 */
function insetPathEnds(path: Point[], inset: number): Point[] {
  if (path.length < 2 || inset <= 0) return path;
  const result = [...path];
  const p0 = result[0]!;
  const p1 = result[1]!;
  const d0x = p1.x - p0.x;
  const d0y = p1.y - p0.y;
  const len0 = Math.hypot(d0x, d0y);
  if (len0 > inset) {
    result[0] = { x: p0.x + (d0x / len0) * inset, y: p0.y + (d0y / len0) * inset };
  }
  const n = result.length - 1;
  const pn = result[n]!;
  const pm = result[n - 1]!;
  const dnx = pm.x - pn.x;
  const dny = pm.y - pn.y;
  const lenN = Math.hypot(dnx, dny);
  if (lenN > inset) {
    result[n] = { x: pn.x + (dnx / lenN) * inset, y: pn.y + (dny / lenN) * inset };
  }
  return result;
}

/**
 * Routes a connection from (fromGX, fromGY) → (toGX, toGY) as an L-shape
 * aligned with the iso grid plane: first travels along the grid-X axis
 * (holding grid-Y at the source row), then along the grid-Y axis. The
 * corner sits at grid (toGX, fromGY) and projects to world coords through
 * gridToWorld so both legs render along the two iso diagonal axes visible
 * in the tile pattern. Returns the three waypoints (start, corner, end);
 * when source and target share a grid row or column the corner coincides
 * with an endpoint and the path degenerates to a straight line.
 */
function routePath(fromGX: number, fromGY: number, toGX: number, toGY: number, yFirst = false): Point[] {
  const s = gridToWorld(fromGX, fromGY);
  const e = gridToWorld(toGX, toGY);
  const c = yFirst
    ? gridToWorld(fromGX, toGY)
    : gridToWorld(toGX, fromGY);
  return [s, c, e];
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

  let highlightedComponentId: ComponentId | null = null;

  const recomputePath = (s: ConnectionRenderState): void => {
    const from = components.get(s.sourceId);
    const to = components.get(s.targetId);
    if (!from || !to) {
      s.path = [];
      return;
    }
    // Canonicalize the underlying L so twin connections (forward + back)
    // trace the SAME shape. Sort the two endpoints by (gridX, gridY) into
    // a stable pair ordering; route that canonical pair once, then reverse
    // the waypoints for whichever direction walks it backwards. Both lanes
    // are then parallel offsets of one L, not two mirrored Ls.
    const aFirst =
      from.gridX < to.gridX ||
      (from.gridX === to.gridX && from.gridY <= to.gridY);
    const canonFrom = aFirst ? from : to;
    const canonTo = aFirst ? to : from;
    const rawCanon = routePath(canonFrom.gridX, canonFrom.gridY, canonTo.gridX, canonTo.gridY, s.yFirst);
    const raw = aFirst ? rawCanon : [...rawCanon].reverse();
    // Fixed screen-space lane offset — blue (forward) shifts right by
    // LANE_OFFSET_PX, orange (back) shifts left by the same amount. Using a
    // constant screen-X offset (instead of a perpendicular-to-line offset)
    // keeps BOTH the visual spacing AND the blue-on-right-of-orange
    // relationship identical for every connection, regardless of the
    // connection's orientation on the iso grid. Canonicalization of the
    // underlying L shape above handles the forward/back twin symmetry; here
    // we just translate by a fixed vector.
    const sign = s.direction === "forward" ? 1 : -1;
    const ox = LANE_OFFSET_PX * sign;
    const oy = 0;
    const offsetPath = raw.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    // Which lane "overshoots" the canonical endpoints depends on the sign of
    // canonDx (the canonical direction's X component). When canonDx > 0, the
    // blue (+X) offset projects forward past the canonical endpoint — blue
    // overshoots and should be trimmed. When canonDx < 0, orange overshoots.
    // For canonDx == 0 (purely vertical canonical line), neither lane
    // overshoots; we default to trimming the back lane so the behavior stays
    // consistent with the earlier (always-trim-orange) default.
    const canonDx = rawCanon[rawCanon.length - 1]!.x - rawCanon[0]!.x;
    const trimForward = canonDx > 0;
    const shouldTrim =
      (trimForward && s.direction === "forward") ||
      (!trimForward && s.direction === "back");
    s.path = shouldTrim ? insetPathEnds(offsetPath, LANE_END_INSET_PX) : offsetPath;
  };

  const strokePath = (gfx: Graphics, path: Point[], width: number, color: number, alpha: number): void => {
    if (path.length < 2) return;
    gfx.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i < path.length; i++) {
      gfx.lineTo(path[i]!.x, path[i]!.y);
    }
    gfx.stroke({ color, width, alpha, cap: "butt", join: "miter" });
  };

  /** Spacing between chevrons along a wire segment. */
  const CHEVRON_SPACING = 40;
  /** Half-width of each chevron (perpendicular to wire direction). */
  const CHEVRON_HALF_W = 4;
  /** How far the chevron tip extends forward along the wire. */
  const CHEVRON_DEPTH = 6;

  /** Draw small chevrons (>>>) along each segment of the path,
   *  pointing in the direction of flow. */
  const drawChevrons = (gfx: Graphics, path: Point[], color: number, alpha: number): void => {
    for (let seg = 0; seg < path.length - 1; seg++) {
      const p0 = path[seg]!;
      const p1 = path[seg + 1]!;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < CHEVRON_SPACING) continue;
      const ux = dx / segLen;
      const uy = dy / segLen;
      const px = -uy; // perpendicular
      const py = ux;
      // Place chevrons evenly along the segment, skipping the endpoints.
      const count = Math.floor(segLen / CHEVRON_SPACING);
      const startOffset = (segLen - (count - 1) * CHEVRON_SPACING) / 2;
      for (let i = 0; i < count; i++) {
        const t = startOffset + i * CHEVRON_SPACING;
        const cx = p0.x + ux * t;
        const cy = p0.y + uy * t;
        // Chevron: two short lines forming a ">" pointing forward.
        const tipX = cx + ux * CHEVRON_DEPTH;
        const tipY = cy + uy * CHEVRON_DEPTH;
        const leftX = cx - ux * CHEVRON_DEPTH * 0.3 + px * CHEVRON_HALF_W;
        const leftY = cy - uy * CHEVRON_DEPTH * 0.3 + py * CHEVRON_HALF_W;
        const rightX = cx - ux * CHEVRON_DEPTH * 0.3 - px * CHEVRON_HALF_W;
        const rightY = cy - uy * CHEVRON_DEPTH * 0.3 - py * CHEVRON_HALF_W;
        gfx.moveTo(leftX, leftY);
        gfx.lineTo(tipX, tipY);
        gfx.lineTo(rightX, rightY);
        gfx.stroke({ color, width: 1.5, alpha, cap: "round", join: "round" });
      }
    }
  };

  const redraw = (): void => {
    outer.clear();
    core.clear();
    highlight.clear();
    for (const [, s] of states) {
      recomputePath(s);
      if (s.path.length < 2) continue;
      const coreColor = s.direction === "forward"
        ? CYBERPUNK_TOKENS.palette.connection
        : CONNECTION_BACK_CORE;
      const outerColor = s.direction === "forward" ? 0x1D75D0 : 0xFFA300;
      // When a component is highlighted, dim connections that don't touch it.
      const touches = highlightedComponentId === null
        || s.sourceId === highlightedComponentId
        || s.targetId === highlightedComponentId;
      const alpha = highlightedComponentId === null ? 1 : (touches ? 1 : 0.15);
      strokePath(outer, s.path, CYBERPUNK_TOKENS.cable.outerWidth, outerColor, alpha);
      strokePath(core, s.path, CYBERPUNK_TOKENS.cable.coreWidth, coreColor, alpha);
      // Subtle chevrons along the wire showing flow direction.
      const chevronColor = s.direction === "forward" ? 0xFFF1E8 : 0x1D2B53;
      drawChevrons(highlight, s.path, chevronColor, alpha * 0.7);
    }
  };

  // Alternating counter for Y-first routing. Each NEW forward connection
  // toggles so adjacent wires take different L-paths and overlap less.
  let routeCounter = 0;

  const add = (
    id: ConnectionId,
    sourceId: ComponentId,
    targetId: ComponentId,
    direction: "forward" | "back" = "forward",
  ): void => {
    // Only forward connections get their own yFirst assignment; the back
    // twin mirrors whatever its forward sibling chose (twin lookup happens
    // in recomputePath via canonicalization).
    const yFirst = direction === "forward" ? (routeCounter++ % 2 === 1) : false;
    // If this is a back connection, find its forward twin and match yFirst.
    let resolvedYFirst = yFirst;
    if (direction === "back") {
      for (const [, s] of states) {
        if (s.sourceId === targetId && s.targetId === sourceId && s.direction === "forward") {
          resolvedYFirst = s.yFirst;
          break;
        }
      }
    }
    states.set(id, { sourceId, targetId, direction, loadUtilization: 0, path: [], yFirst: resolvedYFirst });
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

  /** Toggle a connection's L-routing between X-first and Y-first.
   *  Also toggles its twin (back connection) to match. */
  const toggleRoute = (id: ConnectionId): void => {
    const s = states.get(id);
    if (!s) return;
    s.yFirst = !s.yFirst;
    // Find and match the twin (opposite direction, same endpoints).
    for (const [twinId, twin] of states) {
      if (twinId === id) continue;
      if (twin.sourceId === s.targetId && twin.targetId === s.sourceId) {
        twin.yFirst = s.yFirst;
      }
    }
    redraw();
  };

  const highlightComponent = (id: ComponentId | null): void => {
    if (highlightedComponentId === id) return;
    highlightedComponentId = id;
    redraw();
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
    highlightComponent,
    toggleRoute,
  };
}

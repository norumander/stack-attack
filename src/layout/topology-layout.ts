/**
 * Subtree-aware DAG layout for topology graphs.
 *
 * Leaf-slot algorithm:
 *   1. BFS from entry → depth (x-column)
 *   2. Build a layout tree (each node has one layout parent)
 *   3. Sort children: independent branches at edges, shared branches center
 *   4. DFS leaf assignment: each leaf gets an evenly-spaced y-slot
 *   5. Internal nodes center at the average y of their children
 *   6. Multi-parent centering pass: shared nodes average their parents' y
 *   7. Single-child alignment: chain nodes share parent's y
 *   8. Clamp to board boundaries
 */

export interface LayoutInput {
  readonly entryId: string;
  readonly components: ReadonlyArray<{ id: string }>;
  readonly connections: ReadonlyArray<{ from: string; to: string }>;
}

export interface LayoutResult {
  readonly positions: ReadonlyMap<string, { x: number; y: number }>;
}

const COL_SPACING = 3;
const ROW_SPACING = 3;
const BOARD_HALF = 14; // board is -14..+14 (30 tiles, leave 1-tile margin)

export function computeTopologyLayout(input: LayoutInput): LayoutResult {
  const { entryId, components, connections } = input;

  // ── Build adjacency ────────────────────────────────────────────────
  const children = new Map<string, string[]>();
  for (const c of components) children.set(c.id, []);
  for (const e of connections) {
    children.get(e.from)?.push(e.to);
  }

  // ── BFS depth ──────────────────────────────────────────────────────
  const depth = new Map<string, number>();
  const bfsQueue: string[] = [entryId];
  depth.set(entryId, 0);
  while (bfsQueue.length > 0) {
    const id = bfsQueue.shift()!;
    const d = depth.get(id)!;
    for (const child of children.get(id) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1);
        bfsQueue.push(child);
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const c of components) {
    if (!depth.has(c.id)) depth.set(c.id, maxDepth + 1);
  }

  // ── Layout tree (each node gets one layout parent) ─────────────────
  const layoutChildren = new Map<string, string[]>();
  for (const c of components) layoutChildren.set(c.id, []);
  const visited = new Set<string>();
  const q2: string[] = [entryId];
  visited.add(entryId);
  while (q2.length > 0) {
    const id = q2.shift()!;
    for (const child of children.get(id) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        layoutChildren.get(id)!.push(child);
        q2.push(child);
      }
    }
  }

  // ── All parents map (for multi-parent centering) ───────────────────
  const allParents = new Map<string, string[]>();
  for (const e of connections) {
    if (!allParents.has(e.to)) allParents.set(e.to, []);
    allParents.get(e.to)!.push(e.from);
  }

  // ── Descendant sets (for sorting) ──────────────────────────────────
  const descendantsCache = new Map<string, Set<string>>();
  function getDescendants(id: string): Set<string> {
    if (descendantsCache.has(id)) return descendantsCache.get(id)!;
    const desc = new Set<string>();
    for (const child of children.get(id) ?? []) {
      desc.add(child);
      for (const d of getDescendants(child)) desc.add(d);
    }
    descendantsCache.set(id, desc);
    return desc;
  }

  // ── Sort children: independent branches at edges ───────────────────
  function sortChildren(parentId: string): string[] {
    const kids = layoutChildren.get(parentId) ?? [];
    if (kids.length <= 1) return kids;

    const kidDescendants = new Map<string, Set<string>>();
    for (const kid of kids) kidDescendants.set(kid, getDescendants(kid));

    // Score: how many siblings share downstream nodes with this child
    const sharedScore = new Map<string, number>();
    for (const kid of kids) {
      let score = 0;
      const myDesc = kidDescendants.get(kid)!;
      for (const other of kids) {
        if (other === kid) continue;
        const otherDesc = kidDescendants.get(other)!;
        for (const d of myDesc) {
          if (otherDesc.has(d)) { score++; break; }
        }
      }
      sharedScore.set(kid, score);
    }

    // Independent (score=0) at edges, shared in the middle
    const independent = kids.filter(k => (sharedScore.get(k) ?? 0) === 0);
    const shared = kids.filter(k => (sharedScore.get(k) ?? 0) > 0);
    return [...independent, ...shared];
  }

  // ── Leaf counting ──────────────────────────────────────────────────
  const leafCountCache = new Map<string, number>();
  function leafCount(id: string): number {
    if (leafCountCache.has(id)) return leafCountCache.get(id)!;
    const kids = layoutChildren.get(id) ?? [];
    const count = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + leafCount(kid), 0);
    leafCountCache.set(id, count);
    return count;
  }

  // ── DFS leaf-slot assignment ───────────────────────────────────────
  const positions = new Map<string, { x: number; y: number }>();
  let nextSlot = 0;

  function assignPositions(id: string): void {
    const d = depth.get(id)!;
    const kids = sortChildren(id);

    if (kids.length === 0) {
      // Leaf: gets the next slot
      positions.set(id, { x: d * COL_SPACING, y: nextSlot * ROW_SPACING });
      nextSlot++;
      return;
    }

    // Recurse into children first (DFS)
    for (const kid of kids) {
      assignPositions(kid);
    }

    // Internal node: center at the average y of its children
    let sumY = 0;
    for (const kid of kids) {
      sumY += positions.get(kid)!.y;
    }
    positions.set(id, { x: d * COL_SPACING, y: Math.round(sumY / kids.length) });
  }

  assignPositions(entryId);

  // Unreachable nodes
  for (const c of components) {
    if (!positions.has(c.id)) {
      positions.set(c.id, { x: (maxDepth + 1) * COL_SPACING, y: nextSlot * ROW_SPACING });
      nextSlot++;
    }
  }

  // ── Centering passes ───────────────────────────────────────────────
  for (let pass = 0; pass < 3; pass++) {
    // Single-child chains: child gets parent's y
    for (const [nodeId, kids] of layoutChildren) {
      if (kids.length === 1) {
        const kid = kids[0]!;
        const kidParents = allParents.get(kid);
        if (!kidParents || kidParents.length <= 1) {
          const parentPos = positions.get(nodeId);
          const kidPos = positions.get(kid);
          if (parentPos && kidPos) {
            kidPos.y = parentPos.y;
            positions.set(kid, kidPos);
          }
        }
      }
    }

    // Multi-parent nodes: center at average of all parents
    for (const [nodeId, parents] of allParents) {
      if (parents.length < 2) continue;
      const pos = positions.get(nodeId);
      if (!pos) continue;
      let sumY = 0, count = 0;
      for (const p of parents) {
        const pp = positions.get(p);
        if (pp) { sumY += pp.y; count++; }
      }
      if (count >= 2) {
        pos.y = Math.round(sumY / count);
        positions.set(nodeId, pos);
      }
    }

    // Re-center parents at average of their children
    for (const [nodeId, kids] of layoutChildren) {
      if (kids.length < 2) continue;
      const pos = positions.get(nodeId);
      if (!pos) continue;
      let sumY = 0, count = 0;
      for (const kid of kids) {
        const kp = positions.get(kid);
        if (kp) { sumY += kp.y; count++; }
      }
      if (count >= 2) {
        pos.y = Math.round(sumY / count);
        positions.set(nodeId, pos);
      }
    }
  }

  // ── Center around (0, 0) ───────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // ── Clamp to board boundaries ──────────────────────────────────────
  const halfWidth = (maxX - minX) / 2;
  const halfHeight = (maxY - minY) / 2;
  const scaleX = halfWidth > 0 ? Math.min(1, BOARD_HALF / halfWidth) : 1;
  const scaleY = halfHeight > 0 ? Math.min(1, BOARD_HALF / halfHeight) : 1;
  const scale = Math.min(scaleX, scaleY);

  const centered = new Map<string, { x: number; y: number }>();
  for (const [id, p] of positions) {
    centered.set(id, {
      x: Math.round((p.x - cx) * scale),
      y: Math.round((p.y - cy) * scale),
    });
  }

  return { positions: centered };
}

// ── Wire routing ─────────────────────────────────────────────────────

/**
 * Choose optimal yFirst routing for each connection to minimize overlap.
 *
 * Rules:
 *   - Same y → straight (yFirst doesn't matter, both produce a line)
 *   - Same x → straight
 *   - Fan-out: child above parent → Y-first, below → X-first
 *   - Fan-in: source above target → X-first, below → Y-first
 *   - Single: Y-first (cleaner tree flow)
 *   - Post-check: if an L-bend corner coincides with a component, toggle
 */
export function computeWireRouting(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  connections: ReadonlyArray<{ from: string; to: string }>,
): Map<string, boolean> {
  const routing = new Map<string, boolean>();

  // Group by source (fan-out) and target (fan-in)
  const bySource = new Map<string, Array<{ from: string; to: string }>>();
  const byTarget = new Map<string, Array<{ from: string; to: string }>>();
  for (const e of connections) {
    if (!bySource.has(e.from)) bySource.set(e.from, []);
    bySource.get(e.from)!.push(e);
    if (!byTarget.has(e.to)) byTarget.set(e.to, []);
    byTarget.get(e.to)!.push(e);
  }

  // All occupied grid positions for corner-collision detection
  const occupiedPositions = new Set<string>();
  for (const p of positions.values()) {
    occupiedPositions.add(`${p.x},${p.y}`);
  }

  for (const e of connections) {
    const key = `${e.from}:${e.to}`;
    const fromPos = positions.get(e.from);
    const toPos = positions.get(e.to);
    if (!fromPos || !toPos) { routing.set(key, false); continue; }

    const dy = toPos.y - fromPos.y;
    const dx = toPos.x - fromPos.x;

    if (dy === 0 || dx === 0) {
      // Straight line — routing doesn't matter
      routing.set(key, false);
      continue;
    }

    const siblings = bySource.get(e.from) ?? [];
    const convergents = byTarget.get(e.to) ?? [];

    let yFirst: boolean;

    if (siblings.length > 1) {
      // Fan-out: child above parent → Y-first, below → X-first
      yFirst = dy < 0;
    } else if (convergents.length > 1) {
      // Fan-in: source above target → X-first, below → Y-first
      yFirst = dy > 0;
    } else {
      // Single connection: Y-first for tree flow
      yFirst = true;
    }

    // Post-check: does the L-bend corner land on an occupied grid cell?
    // yFirst corner: (fromX, toY). X-first corner: (toX, fromY).
    const cornerX = yFirst ? fromPos.x : toPos.x;
    const cornerY = yFirst ? toPos.y : fromPos.y;
    const cornerKey = `${cornerX},${cornerY}`;

    // If corner hits a component that isn't the source or target, toggle
    if (occupiedPositions.has(cornerKey)) {
      const isSourceOrTarget =
        (cornerX === fromPos.x && cornerY === fromPos.y) ||
        (cornerX === toPos.x && cornerY === toPos.y);
      if (!isSourceOrTarget) {
        yFirst = !yFirst;
      }
    }

    routing.set(key, yFirst);
  }

  return routing;
}

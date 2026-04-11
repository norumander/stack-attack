import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, RequestId } from "../types/ids.js";
import { getOrInitCounters } from "./metrics-counters.js";

/**
 * Cascade a blocking-child terminal failure up to the parent and across siblings.
 *
 * Called when a blocking child reaches a terminal failure state (DROP, TIMED_OUT).
 * Transitions the parent to terminal CHILD_FAILED and cancels every other sibling
 * in the parent's blockedOn set with SIBLING_CANCELLED.
 *
 * Late-arriving behavior: if the parent is not in blockedParents (already terminal
 * via another sibling's cascade), this is a no-op — just clean up childToParent
 * for the triggering child.
 *
 * Stage 2a scope: sibling cancellation only scans component pending queues for
 * siblings. TTL-time cascade (Task 27) will extend this to scan bufferables and
 * the blocked pool recursively.
 */
export function applyStrictCascade(
  state: SimulationState,
  triggeringChildId: RequestId,
): void {
  const parentId = state.childToParent.get(triggeringChildId);
  if (parentId == null) return;

  const entry = state.blockedParents.get(parentId);
  state.childToParent.delete(triggeringChildId);
  if (!entry) {
    // Parent already terminal (via earlier sibling cascade). Nothing more to do.
    return;
  }

  // Collect siblings BEFORE mutating blockedOn — iteration order is insertion
  // order per ES2015+ Set spec.
  const siblings: RequestId[] = [];
  for (const id of entry.blockedOn) {
    if (id !== triggeringChildId) siblings.push(id);
  }

  // Parent transitions to terminal CHILD_FAILED.
  state.blockedParents.delete(parentId);
  state.appendEvent(parentId, {
    tick: state.currentTick,
    componentId: entry.originComponentId,
    capabilityId: null,
    connectionId: null,
    type: "CHILD_FAILED",
    latencyAdded: 0,
    metadata: { childId: triggeringChildId },
  });
  getOrInitCounters(state, entry.originComponentId).drops += 1;

  // Cancel every remaining blocking sibling.
  for (const siblingId of siblings) {
    state.childToParent.delete(siblingId);

    // Scan component pending queues for the sibling. In Stage 2a this is the
    // only runtime location siblings can sit — they were enqueued by the same
    // deliverStaged blocking-SPAWN path. Buffered and blocked-pool locations
    // are handled by Task 27's TTL scan.
    let found: ComponentId | null = null;
    for (const [componentId, queue] of state.pending) {
      const idx = queue.findIndex((r) => r.id === siblingId);
      if (idx >= 0) {
        queue.splice(idx, 1);
        found = componentId;
        break;
      }
    }

    const attributeTo = found ?? entry.originComponentId;
    state.appendEvent(siblingId, {
      tick: state.currentTick,
      componentId: attributeTo,
      capabilityId: null,
      connectionId: null,
      type: "SIBLING_CANCELLED",
      latencyAdded: 0,
      metadata: { parentId },
    });
    state.appendEvent(siblingId, {
      tick: state.currentTick,
      componentId: attributeTo,
      capabilityId: null,
      connectionId: null,
      type: "DROPPED",
      latencyAdded: 0,
      metadata: { reason: "SIBLING_CANCELLED" },
    });
    getOrInitCounters(state, attributeTo).drops += 1;

    // Recursive cascade: if the sibling itself is a blocking parent, propagate.
    // (In Stage 2a this edge case rarely triggers but the recursion is free.)
    if (state.blockedParents.has(siblingId)) {
      const siblingEntry = state.blockedParents.get(siblingId)!;
      state.blockedParents.delete(siblingId);
      for (const grandchildId of siblingEntry.blockedOn) {
        state.childToParent.delete(grandchildId);
        // TODO(stage-2b): recurse into grandchild's own blocked descendants
      }
    }
  }
}

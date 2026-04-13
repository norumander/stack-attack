import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, RequestId } from "../types/ids.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { isEngineBufferable } from "../capability/engine-interfaces.js";

/**
 * Locate a request by id across every place it can live mid-tick (pending
 * queues then EngineBufferable partitions) and remove it in place. Returns
 * the component id where the request was found, or null if nowhere.
 *
 * Used by the cascade paths (blocking-child fail + parent-timeout) to pull
 * sibling/child requests out of wherever they're parked so the engine can
 * attribute their terminal event to that component and reclaim the slot.
 */
function findAndRemoveRequestById(
  state: SimulationState,
  requestId: RequestId,
): ComponentId | null {
  for (const [componentId, queue] of state.pending) {
    const idx = queue.findIndex((r) => r.id === requestId);
    if (idx >= 0) {
      queue.splice(idx, 1);
      return componentId;
    }
  }
  for (const componentId of state.visitOrder) {
    const comp = state.components.get(componentId);
    if (!comp) continue;
    for (const cap of comp.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      if (cap.removeRequest(requestId)) return componentId;
    }
  }
  return null;
}

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
 * Sibling cancellation searches component pending queues first; if the
 * sibling isn't found, Stage 2c extends the scan to every component's
 * EngineBufferable partitions via `removeRequest(id)` before falling back to
 * the parent's originComponentId for event attribution.
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
    const found = findAndRemoveRequestById(state, siblingId);
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
    if (state.blockedParents.has(siblingId)) {
      const siblingEntry = state.blockedParents.get(siblingId)!;
      state.blockedParents.delete(siblingId);
      for (const grandchildId of siblingEntry.blockedOn) {
        state.childToParent.delete(grandchildId);
        // KNOWN GAP (Stage 2c): grandchildren stuck in pending/bufferables are
        // not scanned here. They time out via Scan 3 on the next tick.
      }
    }
  }
}

/**
 * Down-cascade: when a blocked parent times out (step 5 blocked-pool scan),
 * propagate the timeout to every non-terminal blocking child.
 *
 * Each child is located in one of:
 *   - state.pending (any component queue) — removed and marked TIMED_OUT
 *   - a bufferable partition (Stage 2c: scanned via EngineBufferable
 *     `removeRequest`, the child is physically removed from the buffer)
 *   - state.blockedParents (nested blocking parent) — removed and recursed
 *
 * Counter attribution is at the component where the child was located (pending
 * or bufferable); if not found anywhere, `fallbackComponentId` is used.
 *
 * @param state           - The mutable simulation state.
 * @param childrenIds     - Snapshot of blockedOn set BEFORE the parent entry
 *                          was deleted from blockedParents (caller responsibility).
 * @param fallbackComponentId - The parent's originComponentId, used when a child
 *                          cannot be located in any pending queue.
 */
export function cascadeParentTimeoutToChildren(
  state: SimulationState,
  childrenIds: readonly RequestId[],
  fallbackComponentId: ComponentId,
): void {
  for (const childId of childrenIds) {
    state.childToParent.delete(childId);
    const found = findAndRemoveRequestById(state, childId);
    const attributeTo = found ?? fallbackComponentId;
    state.appendEvent(childId, {
      tick: state.currentTick,
      componentId: attributeTo,
      capabilityId: null,
      connectionId: null,
      type: "TIMED_OUT",
      latencyAdded: 0,
    });
    getOrInitCounters(state, attributeTo).timeouts += 1;

    // Nested blocking parent: recursively cascade its own children.
    if (state.blockedParents.has(childId)) {
      const nestedEntry = state.blockedParents.get(childId)!;
      const nestedChildren = [...nestedEntry.blockedOn];
      state.blockedParents.delete(childId);
      cascadeParentTimeoutToChildren(state, nestedChildren, nestedEntry.originComponentId);
    }
  }
}

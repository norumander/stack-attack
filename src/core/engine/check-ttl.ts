import type { SimulationState } from "../state/simulation-state.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { applyStrictCascade, cascadeParentTimeoutToChildren } from "./cascade.js";

/**
 * Step 5 of the simulation tick: CHECK TTL.
 *
 * Performs three scans in order:
 *
 * 1. PENDING SCAN (Task 26): walks visitOrder; for each component's pending
 *    queue, filters out expired requests, appends TIMED_OUT events, increments
 *    per-component timeout counters, and fires applyStrictCascade (UP-cascade)
 *    to propagate the failure to any blocking parent.
 *
 * 2. BLOCKED-POOL SCAN (Task 27): iterates state.blockedParents; for each
 *    blocked parent whose TTL has elapsed, marks it TIMED_OUT, increments the
 *    counter, and fires cascadeParentTimeoutToChildren (DOWN-cascade) to
 *    propagate the timeout to each non-terminal blocking child.
 *
 * 3. BUFFERABLE PARTITION SCAN (TODO — Stage 2a limitation): scanning
 *    awaitingPipeline / awaitingDelivery partitions inside bufferable
 *    capabilities requires a peek/removeRequest method on EngineBufferable
 *    that does not yet exist. This scan is deferred to a follow-up task that
 *    extends the EngineBufferable interface. Buffered requests whose TTL
 *    expires will be re-emitted next tick and time out at that point via the
 *    pending scan (or the blocked-pool scan if they produce blocking children).
 *
 * Mutation safety: pending rebuild uses a survivors array to preserve FIFO
 * order. The blocked-pool scan snapshots entries before iteration to avoid
 * mutation-during-iteration issues from the down-cascade deleting entries.
 */
export function checkTTL(state: SimulationState): void {
  for (const componentId of state.visitOrder) {
    const queue = state.pending.get(componentId);
    if (!queue || queue.length === 0) continue;

    const survivors: typeof queue = [];
    const expired: typeof queue = [];

    for (const req of queue) {
      if (req.createdAt + req.ttl <= state.currentTick) {
        expired.push(req);
      } else {
        survivors.push(req);
      }
    }

    if (expired.length === 0) continue;

    state.pending.set(componentId, survivors);

    for (const req of expired) {
      state.appendEvent(req.id, {
        tick: state.currentTick,
        componentId,
        capabilityId: null,
        connectionId: null,
        type: "TIMED_OUT",
        latencyAdded: 0,
      });
      getOrInitCounters(state, componentId).timeouts += 1;
      applyStrictCascade(state, req.id);
    }
  }

  // --- BLOCKED-POOL SCAN (§8.1/§8.2 Task 27) ---
  // Snapshot all entries first so that down-cascade deletions during iteration
  // don't cause mutation-during-iteration issues.
  const blockedEntries = [...state.blockedParents.values()];
  for (const entry of blockedEntries) {
    const parentReq = entry.request;
    if (parentReq.createdAt + parentReq.ttl > state.currentTick) continue;

    // Defensive: an earlier iteration's recursive cascade may have already
    // removed this entry from the map.
    if (!state.blockedParents.has(parentReq.id)) continue;

    const originComponentId = entry.originComponentId;
    // Capture children BEFORE deleting the parent entry, since
    // cascadeParentTimeoutToChildren receives the ids directly (not the entry).
    const childrenIds = [...entry.blockedOn];
    state.blockedParents.delete(parentReq.id);

    state.appendEvent(parentReq.id, {
      tick: state.currentTick,
      componentId: originComponentId,
      capabilityId: null,
      connectionId: null,
      type: "TIMED_OUT",
      latencyAdded: 0,
    });
    getOrInitCounters(state, originComponentId).timeouts += 1;

    cascadeParentTimeoutToChildren(state, childrenIds, originComponentId);
  }
}

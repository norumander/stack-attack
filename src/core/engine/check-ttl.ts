import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { applyStrictCascade, cascadeParentTimeoutToChildren } from "./cascade.js";
import { isEngineBufferable } from "../capability/engine-interfaces.js";
import { notifyCircuitBreakers } from "./notify-circuit-breakers.js";

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
 * 3. BUFFERABLE PARTITION SCAN (Stage 2c): walks visitOrder; for each
 *    component's EngineBufferable capabilities, calls peekBuffered() and
 *    expires buffered requests whose TTL has elapsed. Fires applyStrictCascade
 *    for expired blocking children. Uses removeRequest() return value to
 *    skip requests already removed by an earlier cascade in the same scan.
 *
 * Mutation safety: pending rebuild uses a survivors array to preserve FIFO
 * order. The blocked-pool scan snapshots entries before iteration to avoid
 * mutation-during-iteration issues from the down-cascade deleting entries.
 */
export function checkTTL(state: SimulationState, modeController: ModeController): void {
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
      notifyCircuitBreakers(state, modeController, req.id, "failure");
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
    notifyCircuitBreakers(state, modeController, parentReq.id, "failure");

    cascadeParentTimeoutToChildren(state, childrenIds, originComponentId);
  }

  // --- BUFFERABLE PARTITION SCAN (Stage 2c) ---
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    for (const cap of component.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      const buffered = cap.peekBuffered();

      for (const entry of buffered) {
        if (entry.request.createdAt + entry.request.ttl > state.currentTick) {
          continue;
        }

        // Expired — remove from buffer. If removeRequest returns false,
        // the request was already removed by a cascade from an earlier
        // expiration in this same scan pass. Skip to avoid duplicate events.
        if (!cap.removeRequest(entry.request.id)) continue;

        state.appendEvent(entry.request.id, {
          tick: state.currentTick,
          componentId,
          capabilityId: null,
          connectionId: null,
          type: "TIMED_OUT",
          latencyAdded: 0,
        });
        getOrInitCounters(state, componentId).timeouts += 1;
        notifyCircuitBreakers(state, modeController, entry.request.id, "failure");
        applyStrictCascade(state, entry.request.id);
      }
    }
  }
}

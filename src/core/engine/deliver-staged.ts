import type { SimulationState } from "../state/simulation-state.js";
import type { StagedOutcome } from "./staged-outcome.js";
import type { Capability } from "../capability/capability.js";
import type { EngineBufferable } from "../capability/engine-interfaces.js";
import type { Request } from "../types/request.js";
import type { BlockedParentEntry } from "./blocked-parent.js";
import type { ChildResponseSnapshot } from "./blocked-parent.js";
import type { ModeController } from "../mode/mode-controller.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { selectEgressConnection } from "./egress-selection.js";
import { getEffectiveBandwidth, getEffectiveLatency } from "./effective-bandwidth.js";
import { reconstructReturnPath, pickStreamConnection } from "./return-path.js";
import { isEngineBufferable } from "../capability/engine-interfaces.js";
import { IllegalStateError } from "./errors.js";
import { applyStrictCascade } from "./cascade.js";
import { notifyCircuitBreakers } from "./notify-circuit-breakers.js";

/**
 * Apply a staged outcome to simulation state (events, side effects, outcome plumbing).
 */
export function deliverStaged(
  state: SimulationState,
  staged: StagedOutcome,
  modeController: ModeController,
): boolean {
  const { sourceComponentId, request, result } = staged;
  for (const e of result.events) state.appendEvent(request.id, e);

  // Process SPAWN side effects before the primary outcome.
  for (const se of result.sideEffects) {
    if (se.kind === "SCALE") {
      const comp = state.components.get(sourceComponentId);
      if (!comp) continue;
      const clamped = Math.max(
        comp.minInstances,
        Math.min(comp.maxInstances, se.targetInstanceCount),
      );
      if (clamped !== comp.instanceCount) {
        const from = comp.instanceCount;
        state.setInstanceCount(sourceComponentId, clamped);
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId: null,
          type: "SCALED",
          latencyAdded: 0,
          metadata: { from, to: clamped },
        });
      }
      continue;
    }

    if (se.kind !== "SPAWN") continue;

    const parentRemainingTtl = request.createdAt + request.ttl - state.currentTick;
    const inheritedTtl = Math.max(0, Math.min(parentRemainingTtl, se.request.ttl));

    const child: Request = {
      ...se.request,
      createdAt: state.currentTick,
      ttl: inheritedTtl,
      parentId: request.id,
    };

    const target = child.origin ?? sourceComponentId;
    state.requestLog.set(child.id, []);
    state.enqueuePending(target, child);
    state.appendEvent(child.id, {
      tick: state.currentTick,
      componentId: target,
      capabilityId: null,
      connectionId: null,
      type: "ENTERED",
      latencyAdded: 0,
    });
    state.appendEvent(request.id, {
      tick: state.currentTick,
      componentId: sourceComponentId,
      capabilityId: null,
      connectionId: null,
      type: "SPAWNED_SUB",
      latencyAdded: 0,
      metadata: { childId: child.id, blocking: se.blocking },
    });

    if (se.blocking) {
      // Register the parent as blocked, waiting on this child to complete.
      let entry = state.blockedParents.get(request.id);
      if (!entry) {
        const newEntry: BlockedParentEntry = {
          request,
          originComponentId: sourceComponentId,
          blockedOn: new Set(),
          childResponses: new Map(),
        };
        state.blockedParents.set(request.id, newEntry);
        entry = newEntry;
      }
      entry.blockedOn.add(child.id);
      // Reverse lookup: child → parent
      state.childToParent.set(child.id, request.id);
      // Do NOT re-enqueue parent — it is waiting.
    }
  }

  switch (result.outcome.kind) {
    case "RESPOND": {
      // Stream registration side effect (§6.4). Only fires if the request is a stream request.
      if (request.streamDuration != null) {
        const streamConnectionId = pickStreamConnection(state, request.id, sourceComponentId);
        if (streamConnectionId == null) {
          // No valid connection to reserve on — degrade RESPOND to DROP.
          state.appendEvent(request.id, {
            tick: state.currentTick,
            componentId: sourceComponentId,
            capabilityId: null,
            connectionId: null,
            type: "DROPPED",
            latencyAdded: 0,
            metadata: { reason: "NO_STREAM_EGRESS" },
          });
          getOrInitCounters(state, sourceComponentId).drops += 1;
          return true;
        }

        state.registerActiveStream({
          requestId: request.id,
          connectionId: streamConnectionId,
          originComponentId: request.origin,
          baseRevenue: 0,
          request,
          remainingDuration: request.streamDuration,
          reservedBandwidth: request.streamBandwidth ?? 0,
        });
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId: streamConnectionId,
          type: "STREAM_STARTED",
          latencyAdded: 0,
        });
        // Fall through to the normal RESPOND return-path walk below.
      }

      const path = reconstructReturnPath(state, request.id);
      // SERVED fires at the component that produced the RESPOND outcome —
      // this is the "work was done here" signal used by the renderer's
      // green ring pulse. It is NOT what the metrics layer or tests read;
      // those still use RESPONDED below.
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "SERVED",
        latencyAdded: 0,
      });
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: request.origin,
        capabilityId: null,
        connectionId: null,
        type: "RESPONDED",
        latencyAdded: 0,
        metadata: {
          returnLatency: path.returnLatency,
          returnPath: path.reverseConnectionIds,
          forwardLatency: path.forwardLatency,
        },
      });

      if (request.streamDuration == null && !state.childToParent.has(request.id)) {
        const credited = modeController.economy.creditRevenue(request);
        state.revenueEarnedThisTick += credited;
      }

      // Notify upstream CircuitBreakers of success — drives HALF_OPEN → CLOSED.
      notifyCircuitBreakers(state, modeController, request.id, "success");

      const parentId = state.childToParent.get(request.id);
      if (parentId != null) {
        const entry = state.blockedParents.get(parentId);
        if (!entry) {
          // Late-arriving: parent already removed (CHILD_FAILED via sibling, or parent timed out).
          // Clean up childToParent for this child and return moved = true.
          state.childToParent.delete(request.id);
          return true;
        }

        // Normal: record the child response snapshot on the parent, remove the child from
        // blockedOn and from childToParent.
        const snapshot: ChildResponseSnapshot = {
          outcome: result.outcome,
          events: [...(state.requestLog.get(request.id) ?? [])],
          returnLatency: path.returnLatency,
        };
        entry.childResponses.set(request.id, snapshot);
        entry.blockedOn.delete(request.id);
        state.childToParent.delete(request.id);

        // Append CHILD_RESOLVED event on the parent's log at the parent's originComponentId.
        state.appendEvent(parentId, {
          tick: state.currentTick,
          componentId: entry.originComponentId,
          capabilityId: null,
          connectionId: null,
          type: "CHILD_RESOLVED",
          latencyAdded: 0,
          metadata: { childId: request.id },
        });

        // If all blocking children have resolved, unblock the parent.
        if (entry.blockedOn.size === 0) {
          // Stash the accumulated child responses so processPending sees them on
          // re-entry (bridges Task 17 unblock logic with the Task 20 context builder).
          state.pendingChildResponses.set(parentId, entry.childResponses);
          state.blockedParents.delete(parentId);
          // Front-insert the parent into its origin component's pending so the next
          // iteration of the fixed-point loop picks it up before any FIFO newcomers.
          const queue = state.pending.get(entry.originComponentId);
          if (queue) {
            queue.unshift(entry.request);
          } else {
            state.pending.set(entry.originComponentId, [entry.request]);
          }
        }
      }

      return true;
    }
    case "DROP":
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "DROPPED",
        latencyAdded: 0,
        metadata: { reason: result.outcome.reason },
      });
      getOrInitCounters(state, sourceComponentId).drops += 1;
      // Notify upstream CircuitBreakers — but NOT for backpressure, which
      // is resource exhaustion, not downstream service failure.
      if (result.outcome.reason !== "BACKPRESSURED") {
        notifyCircuitBreakers(state, modeController, request.id, "failure");
      }
      applyStrictCascade(state, request.id); // NEW: if this request is a blocking child, cascade
      return true;
    case "FORWARD": {
      const connectionId = selectEgressConnection(
        state,
        sourceComponentId,
        request,
        modeController,
      );
      if (connectionId == null) {
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId: null,
          type: "DROPPED",
          latencyAdded: 0,
          metadata: { reason: "NO_EGRESS" },
        });
        getOrInitCounters(state, sourceComponentId).drops += 1;
        return true;
      }

      const conn = state.connections.get(connectionId);
      if (!conn) {
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId,
          type: "DROPPED",
          latencyAdded: 0,
          metadata: { reason: "NO_EGRESS" },
        });
        getOrInitCounters(state, sourceComponentId).drops += 1;
        return true;
      }

      // Stage 2a models cost as 1 unit per forwarded request. Per-request
      // weighting is a 2b concern (request type → cost map).
      const cost = 1;
      const effective = getEffectiveBandwidth(state, connectionId);
      if (cost > effective) {
        const targetComponentId = conn.target.componentId;
        const targetComponent = state.components.get(targetComponentId);

        // Find the target's first EngineBufferable capability (if any).
        let bufferable: (Capability & EngineBufferable) | null = null;
        if (targetComponent) {
          for (const cap of targetComponent.capabilities.values()) {
            if (isEngineBufferable(cap)) {
              bufferable = cap;
              break;
            }
          }
        }

        if (bufferable && bufferable.enqueueForRetry(request, result)) {
          state.appendEvent(request.id, {
            tick: state.currentTick,
            componentId: targetComponentId,
            capabilityId: null,
            connectionId,
            type: "BACKPRESSURED",
            latencyAdded: 0,
          });
          getOrInitCounters(state, targetComponentId).backpressured += 1;
          return true;
        }

        // No bufferable OR bufferable rejected: drop at target with reason BACKPRESSURED.
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: targetComponentId,
          capabilityId: null,
          connectionId,
          type: "DROPPED",
          latencyAdded: 0,
          metadata: { reason: "BACKPRESSURED" },
        });
        getOrInitCounters(state, targetComponentId).drops += 1;
        return true;
      }

      state.incrementConnectionLoad(connectionId, cost);
      state.enqueuePending(conn.target.componentId, request);
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId,
        type: "TRAVERSED",
        latencyAdded: getEffectiveLatency(state, connectionId),
      });
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: conn.target.componentId,
        capabilityId: null,
        connectionId,
        type: "FORWARDED",
        latencyAdded: 0,
        metadata: { requestType: request.type },
      });
      return true;
    }
    case "QUEUE_HOLD": {
      const source = state.components.get(sourceComponentId);
      if (!source) {
        throw new IllegalStateError(
          `QUEUE_HOLD produced by unknown component ${sourceComponentId}`,
        );
      }
      let bufferable: (Capability & EngineBufferable) | null = null;
      for (const cap of source.capabilities.values()) {
        if (isEngineBufferable(cap)) {
          bufferable = cap;
          break;
        }
      }
      if (!bufferable) {
        throw new IllegalStateError(
          `QUEUE_HOLD produced by non-bufferable component ${sourceComponentId}`,
        );
      }
      const accepted = bufferable.enqueueForRetry(request, result);
      if (accepted) {
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId: null,
          type: "QUEUED",
          latencyAdded: 0,
        });
        return true;
      }
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "DROPPED",
        latencyAdded: 0,
        metadata: { reason: "QUEUE_FULL" },
      });
      getOrInitCounters(state, sourceComponentId).drops += 1;
      return true;
    }
    default:
      return false; // other outcome kinds added in later tasks (12-18)
  }
}

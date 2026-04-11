import type { SimulationState } from "../state/simulation-state.js";
import type { StagedOutcome } from "./staged-outcome.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { selectEgressConnection } from "./egress-selection.js";
import { getEffectiveBandwidth } from "./effective-bandwidth.js";
import { reconstructReturnPath } from "./return-path.js";

export function deliverStaged(
  state: SimulationState,
  staged: StagedOutcome,
): boolean {
  const { sourceComponentId, request, result } = staged;
  for (const e of result.events) state.appendEvent(request.id, e);

  switch (result.outcome.kind) {
    case "RESPOND": {
      const path = reconstructReturnPath(state, request.id);
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
      return true;
    case "FORWARD": {
      // Minimal placeholder ProcessContext for egress selection. Real delivery
      // inside processPending receives a full context; deliverStaged's fallback
      // path (round-robin) ignores ctx entirely, and EngineConsultables that
      // need ctx will already have been consulted during processPending.
      const placeholderCtx = {
        state: state.asReader(),
        componentId: sourceComponentId,
        effectiveTier: 0,
        effectiveTiers: new Map(),
        activeCapabilityIds: new Set(),
        currentTick: state.currentTick,
        rng: null as unknown as never,
        directories: [],
        childResponses: new Map(),
      } as unknown as import("../capability/process-context.js").ProcessContext;

      const connectionId = selectEgressConnection(
        state,
        sourceComponentId,
        request,
        placeholderCtx,
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
        // Real backpressure path lands in Task 19 — for now, stub as a drop so
        // tests can assert the branch is reached without leaking pending state.
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId,
          type: "DROPPED",
          latencyAdded: 0,
          metadata: { reason: "BACKPRESSURED_STUB" },
        });
        getOrInitCounters(state, sourceComponentId).drops += 1;
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
        latencyAdded: conn.latency,
      });
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: conn.target.componentId,
        capabilityId: null,
        connectionId,
        type: "FORWARDED",
        latencyAdded: 0,
      });
      return true;
    }
    default:
      return false; // other outcome kinds added in later tasks (12-18)
  }
}

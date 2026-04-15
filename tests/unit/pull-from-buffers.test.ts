import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability";
import { pullFromBuffers } from "@core/engine/pull-from-buffers";
import { NoOpModeController } from "../harness/noop-mode-controller.js";
import { makeComponent, makePort, makeConnection } from "../harness/fixtures.js";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function batchReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "batch",
    payload: null,
    origin: "client" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

const holdResult: ProcessResult = {
  outcome: { kind: "QUEUE_HOLD" },
  sideEffects: [],
  events: [],
};

function buildQueueWorkerTopology() {
  const queueCap = new QueueCapability("queue" as CapabilityId, {
    holdTypes: new Set(["batch"]),
  });
  const batchCap = new BatchProcessingCapability(
    "batch-processing" as CapabilityId,
  );

  const queueComp = makeComponent({
    id: "queue-1",
    type: "queue",
    capabilities: new Map([["queue" as CapabilityId, queueCap]]),
    tiers: new Map([["queue" as CapabilityId, 1]]),
    ports: [makePort("q-out", "egress"), makePort("q-in", "ingress")],
  });

  const workerComp = makeComponent({
    id: "worker-1",
    type: "worker",
    capabilities: new Map([
      ["batch-processing" as CapabilityId, batchCap],
    ]),
    tiers: new Map([["batch-processing" as CapabilityId, 1]]),
    ports: [makePort("w-in", "ingress")],
  });

  const conn = makeConnection(
    "conn-q-w",
    { componentId: "queue-1", portId: "q-out" },
    { componentId: "worker-1", portId: "w-in" },
  );

  const state = new SimulationState({
    zones: [],
    pairLatency: new Map(),
  });
  state.placeComponent(queueComp);
  state.placeComponent(workerComp);
  state.addConnection(conn);
  state.recomputeVisitOrder();

  // Set tier so capacity calc works
  queueCap.getUpkeepCost(1);

  return { state, queueCap, batchCap };
}

const mc = new NoOpModeController({
  requestsPerTick: 0,
  typeWeights: {},
  origins: [],
});

describe("pullFromBuffers", () => {
  it("Worker pulls batch items from connected Queue heldBuffer", () => {
    const { state, queueCap } = buildQueueWorkerTopology();

    // Enqueue 3 batch items into Queue's heldBuffer via QUEUE_HOLD
    queueCap.enqueueForRetry(batchReq("r-1"), holdResult);
    queueCap.enqueueForRetry(batchReq("r-2"), holdResult);
    queueCap.enqueueForRetry(batchReq("r-3"), holdResult);
    expect(queueCap.getStats().heldDepth).toBe(3);

    pullFromBuffers(state, mc);

    // Worker's pending queue should now have the 3 items
    const workerPending =
      state.pending.get("worker-1" as ComponentId) ?? [];
    expect(workerPending).toHaveLength(3);
    expect(workerPending.map((r) => r.id)).toEqual(["r-1", "r-2", "r-3"]);

    // Queue's heldBuffer should be drained
    expect(queueCap.getStats().heldDepth).toBe(0);
  });

  it("respects Worker throughput capacity", () => {
    const { state, queueCap } = buildQueueWorkerTopology();

    // Tier 1 BatchProcessing throughput = 1 * 5 = 5
    // Enqueue 8 items, only 5 should be pulled
    for (let i = 0; i < 8; i++) {
      queueCap.enqueueForRetry(batchReq(`r-${i}`), holdResult);
    }

    pullFromBuffers(state, mc);

    const workerPending =
      state.pending.get("worker-1" as ComponentId) ?? [];
    expect(workerPending).toHaveLength(5);
    expect(queueCap.getStats().heldDepth).toBe(3);
  });

  it("does nothing when Queue heldBuffer is empty", () => {
    const { state } = buildQueueWorkerTopology();

    pullFromBuffers(state, mc);

    const workerPending =
      state.pending.get("worker-1" as ComponentId) ?? [];
    expect(workerPending).toHaveLength(0);
  });
});

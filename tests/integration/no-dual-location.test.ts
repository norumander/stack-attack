import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { createRng } from "@core/engine/rng";
import { makeRandomTopology } from "@harness/random-topology";
import type { SimulationState } from "@core/state/simulation-state";
import type { RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

const RUNS = 20;

function assertNoDualLocation(state: SimulationState): void {
  const seen = new Map<RequestId, string[]>();
  const mark = (id: RequestId, loc: string) => {
    const list = seen.get(id) ?? [];
    list.push(loc);
    seen.set(id, list);
  };

  for (const [cid, queue] of state.pending) {
    for (const req of queue) mark(req.id, `pending(${cid})`);
  }
  for (const [parentId] of state.blockedParents) {
    mark(parentId, "blocked");
  }
  for (const [reqId] of state.activeStreams) {
    mark(reqId, "activeStream");
  }

  for (const [id, locations] of seen) {
    if (locations.length > 1) {
      throw new Error(
        `request ${id} is in multiple live locations: ${locations.join(", ")}`,
      );
    }
  }

  // Suppress unused variable warning — expect is used in the calling test.
  void expect;
}

describe("property — no request exists in two runtime locations simultaneously", () => {
  it("across 20 random topologies and 10 ticks each, every request is in at most one live location", () => {
    for (let run = 0; run < RUNS; run++) {
      const rng = createRng(`nodual-seed-${run}`);
      const topo = makeRandomTopology(rng);
      const { state, entryComponentId } = topo;

      const mc = new NoOpModeController({
        targetEntryPointId: entryComponentId,
        intensity: 0,
        requestType: "api_read",
      });
      const engine = new Engine(state);

      // Inject 8 requests spread over the first 4 ticks.
      for (let i = 0; i < 8; i++) {
        const req: Request = {
          id: `r-${run}-${i}` as RequestId,
          parentId: null,
          type: "api_read",
          payload: null,
          origin: entryComponentId,
          createdAt: state.currentTick,
          ttl: 1000,
          originZone: null,
          streamDuration: null,
          streamBandwidth: null,
        };
        state.requestLog.set(req.id, []);
        state.enqueuePending(entryComponentId, req);
        if (i % 2 === 1) engine.tick(mc);
      }
      // Drain.
      for (let t = 0; t < 20; t++) {
        engine.tick(mc);
        assertNoDualLocation(state);
      }
    }
  });
});

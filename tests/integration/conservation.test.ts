import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { createRng } from "@core/engine/rng";
import { makeRandomTopology } from "@harness/random-topology";
import type { SimulationState } from "@core/state/simulation-state";
import type { RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

const TOPOLOGIES = 100;

function classifyTerminal(
  events: { type: string }[],
): "resolved" | "dropped" | "timedOut" | "childFailed" | "unresolved" {
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i]!.type;
    if (t === "RESPONDED") return "resolved";
    if (t === "TIMED_OUT") return "timedOut";
    if (t === "DROPPED") return "dropped";
    if (t === "CHILD_FAILED") return "childFailed";
  }
  return "unresolved";
}

function countCategories(state: SimulationState) {
  let resolved = 0;
  let dropped = 0;
  let timedOut = 0;
  let childFailed = 0;
  let unresolved = 0;
  for (const events of state.requestLog.values()) {
    const kind = classifyTerminal(events as { type: string }[]);
    if (kind === "resolved") resolved += 1;
    else if (kind === "dropped") dropped += 1;
    else if (kind === "timedOut") timedOut += 1;
    else if (kind === "childFailed") childFailed += 1;
    else unresolved += 1;
  }
  return { resolved, dropped, timedOut, childFailed, unresolved };
}

function assertConservation(
  state: SimulationState,
  cumulativeInjected: number,
  run: number,
): void {
  const cats = countCategories(state);
  const pendingCount = [...state.pending.values()].reduce((a, q) => a + q.length, 0);
  const blockedCount = state.blockedParents.size;
  const streamCount = state.activeStreams.size;

  const total =
    cats.resolved +
    cats.dropped +
    cats.timedOut +
    cats.childFailed +
    cats.unresolved;

  // Sanity: every injected request has a log entry.
  expect(total).toBe(cumulativeInjected);

  // Every still-unresolved request must be somewhere alive.
  // In these linear topologies with no blocking SPAWN or streams, unresolved
  // == pending count exactly.
  expect(cats.unresolved).toBe(
    pendingCount + blockedCount + streamCount,
  );

  void run; // used in outer loop for debugging context only
}

describe("property — conservation across random linear topologies", () => {
  it("cumulative counts match total injected at end of every tick across 100 topologies", () => {
    for (let run = 0; run < TOPOLOGIES; run++) {
      const rng = createRng(`conservation-seed-${run}`);
      const topo = makeRandomTopology(rng);
      const { state, entryComponentId } = topo;

      const mc = new NoOpModeController({
        targetEntryPointId: entryComponentId,
        intensity: 0,
        requestType: "api_read",
      });
      const engine = new Engine(state);

      // Inject 5 requests, one per tick, then drain.
      const totalRequests = 5;
      let cumulativeInjected = 0;
      for (let i = 0; i < totalRequests; i++) {
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
        cumulativeInjected += 1;
        engine.tick(mc);
        assertConservation(state, cumulativeInjected, run);
      }

      // Drain: run until everything is quiescent or we've gone N more ticks.
      for (let t = 0; t < 20; t++) {
        const stillActive =
          state.blockedParents.size > 0 ||
          [...state.pending.values()].some((q) => q.length > 0) ||
          state.activeStreams.size > 0;
        if (!stillActive) break;
        engine.tick(mc);
        assertConservation(state, cumulativeInjected, run);
      }

      // After drain, all requests should be in terminal states.
      const finalCounts = countCategories(state);
      const totalTerminal =
        finalCounts.resolved +
        finalCounts.dropped +
        finalCounts.timedOut +
        finalCounts.childFailed;
      expect(totalTerminal).toBe(cumulativeInjected);
    }
  });
});

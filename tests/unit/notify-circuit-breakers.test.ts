import { describe, it, expect, vi } from "vitest";
import { notifyCircuitBreakers } from "@core/engine/notify-circuit-breakers";
import { SimulationState } from "@core/state/simulation-state";
import { CircuitBreakerCapability } from "@capabilities/circuit-breaker/circuit-breaker-capability";
import { makeComponent } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { RequestEvent } from "@core/types/request";

const MC = new NoOpModeController({
  targetEntryPointId: "c-a" as ComponentId,
  intensity: 1,
  requestType: "api_read",
});

function makeState(): SimulationState {
  return new SimulationState({ zones: [], pairLatency: new Map() });
}

function makeEvent(componentId: string): RequestEvent {
  return {
    tick: 0,
    componentId: componentId as ComponentId,
    capabilityId: null,
    connectionId: null,
    type: "PROCESSED",
    latencyAdded: 0,
  };
}

const CB_ID = "cb" as CapabilityId;

describe("notifyCircuitBreakers", () => {
  it("calls reportFailure on a CB-bearing component in the event path", () => {
    const state = makeState();
    const cap = new CircuitBreakerCapability(CB_ID);
    const spy = vi.spyOn(cap, "reportFailure");

    const comp = makeComponent({
      id: "c-a",
      capabilities: new Map<CapabilityId, CircuitBreakerCapability>([[CB_ID, cap]]),
    });
    state.placeComponent(comp);

    const reqId = "r-1" as RequestId;
    state.appendEvent(reqId, makeEvent("c-a"));

    notifyCircuitBreakers(state, MC, reqId, "failure");

    expect(spy).toHaveBeenCalledOnce();
  });

  it("calls reportSuccess in HALF_OPEN → transitions to CLOSED", () => {
    const state = makeState();
    const cap = new CircuitBreakerCapability(CB_ID);

    // Force into HALF_OPEN by casting private state
    (cap as unknown as { state: string }).state = "HALF_OPEN";

    const comp = makeComponent({
      id: "c-a",
      capabilities: new Map<CapabilityId, CircuitBreakerCapability>([[CB_ID, cap]]),
    });
    state.placeComponent(comp);

    const reqId = "r-1" as RequestId;
    state.appendEvent(reqId, makeEvent("c-a"));

    notifyCircuitBreakers(state, MC, reqId, "success");

    expect(cap.getCircuitState()).toBe("CLOSED");
  });

  it("deduplicates by componentId — each component notified only once even with multiple events", () => {
    const state = makeState();
    const cap = new CircuitBreakerCapability(CB_ID);
    const spy = vi.spyOn(cap, "reportFailure");

    const comp = makeComponent({
      id: "c-a",
      capabilities: new Map<CapabilityId, CircuitBreakerCapability>([[CB_ID, cap]]),
    });
    state.placeComponent(comp);

    const reqId = "r-1" as RequestId;
    // Append the same component three times
    state.appendEvent(reqId, makeEvent("c-a"));
    state.appendEvent(reqId, makeEvent("c-a"));
    state.appendEvent(reqId, makeEvent("c-a"));

    notifyCircuitBreakers(state, MC, reqId, "failure");

    expect(spy).toHaveBeenCalledOnce();
  });

  it("handles an empty event log gracefully (no throw)", () => {
    const state = makeState();
    const reqId = "r-empty" as RequestId;
    // Explicitly set an empty array
    state.requestLog.set(reqId, []);

    expect(() => notifyCircuitBreakers(state, MC, reqId, "failure")).not.toThrow();
  });

  it("handles a missing request log entry gracefully (no throw)", () => {
    const state = makeState();
    const reqId = "r-missing" as RequestId;
    // No entry at all in requestLog

    expect(() => notifyCircuitBreakers(state, MC, reqId, "failure")).not.toThrow();
  });

  it("skips components that have no CB capability (no reportFailure/reportSuccess)", () => {
    const state = makeState();

    // Component with no capabilities
    const comp = makeComponent({ id: "c-plain" });
    state.placeComponent(comp);

    const reqId = "r-1" as RequestId;
    state.appendEvent(reqId, makeEvent("c-plain"));

    // Should not throw and nothing to assert — just verifying no crash
    expect(() => notifyCircuitBreakers(state, MC, reqId, "failure")).not.toThrow();
  });

  it("notifies all CBs on the path, not just the first", () => {
    const state = makeState();

    const capA = new CircuitBreakerCapability("cb-a" as CapabilityId);
    const capB = new CircuitBreakerCapability("cb-b" as CapabilityId);
    const spyA = vi.spyOn(capA, "reportFailure");
    const spyB = vi.spyOn(capB, "reportFailure");

    const compA = makeComponent({
      id: "c-a",
      capabilities: new Map<CapabilityId, CircuitBreakerCapability>([
        ["cb-a" as CapabilityId, capA],
      ]),
    });
    const compB = makeComponent({
      id: "c-b",
      capabilities: new Map<CapabilityId, CircuitBreakerCapability>([
        ["cb-b" as CapabilityId, capB],
      ]),
    });

    state.placeComponent(compA);
    state.placeComponent(compB);

    const reqId = "r-1" as RequestId;
    state.appendEvent(reqId, makeEvent("c-a"));
    state.appendEvent(reqId, makeEvent("c-b"));

    notifyCircuitBreakers(state, MC, reqId, "failure");

    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).toHaveBeenCalledOnce();
  });
});

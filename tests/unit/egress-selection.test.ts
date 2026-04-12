import { describe, it, expect } from "vitest";
import { selectEgressConnection } from "@core/engine/egress-selection";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { Capability } from "@core/capability/capability";
import type { ComponentId, CapabilityId, ConnectionId } from "@core/types/ids";
import type { EngineConsultable } from "@core/capability/engine-interfaces";

describe("selectEgressConnection", () => {
  const topo = { zones: [], pairLatency: new Map() };
  const mc = new NoOpModeController({
    targetEntryPointId: "c-src" as ComponentId,
    intensity: 0,
    requestType: "noop",
  });

  function setup3conn() {
    const state = new SimulationState(topo);
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    state.placeComponent(src);
    for (const id of ["cx-b", "cx-a", "cx-c"]) {
      const conn = makeConnection(
        id,
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
      );
      state.addConnection(conn);
    }
    return state;
  }

  it("returns null when source has no egress connections", () => {
    const state = new SimulationState(topo);
    const src = makeComponent({ id: "c-src" });
    state.placeComponent(src);
    expect(
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, mc),
    ).toBe(null);
  });

  it("round-robins in ascending ConnectionId order when no consultable", () => {
    const state = setup3conn();
    const pick = () =>
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, mc);
    expect(pick()).toBe("cx-a");
    expect(pick()).toBe("cx-b");
    expect(pick()).toBe("cx-c");
    expect(pick()).toBe("cx-a");
  });

  it("delegates to EngineConsultable when source owns one", () => {
    const state = new SimulationState(topo);
    const consultable: EngineConsultable & Capability = {
      id: "rt" as CapabilityId,
      phase: "INTERCEPT",
      canHandle: () => true,
      process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
      getUpkeepCost: () => 0,
      getStats: () => ({}),
      selectConnection: () => "cx-c" as ConnectionId,
    };
    const caps = new Map<CapabilityId, Capability>();
    caps.set("rt" as CapabilityId, consultable);
    const src = makeComponent({
      id: "c-src",
      ports: [makePort("p-out", "egress")],
      capabilities: caps,
    });
    state.placeComponent(src);
    for (const id of ["cx-b", "cx-a", "cx-c"]) {
      const conn = makeConnection(
        id,
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
      );
      state.addConnection(conn);
    }
    expect(
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, mc),
    ).toBe("cx-c");
  });
});

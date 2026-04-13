import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("Stage 1 smoke test", () => {
  it("Client → Server topology, 10 requests over 5 ticks, all RESPONDED", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const clientEgress = makePort("p-c-out", "egress");
    const clientCap = new TestForwardingCapability("cap-client" as CapabilityId);
    const clientCaps = new Map<CapabilityId, Capability>([
      ["cap-client" as CapabilityId, clientCap],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    const serverIngress = makePort("p-s-in", "ingress");
    const caps = new Map<CapabilityId, Capability>([
      [
        "cap-proc" as CapabilityId,
        new RespondingCapability("cap-proc" as CapabilityId),
      ],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: caps,
      tiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const engine = new Engine(state);
    for (let i = 0; i < 5; i++) engine.tick(mode);

    expect(state.currentTick).toBe(5);

    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(10);

    for (const events of logs) {
      const types = events.map((e) => e.type);
      expect(types).toContain("ENTERED");
      expect(types).toContain("TRAVERSED");
      expect(types).toContain("RESPONDED");
      expect(types).not.toContain("DROPPED");
    }

    // Ordering: ENTERED is always the first event on a request.
    for (const events of logs) {
      expect(events[0]?.type).toBe("ENTERED");
    }

    // All TRAVERSED events are on the single connection.
    const traversed = logs.flatMap((evs) => evs.filter((e) => e.type === "TRAVERSED"));
    expect(traversed).toHaveLength(10);
    for (const t of traversed) expect(t.connectionId).toBe("cx-1");
  });
});

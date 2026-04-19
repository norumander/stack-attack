import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { resetIdCountersForTest } from "@sim/packet";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resolveTarget } from "../../../src/physics-td/chaos";
import { PhysicsCampaignController, type WaveSlot } from "../../../src/physics-td/campaign-controller";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function noopCallbacks() {
  return {
    onPlaced: () => {},
    onConnected: () => {},
    onComponentDeleted: () => {},
    onConnectionDeleted: () => {},
    onPhaseChange: () => {},
    onBudgetChange: () => {},
  };
}

function buildSimWithTopology(seed: number): Sim {
  const sim = new Sim({ seed });
  const server = new SimComponent({ id: "srv" as ComponentId, capabilities: [new ForwardingCapability()] });
  const cache = new SimComponent({
    id: "cache" as ComponentId,
    capabilities: [new CachingCapability({ capacity: 10, revenuePerRead: 0 })],
  });
  const db = new SimComponent({
    id: "db" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerRead: 0, revenuePerWrite: 0 })],
    capacityPerSecond: 30,
  });
  sim.addComponent(server);
  sim.addComponent(cache);
  sim.addComponent(db);

  const edges: Array<[string, string, string, string]> = [
    ["srv", "cache", "e1", "e1t"],
    ["cache", "db", "e2", "e2t"],
  ];
  for (const [from, to, id, twin] of edges) {
    sim.addConnection(new SimConnection({
      id: id as ConnectionId,
      from: { componentId: from as ComponentId, portId: "out" as PortId },
      to: { componentId: to as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1,
      twinId: twin as ConnectionId,
      direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: twin as ConnectionId,
      from: { componentId: to as ComponentId, portId: "in" as PortId },
      to: { componentId: from as ComponentId, portId: "out" as PortId },
      bandwidth: 100,
      latencySeconds: 1,
      twinId: id as ConnectionId,
      direction: "back",
    }));
  }
  return sim;
}

describe("chaos scheduler / role resolver", () => {
  beforeEach(() => resetIdCountersForTest());

  it("resolveTarget picks a component matching the role's capability", () => {
    const sim = buildSimWithTopology(1);
    expect(resolveTarget("any_server", sim)).toBe("srv");
    expect(resolveTarget("any_cache", sim)).toBe("cache");
    expect(resolveTarget("any_database", sim)).toBe("db");
  });

  it("resolveTarget picks a forward connection pointing to the role target", () => {
    const sim = buildSimWithTopology(1);
    // Only e2 points to db (processing cap).
    expect(resolveTarget("any_connection_to_database", sim)).toBe("e2");
    expect(resolveTarget("any_connection_to_cache", sim)).toBe("e1");
  });

  it("resolveTarget is deterministic under the same seed", () => {
    const simA = buildSimWithTopology(42);
    const simB = buildSimWithTopology(42);
    // Add two equivalent servers so selection is non-trivial.
    for (const sim of [simA, simB]) {
      sim.addComponent(new SimComponent({
        id: "srv2" as ComponentId,
        capabilities: [new ForwardingCapability()],
      }));
    }
    expect(resolveTarget("any_server", simA)).toBe(resolveTarget("any_server", simB));
  });

  it("resolveTarget returns null when no candidate exists", () => {
    const sim = new Sim({ seed: 1 });
    expect(resolveTarget("any_server", sim)).toBeNull();
    expect(resolveTarget("any_connection_to_database", sim)).toBeNull();
    expect(resolveTarget("nonsense_role", sim)).toBeNull();
  });

  it("controller.tickChaos fires events once at the right elapsed time", () => {
    const sim = buildSimWithTopology(1);
    const waves: WaveSlot[] = [{
      id: "w1",
      startBudget: 0,
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 0 },
      chaosSchedule: [
        { atSeconds: 2, kind: "crash_component", targetRole: "any_cache" },
        { atSeconds: 5, kind: "sever_connection", targetRole: "any_connection_to_database" },
      ],
    }];
    const controller = new PhysicsCampaignController({
      waves,
      componentCosts: new Map(),
      callbacks: noopCallbacks(),
    });
    controller.ready();

    // Before atSeconds, no chaos fired yet.
    controller.tickChaos(1, sim);
    expect(sim.crashedComponents.has("cache" as ComponentId)).toBe(false);

    // Cross 2s threshold — cache should crash.
    controller.tickChaos(1.5, sim);
    expect(sim.crashedComponents.has("cache" as ComponentId)).toBe(true);
    expect(sim.connections.has("e2" as ConnectionId)).toBe(true);

    // Cross 5s threshold — connection to db should be severed.
    controller.tickChaos(3, sim);
    expect(sim.connections.has("e2" as ConnectionId)).toBe(false);
    expect(sim.connections.has("e2t" as ConnectionId)).toBe(false);

    // Subsequent ticks must not re-fire events.
    const crashedCountBefore = sim.lastStepEvents.filter((e) => e.kind === "component-crashed").length;
    const severedCountBefore = sim.lastStepEvents.filter((e) => e.kind === "connection-severed").length;
    controller.tickChaos(10, sim);
    const crashedCountAfter = sim.lastStepEvents.filter((e) => e.kind === "component-crashed").length;
    const severedCountAfter = sim.lastStepEvents.filter((e) => e.kind === "connection-severed").length;
    expect(crashedCountAfter).toBe(crashedCountBefore);
    expect(severedCountAfter).toBe(severedCountBefore);
  });

  it("controller.tickChaos does nothing outside simulate phase", () => {
    const sim = buildSimWithTopology(1);
    const waves: WaveSlot[] = [{
      id: "w1",
      startBudget: 0,
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 0 },
      chaosSchedule: [{ atSeconds: 0, kind: "crash_component", targetRole: "any_cache" }],
    }];
    const controller = new PhysicsCampaignController({
      waves,
      componentCosts: new Map(),
      callbacks: noopCallbacks(),
    });
    // Phase is "build" — tickChaos is a no-op.
    controller.tickChaos(1, sim);
    expect(sim.crashedComponents.size).toBe(0);
  });
});

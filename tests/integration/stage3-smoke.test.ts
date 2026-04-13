import { describe, it, expect } from "vitest";
import { bootstrapRegistries } from "@core/registry/register-all";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makePort, makeConnection } from "@harness/fixtures";
import type { ComponentId } from "@core/types/ids";

describe("Stage 3 integration smoke test", () => {
  it("creates a Cache → Server topology from registry and runs 10 ticks", () => {
    const { components: registry } = bootstrapRegistries();

    const ctrl = new SandboxModeController();
    const state = new SimulationState(ctrl.getInitialZoneTopology());

    // Create components from registry (inject traffic directly at cache)
    const cache = registry.create("cache", { x: 1, y: 0 }, "default");
    const server = registry.create("server", { x: 2, y: 0 }, "default");

    state.placeComponent(cache);
    state.placeComponent(server);

    // Wire connection: cache → server
    const cacheEgress = cache.ports.find(p => p.direction === "egress")!;
    const serverIngress = server.ports.find(p => p.direction === "ingress")!;

    const c1 = makeConnection("cx-1",
      { componentId: cache.id as string, portId: cacheEgress.id as string },
      { componentId: server.id as string, portId: serverIngress.id as string },
    );
    cacheEgress.connections.push(c1.id);
    serverIngress.connections.push(c1.id);
    state.addConnection(c1);

    // Configure traffic — inject directly at cache
    ctrl.addTrafficSource({
      targetEntryPointId: cache.id,
      requestType: "api_read",
      intensity: 10,
      pattern: "steady",
    });
    ctrl.advancePhase(); // build → simulate

    const engine = new Engine(state);
    for (let i = 0; i < 10; i++) engine.tick(ctrl);

    // Verify simulation ran
    expect(state.currentTick).toBe(10);
    expect(state.metricsHistory).toHaveLength(10);

    // Verify requests were processed
    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.totalResolved).toBeGreaterThan(0);
    expect(snap.ticks).toBe(10);

    // Verify cache produced hits (after warming)
    const allEvents = [...state.requestLog.values()].flat();
    const cacheHits = allEvents.filter(e => e.type === "CACHED_HIT");
    const cacheMisses = allEvents.filter(e => e.type === "CACHED_MISS");
    expect(cacheHits.length).toBeGreaterThan(0);
    expect(cacheMisses.length).toBeGreaterThan(0);
  });

  it("creates all 14 component types from registry without errors", () => {
    const { components: registry } = bootstrapRegistries();
    for (const entry of registry.list()) {
      const comp = registry.create(entry.type, { x: 0, y: 0 }, "default");
      expect(comp.id).toBeTruthy();
      expect(comp.type).toBe(entry.type);
      expect(comp.capabilities.size).toBe(entry.capabilities.length);
    }
  });
});

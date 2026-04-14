import { describe, it, expect } from "vitest";
import { bootstrapRegistries } from "@core/registry/register-all";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makePort, makeConnection } from "@harness/fixtures";
import type { ComponentId } from "@core/types/ids";

describe("Stage 3 integration smoke test", () => {
  it("creates a Server topology from registry and runs 10 ticks with resolved requests", () => {
    const { components: registry } = bootstrapRegistries();

    const ctrl = new SandboxModeController();
    const state = new SimulationState(ctrl.getInitialZoneTopology());

    // Create components from registry — Server as the terminal processor.
    // The global cache component (caching + monitoring only) has no forwarding
    // capability, so sandbox traffic (null payload) would miss the cache and
    // have no PROCESS handler → DROP. Traffic goes directly to Server so it
    // can be resolved end-to-end.
    const server = registry.create("server", { x: 1, y: 0 }, "default");
    const cache = registry.create("cache", { x: 0, y: 0 }, "default");

    state.placeComponent(server);
    state.placeComponent(cache);

    // Configure traffic — inject at server (ProcessingCapability handles api_read)
    ctrl.addTrafficSource({
      targetEntryPointId: server.id,
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

    // Verify requests were processed (Server's ProcessingCapability → RESPOND)
    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.totalResolved).toBeGreaterThan(0);
    expect(snap.ticks).toBe(10);

    // Verify that the cache component was created and is a valid registry component.
    // With sandbox null-payload traffic, the cache produces only misses (no pooled
    // payloads → no cache hits). Cache hits require payload-keyed matching, which
    // only TDTrafficSource provides via its keyPoolSize tuning knob.
    expect(cache.id).toBeTruthy();
    expect(cache.capabilities.has("caching" as import("@core/types/ids").CapabilityId)).toBe(true);
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

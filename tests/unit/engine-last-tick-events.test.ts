import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { Engine } from "@core/engine/engine.js";
import { NoOpModeController } from "@harness/noop-mode-controller.js";
import { makeComponent } from "@harness/fixtures.js";
import { RespondingCapability } from "@harness/test-capabilities.js";
import { computeVisitOrder } from "@core/engine/visit-order.js";
import type { Capability } from "@core/capability/capability.js";
import type { CapabilityId, RequestId, ComponentId } from "@core/types/ids.js";

describe("state.lastTickEvents", () => {
  it("is an empty array on a fresh state", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(state.lastTickEvents).toEqual([]);
  });

  it("accumulates events during a tick and clears at the start of the next", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const respCap = new RespondingCapability("resp" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set(respCap.id, respCap);
    const server = makeComponent({
      id: "s1" as ComponentId,
      type: "server",
      capabilities: caps,
    });
    state.placeComponent(server);
    state.visitOrder.push(...computeVisitOrder(state.components));

    // Seed a pending request so injectTraffic has no-op, but processing has work.
    state.enqueuePending(server.id, {
      id: "r1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: server.id,
      createdAt: 0,
      ttl: 10,
      originZone: "default",
      streamDuration: null,
      streamBandwidth: null,
    });

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: server.id,
      intensity: 0,
      requestType: "api_read",
    });

    engine.tick(mc);

    // After tick 0: lastTickEvents holds whatever was emitted this tick
    // (ENTERED from any traffic + RESPONDED from the processed request).
    const tick0Events = [...state.lastTickEvents];
    expect(tick0Events.length).toBeGreaterThan(0);
    expect(tick0Events.some((e) => e.type === "RESPONDED")).toBe(true);

    // Run a second, quiet tick. lastTickEvents must be cleared at the start,
    // then re-populated only with this tick's events (likely empty).
    engine.tick(mc);
    for (const ev of state.lastTickEvents) {
      expect(ev.tick).toBe(1); // only tick=1 events
    }
  });

  it("stamps each entry with the owning requestId (Stage 3c PerTickEventView)", () => {
    // The renderer adapter correlates FORWARDED dots with subsequent
    // SERVED/DROPPED flashes via ev.requestId. The engine's appendEvent
    // must include the requestId on the lastTickEvents entry even though
    // requestLog itself keys by requestId without embedding it.
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const respCap = new RespondingCapability("resp" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set(respCap.id, respCap);
    const server = makeComponent({
      id: "s1" as ComponentId,
      type: "server",
      capabilities: caps,
    });
    state.placeComponent(server);
    state.visitOrder.push(...computeVisitOrder(state.components));

    state.enqueuePending(server.id, {
      id: "r-stamp" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: server.id,
      createdAt: 0,
      ttl: 10,
      originZone: "default",
      streamDuration: null,
      streamBandwidth: null,
    });

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: server.id,
      intensity: 0,
      requestType: "api_read",
    });
    engine.tick(mc);

    // Every entry in lastTickEvents must carry the owning requestId.
    expect(state.lastTickEvents.length).toBeGreaterThan(0);
    for (const ev of state.lastTickEvents) {
      expect(ev.requestId).toBe("r-stamp");
    }
  });
});

import { describe, it, expect } from "vitest";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { SandboxEconomy } from "@modes/sandbox/sandbox-economy";
import { SimulationState } from "@core/state/simulation-state";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { makeComponent, makePort } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { ChaosEvent } from "@core/types/chaos";
import type { TickMetrics } from "@core/types/metrics";

function makeServerComponent() {
  const caps = new Map<CapabilityId, Capability>([
    [
      "cap-proc" as CapabilityId,
      new ProcessingCapability("cap-proc" as CapabilityId, { outcomeKind: "RESPOND" }),
    ],
  ]);
  const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
  return makeComponent({
    id: "c-server",
    ports: [makePort("p-in", "ingress")],
    capabilities: caps,
    tiers,
  });
}

function makeEmptyMetrics(overrides: Partial<TickMetrics> = {}): TickMetrics {
  return {
    tick: 0,
    requestsProcessed: 0,
    requestsResolved: 0,
    requestsDropped: 0,
    requestsOverloaded: 0,
    requestsBackpressured: 0,
    requestsTimedOut: 0,
    revenueEarned: 0,
    upkeepPaid: 0,
    avgLatency: 0,
    perComponent: new Map(),
    ...overrides,
  };
}

describe("SandboxModeController", () => {
  describe("capability access", () => {
    it("returns all capabilities (no filtering)", () => {
      const ctrl = new SandboxModeController();
      const comp = makeServerComponent();
      const active = ctrl.getActiveCapabilities(comp);
      expect(active.size).toBe(1);
      expect(active.has("cap-proc" as CapabilityId)).toBe(true);
    });

    it("tier cap is Infinity", () => {
      const ctrl = new SandboxModeController();
      const comp = makeServerComponent();
      expect(ctrl.getTierCap(comp, "cap-proc" as CapabilityId)).toBe(Infinity);
    });
  });

  describe("build constraints", () => {
    it("allows all component types (empty list = no restriction)", () => {
      const ctrl = new SandboxModeController();
      const constraints = ctrl.getBuildConstraints();
      expect(constraints.availableComponentTypes).toEqual([]);
      expect(constraints.maxPlacements).toBeUndefined();
      expect(constraints.zoneAllowlist).toBeUndefined();
    });
  });

  describe("phase management", () => {
    it("starts in build phase", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.getPhase()).toBe("build");
    });

    it("cycles build → simulate → assess → build", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.getPhase()).toBe("build");

      ctrl.advancePhase();
      expect(ctrl.getPhase()).toBe("simulate");

      ctrl.advancePhase();
      expect(ctrl.getPhase()).toBe("assess");

      ctrl.advancePhase();
      expect(ctrl.getPhase()).toBe("build");
    });
  });

  describe("placement and upgrade", () => {
    it("tryPlace always succeeds with generated componentId", () => {
      const ctrl = new SandboxModeController();
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const result = ctrl.tryPlace(state, "server", { x: 0, y: 0 }, null);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.componentId).toMatch(/^sandbox-placed-/);
      }
    });

    it("tryPlace generates unique IDs", () => {
      const ctrl = new SandboxModeController();
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const r1 = ctrl.tryPlace(state, "server", { x: 0, y: 0 }, null);
      const r2 = ctrl.tryPlace(state, "cache", { x: 1, y: 0 }, null);
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.componentId).not.toBe(r2.componentId);
      }
    });

    it("tryUpgrade succeeds for existing capability", () => {
      const ctrl = new SandboxModeController();
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const comp = makeServerComponent();
      state.placeComponent(comp);

      const result = ctrl.tryUpgrade(state, comp.id, "cap-proc" as CapabilityId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newPlayerTier).toBe(2); // 1 + 1
      }
    });

    it("tryUpgrade fails for missing component", () => {
      const ctrl = new SandboxModeController();
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const result = ctrl.tryUpgrade(state, "nonexistent" as ComponentId, "cap-proc" as CapabilityId);
      expect(result.ok).toBe(false);
    });

    it("tryUpgrade fails for missing capability on existing component", () => {
      const ctrl = new SandboxModeController();
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const comp = makeComponent({ id: "c-bare" });
      state.placeComponent(comp);

      const result = ctrl.tryUpgrade(state, comp.id, "nonexistent" as CapabilityId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("capability_not_found");
      }
    });
  });

  describe("chaos scheduling", () => {
    it("getScheduledChaos returns events at the correct tick", () => {
      const ctrl = new SandboxModeController();
      const event: ChaosEvent = { kind: "component_failure", componentId: "c-1" as ComponentId };
      ctrl.scheduleChaos(event, 5);

      expect(ctrl.getScheduledChaos(4)).toHaveLength(0);
      expect(ctrl.getScheduledChaos(5)).toHaveLength(1);
      expect(ctrl.getScheduledChaos(5)[0]).toEqual(event);
      expect(ctrl.getScheduledChaos(6)).toHaveLength(0);
    });

    it("supports multiple chaos events at same tick", () => {
      const ctrl = new SandboxModeController();
      const e1: ChaosEvent = { kind: "component_failure", componentId: "c-1" as ComponentId };
      const e2: ChaosEvent = { kind: "zone_outage", zone: "us-east", durationTicks: 3 };
      ctrl.scheduleChaos(e1, 10);
      ctrl.scheduleChaos(e2, 10);

      expect(ctrl.getScheduledChaos(10)).toHaveLength(2);
    });
  });

  describe("traffic source management", () => {
    it("starts with no traffic sources", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.getTrafficSources()).toHaveLength(0);
    });

    it("addTrafficSource returns index", () => {
      const ctrl = new SandboxModeController();
      const idx = ctrl.addTrafficSource({
        targetEntryPointId: "c-entry" as ComponentId,
        requestType: "api_read",
        intensity: 10,
        pattern: "steady",
      });
      expect(idx).toBe(0);
      expect(ctrl.getTrafficSources()).toHaveLength(1);
    });

    it("removeTrafficSource removes by index", () => {
      const ctrl = new SandboxModeController();
      ctrl.addTrafficSource({
        targetEntryPointId: "c-entry" as ComponentId,
        requestType: "api_read",
        intensity: 10,
        pattern: "steady",
      });
      expect(ctrl.removeTrafficSource(0)).toBe(true);
      expect(ctrl.getTrafficSources()).toHaveLength(0);
    });

    it("removeTrafficSource returns false for invalid index", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.removeTrafficSource(0)).toBe(false);
      expect(ctrl.removeTrafficSource(-1)).toBe(false);
    });

    it("getTrafficSource returns CompositeTrafficSource", () => {
      const ctrl = new SandboxModeController();
      ctrl.addTrafficSource({
        targetEntryPointId: "c-entry" as ComponentId,
        requestType: "api_read",
        intensity: 5,
        pattern: "steady",
      });
      const composite = ctrl.getTrafficSource();
      expect(composite.targetEntryPointId).toBeNull(); // CompositeTrafficSource always null
      const requests = composite.generate(0);
      expect(requests).toHaveLength(5);
    });
  });

  describe("evaluateOutcome", () => {
    it("returns neutral verdict with empty metrics", () => {
      const ctrl = new SandboxModeController();
      const result = ctrl.evaluateOutcome([]);
      expect(result.verdict).toBe("neutral");
      expect(result.score.composite).toBe(0);
    });

    it("returns neutral verdict with real metrics", () => {
      const ctrl = new SandboxModeController();
      const metrics = [
        makeEmptyMetrics({
          requestsResolved: 100,
          requestsDropped: 10,
          revenueEarned: 200,
          upkeepPaid: 50,
          avgLatency: 2,
        }),
      ];
      const result = ctrl.evaluateOutcome(metrics);
      expect(result.verdict).toBe("neutral");
      expect(result.score.reliability).toBeCloseTo(100 / 110, 2);
      expect(result.score.cost).toBeCloseTo(0.75, 2); // 1 - 50/200
      expect(result.score.composite).toBeGreaterThan(0);
    });
  });

  describe("zone topology", () => {
    it("returns single default zone", () => {
      const ctrl = new SandboxModeController();
      const topo = ctrl.getInitialZoneTopology();
      expect(topo.zones).toEqual(["default"]);
      expect(topo.pairLatency.size).toBe(0);
    });
  });

  describe("economy", () => {
    it("uses SandboxEconomy", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.economy).toBeInstanceOf(SandboxEconomy);
    });
  });

  describe("addTrafficSourceFromPreset", () => {
    it("creates a source from a known preset", () => {
      const ctrl = new SandboxModeController();
      const target = "c-entry" as ComponentId;
      const idx = ctrl.addTrafficSourceFromPreset("steady-load", target);
      expect(idx).toBe(0);
      expect(ctrl.getTrafficSources()).toHaveLength(1);

      const source = ctrl.getTrafficSources()[0]!;
      expect(source.targetEntryPointId).toBe(target);
      expect(source.config.pattern).toBe("steady");
      expect(source.config.intensity).toBe(50);
    });

    it("throws for unknown preset name", () => {
      const ctrl = new SandboxModeController();
      expect(() =>
        ctrl.addTrafficSourceFromPreset("nonexistent" as any, "c-entry" as ComponentId),
      ).toThrow(/Unknown traffic preset/);
    });
  });

  describe("clearTrafficSources", () => {
    it("empties the sources array", () => {
      const ctrl = new SandboxModeController();
      ctrl.addTrafficSource({
        targetEntryPointId: "c-entry" as ComponentId,
        requestType: "api_read",
        intensity: 10,
        pattern: "steady",
      });
      ctrl.addTrafficSource({
        targetEntryPointId: "c-entry" as ComponentId,
        requestType: "api_write",
        intensity: 5,
        pattern: "spike",
      });
      expect(ctrl.getTrafficSources()).toHaveLength(2);

      ctrl.clearTrafficSources();
      expect(ctrl.getTrafficSources()).toHaveLength(0);
    });
  });

  describe("clearChaosQueue", () => {
    it("empties the chaos queue", () => {
      const ctrl = new SandboxModeController();
      ctrl.scheduleChaos(
        { kind: "component_failure", componentId: "c-1" as ComponentId },
        5,
      );
      ctrl.scheduleChaos(
        { kind: "zone_outage", zone: "us-east", durationTicks: 3 },
        10,
      );
      expect(ctrl.getChaosQueue()).toHaveLength(2);

      ctrl.clearChaosQueue();
      expect(ctrl.getChaosQueue()).toHaveLength(0);
    });
  });

  describe("getChaosQueue", () => {
    it("returns the full chaos queue", () => {
      const ctrl = new SandboxModeController();
      ctrl.scheduleChaos(
        { kind: "component_failure", componentId: "c-1" as ComponentId },
        5,
      );
      const queue = ctrl.getChaosQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]!.event.kind).toBe("component_failure");
      expect(queue[0]!.atTick).toBe(5);
    });
  });
});

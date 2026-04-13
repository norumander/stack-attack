import { describe, it, expect } from "vitest";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import {
  exportScenario,
  applyScenario,
  serializeScenario,
  parseScenario,
} from "@modes/sandbox/sandbox-scenario";
import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { ChaosEvent } from "@core/types/chaos";

const TARGET = "c-entry" as ComponentId;

describe("exportScenario", () => {
  it("captures zones, traffic sources, and chaos queue", () => {
    const ctrl = new SandboxModeController();
    ctrl.addZone("us-east");
    ctrl.setZonePairLatency("default", "us-east", 50);
    ctrl.addTrafficSource({
      targetEntryPointId: TARGET,
      requestType: "api_read",
      intensity: 10,
      pattern: "steady",
    });
    ctrl.scheduleChaos(
      { kind: "component_failure", componentId: "c-server" as ComponentId },
      5,
    );

    const scenario = exportScenario("Test", "A test scenario", ctrl);

    expect(scenario.version).toBe(1);
    expect(scenario.name).toBe("Test");
    expect(scenario.description).toBe("A test scenario");
    expect(scenario.zones).toEqual(["default", "us-east"]);
    expect(scenario.pairLatencies).toEqual([
      { zoneA: "default", zoneB: "us-east", latency: 50 },
    ]);
    expect(scenario.trafficSources).toHaveLength(1);
    expect(scenario.trafficSources[0]!.requestType).toBe("api_read");
    expect(scenario.chaosSchedule).toHaveLength(1);
    expect(scenario.chaosSchedule[0]!.atTick).toBe(5);
  });

  it("omits runtime state (economy, metrics, counters)", () => {
    const ctrl = new SandboxModeController();
    ctrl.addTrafficSource({
      targetEntryPointId: TARGET,
      requestType: "api_read",
      intensity: 5,
      pattern: "steady",
    });

    const scenario = exportScenario("Test", "", ctrl);

    // Scenario should not have economy, metrics, or internal counter fields
    expect(scenario).not.toHaveProperty("economy");
    expect(scenario).not.toHaveProperty("metrics");
    expect(scenario).not.toHaveProperty("counter");
  });
});

describe("applyScenario", () => {
  it("sets zones, traffic sources, and chaos schedule", () => {
    const ctrl = new SandboxModeController();

    applyScenario(
      {
        version: 1,
        name: "Applied",
        description: "",
        zones: ["us-east", "eu-west"],
        pairLatencies: [{ zoneA: "us-east", zoneB: "eu-west", latency: 80 }],
        trafficSources: [
          {
            requestType: "api_write",
            intensity: 20,
            pattern: "spike",
          },
        ],
        chaosSchedule: [
          {
            event: { kind: "zone_outage", zone: "eu-west", durationTicks: 5 },
            atTick: 10,
          },
        ],
      },
      ctrl,
      TARGET,
    );

    expect(ctrl.getZones()).toEqual(["us-east", "eu-west"]);
    expect(ctrl.getZonePairLatencies().get("eu-west|us-east")).toBe(80);
    expect(ctrl.getTrafficSources()).toHaveLength(1);
    expect(ctrl.getTrafficSources()[0]!.config.requestType).toBe("api_write");
    expect(ctrl.getTrafficSources()[0]!.targetEntryPointId).toBe(TARGET);
    expect(ctrl.getChaosQueue()).toHaveLength(1);
    expect(ctrl.getChaosQueue()[0]!.atTick).toBe(10);
  });

  it("retargets traffic sources to the supplied entry-point id", () => {
    // Scenarios are load-time rebound because component ids drift across
    // topology rebuilds — this guards the C1 regression.
    const ctrl = new SandboxModeController();
    const freshEntry = "c-entry-v2" as ComponentId;

    applyScenario(
      {
        version: 1,
        name: "Rebind",
        description: "",
        zones: ["default"],
        pairLatencies: [],
        trafficSources: [
          { requestType: "api_read", intensity: 5, pattern: "steady" },
          { requestType: "api_write", intensity: 10, pattern: "spike" },
        ],
        chaosSchedule: [],
      },
      ctrl,
      freshEntry,
    );

    const sources = ctrl.getTrafficSources();
    expect(sources).toHaveLength(2);
    expect(sources[0]!.targetEntryPointId).toBe(freshEntry);
    expect(sources[1]!.targetEntryPointId).toBe(freshEntry);
  });

  it("clears previous state before applying", () => {
    const ctrl = new SandboxModeController();
    ctrl.addZone("old-zone");
    ctrl.addTrafficSource({
      targetEntryPointId: TARGET,
      requestType: "api_read",
      intensity: 5,
      pattern: "steady",
    });
    ctrl.scheduleChaos(
      { kind: "component_failure", componentId: "c-old" as ComponentId },
      1,
    );

    applyScenario(
      {
        version: 1,
        name: "Fresh",
        description: "",
        zones: ["new-zone"],
        pairLatencies: [],
        trafficSources: [],
        chaosSchedule: [],
      },
      ctrl,
      TARGET,
    );

    expect(ctrl.getZones()).toEqual(["new-zone"]);
    expect(ctrl.getTrafficSources()).toHaveLength(0);
    expect(ctrl.getChaosQueue()).toHaveLength(0);
  });
});

describe("serializeScenario + parseScenario roundtrip", () => {
  it("produces identical scenario after roundtrip", () => {
    const ctrl = new SandboxModeController();
    ctrl.addZone("us-east");
    ctrl.addZone("eu-west");
    ctrl.setZonePairLatency("us-east", "eu-west", 80);
    ctrl.addTrafficSource({
      targetEntryPointId: TARGET,
      requestType: "api_read",
      intensity: 50,
      pattern: "steady",
      requestTypeDistribution: [
        { type: "api_read", weight: 60 },
        { type: "api_write", weight: 40 },
      ],
    });
    ctrl.scheduleChaos(
      { kind: "component_failure", componentId: "c-server" as ComponentId },
      5,
    );
    ctrl.scheduleChaos(
      {
        kind: "latency_injection",
        connectionId: "cx-1" as ConnectionId,
        extraLatency: 10,
        durationTicks: 3,
      },
      8,
    );

    const original = exportScenario("Roundtrip", "Test roundtrip", ctrl);
    const json = serializeScenario(original);
    const parsed = parseScenario(json);

    expect(parsed.version).toBe(original.version);
    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.zones).toEqual([...original.zones]);
    expect(parsed.pairLatencies).toEqual([...original.pairLatencies]);
    expect(parsed.trafficSources).toEqual([...original.trafficSources]);
    expect(parsed.chaosSchedule).toEqual([...original.chaosSchedule]);
  });

  it("apply after roundtrip produces same export", () => {
    const ctrl = new SandboxModeController();
    ctrl.addZone("us-east");
    ctrl.setZonePairLatency("default", "us-east", 50);
    ctrl.addTrafficSource({
      targetEntryPointId: TARGET,
      requestType: "api_read",
      intensity: 10,
      pattern: "steady",
    });

    const original = exportScenario("Test", "Desc", ctrl);
    const json = serializeScenario(original);
    const parsed = parseScenario(json);

    const ctrl2 = new SandboxModeController();
    applyScenario(parsed, ctrl2, TARGET);
    const reExported = exportScenario("Test", "Desc", ctrl2);

    expect(reExported.zones).toEqual([...original.zones]);
    expect(reExported.pairLatencies).toEqual([...original.pairLatencies]);
    expect(reExported.trafficSources).toEqual([...original.trafficSources]);
    expect(reExported.chaosSchedule).toEqual([...original.chaosSchedule]);
  });
});

describe("parseScenario validation", () => {
  it("rejects invalid version", () => {
    const json = JSON.stringify({ version: 2, zones: ["default"], trafficSources: [], chaosSchedule: [] });
    expect(() => parseScenario(json)).toThrow(/Unsupported scenario version/);
  });

  it("rejects empty zones array", () => {
    const json = JSON.stringify({ version: 1, zones: [], trafficSources: [], chaosSchedule: [] });
    expect(() => parseScenario(json)).toThrow(/at least one zone/);
  });

  it("rejects missing trafficSources", () => {
    const json = JSON.stringify({ version: 1, zones: ["default"], chaosSchedule: [] });
    expect(() => parseScenario(json)).toThrow(/trafficSources/);
  });

  it("rejects traffic source missing required fields", () => {
    const json = JSON.stringify({
      version: 1,
      zones: ["default"],
      trafficSources: [{ intensity: 10 }],
      chaosSchedule: [],
    });
    expect(() => parseScenario(json)).toThrow(/requestType/);
  });

  it("rejects traffic source with negative intensity", () => {
    const json = JSON.stringify({
      version: 1,
      zones: ["default"],
      trafficSources: [
        { requestType: "api_read", intensity: -5, pattern: "steady" },
      ],
      chaosSchedule: [],
    });
    expect(() => parseScenario(json)).toThrow(/non-negative intensity/);
  });
});

describe("full scenario with all features", () => {
  it("handles multi-zone, multi-source, multi-chaos", () => {
    const chaos1: ChaosEvent = { kind: "component_failure", componentId: "c-server" as ComponentId };
    const chaos2: ChaosEvent = { kind: "zone_outage", zone: "eu-west", durationTicks: 5 };
    const chaos3: ChaosEvent = {
      kind: "connection_sever",
      connectionId: "cx-1" as ConnectionId,
      durationTicks: 3,
    };

    const ctrl = new SandboxModeController();
    ctrl.addZone("us-east");
    ctrl.addZone("eu-west");
    ctrl.addZone("ap-south");
    ctrl.setZonePairLatency("us-east", "eu-west", 80);
    ctrl.setZonePairLatency("us-east", "ap-south", 150);
    ctrl.setZonePairLatency("eu-west", "ap-south", 120);

    ctrl.addTrafficSource({
      targetEntryPointId: "c-entry-1" as ComponentId,
      requestType: "api_read",
      intensity: 50,
      pattern: "steady",
      originZone: "us-east",
    });
    ctrl.addTrafficSource({
      targetEntryPointId: "c-entry-2" as ComponentId,
      requestType: "stream",
      intensity: 20,
      pattern: "burst",
      originZone: "eu-west",
    });

    ctrl.scheduleChaos(chaos1, 5);
    ctrl.scheduleChaos(chaos2, 10);
    ctrl.scheduleChaos(chaos3, 15);

    const scenario = exportScenario("Full Test", "Everything", ctrl);

    expect(scenario.zones).toHaveLength(4); // default + 3 added
    expect(scenario.pairLatencies).toHaveLength(3);
    expect(scenario.trafficSources).toHaveLength(2);
    expect(scenario.chaosSchedule).toHaveLength(3);

    // Roundtrip
    const json = serializeScenario(scenario);
    const parsed = parseScenario(json);

    const ctrl2 = new SandboxModeController();
    applyScenario(parsed, ctrl2, "c-entry-1" as ComponentId);

    expect(ctrl2.getZones()).toHaveLength(4);
    expect(ctrl2.getTrafficSources()).toHaveLength(2);
    expect(ctrl2.getChaosQueue()).toHaveLength(3);
  });
});

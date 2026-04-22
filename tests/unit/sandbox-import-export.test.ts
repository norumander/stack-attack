import { describe, it, expect } from "vitest";
import { exportTopology, importTopology } from "../../src/sandbox/import-export";
import type { TopologyDef } from "../../src/playtest/topology-builder";
import type { SandboxTrafficSettings } from "../../src/sandbox/import-export";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTopo: TopologyDef = {
  label: "test-topo",
  components: [
    { type: "server", id: "s1" },
    { type: "database", id: "db1" },
  ],
  entryTargetId: "s1",
  connections: [{ from: "s1", to: "db1" }],
  autoScaleIds: [],
};

const trafficSettings: SandboxTrafficSettings = {
  intensity: 0.6,
  composition: {
    writeRatio: 0.3,
    authRatio: 0.1,
    streamRatio: 0.05,
    largeRatio: 0.05,
    asyncRatio: 0.1,
  },
  keyDistribution: { kind: "zipf", alpha: 1.2, spaceSize: 1000 },
};

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("exportTopology / importTopology round-trip", () => {
  it("preserves components and connections without traffic", () => {
    const json = exportTopology(baseTopo);
    const result = importTopology(json);

    expect(result).not.toBeNull();
    expect(result!.topology.components).toEqual(baseTopo.components);
    expect(result!.topology.connections).toEqual(baseTopo.connections);
    expect(result!.topology.entryTargetId).toBe(baseTopo.entryTargetId);
    expect(result!.topology.label).toBe(baseTopo.label);
    expect(result!.traffic).toBeUndefined();
  });

  it("preserves traffic settings when provided", () => {
    const json = exportTopology(baseTopo, trafficSettings);
    const result = importTopology(json);

    expect(result).not.toBeNull();
    expect(result!.traffic).toEqual(trafficSettings);
  });

  it("preserves components with zone and label fields", () => {
    const topoWithZone: TopologyDef = {
      ...baseTopo,
      components: [
        { type: "server", id: "s1", zone: "zone_na", label: "Web Server" },
        { type: "database", id: "db1" },
      ],
      autoScaleIds: ["s1"],
    };

    const json = exportTopology(topoWithZone, trafficSettings);
    const result = importTopology(json);

    expect(result).not.toBeNull();
    expect(result!.topology.components[0]).toMatchObject({ zone: "zone_na", label: "Web Server" });
    expect(result!.topology.autoScaleIds).toContain("s1");
    expect(result!.traffic?.keyDistribution).toEqual(trafficSettings.keyDistribution);
  });

  it("produces valid JSON that is parseable", () => {
    const json = exportTopology(baseTopo, trafficSettings);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Malformed / invalid input
// ---------------------------------------------------------------------------

describe("importTopology — invalid input returns null", () => {
  it("returns null for malformed JSON", () => {
    expect(importTopology("not json at all")).toBeNull();
    expect(importTopology("{unterminated")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(importTopology("")).toBeNull();
  });

  it("returns null when entryTargetId is missing", () => {
    const json = JSON.stringify({
      label: "x",
      components: [],
      connections: [],
      autoScaleIds: [],
    });
    expect(importTopology(json)).toBeNull();
  });

  it("returns null when components is missing", () => {
    const json = JSON.stringify({
      label: "x",
      entryTargetId: "s1",
      connections: [],
      autoScaleIds: [],
    });
    expect(importTopology(json)).toBeNull();
  });

  it("returns null when connections is missing", () => {
    const json = JSON.stringify({
      label: "x",
      entryTargetId: "s1",
      components: [],
      autoScaleIds: [],
    });
    expect(importTopology(json)).toBeNull();
  });

  it("returns null for a JSON array instead of object", () => {
    expect(importTopology("[]")).toBeNull();
  });

  it("returns null for JSON null", () => {
    expect(importTopology("null")).toBeNull();
  });

  it("returns null for a JSON primitive", () => {
    expect(importTopology('"hello"')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Import without traffic field
// ---------------------------------------------------------------------------

describe("importTopology — traffic field optional", () => {
  it("succeeds when traffic field is absent", () => {
    const json = JSON.stringify({
      label: "minimal",
      entryTargetId: "s1",
      components: [{ type: "server", id: "s1" }],
      connections: [],
      autoScaleIds: [],
    });
    const result = importTopology(json);
    expect(result).not.toBeNull();
    expect(result!.traffic).toBeUndefined();
  });

  it("topology fields are correct for minimal input", () => {
    const json = JSON.stringify({
      entryTargetId: "s1",
      components: [{ type: "server", id: "s1" }],
      connections: [{ from: "s1", to: "db1" }],
    });
    const result = importTopology(json);
    expect(result).not.toBeNull();
    expect(result!.topology.entryTargetId).toBe("s1");
    expect(result!.topology.connections).toHaveLength(1);
    expect(result!.topology.label).toBe("");
    expect(result!.topology.autoScaleIds).toEqual([]);
  });
});

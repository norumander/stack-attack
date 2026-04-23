import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toHCL, fromHCL } from "../../src/sandbox/hcl";
import type { TopologyDef } from "../../src/playtest/topology-builder";
import type { SandboxTrafficSettings } from "../../src/sandbox/import-export";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTopo: TopologyDef = {
  label: "round-trip-test",
  components: [
    { type: "server", id: "s1", label: "Server 1" },
    { type: "database", id: "db1", label: "Database" },
  ],
  entryTargetId: "s1",
  connections: [{ from: "s1", to: "db1" }],
  autoScaleIds: [],
};

const trafficSettings: SandboxTrafficSettings = {
  intensity: 75,
  composition: {
    writeRatio: 0.2,
    authRatio: 0.1,
    streamRatio: 0.15,
    largeRatio: 0.05,
    asyncRatio: 0.1,
  },
  keyDistribution: { kind: "zipf", alpha: 1.5, spaceSize: 500 },
};

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("toHCL / fromHCL round-trip", () => {
  it("preserves topology without traffic", () => {
    const hcl = toHCL(baseTopo);
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.topology.components).toHaveLength(2);
    expect(result!.topology.entryTargetId).toBe("s1");
    expect(result!.topology.connections).toEqual([{ from: "s1", to: "db1" }]);
    expect(result!.traffic).toBeUndefined();
  });

  it("preserves topology with traffic", () => {
    const hcl = toHCL(baseTopo, trafficSettings);
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.traffic).toBeDefined();
    expect(result!.traffic!.intensity).toBe(75);
    expect(result!.traffic!.composition.writeRatio).toBeCloseTo(0.2, 1);
    expect(result!.traffic!.composition.authRatio).toBeCloseTo(0.1, 1);
    expect(result!.traffic!.composition.streamRatio).toBeCloseTo(0.15, 1);
    expect(result!.traffic!.composition.largeRatio).toBeCloseTo(0.05, 1);
    expect(result!.traffic!.composition.asyncRatio).toBeCloseTo(0.1, 1);
    expect(result!.traffic!.keyDistribution).toEqual({
      kind: "zipf",
      alpha: 1.5,
      spaceSize: 500,
    });
  });

  it("preserves component labels and zones", () => {
    const topo: TopologyDef = {
      label: "zone-test",
      components: [
        { type: "server", id: "s1", label: "App Server", zone: "zone_na" },
        { type: "database", id: "db1", label: "Primary DB", zone: "zone_eu" },
      ],
      entryTargetId: "s1",
      connections: [{ from: "s1", to: "db1" }],
      autoScaleIds: [],
    };
    const hcl = toHCL(topo);
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.topology.components[0]!.zone).toBe("zone_na");
    expect(result!.topology.components[1]!.zone).toBe("zone_eu");
    expect(result!.topology.components[0]!.label).toBe("App Server");
  });

  it("handles uniform key distribution", () => {
    const traffic: SandboxTrafficSettings = {
      intensity: 50,
      composition: {
        writeRatio: 0,
        authRatio: 0,
        streamRatio: 0,
        largeRatio: 0,
        asyncRatio: 0,
      },
      keyDistribution: { kind: "uniform", spaceSize: 300 },
    };
    const hcl = toHCL(baseTopo, traffic);
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.traffic!.keyDistribution).toEqual({
      kind: "uniform",
      spaceSize: 300,
    });
  });
});

// ---------------------------------------------------------------------------
// Reference file test
// ---------------------------------------------------------------------------

describe("full-traffic-test.tf reference file", () => {
  it("parses the reference preset correctly", () => {
    const tfPath = resolve(__dirname, "../../docs/sandbox-presets/full-traffic-test.tf");
    const hcl = readFileSync(tfPath, "utf-8");
    const result = fromHCL(hcl);

    expect(result).not.toBeNull();

    // Components
    expect(result!.topology.components).toHaveLength(10);
    expect(result!.topology.entryTargetId).toBe("router1");
    expect(result!.topology.components[0]).toEqual({
      type: "edge_router",
      id: "router1",
      label: "Edge Router",
    });

    // Connections
    expect(result!.topology.connections).toHaveLength(11);
    expect(result!.topology.connections[0]).toEqual({
      from: "router1",
      to: "cdn1",
    });

    // Traffic
    expect(result!.traffic).toBeDefined();
    expect(result!.traffic!.intensity).toBe(80);
    expect(result!.traffic!.composition.writeRatio).toBeCloseTo(0.1, 2);
    expect(result!.traffic!.composition.authRatio).toBeCloseTo(0.15, 2);
    expect(result!.traffic!.composition.streamRatio).toBeCloseTo(0.2, 2);
    expect(result!.traffic!.composition.largeRatio).toBeCloseTo(0.25, 2);
    expect(result!.traffic!.composition.asyncRatio).toBe(0);
    expect(result!.traffic!.keyDistribution).toEqual({
      kind: "zipf",
      alpha: 1.3,
      spaceSize: 200,
    });
  });
});

// ---------------------------------------------------------------------------
// Parser resilience
// ---------------------------------------------------------------------------

describe("fromHCL parser edge cases", () => {
  it("handles extra whitespace and comments", () => {
    const hcl = `
      # A comment at the top

      resource "stackattack_server"   "s1"  {
        label = "Server"
        # inline comment
      }

      resource "stackattack_database"  "db1" {
        label = "DB"
      }

      connection "s1_to_db1" {
        from = stackattack_server.s1
        to   = stackattack_database.db1
      }
    `;
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.topology.components).toHaveLength(2);
    expect(result!.topology.connections).toHaveLength(1);
  });

  it("returns null for empty input", () => {
    expect(fromHCL("")).toBeNull();
  });

  it("returns null for malformed HCL (missing brace)", () => {
    const hcl = `resource "stackattack_server" "s1" { label = "S"`;
    expect(fromHCL(hcl)).toBeNull();
  });

  it("returns null for invalid resource type prefix", () => {
    const hcl = `resource "aws_server" "s1" { label = "S" }`;
    expect(fromHCL(hcl)).toBeNull();
  });

  it("returns null for completely invalid text", () => {
    expect(fromHCL("not valid hcl at all %%%")).toBeNull();
  });

  it("parses topology without traffic block", () => {
    const hcl = `
resource "stackattack_server" "s1" {
  label = "S"
}
connection "s1_to_s1" {
  from = stackattack_server.s1
  to   = stackattack_server.s1
}
    `;
    const result = fromHCL(hcl);
    expect(result).not.toBeNull();
    expect(result!.traffic).toBeUndefined();
  });
});

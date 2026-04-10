import { describe, it, expect } from "vitest";
import {
  zonePairKey,
  getZonePairLatency,
  type ZoneTopology,
} from "@core/types/zone";

describe("zone helpers", () => {
  it("zonePairKey is order-independent", () => {
    expect(zonePairKey("us-east", "us-west")).toBe(zonePairKey("us-west", "us-east"));
  });

  it("same zone returns 0 regardless of topology", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, "us-east", "us-east")).toBe(0);
  });

  it("null zone returns 0", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, null, "us-east")).toBe(0);
    expect(getZonePairLatency(topo, "us-east", null)).toBe(0);
    expect(getZonePairLatency(topo, null, null)).toBe(0);
  });

  it("empty topology returns 0 for any cross-zone pair", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, "us-east", "us-west")).toBe(0);
  });

  it("populated topology returns the configured latency", () => {
    const topo: ZoneTopology = {
      zones: ["us-east", "us-west"],
      pairLatency: new Map([[zonePairKey("us-east", "us-west"), 40]]),
    };
    expect(getZonePairLatency(topo, "us-east", "us-west")).toBe(40);
    expect(getZonePairLatency(topo, "us-west", "us-east")).toBe(40);
  });
});

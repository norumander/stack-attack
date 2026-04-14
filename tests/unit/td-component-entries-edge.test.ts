import { describe, it, expect } from "vitest";
import { CDN_ENTRY } from "@modes/td/td-component-entries";

describe("TD_CDN_ENTRY", () => {
  it("has caching, forwarding-pipe, monitoring capabilities", () => {
    const ids = CDN_ENTRY.capabilities.map((c) => c.id);
    expect(ids).toContain("caching");
    expect(ids).toContain("forwarding-pipe");
    expect(ids).toContain("monitoring");
  });

  it("has placement cost 200", () => {
    expect(CDN_ENTRY.placementCost).toBe(200);
  });

  it("has http ingress and egress ports of capacity 2", () => {
    const ingress = CDN_ENTRY.ports.find((p) => p.direction === "ingress");
    const egress = CDN_ENTRY.ports.find((p) => p.direction === "egress");
    expect(ingress).toBeDefined();
    expect(egress).toBeDefined();
    expect(ingress!.dataType).toBe("http");
    expect(egress!.dataType).toBe("http");
    expect(ingress!.capacity).toBe(2);
    expect(egress!.capacity).toBe(2);
  });

  it("uses a resilient condition profile (lower decay than default)", () => {
    expect(CDN_ENTRY.conditionProfile.decayRate).toBeLessThan(0.05);
  });

  it("has type cdn", () => {
    expect(CDN_ENTRY.type).toBe("cdn");
  });
});

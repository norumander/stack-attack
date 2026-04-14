import { describe, it, expect } from "vitest";
import { CDN_ENTRY } from "@modes/td/td-component-entries";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";

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

describe("registerTDDefaults: CDN registered", () => {
  it("registers cdn component type", () => {
    const cap = new CapabilityRegistry();
    const comp = new ComponentRegistry(cap);
    registerTDDefaults(cap, comp);
    const created = comp.create("cdn", { x: 0, y: 0 }, null);
    expect(created).not.toBeNull();
    expect(created!.type).toBe("cdn");
    const capIds = Array.from(created!.capabilities.keys());
    expect(capIds).toContain("caching");
    expect(capIds).toContain("forwarding-pipe");
    expect(capIds).toContain("monitoring");
  });

  it("Server processing accepts api_read and static_asset", () => {
    const cap = new CapabilityRegistry();
    const comp = new ComponentRegistry(cap);
    registerTDDefaults(cap, comp);
    const server = comp.create("server", { x: 0, y: 0 }, null);
    expect(server).not.toBeNull();
    const processing = server!.capabilities.get("processing" as any);
    expect(processing).toBeDefined();
    expect(processing!.canHandle("api_read")).toBe(true);
    expect(processing!.canHandle("static_asset")).toBe(true);
  });
});

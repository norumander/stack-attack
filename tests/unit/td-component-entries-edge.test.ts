import { describe, it, expect } from "vitest";
import { CDN_ENTRY, API_GATEWAY_ENTRY } from "@modes/td/td-component-entries";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import type { CapabilityId } from "@core/types/ids";
import { AuthCapability } from "@capabilities/auth/auth-capability";

describe("TD_CDN_ENTRY", () => {
  it("has caching, forwarding-pipe, monitoring capabilities", () => {
    const ids = CDN_ENTRY.capabilities.map((c) => c.id);
    expect(ids).toContain("caching");
    expect(ids).toContain("forwarding-pipe");
    expect(ids).toContain("monitoring");
  });

  it("has placement cost 0 (free placement; upkeep via rentPerWave)", () => {
    expect(CDN_ENTRY.placementCost).toBe(0);
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

describe("TD_API_GATEWAY_ENTRY", () => {
  it("has auth, forwarding-pipe, monitoring capabilities", () => {
    const ids = API_GATEWAY_ENTRY.capabilities.map((c) => c.id);
    expect(ids).toContain("auth");
    expect(ids).toContain("forwarding-pipe");
    expect(ids).toContain("monitoring");
  });

  it("has placement cost 0 (free placement; upkeep via rentPerWave)", () => {
    expect(API_GATEWAY_ENTRY.placementCost).toBe(0);
  });

  it("has http ingress and egress ports of capacity 2", () => {
    const ingress = API_GATEWAY_ENTRY.ports.find((p) => p.direction === "ingress");
    const egress = API_GATEWAY_ENTRY.ports.find((p) => p.direction === "egress");
    expect(ingress).toBeDefined();
    expect(egress).toBeDefined();
    expect(ingress!.capacity).toBe(2);
    expect(egress!.capacity).toBe(2);
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
    const processing = server!.capabilities.get("processing" as CapabilityId);
    expect(processing).toBeDefined();
    expect(processing!.canHandle("api_read")).toBe(true);
    expect(processing!.canHandle("static_asset")).toBe(true);
  });
});

describe("registerTDDefaults: API Gateway and Server auth wiring", () => {
  it("registers api_gateway component with terminateAuthRequired auth", () => {
    const cap = new CapabilityRegistry();
    const comp = new ComponentRegistry(cap);
    registerTDDefaults(cap, comp);
    const gateway = comp.create("api_gateway", { x: 0, y: 0 }, null);
    expect(gateway).not.toBeNull();
    const auth = gateway!.capabilities.get("auth" as CapabilityId) as AuthCapability;
    expect(auth).toBeDefined();
    // Drive auth_required through the auth cap and verify RESPOND
    const result = auth.process(
      {
        id: "r-1" as any,
        parentId: null,
        type: "auth_required",
        payload: null,
        origin: "c-a" as any,
        createdAt: 0,
        ttl: 10,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      },
      {
        state: { currentTick: 0 } as any,
        componentId: "c-a" as any,
        effectiveTier: 1,
        effectiveTiers: new Map([["auth" as CapabilityId, 1]]),
        activeCapabilityIds: new Set(),
        currentTick: 0,
        rng: () => 0,
        directories: [],
        childResponses: new Map(),
      } as any,
    );
    expect(result.outcome.kind).toBe("RESPOND");
  });

  it("Server processing accepts auth_required with +4 latency penalty", () => {
    const cap = new CapabilityRegistry();
    const comp = new ComponentRegistry(cap);
    registerTDDefaults(cap, comp);
    const server = comp.create("server", { x: 0, y: 0 }, null);
    const processing = server!.capabilities.get("processing" as CapabilityId) as any;
    expect(processing.canHandle("auth_required")).toBe(true);
    const result = processing.process(
      {
        id: "r-1" as any,
        parentId: null,
        type: "auth_required",
        payload: null,
        origin: "c-a" as any,
        createdAt: 0,
        ttl: 10,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      },
      {
        state: { currentTick: 0 } as any,
        componentId: "c-a" as any,
        effectiveTier: 1,
        effectiveTiers: new Map([["processing" as CapabilityId, 1]]),
        activeCapabilityIds: new Set(),
        currentTick: 0,
        rng: () => 0,
        directories: [],
        childResponses: new Map(),
      } as any,
    );
    expect(result.events[0].latencyAdded).toBe(5);
  });
});

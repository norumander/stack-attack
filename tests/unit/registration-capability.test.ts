import { describe, it, expect } from "vitest";
import { RegistrationCapability } from "@capabilities/registration/registration-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string, payload: unknown = null): Request {
  return { id: "r-1" as RequestId, parentId: null, type, payload, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}
function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("RegistrationCapability", () => {
  it("has PROCESS phase", () => { expect(new RegistrationCapability("reg" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle register and deregister", () => {
    const cap = new RegistrationCapability("reg" as CapabilityId);
    expect(cap.canHandle("register")).toBe(true);
    expect(cap.canHandle("deregister")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("registers and lists candidates", () => {
    const cap = new RegistrationCapability("reg" as CapabilityId);
    cap.process(req("register", { componentId: "c-srv" as ComponentId, componentType: "server", zone: "us-east", condition: 1 }), ctx());
    const candidates = cap.listCandidates({ componentType: "server" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.componentId).toBe("c-srv");
  });
  it("deregisters removes from list", () => {
    const cap = new RegistrationCapability("reg" as CapabilityId);
    cap.process(req("register", { componentId: "c-srv" as ComponentId, componentType: "server", zone: null, condition: 1 }), ctx());
    cap.process(req("deregister", { componentId: "c-srv" as ComponentId }), ctx());
    expect(cap.listCandidates({})).toHaveLength(0);
  });
  it("listCandidates filters by zone and health", () => {
    const cap = new RegistrationCapability("reg" as CapabilityId);
    cap.process(req("register", { componentId: "c-1" as ComponentId, componentType: "server", zone: "us-east", condition: 1 }), ctx());
    cap.process(req("register", { componentId: "c-2" as ComponentId, componentType: "server", zone: "eu-west", condition: 0.3 }), ctx());
    expect(cap.listCandidates({ zone: "us-east" })).toHaveLength(1);
    expect(cap.listCandidates({ healthyOnly: true })).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { bootTDRegistry } from "@harness/td-fixtures";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import type { CapabilityId } from "@core/types/ids";

describe("TD Server capability config (Data Cache redesign pin)", () => {
  it("Processing handles static_asset and auth_required but NOT api_read", () => {
    const compRegistry = bootTDRegistry();
    const server = compRegistry.create("server", { x: 0, y: 0 }, null);
    const processing = server.capabilities.get("processing" as CapabilityId) as ProcessingCapability;
    expect(processing.canHandle("static_asset")).toBe(true);
    expect(processing.canHandle("auth_required")).toBe(true);
    expect(processing.canHandle("api_read")).toBe(false);
  });

  it("Forwarding handles api_read and api_write", () => {
    const compRegistry = bootTDRegistry();
    const server = compRegistry.create("server", { x: 0, y: 0 }, null);
    const forwarding = server.capabilities.get("forwarding" as CapabilityId) as ForwardingCapability;
    expect(forwarding.canHandle("api_read")).toBe(true);
    expect(forwarding.canHandle("api_write")).toBe(true);
  });
});

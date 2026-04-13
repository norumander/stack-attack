import { describe, expect, it } from "vitest";
import { ComponentRegistry } from "@core/registry/component-registry.js";
import { CapabilityRegistry } from "@core/registry/capability-registry.js";
import { SERVER_ENTRY } from "@modes/td/td-component-entries.js";
import { ProcessingCapability } from "@capabilities/processing/processing-capability.js";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability.js";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability.js";
import type { CapabilityId } from "@core/types/ids.js";

function freshRegistry(): { capRegistry: CapabilityRegistry; compRegistry: ComponentRegistry } {
  const capRegistry = new CapabilityRegistry();
  capRegistry.register({ id: "processing" as CapabilityId, factory: () => new ProcessingCapability("processing" as CapabilityId) });
  capRegistry.register({ id: "forwarding" as CapabilityId, factory: () => new ForwardingCapability("forwarding" as CapabilityId, { handledTypes: ["api_read", "api_write"] }) });
  capRegistry.register({ id: "monitoring" as CapabilityId, factory: () => new MonitoringCapability("monitoring" as CapabilityId) });
  const compRegistry = new ComponentRegistry(capRegistry);
  compRegistry.register(SERVER_ENTRY);
  compRegistry.validate();
  return { capRegistry, compRegistry };
}

describe("ComponentRegistry.tryCreate", () => {
  it("returns a Component on known type", () => {
    const { compRegistry } = freshRegistry();
    const component = compRegistry.tryCreate("server", { x: 0, y: 0 }, null);
    expect(component).not.toBeNull();
    expect(component?.type).toBe("server");
  });

  it("returns null on unknown type instead of throwing", () => {
    const { compRegistry } = freshRegistry();
    expect(() => compRegistry.tryCreate("not_a_real_type", { x: 0, y: 0 }, null)).not.toThrow();
    const component = compRegistry.tryCreate("not_a_real_type", { x: 0, y: 0 }, null);
    expect(component).toBeNull();
  });

  it("create() still throws on unknown type (back-compat)", () => {
    const { compRegistry } = freshRegistry();
    expect(() => compRegistry.create("not_a_real_type", { x: 0, y: 0 }, null)).toThrow();
  });
});

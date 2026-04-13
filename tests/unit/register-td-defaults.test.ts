import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";

describe("registerTDDefaults", () => {
  it("populates capability and component registries without throwing", () => {
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    expect(() => registerTDDefaults(capRegistry, compRegistry)).not.toThrow();
  });
});

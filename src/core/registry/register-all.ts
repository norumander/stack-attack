import { CapabilityRegistry } from "./capability-registry.js";
import { ComponentRegistry } from "./component-registry.js";
import { registerAllCapabilities } from "../../capabilities/register-all-capabilities.js";
import { COMPONENT_ENTRIES } from "./component-entries.js";

/**
 * Bootstrap both registries with all 24 capabilities and 14 component types.
 * Returns the populated registries ready for simulation.
 */
export function bootstrapRegistries(): {
  capabilities: CapabilityRegistry;
  components: ComponentRegistry;
} {
  const capabilities = new CapabilityRegistry();
  registerAllCapabilities(capabilities);

  const components = new ComponentRegistry(capabilities);
  for (const entry of COMPONENT_ENTRIES) {
    components.register(entry);
  }

  capabilities.validate();
  components.validate();

  return { capabilities, components };
}

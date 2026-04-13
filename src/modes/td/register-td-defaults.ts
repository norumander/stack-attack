import type { CapabilityRegistry } from "@core/registry/capability-registry.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import type { CapabilityId } from "@core/types/ids.js";
import { ProcessingCapability } from "@capabilities/processing/processing-capability.js";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability.js";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability.js";
import { StorageCapability } from "@capabilities/storage/storage-capability.js";
import { CachingCapability } from "@capabilities/caching/caching-capability.js";
import { RoutingCapability } from "@capabilities/routing/routing-capability.js";
import { SERVER_ENTRY, DATABASE_ENTRY, CACHE_ENTRY, LOAD_BALANCER_ENTRY } from "./td-component-entries.js";

/**
 * Populate the capability and component registries with the TD-mode
 * defaults. Called once at the start of an integration test / game
 * session to bootstrap what's available for the current stage.
 */
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () => new ProcessingCapability("processing" as CapabilityId),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    // Default factory registers a generic "forwards everything" instance.
    // Integration tests build components via tests/integration/td/helpers.ts
    // (buildServer, buildCache, etc.) which construct per-instance
    // ForwardingCapability with appropriate throughputPerTier values.
    // The registry instance is only used by compRegistry.validate() —
    // never instantiated for actual wave simulation in Stage 3a.
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
      }),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () => new StorageCapability("storage" as CapabilityId),
  });
  capRegistry.register({
    id: "caching" as CapabilityId,
    factory: () => new CachingCapability("caching" as CapabilityId),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });

  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);

  compRegistry.validate();
}

import type { CapabilityRegistry } from "@core/registry/capability-registry.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import type { CapabilityId } from "@core/types/ids.js";
import { ProcessingCapability } from "@capabilities/processing/processing-capability.js";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability.js";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability.js";
import { StorageCapability } from "@capabilities/storage/storage-capability.js";
import { CachingCapability } from "@capabilities/caching/caching-capability.js";
import { RoutingCapability } from "@capabilities/routing/routing-capability.js";
import {
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
  CLIENT_ENTRY,
} from "./td-component-entries.js";

/**
 * Populate the capability and component registries with the TD-mode defaults.
 *
 * Stage 3b: factory options match tests/integration/td/helpers.ts:buildX
 * exactly, so dashboard-placed components have the same runtime behavior
 * as harness-built components in the wave tests.
 */
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () =>
      new ProcessingCapability("processing" as CapabilityId, {
        handledTypes: ["api_read"],
        throughputPerTier: 20,
        emitProcessedEvent: true,
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_write"],
        throughputPerTier: 12,
        emitForwardedEvent: true,
      }),
  });
  // forwarding-pipe is the Cache/LB/Client variant: handles all traffic at
  // ~55/tick. Distinct id so it can be registered as a separate factory.
  capRegistry.register({
    id: "forwarding-pipe" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding-pipe" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
        throughputPerTier: 55,
        emitForwardedEvent: true,
      }),
  });
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () =>
      new StorageCapability("storage" as CapabilityId, {
        throughputPerTier: 25,
        emitProcessedEvent: true,
        // TD-tuned: Database is a write sink only. A naked Client→Database
        // must NOT trivially win Wave 1 (100% reads) — the Server tier is
        // the only api_read primitive in the TD learning arc.
        handledTypes: ["api_write"],
      }),
  });
  capRegistry.register({
    id: "caching" as CapabilityId,
    factory: () => new CachingCapability("caching" as CapabilityId),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });

  compRegistry.register(CLIENT_ENTRY);
  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);

  compRegistry.validate();
}

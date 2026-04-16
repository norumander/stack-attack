import type { CapabilityRegistry } from "@core/registry/capability-registry.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import type { CapabilityId } from "@core/types/ids.js";
import { ProcessingCapability } from "@capabilities/processing/processing-capability.js";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability.js";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability.js";
import { StorageCapability } from "@capabilities/storage/storage-capability.js";
import { CachingCapability } from "@capabilities/caching/caching-capability.js";
import { RoutingCapability } from "@capabilities/routing/routing-capability.js";
import { AuthCapability } from "@capabilities/auth/auth-capability.js";
import { QueueCapability } from "@capabilities/queue/queue-capability.js";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability.js";
import { CircuitBreakerCapability } from "@capabilities/circuit-breaker/circuit-breaker-capability.js";
import { StreamingCapability } from "@capabilities/streaming/streaming-capability.js";
import { BlobStorageCapability } from "@capabilities/blob-storage/blob-storage-capability.js";
import { GeoRoutingCapability } from "@capabilities/geo-routing/geo-routing-capability.js";
import { AutoScaleCapability } from "@capabilities/auto-scale/auto-scale-capability.js";
import {
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
  CLIENT_ENTRY,
  CDN_ENTRY,
  API_GATEWAY_ENTRY,
  QUEUE_ENTRY,
  WORKER_ENTRY,
  CIRCUIT_BREAKER_ENTRY,
  STREAMING_SERVER_ENTRY,
  BLOB_STORAGE_ENTRY,
  DNS_GTM_ENTRY,
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
        handledTypes: ["api_read", "static_asset", "auth_required"],
        // Stage 3c one-type-per-tick re-tune (Processing + Forwarding
        // contributions sum into a pooled component budget — see
        // `src/core/engine/throughput.ts:componentThroughputPerTick`,
        // they are NOT type-segmented per-cap limits). Server total
        // budget = 15 + 15 = 30. Wave 2 (25/tick either all-reads or
        // all-writes) fits under 30 comfortably. Wave 3 (50/tick) blows
        // through 30 → lone Server loses on either tick type, which is
        // the intended "needs horizontal scale" teaching moment.
        throughputPerTier: 15,
        emitProcessedEvent: true,
        // auth_required on Server is expensive: +4 on top of base 1 = 5
        // ticks latency. Player feels "Server can serve auth, but it's so
        // slow my SLA fails" → teaches API Gateway rescue for Wave 5.
        typeLatencyPenalty: { auth_required: 4 },
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_write"],
        // See note above — this is a budget contribution, not a write
        // cap. Combined with Processing's 15 it gives Server a 30/tick
        // total pooled budget.
        throughputPerTier: 15,
        emitForwardedEvent: true,
      }),
  });
  // forwarding-pipe is the Cache/CDN/LB/Client variant: handles all traffic at
  // a high pass-through rate. Tier-1 budget is 200/tick so a single CDN or Cache
  // can absorb Wave 5's 150/tick intensity without overflowing its queue. Raised
  // from 55 (Wave 3-era) to 200 when Stage 3d added Wave 4 (80/tick) and Wave 5
  // (150/tick) — the Stage 3c engine treats dequeued cache-hit requests as
  // consuming the tick budget, so the cap must be at least the total arrival
  // rate at any intermediary component.
  capRegistry.register({
    id: "forwarding-pipe" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding-pipe" as CapabilityId, {
        handledTypes: ["api_read", "api_write", "static_asset", "auth_required", "batch", "event", "stream"],
        throughputPerTier: 500,
        emitForwardedEvent: true,
      }),
  });
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () =>
      new StorageCapability("storage" as CapabilityId, {
        // Stage 3c one-type-per-tick re-tune: Wave 3 writes-ticks drive
        // up to 50 writes/tick into Database (via single Server with
        // 50/tick forwarding, or via LB with two Servers each at 25).
        // Bumped from 25 so Database isn't the Wave 3 bottleneck.
        throughputPerTier: 50,
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
  // Wave 4 teaching moment: CDN (edge) handles static_asset; Cache
  // (application tier) handles api_read. Specializing the caching
  // capability per component type forces the full CDN+Cache stack to be
  // used — neither alone can cover both cacheable traffic types.
  capRegistry.register({
    id: "caching-static" as CapabilityId,
    factory: () =>
      new CachingCapability("caching-static" as CapabilityId, {
        cacheableTypes: new Set(["static_asset"]),
      }),
  });
  capRegistry.register({
    id: "caching-api" as CapabilityId,
    factory: () =>
      new CachingCapability("caching-api" as CapabilityId, {
        cacheableTypes: new Set(["api_read"]),
      }),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });
  capRegistry.register({
    id: "auth" as CapabilityId,
    factory: () =>
      new AuthCapability("auth" as CapabilityId, {
        terminateAuthRequired: true,
      }),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });

  capRegistry.register({
    id: "queue" as CapabilityId,
    factory: () => new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    }),
    documentsSubInterfaces: ["EngineBufferable"],
  });
  capRegistry.register({
    id: "batch-processing" as CapabilityId,
    factory: () => new BatchProcessingCapability("batch-processing" as CapabilityId),
    documentsSubInterfaces: ["EnginePullable"],
  });
  capRegistry.register({
    id: "circuit-breaker" as CapabilityId,
    factory: () => new CircuitBreakerCapability("circuit-breaker" as CapabilityId),
    documentsSubInterfaces: ["EngineConsultable"],
  });
  capRegistry.register({
    id: "streaming" as CapabilityId,
    factory: () => new StreamingCapability("streaming" as CapabilityId),
  });
  capRegistry.register({
    id: "blob-storage" as CapabilityId,
    factory: () => new BlobStorageCapability("blob-storage" as CapabilityId),
  });
  capRegistry.register({
    id: "geo-routing" as CapabilityId,
    factory: () => new GeoRoutingCapability("geo-routing" as CapabilityId),
    documentsSubInterfaces: ["EngineConsultable"],
  });
  capRegistry.register({
    id: "auto-scale" as CapabilityId,
    factory: () => new AutoScaleCapability("auto-scale" as CapabilityId),
  });

  compRegistry.register(CLIENT_ENTRY);
  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);
  compRegistry.register(CDN_ENTRY);
  compRegistry.register(API_GATEWAY_ENTRY);
  compRegistry.register(QUEUE_ENTRY);
  compRegistry.register(WORKER_ENTRY);
  compRegistry.register(CIRCUIT_BREAKER_ENTRY);
  compRegistry.register(STREAMING_SERVER_ENTRY);
  compRegistry.register(BLOB_STORAGE_ENTRY);
  compRegistry.register(DNS_GTM_ENTRY);

  compRegistry.validate();
}

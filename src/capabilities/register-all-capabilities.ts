import type { CapabilityRegistry } from "../core/registry/capability-registry.js";
import type { CapabilityId } from "../core/types/ids.js";
import { MonitoringCapability } from "./monitoring/monitoring-capability.js";
import { HealthCheckCapability } from "./health-check/health-check-capability.js";
import { FilterCapability } from "./filter/filter-capability.js";
import { SSLTerminationCapability } from "./ssl-termination/ssl-termination-capability.js";
import { CompressionCapability } from "./compression/compression-capability.js";
import { RateLimitCapability } from "./rate-limit/rate-limit-capability.js";
import { AuthCapability } from "./auth/auth-capability.js";
import { CachingCapability } from "./caching/caching-capability.js";
import { QueueCapability } from "./queue/queue-capability.js";
import { ProcessingCapability } from "./processing/processing-capability.js";
import { StorageCapability } from "./storage/storage-capability.js";
import { SearchCapability } from "./search/search-capability.js";
import { QueryCapability } from "./query/query-capability.js";
import { RegistrationCapability } from "./registration/registration-capability.js";
import { BlobStorageCapability } from "./blob-storage/blob-storage-capability.js";
import { StreamingCapability } from "./streaming/streaming-capability.js";
import { BatchProcessingCapability } from "./batch-processing/batch-processing-capability.js";
import { ReplicationCapability } from "./replication/replication-capability.js";
import { ShardingCapability } from "./sharding/sharding-capability.js";
import { CircuitBreakerCapability } from "./circuit-breaker/circuit-breaker-capability.js";
import { RetryCapability } from "./retry/retry-capability.js";
import { RoutingCapability } from "./routing/routing-capability.js";
import { GeoRoutingCapability } from "./geo-routing/geo-routing-capability.js";
import { AutoScaleCapability } from "./auto-scale/auto-scale-capability.js";

export function registerAllCapabilities(registry: CapabilityRegistry): void {
  type SubIface = "EngineConsultable" | "EngineBufferable" | "EnginePullable" | "InstanceDirectory";
  type Cap = import("../core/capability/capability.js").Capability;

  const r = (id: string, factory: () => unknown, subInterfaces?: readonly SubIface[]) => {
    const entry: import("../core/registry/capability-registry.js").CapabilityRegistryEntry = {
      id: id as CapabilityId,
      factory: factory as () => Cap,
    };
    if (subInterfaces) {
      (entry as { documentsSubInterfaces: readonly SubIface[] }).documentsSubInterfaces = subInterfaces;
    }
    registry.register(entry);
  };

  // OBSERVE
  r("monitoring", () => new MonitoringCapability("monitoring" as CapabilityId));
  r("health-check", () => new HealthCheckCapability("health-check" as CapabilityId));
  r("auto-scale", () => new AutoScaleCapability("auto-scale" as CapabilityId));

  // INTERCEPT
  r("filter", () => new FilterCapability("filter" as CapabilityId));
  r("ssl-termination", () => new SSLTerminationCapability("ssl-termination" as CapabilityId));
  r("compression", () => new CompressionCapability("compression" as CapabilityId));
  r("rate-limit", () => new RateLimitCapability("rate-limit" as CapabilityId));
  r("auth", () => new AuthCapability("auth" as CapabilityId));
  r("caching", () => new CachingCapability("caching" as CapabilityId));
  r("queue", () => new QueueCapability("queue" as CapabilityId), ["EngineBufferable"]);
  r("circuit-breaker", () => new CircuitBreakerCapability("circuit-breaker" as CapabilityId), ["EngineConsultable"]);
  r("retry", () => new RetryCapability("retry" as CapabilityId), ["EngineBufferable"]);

  // PROCESS
  r("processing", () => new ProcessingCapability("processing" as CapabilityId));
  r("storage", () => new StorageCapability("storage" as CapabilityId));
  r("search", () => new SearchCapability("search" as CapabilityId));
  r("query", () => new QueryCapability("query" as CapabilityId));
  r("registration", () => new RegistrationCapability("registration" as CapabilityId), ["InstanceDirectory"]);
  r("blob-storage", () => new BlobStorageCapability("blob-storage" as CapabilityId));
  r("streaming", () => new StreamingCapability("streaming" as CapabilityId));
  r("batch-processing", () => new BatchProcessingCapability("batch-processing" as CapabilityId), ["EnginePullable"]);

  // REPLICATE
  r("replication", () => new ReplicationCapability("replication" as CapabilityId));
  r("sharding", () => new ShardingCapability("sharding" as CapabilityId));

  // No phase (EngineConsultable only)
  r("routing", () => new RoutingCapability("routing" as CapabilityId), ["EngineConsultable"]);
  r("geo-routing", () => new GeoRoutingCapability("geo-routing" as CapabilityId), ["EngineConsultable"]);
}

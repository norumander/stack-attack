import type { ComponentId } from "@core/types/ids";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GatewayCapability } from "@sim/capabilities/gateway";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import { StreamingCapability } from "@sim/capabilities/streaming";
import { GeoRoutingCapability } from "@sim/capabilities/geo-routing";
import { BlobStorageCapability } from "@sim/capabilities/blob-storage";
import { CircuitBreakerCapability } from "@sim/capabilities/circuit-breaker";
import { ContentRouterCapability } from "@sim/capabilities/content-router";
import type { WaveRevenue } from "@sim/wave";
import type { Zone } from "@sim/types";

export const COMPONENT_COSTS: ReadonlyMap<string, number> = new Map([
  ["server", 100],
  ["database", 200],
  ["data_cache", 150],
  ["load_balancer", 175],
  ["cdn", 200],
  ["edge_cache", 175],
  ["api_gateway", 250],
  ["queue", 125],
  ["worker", 150],
  ["streaming_server", 250],
  ["dns_gtm", 200],
  ["blob_storage", 200],
  ["circuit_breaker", 150],
  ["edge_router", 200],
]);

/** Sprite type used by the renderer to pick the iso tile graphic. */
export const COMPONENT_SPRITE_TYPE: ReadonlyMap<string, string> = new Map([
  ["server", "server"],
  ["database", "database"],
  ["data_cache", "data_cache"],
  ["load_balancer", "load_balancer"],
  ["cdn", "cdn"],
  ["edge_cache", "edge_cache"],
  ["api_gateway", "api_gateway"],
  ["queue", "queue"],
  ["worker", "worker"],
  ["streaming_server", "streaming_server"],
  ["dns_gtm", "dns_gtm"],
  ["blob_storage", "blob_storage"],
  ["circuit_breaker", "circuit_breaker"],
  ["edge_router", "api_gateway"],
]);

export const CLIENT_FACING_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  "server",
  "cdn",
  "edge_cache",
  "api_gateway",
  "load_balancer",
  "streaming_server",
  "dns_gtm",
  "edge_router",
]);

export function isClientFacing(type: string): boolean {
  return CLIENT_FACING_COMPONENT_TYPES.has(type);
}

export const COMPONENT_FACTORY: ReadonlyArray<string> = [
  "server", "database", "data_cache", "load_balancer", "cdn", "edge_cache", "api_gateway",
  "queue", "worker", "streaming_server", "dns_gtm", "blob_storage", "circuit_breaker", "edge_router",
];

export function buildSimComponent(
  type: string,
  id: ComponentId,
  revenue: WaveRevenue,
  zone?: Zone,
  label?: string,
): SimComponent | null {
  const z = zone !== undefined ? { zone } : {};
  const l = label !== undefined ? { label } : {};
  switch (type) {
    case "server":
      return new SimComponent({
        id,
        capabilities: [new ForwardingCapability()],
        capacityPerSecond: 30,
        ...z,
        ...l,
      });
    case "database":
      return new SimComponent({
        id,
        capabilities: [new ProcessingCapability({ revenuePerWrite: revenue.perWrite, revenuePerRead: revenue.perRead })],
        capacityPerSecond: 30,
        ...z,
        ...l,
      });
    case "data_cache":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: revenue.perRead })],
        ...z,
        ...l,
      });
    case "load_balancer":
      return new SimComponent({
        id,
        capabilities: [new LoadBalancerCapability()],
        ...z,
        ...l,
      });
    case "cdn":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 24, revenuePerRead: revenue.perRead, largeOnly: true })],
        ...z,
        ...l,
      });
    case "edge_cache":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({
          capacity: 40,
          revenuePerRead: revenue.perRead,
          cacheableTypes: ["api_read"],
        })],
        ...z,
        ...l,
      });
    case "api_gateway":
      return new SimComponent({
        id,
        capabilities: [new GatewayCapability({ revenuePerAuth: revenue.perAuth })],
        ...z,
        ...l,
      });
    case "queue":
      return new SimComponent({
        id,
        capabilities: [new QueueCapability({ capacity: 64 })],
        ...z,
        ...l,
      });
    case "worker":
      return new SimComponent({
        id,
        capabilities: [new WorkerCapability({ pullRate: 30, revenuePerItem: revenue.perAsync }, null)],
        ...z,
        ...l,
      });
    case "streaming_server":
      return new SimComponent({
        id,
        capabilities: [new StreamingCapability({ revenuePerStream: revenue.perStream })],
        ...z,
        ...l,
      });
    case "dns_gtm":
      return new SimComponent({
        id,
        capabilities: [new GeoRoutingCapability()],
        ...z,
        ...l,
      });
    case "blob_storage":
      return new SimComponent({
        id,
        capabilities: [
          new BlobStorageCapability({
            revenuePerWrite: revenue.perWrite,
            revenuePerRead: revenue.perRead,
            revenuePerStream: revenue.perStream,
          }),
        ],
        capacityPerSecond: 60,
        ...z,
        ...l,
      });
    case "circuit_breaker":
      return new SimComponent({
        id,
        capabilities: [new CircuitBreakerCapability({ failureThreshold: 5, cooldownSeconds: 2 })],
        ...z,
        ...l,
      });
    case "edge_router":
      return new SimComponent({
        id,
        capabilities: [new ContentRouterCapability()],
        ...z,
        ...l,
      });
    default:
      return null;
  }
}

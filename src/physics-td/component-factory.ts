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

export const COMPONENT_COSTS: ReadonlyMap<string, number> = new Map([
  ["server", 100],
  ["database", 200],
  ["data_cache", 150],
  ["load_balancer", 175],
  ["cdn", 200],
  ["api_gateway", 250],
  ["queue", 125],
  ["worker", 150],
  ["streaming_server", 250],
  ["dns_gtm", 200],
]);

/** Sprite type used by the renderer to pick the iso tile graphic. */
export const COMPONENT_SPRITE_TYPE: ReadonlyMap<string, string> = new Map([
  ["server", "server"],
  ["database", "database"],
  ["data_cache", "data_cache"],
  ["load_balancer", "load_balancer"],
  ["cdn", "cdn"],
  ["api_gateway", "api_gateway"],
  ["queue", "queue"],
  ["worker", "worker"],
  ["streaming_server", "streaming_server"],
  ["dns_gtm", "dns_gtm"],
]);

export const COMPONENT_FACTORY: ReadonlyArray<string> = [
  "server", "database", "data_cache", "load_balancer", "cdn", "api_gateway",
  "queue", "worker", "streaming_server", "dns_gtm",
];

export function buildSimComponent(type: string, id: ComponentId): SimComponent | null {
  switch (type) {
    case "server":
      return new SimComponent({ id, capabilities: [new ForwardingCapability()] });
    case "database":
      return new SimComponent({
        id,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 5, revenuePerRead: 2 })],
        capacityPerSecond: 30,
      });
    case "data_cache":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 2 })],
      });
    case "load_balancer":
      return new SimComponent({
        id,
        capabilities: [new LoadBalancerCapability()],
      });
    case "cdn":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 24, revenuePerRead: 1, largeOnly: true })],
      });
    case "api_gateway":
      return new SimComponent({
        id,
        capabilities: [new GatewayCapability({ revenuePerAuth: 4 })],
      });
    case "queue":
      return new SimComponent({
        id,
        capabilities: [new QueueCapability({ capacity: 64 })],
      });
    case "worker":
      return new SimComponent({
        id,
        capabilities: [new WorkerCapability({ pullRate: 30, revenuePerItem: 1 }, null)],
      });
    case "streaming_server":
      return new SimComponent({
        id,
        capabilities: [new StreamingCapability({ revenuePerStream: 5 })],
      });
    case "dns_gtm":
      return new SimComponent({
        id,
        capabilities: [new GeoRoutingCapability()],
      });
    default:
      return null;
  }
}

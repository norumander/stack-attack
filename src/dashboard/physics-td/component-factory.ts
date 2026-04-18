import type { ComponentId } from "@core/types/ids";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GatewayCapability } from "@sim/capabilities/gateway";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";

export const COMPONENT_COSTS: ReadonlyMap<string, number> = new Map([
  ["server", 100],
  ["database", 200],
  ["data_cache", 150],
  ["load_balancer", 175],
  ["cdn", 200],
  ["api_gateway", 250],
]);

/** Sprite type used by the renderer to pick the iso tile graphic. */
export const COMPONENT_SPRITE_TYPE: ReadonlyMap<string, string> = new Map([
  ["server", "server"],
  ["database", "database"],
  ["data_cache", "data_cache"],
  ["load_balancer", "load_balancer"],
  ["cdn", "cdn"],
  ["api_gateway", "api_gateway"],
]);

export const COMPONENT_FACTORY: ReadonlyArray<string> = [
  "server", "database", "data_cache", "load_balancer", "cdn", "api_gateway",
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
        capabilities: [new CachingCapability({ capacity: 24, revenuePerRead: 1 })],
      });
    case "api_gateway":
      return new SimComponent({
        id,
        capabilities: [new GatewayCapability({ revenuePerAuth: 4 })],
      });
    default:
      return null;
  }
}

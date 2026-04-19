import type { TopologyError } from "./validate-topology";

/**
 * Human-readable display names per component type id. Keeps the messages
 * scannable instead of showing raw snake_case capability ids.
 */
const TYPE_LABEL: ReadonlyMap<string, string> = new Map([
  ["server", "Server"],
  ["database", "Database"],
  ["data_cache", "Data Cache"],
  ["load_balancer", "Load Balancer"],
  ["cdn", "CDN"],
  ["api_gateway", "API Gateway"],
  ["queue", "Queue"],
  ["worker", "Worker"],
  ["streaming_server", "Streaming Server"],
  ["dns_gtm", "DNS / GTM"],
  ["blob_storage", "Blob Storage"],
  ["circuit_breaker", "Circuit Breaker"],
  // Capability-id fallbacks (validator emits these when no higher-level type
  // is known — e.g. the client entry itself).
  ["processing", "Server"],
  ["caching", "Data Cache"],
  ["gateway", "API Gateway"],
  ["streaming", "Streaming Server"],
  ["forwarding", "Forwarder"],
  ["load-balancer", "Load Balancer"],
  ["geo-routing", "DNS / GTM"],
  ["blob_storage", "Blob Storage"],
  ["circuit_breaker", "Circuit Breaker"],
  ["client", "Client"],
  ["unknown", "Component"],
]);

const REQUEST_LABEL: ReadonlyMap<string, string> = new Map([
  ["api_read", "api_read"],
  ["api_write", "api_write"],
  ["auth_required", "auth_required"],
  ["stream_data", "stream_data"],
  ["large_payload", "large_payload"],
  ["async_work", "async_work"],
  ["*", "traffic"],
]);

function typeLabel(type: string): string {
  return TYPE_LABEL.get(type) ?? type;
}

function requestLabel(type: string): string {
  return REQUEST_LABEL.get(type) ?? type;
}

/**
 * Map a TopologyError to a single-line human message suitable for the HUD.
 *
 * Rules:
 *  - no_handler    → "No handler for {requestType} at {componentType}"
 *  - no_egress     → "{componentType} has no downstream"
 *  - backend_only_as_entry → "{componentType} can't face the client directly"
 */
export function formatTopologyError(err: TopologyError): string {
  const comp = typeLabel(err.componentType);
  switch (err.reason) {
    case "no_handler":
      return `No handler for ${requestLabel(err.requestType)} at ${comp}`;
    case "no_egress":
      return `${comp} has no downstream`;
    case "backend_only_as_entry":
      return `${comp} can't face the client directly`;
  }
}

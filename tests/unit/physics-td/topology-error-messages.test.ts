import { describe, it, expect } from "vitest";
import type { ComponentId } from "@core/types/ids";
import type { TopologyError } from "../../../src/physics-td/validate-topology";
import { formatTopologyError } from "../../../src/physics-td/topology-error-messages";

function err(partial: Partial<TopologyError>): TopologyError {
  return {
    requestType: "api_read",
    componentId: "c000001" as ComponentId,
    componentType: "server",
    reason: "no_handler",
    ...partial,
  };
}

describe("formatTopologyError", () => {
  it("maps no_handler to a human message naming the request type + component", () => {
    expect(
      formatTopologyError(err({ reason: "no_handler", requestType: "api_read", componentType: "database" })),
    ).toBe("No handler for api_read at Database");
  });

  it("maps no_egress to a short dead-end message naming the component", () => {
    expect(
      formatTopologyError(err({ reason: "no_egress", componentType: "load_balancer" })),
    ).toBe("Load Balancer has no downstream");
  });

  it("maps backend_only_as_entry to a 'can't face client' message", () => {
    expect(
      formatTopologyError(err({ reason: "backend_only_as_entry", componentType: "database" })),
    ).toBe("Database can't face the client directly");
  });

  it("uses pretty labels for all palette component types (no_egress)", () => {
    const types: Array<[string, string]> = [
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
    ];
    for (const [type, label] of types) {
      expect(
        formatTopologyError(err({ reason: "no_egress", componentType: type })),
      ).toBe(`${label} has no downstream`);
    }
  });

  it("falls back to capability-id labels when validator reports a capability id", () => {
    // Validator's componentTypeLabel returns the first capability's id — e.g.
    // "processing" for a Server. The formatter should still produce a
    // readable type name.
    expect(
      formatTopologyError(err({ reason: "no_handler", requestType: "api_write", componentType: "processing" })),
    ).toBe("No handler for api_write at Server");
    expect(
      formatTopologyError(err({ reason: "no_egress", componentType: "caching" })),
    ).toBe("Data Cache has no downstream");
  });

  it("uses 'traffic' in place of the wildcard request type", () => {
    // backend_only_as_entry emits requestType = "*" — messages shouldn't
    // mention a concrete type there (we only report the component).
    const msg = formatTopologyError(err({
      reason: "backend_only_as_entry",
      requestType: "*",
      componentType: "database",
    }));
    expect(msg).not.toContain("*");
    expect(msg).toBe("Database can't face the client directly");
  });

  it("preserves unknown component types verbatim rather than crashing", () => {
    expect(
      formatTopologyError(err({ reason: "no_egress", componentType: "alien_widget" })),
    ).toBe("alien_widget has no downstream");
  });
});

import { describe, it, expect } from "vitest";
import { bootstrapRegistries } from "@core/registry/register-all";

describe("bootstrapRegistries", () => {
  it("registers all 24 capabilities", () => {
    const { capabilities } = bootstrapRegistries();
    const expectedIds = [
      "monitoring", "health-check", "auto-scale",
      "filter", "ssl-termination", "compression", "rate-limit", "auth",
      "caching", "queue", "circuit-breaker", "retry",
      "processing", "storage", "search", "query", "registration",
      "blob-storage", "streaming", "batch-processing",
      "replication", "sharding",
      "routing", "geo-routing",
    ];
    for (const id of expectedIds) {
      expect(capabilities.get(id as any), `capability "${id}" should be registered`).toBeDefined();
    }
  });

  it("registers all 14 component types", () => {
    const { components } = bootstrapRegistries();
    const expectedTypes = [
      "client", "server", "database", "cache", "load_balancer",
      "queue", "cdn", "api_gateway", "service_registry", "worker",
      "circuit_breaker", "dns_gtm", "blob_storage", "streaming_media_server",
    ];
    for (const type of expectedTypes) {
      expect(components.get(type), `component "${type}" should be registered`).toBeDefined();
    }
  });

  it("lists all 14 component entries", () => {
    const { components } = bootstrapRegistries();
    expect(components.list()).toHaveLength(14);
  });

  it("validate() passes without errors", () => {
    expect(() => bootstrapRegistries()).not.toThrow();
  });

  it("can create each component type", () => {
    const { components } = bootstrapRegistries();
    for (const entry of components.list()) {
      const comp = components.create(entry.type, { x: 0, y: 0 }, "default");
      expect(comp.type).toBe(entry.type);
      expect(comp.name).toBe(entry.name);
    }
  });
});

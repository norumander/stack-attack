import { describe, it, expect } from "vitest";
import { COMPONENT_FACTORY, COMPONENT_COSTS, buildSimComponent } from "../../../../src/dashboard/physics-td/component-factory";
import type { ComponentId } from "@core/types/ids";

describe("component-factory", () => {
  it("knows costs for the six MVP component types", () => {
    expect(COMPONENT_COSTS.get("server")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("database")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("data_cache")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("load_balancer")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("cdn")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("api_gateway")).toBeGreaterThan(0);
  });

  it("buildSimComponent for server returns a SimComponent with ForwardingCapability", () => {
    const comp = buildSimComponent("server", "s1" as ComponentId);
    expect(comp).toBeDefined();
    expect(comp!.id).toBe("s1");
    expect(comp!.capabilities[0]?.id).toBe("forwarding");
  });

  it("buildSimComponent for database has capacity bucket and processing cap", () => {
    const comp = buildSimComponent("database", "db1" as ComponentId);
    expect(comp).toBeDefined();
    expect(comp!.bucket).not.toBeNull();
    expect(comp!.capabilities[0]?.id).toBe("processing");
  });

  it("returns null for unknown type", () => {
    const comp = buildSimComponent("unknown_thing", "x" as ComponentId);
    expect(comp).toBeNull();
  });
});

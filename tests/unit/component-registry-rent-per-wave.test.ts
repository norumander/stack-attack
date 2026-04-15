import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import {
  ComponentRegistry,
  type ComponentRegistryEntry,
} from "@core/registry/component-registry";

describe("ComponentRegistryEntry.rentPerWave", () => {
  it("is an optional number field on registry entries", () => {
    const capRegistry = new CapabilityRegistry();
    const registry = new ComponentRegistry(capRegistry);

    const entry: ComponentRegistryEntry = {
      type: "test-type",
      name: "Test",
      description: "Test component",
      capabilities: [],
      ports: [],
      placementCost: 0,
      upgradeCostCurve: [],
      visual: { icon: "■", color: "#fff", shape: "square" },
      conditionProfile: {
        degradedThreshold: 0.5,
        criticalThreshold: 0.2,
        decayRate: 0,
        recoveryRate: 0,
        degradedEffects: [],
        criticalEffects: [],
      },
      rentPerWave: 80,
    };

    registry.register(entry);
    const fetched = registry.get("test-type");
    expect(fetched).toBeDefined();
    expect(fetched!.rentPerWave).toBe(80);
  });

  it("allows rentPerWave to be undefined (backward compat)", () => {
    const capRegistry = new CapabilityRegistry();
    const registry = new ComponentRegistry(capRegistry);

    const entry: ComponentRegistryEntry = {
      type: "legacy-type",
      name: "Legacy",
      description: "Legacy component",
      capabilities: [],
      ports: [],
      placementCost: 100,
      upgradeCostCurve: [],
      visual: { icon: "■", color: "#fff", shape: "square" },
      conditionProfile: {
        degradedThreshold: 0.5,
        criticalThreshold: 0.2,
        decayRate: 0,
        recoveryRate: 0,
        degradedEffects: [],
        criticalEffects: [],
      },
    };

    registry.register(entry);
    const fetched = registry.get("legacy-type");
    expect(fetched).toBeDefined();
    expect(fetched!.rentPerWave).toBeUndefined();
    expect(fetched!.placementCost).toBe(100);
  });
});

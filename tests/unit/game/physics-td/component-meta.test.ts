import { describe, it, expect } from "vitest";
import { COMPONENT_META } from "../../../../src/physics-td/component-meta";
import { COMPONENT_COSTS } from "../../../../src/physics-td/component-factory";

describe("COMPONENT_META catalog", () => {
  it("covers all 10 placeable types from COMPONENT_COSTS", () => {
    const metaKeys = Object.keys(COMPONENT_META).sort();
    const costKeys = [...COMPONENT_COSTS.keys()].sort();
    expect(metaKeys).toEqual(costKeys);
  });

  it("every entry has non-empty displayName, description, and at least one capability bullet", () => {
    for (const [type, meta] of Object.entries(COMPONENT_META)) {
      expect(meta.displayName, `${type}.displayName`).toBeTruthy();
      expect(meta.description, `${type}.description`).toBeTruthy();
      expect(meta.capabilitiesHuman.length, `${type}.capabilitiesHuman`).toBeGreaterThan(0);
      for (const bullet of meta.capabilitiesHuman) {
        expect(bullet, `${type} bullet`).toBeTruthy();
      }
    }
  });

  it("every entry has a non-empty dossier with body, wire, and handles", () => {
    for (const [type, meta] of Object.entries(COMPONENT_META)) {
      expect(meta.dossier.body, `${type}.dossier.body`).toBeTruthy();
      expect(meta.dossier.wire, `${type}.dossier.wire`).toBeTruthy();
      expect(meta.dossier.handles, `${type}.dossier.handles`).toBeTruthy();
    }
  });

  it("server / database / data_cache dossiers match the ported voice", () => {
    expect(COMPONENT_META.server!.dossier.body).toContain("workhorses");
    expect(COMPONENT_META.database!.dossier.body).toContain("store your data");
    expect(COMPONENT_META.data_cache!.dossier.body).toContain("Redis");
  });
});

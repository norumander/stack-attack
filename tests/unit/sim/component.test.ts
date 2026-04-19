import { describe, it, expect } from "vitest";
import type { ComponentId } from "@core/types/ids";
import { SimComponent } from "@sim/component";

describe("SimComponent label", () => {
  it("defaults label to undefined when not provided", () => {
    const comp = new SimComponent({
      id: "c1" as ComponentId,
      capabilities: [],
    });
    expect(comp.label).toBeUndefined();
  });

  it("stores the provided label verbatim", () => {
    const comp = new SimComponent({
      id: "c1" as ComponentId,
      capabilities: [],
      label: "Profile DB",
    });
    expect(comp.label).toBe("Profile DB");
  });

  it("preserves label independent of tier/capacity options", () => {
    const comp = new SimComponent({
      id: "c1" as ComponentId,
      capabilities: [],
      capacityPerSecond: 30,
      tier: 3,
      label: "Server 7",
    });
    expect(comp.label).toBe("Server 7");
    expect(comp.tier).toBe(3);
  });
});

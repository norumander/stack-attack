import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resetIdCountersForTest } from "@sim/packet";
import { diagnoseWave, type DiagnosisInput } from "../../../../src/physics-td/diagnose-wave";
import type { ComponentId } from "@core/types/ids";

describe("diagnoseWave (physics)", () => {
  beforeEach(() => resetIdCountersForTest());

  it("flags write routing gap when writes drop at a server with no DB downstream", () => {
    const sim = new Sim({ seed: 1 });
    const server = new SimComponent({ id: "s1" as ComponentId, capabilities: [new ForwardingCapability()] });
    sim.addComponent(server);
    // Server has no outgoing connections at all.
    const input: DiagnosisInput = {
      sim,
      wave: { writeRatio: 0.3, hasReads: true, hasStreams: false },
      perComponentDrops: new Map([["s1" as ComponentId, { total: 80, byReason: new Map([["no_egress", 80]]) }]]),
      totalDrops: 80,
      totalProcessed: 20,
    };
    const d = diagnoseWave(input);
    expect(d.headline.toLowerCase()).toContain("nowhere to write");
    expect(d.hint).toBeTruthy();
  });

  it("flags overload when a component's drops are dominated by 'overloaded' reason", () => {
    const sim = new Sim({ seed: 1 });
    const db = new SimComponent({ id: "db" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })], capacityPerSecond: 30 });
    sim.addComponent(db);
    const input: DiagnosisInput = {
      sim,
      wave: { writeRatio: 0, hasReads: true, hasStreams: false },
      perComponentDrops: new Map([["db" as ComponentId, { total: 120, byReason: new Map([["overloaded", 120]]) }]]),
      totalDrops: 120,
      totalProcessed: 80,
    };
    const d = diagnoseWave(input);
    expect(d.headline.toLowerCase()).toContain("overwhelmed");
    expect(d.hint).toBeTruthy();
  });

  it("falls back to a default when no specific branch fires", () => {
    const sim = new Sim({ seed: 1 });
    const input: DiagnosisInput = {
      sim,
      wave: { writeRatio: 0, hasReads: true, hasStreams: false },
      perComponentDrops: new Map(),
      totalDrops: 50,
      totalProcessed: 50,
    };
    const d = diagnoseWave(input);
    expect(d.headline.toLowerCase()).toContain("dropped");
  });
});

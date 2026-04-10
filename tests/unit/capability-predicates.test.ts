import { describe, it, expect } from "vitest";
import {
  isEngineConsultable,
  isEngineBufferable,
  isEnginePullable,
  isInstanceDirectory,
} from "@core/capability/engine-interfaces";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ConnectionId } from "@core/types/ids";

function baseCap(): Capability {
  return {
    id: "cap-x" as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

describe("engine sub-interface predicates", () => {
  it("plain capability is recognized as none", () => {
    const c = baseCap();
    expect(isEngineConsultable(c)).toBe(false);
    expect(isEngineBufferable(c)).toBe(false);
    expect(isEnginePullable(c)).toBe(false);
    expect(isInstanceDirectory(c)).toBe(false);
  });

  it("adding selectConnection makes it EngineConsultable", () => {
    const c: Capability = {
      ...baseCap(),
      selectConnection: () => "cx-1" as ConnectionId,
    } as Capability;
    expect(isEngineConsultable(c)).toBe(true);
  });

  it("adding listCandidates makes it InstanceDirectory", () => {
    const c: Capability = {
      ...baseCap(),
      listCandidates: () => [],
    } as Capability;
    expect(isInstanceDirectory(c)).toBe(true);
  });

  it("adding pullPending makes it EnginePullable", () => {
    const c: Capability = { ...baseCap(), pullPending: () => [] } as Capability;
    expect(isEnginePullable(c)).toBe(true);
  });

  it("adding enqueueForRetry/emitReady/dequeueBatch makes it EngineBufferable", () => {
    const c: Capability = {
      ...baseCap(),
      enqueueForRetry: () => true,
      emitReady: () => ({ awaitingPipeline: [], awaitingDelivery: [] }),
      dequeueBatch: () => [],
    } as Capability;
    expect(isEngineBufferable(c)).toBe(true);
  });
});

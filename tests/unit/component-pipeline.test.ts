import { describe, it, expect } from "vitest";
import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import { createRng } from "@core/engine/rng";

const profile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

function stubCap(
  id: string,
  phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE",
  outcome: ProcessResult["outcome"],
  callLog: string[],
): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => {
      callLog.push(id);
      return { outcome, sideEffects: [], events: [] };
    },
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function ctx(active: CapabilityId[]): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-1" as ComponentId,
    effectiveTier: 1,
    effectiveTiers: new Map(active.map(id => [id, 1])),
    activeCapabilityIds: new Set(active),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
    childResponses: new Map(),
  };
}

function req(): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c-client" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("Component.process pipeline runner", () => {
  it("runs phases in INTERCEPT → PROCESS → REPLICATE → OBSERVE order", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["obs" as CapabilityId, stubCap("obs", "OBSERVE", { kind: "PASS" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
      ["rep" as CapabilityId, stubCap("rep", "REPLICATE", { kind: "PASS" }, log)],
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([...caps.keys()].map(k => [k, 1]));
    const comp = new Component({
      id: "c-1" as ComponentId,
      type: "server",
      name: "S",
      description: "",
      capabilities: caps,
      initialTiers: tiers,
      ports: [],
      placementCost: 0,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: profile,
    });
    comp.process(req(), ctx(["int", "proc", "rep", "obs"] as CapabilityId[]));
    expect(log).toEqual(["int", "proc", "rep", "obs"]);
  });

  it("INTERCEPT RESPOND short-circuits later phases", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "RESPOND" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["int" as CapabilityId, 1],
      ["proc" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId,
      type: "server",
      name: "S",
      description: "",
      capabilities: caps,
      initialTiers: tiers,
      ports: [],
      placementCost: 0,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: profile,
    });
    const r = comp.process(req(), ctx(["int", "proc"] as CapabilityId[]));
    expect(log).toEqual(["int"]);
    expect(r.outcome.kind).toBe("RESPOND");
  });

  it("only one PROCESS capability runs (first canHandle match)", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["p1" as CapabilityId, stubCap("p1", "PROCESS", { kind: "RESPOND" }, log)],
      ["p2" as CapabilityId, stubCap("p2", "PROCESS", { kind: "RESPOND" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["p1" as CapabilityId, 1],
      ["p2" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId,
      type: "server",
      name: "S",
      description: "",
      capabilities: caps,
      initialTiers: tiers,
      ports: [],
      placementCost: 0,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: profile,
    });
    comp.process(req(), ctx(["p1", "p2"] as CapabilityId[]));
    expect(log).toEqual(["p1"]);
  });

  it("skips capabilities not in activeCapabilityIds", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "PASS" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["int" as CapabilityId, 1],
      ["proc" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId,
      type: "server",
      name: "S",
      description: "",
      capabilities: caps,
      initialTiers: tiers,
      ports: [],
      placementCost: 0,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: profile,
    });
    comp.process(req(), ctx(["proc"] as CapabilityId[]));
    expect(log).toEqual(["proc"]);
  });

  it("defaults to PASS outcome when no capability resolves", () => {
    const comp = new Component({
      id: "c-1" as ComponentId,
      type: "server",
      name: "S",
      description: "",
      capabilities: new Map(),
      initialTiers: new Map(),
      ports: [],
      placementCost: 0,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: profile,
    });
    const r = comp.process(req(), ctx([]));
    expect(r.outcome.kind).toBe("PASS");
  });
});

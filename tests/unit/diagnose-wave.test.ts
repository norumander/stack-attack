import { describe, it, expect } from "vitest";
import { diagnoseWave } from "../../src/dashboard/td/diagnose-wave.js";
import { makeComponent, makeConnection, makePort } from "../harness/fixtures";
import { RespondingCapability } from "../harness/test-capabilities";
import type { Component } from "@core/component/component";
import type { Connection } from "@core/types/connection";
import type { TickMetrics } from "@core/types/metrics";
import type { Capability } from "@core/capability/capability";
import type {
  ComponentId,
  ConnectionId,
  CapabilityId,
} from "@core/types/ids";
import type { TDWaveDefinition } from "@modes/td/td-waves";

function makeWave(args: {
  composition?: Array<[string, number]>;
  sla?: TDWaveDefinition["sla"];
}): TDWaveDefinition {
  return {
    id: 99,
    name: "test",
    startingBudget: 500,
    intensity: 10,
    composition: new Map(args.composition ?? [["api_read", 1.0]]),
    duration: 30,
    ttl: 10,
    availableComponents: ["server", "database"],
    dropThreshold: 0.05,
    viabilityPerFailure: 0.1,
    viabilityRampPenalty: 0.5,
    revenuePerRequestType: new Map([["api_read", 1]]),
    ...(args.sla !== undefined ? { sla: args.sla } : {}),
  };
}

function tickMetricsFor(args: {
  tick: number;
  perComponent: Array<[
    ComponentId,
    { processed?: number; dropped?: number; overloaded?: number },
  ]>;
  requestsDropped?: number;
  requestsProcessed?: number;
  requestsTimedOut?: number;
}): TickMetrics {
  const perComponent = new Map<
    ComponentId,
    {
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;
      timedOut: number;
      pendingAtEndOfTick: number;
      blockedAtEndOfTick: number;
      instanceCount: number;
    }
  >();
  for (const [id, pc] of args.perComponent) {
    perComponent.set(id, {
      processed: pc.processed ?? 0,
      dropped: pc.dropped ?? 0,
      overloaded: pc.overloaded ?? 0,
      backpressured: 0,
      condition: 1,
      timedOut: 0,
      pendingAtEndOfTick: 0,
      blockedAtEndOfTick: 0,
      instanceCount: 1,
    });
  }
  return {
    tick: args.tick,
    requestsProcessed: args.requestsProcessed ?? 0,
    requestsResolved: 0,
    requestsDropped: args.requestsDropped ?? 0,
    requestsOverloaded: 0,
    requestsBackpressured: 0,
    requestsTimedOut: args.requestsTimedOut ?? 0,
    revenueEarned: 0,
    upkeepPaid: 0,
    avgLatency: 0,
    perComponent,
  };
}

describe("diagnoseWave", () => {
  // ─── Case 1: default ───────────────────────────────────────────────
  it("returns the default 'too many dropped' message for minor drops", () => {
    const server = makeComponent({
      id: "s1",
      type: "server",
      ports: [makePort("p-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>(),
    });
    const components = new Map<ComponentId, Component>();
    components.set(server.id, server);

    const metrics: TickMetrics[] = [
      tickMetricsFor({
        tick: 0,
        perComponent: [[server.id, { processed: 10, dropped: 1 }]],
        requestsProcessed: 10,
        requestsDropped: 1,
      }),
    ];
    const diag = diagnoseWave({
      wave: makeWave({}),
      metrics,
      components,
      connections: new Map(),
    });
    expect(diag.headline).toMatch(/too many|dropped|check/i);
  });

  // ─── Case 2: process throughput bottleneck ────────────────────────
  it("detects an overwhelmed component (95%+ saturation for 5+ ticks, >5% drops)", () => {
    const serverCap = new RespondingCapability("resp" as CapabilityId, {
      throughputPerTier: 20,
    });
    const capMap = new Map<CapabilityId, Capability>();
    capMap.set(serverCap.id, serverCap);
    const tiersMap = new Map<CapabilityId, number>();
    tiersMap.set(serverCap.id, 1);
    const server = makeComponent({
      id: "s1",
      type: "server",
      ports: [makePort("p-in", "ingress")],
      capabilities: capMap,
      tiers: tiersMap,
    });
    const components = new Map<ComponentId, Component>();
    components.set(server.id, server);

    // 6 ticks of full saturation (20/tick) with heavy drops.
    const metrics: TickMetrics[] = [];
    for (let t = 0; t < 6; t++) {
      metrics.push(
        tickMetricsFor({
          tick: t,
          perComponent: [[server.id, { processed: 20, dropped: 30 }]],
          requestsProcessed: 20,
          requestsDropped: 30,
        }),
      );
    }
    const diag = diagnoseWave({
      wave: makeWave({}), // reads-only, no routing gap
      metrics,
      components,
      connections: new Map(),
    });
    expect(diag.headline).toMatch(/overwhelmed/i);
  });

  // ─── Case 3: write routing gap ────────────────────────────────────
  it("detects a write routing gap when bottleneck has no downstream write-acceptor", () => {
    // Server has no capabilities at all → not a write-acceptor.
    const server = makeComponent({
      id: "s1",
      type: "server",
      ports: [makePort("p-in", "ingress"), makePort("p-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>(),
    });
    const components = new Map<ComponentId, Component>();
    components.set(server.id, server);

    const metrics: TickMetrics[] = [
      tickMetricsFor({
        tick: 0,
        perComponent: [[server.id, { processed: 5, dropped: 15 }]],
        requestsProcessed: 5,
        requestsDropped: 15,
      }),
    ];
    const diag = diagnoseWave({
      wave: makeWave({ composition: [["api_read", 0.7], ["api_write", 0.3]] }),
      metrics,
      components,
      connections: new Map<ConnectionId, Connection>(),
    });
    expect(diag.hint).toMatch(/persists|storage|durab/i);
  });

  // ─── Case 4: TTL timeouts ──────────────────────────────────────────
  it("detects pileup when TTL timeout rate exceeds 10%", () => {
    const server = makeComponent({
      id: "s1",
      type: "server",
      ports: [makePort("p-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>(),
    });
    const components = new Map<ComponentId, Component>();
    components.set(server.id, server);

    const metrics: TickMetrics[] = [
      tickMetricsFor({
        tick: 0,
        perComponent: [[server.id, { processed: 10, dropped: 1 }]],
        requestsProcessed: 10,
        requestsDropped: 1,
        requestsTimedOut: 20,
      }),
    ];
    const diag = diagnoseWave({
      wave: makeWave({}),
      metrics,
      components,
      connections: new Map(),
    });
    expect(diag.headline).toMatch(/piling up|pile/i);
  });

  // ─── Case 5: specificity (routing gap wins over throughput) ───────
  it("prefers routing-gap diagnosis over throughput when both match", () => {
    // Server is saturated AND has no write acceptor downstream.
    const serverCap = new RespondingCapability("resp" as CapabilityId, {
      throughputPerTier: 20,
    });
    // Override canHandle to reject writes so it's NOT a write acceptor.
    (serverCap as unknown as { canHandle: (t: string) => boolean }).canHandle =
      (t: string) => t === "api_read";
    const capMap = new Map<CapabilityId, Capability>();
    capMap.set(serverCap.id, serverCap);
    const tiersMap = new Map<CapabilityId, number>();
    tiersMap.set(serverCap.id, 1);
    const server = makeComponent({
      id: "s1",
      type: "server",
      ports: [makePort("p-in", "ingress")],
      capabilities: capMap,
      tiers: tiersMap,
    });
    const components = new Map<ComponentId, Component>();
    components.set(server.id, server);

    const metrics: TickMetrics[] = [];
    for (let t = 0; t < 6; t++) {
      metrics.push(
        tickMetricsFor({
          tick: t,
          perComponent: [[server.id, { processed: 20, dropped: 30 }]],
          requestsProcessed: 20,
          requestsDropped: 30,
        }),
      );
    }
    const diag = diagnoseWave({
      wave: makeWave({ composition: [["api_read", 0.7], ["api_write", 0.3]] }),
      metrics,
      components,
      connections: new Map(),
    });
    // Routing gap branch (more specific) must win.
    expect(diag.hint).toMatch(/persists|storage|durab/i);
    expect(diag.headline).not.toMatch(/overwhelmed/i);
  });
});

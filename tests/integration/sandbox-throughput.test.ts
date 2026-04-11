import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { ForwardingCapability } from "@harness/test-capabilities";
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import type { ProcessResult } from "@core/types/result";
import type { CapabilityId, ComponentId } from "@core/types/ids";

/**
 * A RespondingCapability with a finite getThroughputPerTick.
 * Returns `limit` as the throughput cap, so the engine's throughput gate
 * will mark excess requests as OVERLOADED.
 */
class BoundedRespondingCapability implements Capability {
  readonly phase = "PROCESS" as const;
  constructor(
    readonly id: CapabilityId,
    private readonly limit: number,
  ) {}
  canHandle(_requestType: string): boolean { return true; }
  process(_req: Request, _ctx: ProcessContext): ProcessResult {
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }
  getUpkeepCost(_tier: number): number { return 0; }
  getThroughputPerTick(_tier: number): number { return this.limit; }
  getStats(): CapabilityStats { return {}; }
}

describe("Sandbox throughput saturation", () => {
  it("excess requests beyond throughput are marked OVERLOADED", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Client: forwards traffic (unbounded throughput)
    const clientEgress = makePort("p-c-out", "egress");
    const clientCaps = new Map<CapabilityId, Capability>([
      ["cap-fwd" as CapabilityId, new ForwardingCapability("cap-fwd" as CapabilityId)],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-fwd" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    // Server: BoundedRespondingCapability with throughput=5
    const serverIngress = makePort("p-s-in", "ingress");
    const serverCaps = new Map<CapabilityId, Capability>([
      ["cap-bounded" as CapabilityId, new BoundedRespondingCapability("cap-bounded" as CapabilityId, 5)],
    ]);
    const serverTiers = new Map<CapabilityId, number>([["cap-bounded" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: serverCaps,
      tiers: serverTiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new SandboxModeController();
    // Inject 20 requests per tick — way more than server throughput of 5
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_read",
      intensity: 20,
      pattern: "steady",
    });
    mode.advancePhase();

    const engine = new Engine(state);
    engine.tick(mode);

    const allEvents = [...state.requestLog.values()].flat();

    // Some should be RESPONDED (within throughput of 5)
    const respondedEvents = allEvents.filter((e) => e.type === "RESPONDED");
    expect(respondedEvents.length).toBeGreaterThan(0);
    expect(respondedEvents.length).toBeLessThanOrEqual(5);

    // Excess should be OVERLOADED
    const overloadedEvents = allEvents.filter((e) => e.type === "OVERLOADED");
    expect(overloadedEvents.length).toBeGreaterThan(0);

    // Metrics should capture both
    const snap = mode.getMetricsSnapshot(state);
    expect(snap.totalOverloaded).toBeGreaterThan(0);
    expect(snap.totalResolved).toBeGreaterThan(0);
  });
});

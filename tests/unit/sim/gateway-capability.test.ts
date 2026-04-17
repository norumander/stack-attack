import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { GatewayCapability } from "@sim/capabilities/gateway";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(requiresAuth: boolean): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("GatewayCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const gw = new SimComponent({ id: "gw" as ComponentId, capabilities: [new GatewayCapability({ revenuePerAuth: 4 })] });
    const downstream = new SimComponent({ id: "ds" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: gw.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const bd = new SimConnection({
      id: "bd" as ConnectionId,
      from: { componentId: gw.id, portId: "p" as PortId },
      to: { componentId: downstream.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "db" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(gw); sim.addComponent(downstream);
    sim.addConnection(ab); sim.addConnection(bd);
    return { sim, ab, bd };
  }

  it("terminates auth-required packet with revenue per request", () => {
    const { sim, ab } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq(true), mkReq(true), mkReq(true)], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 12 });
  });

  it("forwards non-auth packet to first egress", () => {
    const { sim, ab, bd } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq(false)], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(bd.id);
  });
});

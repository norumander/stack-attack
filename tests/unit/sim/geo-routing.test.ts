import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { GeoRoutingCapability } from "@sim/capabilities/geo-routing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(zone: string | null): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: zone,
    spawnedAt: 0,
  };
}

describe("GeoRoutingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const dns = new SimComponent({ id: "dns" as ComponentId, capabilities: [new GeoRoutingCapability()] });
    const na = new SimComponent({ id: "na" as ComponentId, capabilities: [], zone: "NA" });
    const eu = new SimComponent({ id: "eu" as ComponentId, capabilities: [], zone: "EU" });
    const mk = (id: string, from: ComponentId, to: ComponentId, twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: "forward",
      });
    sim.addComponent(a); sim.addComponent(dns); sim.addComponent(na); sim.addComponent(eu);
    const ad = mk("ad", a.id, dns.id, "da");
    const dn = mk("dn", dns.id, na.id, "nd");
    const de = mk("de", dns.id, eu.id, "ed");
    for (const e of [ad, dn, de]) sim.addConnection(e);
    return { sim, ad, dn, de };
  }

  it("routes NA request to NA server", () => {
    const { sim, ad, dn } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("NA")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(dn.id);
  });

  it("routes EU request to EU server", () => {
    const { sim, ad, de } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("EU")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(de.id);
  });

  it("drops when no egress matches the zone", () => {
    const { sim, ad } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("AP")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "no_zone_match" });
  });
});

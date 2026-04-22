import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ContentRouterCapability } from "@sim/capabilities/content-router";
import { wireContentRouters } from "../../../src/physics-td/wire-content-routers";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(overrides: Partial<Request> = {}): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
    ...overrides,
  };
}

function mkConn(
  id: string,
  from: ComponentId,
  to: ComponentId,
  twin: string,
): SimConnection {
  return new SimConnection({
    id: id as ConnectionId,
    from: { componentId: from, portId: "p" as PortId },
    to: { componentId: to, portId: "p" as PortId },
    bandwidth: 100,
    latencySeconds: 1 / 60,
    twinId: twin as ConnectionId,
    direction: "forward",
  });
}

describe("ContentRouterCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  /**
   * Build a topology:
   *   source -> router -> streaming_server
   *                    -> cdn
   *                    -> api_gateway
   *                    -> server (default)
   */
  function boot() {
    const sim = new Sim({ seed: 1 });

    const source = new SimComponent({ id: "src" as ComponentId, capabilities: [] });
    const router = new SimComponent({
      id: "router" as ComponentId,
      capabilities: [new ContentRouterCapability()],
    });
    const streaming = new SimComponent({ id: "streaming" as ComponentId, capabilities: [] });
    const cdn = new SimComponent({ id: "cdn" as ComponentId, capabilities: [] });
    const gateway = new SimComponent({ id: "gateway" as ComponentId, capabilities: [] });
    const server = new SimComponent({ id: "server" as ComponentId, capabilities: [] });

    sim.addComponent(source);
    sim.addComponent(router);
    sim.addComponent(streaming);
    sim.addComponent(cdn);
    sim.addComponent(gateway);
    sim.addComponent(server);

    const srcToRouter = mkConn("sr", source.id, router.id, "rs");
    const routerToStreaming = mkConn("r_stream", router.id, streaming.id, "stream_r");
    const routerToCdn = mkConn("r_cdn", router.id, cdn.id, "cdn_r");
    const routerToGateway = mkConn("r_gw", router.id, gateway.id, "gw_r");
    const routerToServer = mkConn("r_srv", router.id, server.id, "srv_r");

    for (const c of [srcToRouter, routerToStreaming, routerToCdn, routerToGateway, routerToServer]) {
      sim.addConnection(c);
    }

    const componentTypes = new Map<ComponentId, string>([
      ["src" as ComponentId, "server"],
      ["router" as ComponentId, "edge_router"],
      ["streaming" as ComponentId, "streaming_server"],
      ["cdn" as ComponentId, "cdn"],
      ["gateway" as ComponentId, "api_gateway"],
      ["server" as ComponentId, "server"],
    ]);

    wireContentRouters(sim, componentTypes);

    return { sim, srcToRouter, routerToStreaming, routerToCdn, routerToGateway, routerToServer };
  }

  it("routes stream requests to the streaming egress", () => {
    const { sim, srcToRouter, routerToStreaming } = boot();
    const req = mkReq({ stream: { duration: 5, bandwidth: 10 } });
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(routerToStreaming.id);
  });

  it("routes large requests to the CDN egress", () => {
    const { sim, srcToRouter, routerToCdn } = boot();
    const req = mkReq({ isLarge: true });
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(routerToCdn.id);
  });

  it("routes auth requests to the gateway egress", () => {
    const { sim, srcToRouter, routerToGateway } = boot();
    const req = mkReq({ requiresAuth: true });
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(routerToGateway.id);
  });

  it("routes plain reads to the default (server) egress", () => {
    const { sim, srcToRouter, routerToServer } = boot();
    const req = mkReq();
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(routerToServer.id);
  });

  it("splits mixed-type packets across multiple egresses", () => {
    const { sim, srcToRouter, routerToStreaming, routerToServer } = boot();
    const streamReq = mkReq({ stream: { duration: 5, bandwidth: 10 } });
    const plainReq = mkReq();
    sim.spawnPacket(makePacket({
      requests: [streamReq, plainReq],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    // Should have split into 2 child packets
    expect(sim.activePackets.length).toBe(2);
    const edgeIds = new Set(sim.activePackets.map((p) => p.edgeId));
    expect(edgeIds.has(routerToStreaming.id)).toBe(true);
    expect(edgeIds.has(routerToServer.id)).toBe(true);
  });

  it("falls through to default when no matching egress exists", () => {
    // Build a topology with only a default egress (no streaming, cdn, or gateway)
    const sim = new Sim({ seed: 1 });
    const source = new SimComponent({ id: "src" as ComponentId, capabilities: [] });
    const router = new SimComponent({
      id: "router" as ComponentId,
      capabilities: [new ContentRouterCapability()],
    });
    const server = new SimComponent({ id: "server" as ComponentId, capabilities: [] });

    sim.addComponent(source);
    sim.addComponent(router);
    sim.addComponent(server);

    const srcToRouter = mkConn("sr", source.id, router.id, "rs");
    const routerToServer = mkConn("r_srv", router.id, server.id, "srv_r");
    sim.addConnection(srcToRouter);
    sim.addConnection(routerToServer);

    const componentTypes = new Map<ComponentId, string>([
      ["src" as ComponentId, "server"],
      ["router" as ComponentId, "edge_router"],
      ["server" as ComponentId, "server"],
    ]);
    wireContentRouters(sim, componentTypes);

    // Stream request should fall back to default since no streaming egress exists
    const req = mkReq({ stream: { duration: 5, bandwidth: 10 } });
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(routerToServer.id);
  });

  it("drops with no_egress when router has zero egresses", () => {
    const sim = new Sim({ seed: 1 });
    const source = new SimComponent({ id: "src" as ComponentId, capabilities: [] });
    const router = new SimComponent({
      id: "router" as ComponentId,
      capabilities: [new ContentRouterCapability()],
    });

    sim.addComponent(source);
    sim.addComponent(router);

    const srcToRouter = mkConn("sr", source.id, router.id, "rs");
    sim.addConnection(srcToRouter);

    const req = mkReq();
    sim.spawnPacket(makePacket({
      requests: [req],
      edgeId: srcToRouter.id,
      speed: srcToRouter.speed,
      spawnedAt: 0,
      direction: "forward",
    }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "no_egress" });
  });
});

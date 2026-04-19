import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { SimToRendererAdapter } from "../../../src/sim-demo/sim-to-renderer";
import type { TopologyRenderer, SpawnRequestDotArgs, ComponentUpdate, ConnectionUpdate, ComponentVisual, RendererPointerEvent } from "@dashboard/render/topology-renderer";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { Request } from "@sim/types";

class MockRenderer implements TopologyRenderer {
  spawnedDots: SpawnRequestDotArgs[] = [];
  dropsFlashed: ComponentId[] = [];
  respondedFlashed: ComponentId[] = [];
  async mount(): Promise<void> {}
  destroy(): void {}
  resize(): void {}
  addComponent(_id: ComponentId, _visual: ComponentVisual): void {}
  removeComponent(): void {}
  updateComponent(_id: ComponentId, _u: ComponentUpdate): void {}
  addConnection(): void {}
  removeConnection(): void {}
  updateConnection(_id: ConnectionId, _u: ConnectionUpdate): void {}
  spawnRequestDot(args: SpawnRequestDotArgs): void { this.spawnedDots.push(args); }
  flashOverload(id: ComponentId): void { this.dropsFlashed.push(id); }
  flashDrop(id: ComponentId): void { this.dropsFlashed.push(id); }
  flashResponded(id: ComponentId): void { this.respondedFlashed.push(id); }
  queueFlashOnRequestArrival(): void {}
  setSelected(): void {}
  setPlacementGhost(): void {}
  setConnectionMode(): void {}
  hitTest(): null { return null; }
  hitTestConnection(): null { return null; }
  screenToGrid(): { x: number; y: number } { return { x: 0, y: 0 }; }
  worldToScreen(): { x: number; y: number } { return { x: 0, y: 0 }; }
  onPointerDown(_cb: (ev: RendererPointerEvent) => void): () => void { return () => {}; }
  onPointerMove(_cb: (ev: RendererPointerEvent) => void): () => void { return () => {}; }
  onConnectionPointerDown(): () => void { return () => {}; }
  onComponentDragEnd(): () => void { return () => {}; }
  updateClientSnake(): void {}
}

function mkRead(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false, requiresAuth: false, isLarge: false, isAsync: false,
    originClientId: "client" as ComponentId, originZone: null, spawnedAt: 0,
  };
}

describe("SimToRendererAdapter", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({
      id: "b" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 100,
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: b.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "p" as PortId },
      to: { componentId: a.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    return { sim, ef };
  }

  it("spawns a renderer dot for each new in-flight packet", () => {
    const { sim, ef } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer, new Map());
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    adapter.syncFrame();
    expect(renderer.spawnedDots).toHaveLength(1);
    expect(renderer.spawnedDots[0]!.connectionId).toBe(ef.id);
    expect(renderer.spawnedDots[0]!.durationMs).toBeGreaterThan(0);
  });

  it("does not re-spawn dots for packets already tracked", () => {
    const { sim, ef } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer, new Map());
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    adapter.syncFrame();
    adapter.syncFrame();
    adapter.syncFrame();
    expect(renderer.spawnedDots).toHaveLength(1);
  });

  it("fires flashDrop on drop events", () => {
    const { sim } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer, new Map());
    sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "test", count: 1 });
    adapter.syncFrame();
    expect(renderer.dropsFlashed).toEqual(["b"]);
  });

  it("fires flashResponded on respond-delivered events", () => {
    const { sim } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer, new Map());
    sim.lastStepEvents.push({ kind: "respond-delivered", componentId: "a" as ComponentId, revenue: 5, latencySeconds: 0.2 });
    adapter.syncFrame();
    expect(renderer.respondedFlashed).toEqual(["a"]);
  });

  it("throttles flashes within the window", () => {
    const { sim } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer, new Map(), { flashWindowMs: 1000 });
    // Push 5 drop events on the same component
    for (let i = 0; i < 5; i += 1) {
      sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "x", count: 1 });
    }
    adapter.syncFrame();
    // First syncFrame fires once (window starts)
    expect(renderer.dropsFlashed).toEqual(["b"]);
    // Second syncFrame within window — no new flash
    sim.lastStepEvents.length = 0;
    for (let i = 0; i < 5; i += 1) {
      sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "x", count: 1 });
    }
    adapter.syncFrame();
    expect(renderer.dropsFlashed).toEqual(["b"]); // still just one
  });
});

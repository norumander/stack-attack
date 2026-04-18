// src/dashboard/sim-demo/sim-to-renderer.ts
import type { Sim } from "@sim/sim";
import type { TopologyRenderer } from "@dashboard/render/topology-renderer";
import type { Packet, PacketId } from "@sim/types";
import type { ComponentId, RequestId } from "@core/types/ids";

export type SimToRendererAdapterOptions = {
  readonly flashWindowMs?: number;
};

export class SimToRendererAdapter {
  private readonly trackedPackets: Set<PacketId> = new Set();
  private readonly recentProcessed: Map<ComponentId, number[]> = new Map();
  private readonly lastFlashAt: Map<string, number> = new Map();
  private readonly flashWindowMs: number;

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
    private readonly positions: Map<ComponentId, { x: number; y: number }>,
    options: SimToRendererAdapterOptions = {},
  ) {
    this.flashWindowMs = options.flashWindowMs ?? 200;
  }

  private maybeFlash(componentId: ComponentId, kind: "drop" | "responded"): void {
    const key = `${componentId as unknown as string}:${kind}`;
    const now = performance.now();
    const last = this.lastFlashAt.get(key) ?? 0;
    if (now - last < this.flashWindowMs) return;
    this.lastFlashAt.set(key, now);
    if (kind === "drop") this.renderer.flashDrop(componentId);
    else this.renderer.flashResponded(componentId);
  }

  syncFrame(): void {
    for (const packet of this.sim.activePackets) {
      if (this.trackedPackets.has(packet.id)) continue;
      this.trackedPackets.add(packet.id);
      const remainingProgress = 1 - packet.progress;
      const durationMs = (remainingProgress / packet.speed) * 1000;
      const reqId: RequestId = (packet.requests[0]?.id ?? (packet.id as unknown as RequestId));
      this.renderer.spawnRequestDot({
        connectionId: packet.edgeId,
        requestId: reqId,
        requestType: inferRequestType(packet),
        durationMs,
        count: packet.requests.length,
      });
    }

    const activeIds = new Set<PacketId>(this.sim.activePackets.map((p) => p.id));
    for (const id of this.trackedPackets) {
      if (!activeIds.has(id)) this.trackedPackets.delete(id);
    }

    for (const ev of this.sim.lastStepEvents) {
      if (ev.kind === "drop") this.maybeFlash(ev.componentId, "drop");
      else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
        this.maybeFlash(ev.componentId, "responded");
      }
    }

    // Track processed events for utilization (rolling 1s window).
    for (const ev of this.sim.lastStepEvents) {
      if (ev.kind !== "terminate" && ev.kind !== "respond-delivered") continue;
      const arr = this.recentProcessed.get(ev.componentId) ?? [];
      arr.push(this.sim.simTime);
      this.recentProcessed.set(ev.componentId, arr);
    }

    // Push utilization for any component with a capacity.
    const cutoff = this.sim.simTime - 1;
    for (const [id, comp] of this.sim.components.entries()) {
      if (comp.capacityPerSecond === null) continue;
      const arr = this.recentProcessed.get(id) ?? [];
      while (arr.length > 0 && arr[0]! < cutoff) arr.shift();
      const utilization = arr.length / comp.capacityPerSecond;
      this.renderer.updateComponent(id, { utilization: Math.min(1, utilization) });
    }

    for (const [id, comp] of this.sim.components.entries()) {
      for (const cap of comp.capabilities) {
        if (cap.id === "caching") {
          const snapshot = (cap as unknown as { getSnapshot(): { keys: ReadonlyArray<string> } }).getSnapshot();
          this.renderer.updateComponent(id, { cacheKeys: snapshot.keys });
        }
      }
    }

    if (this.renderer.updateClientSnake) {
      for (const client of this.sim.clients.values()) {
        const clientPos = this.positions.get(client.id);
        let trailDirection: { dx: number; dy: number } = { dx: -1, dy: 0 };
        if (clientPos) {
          for (const conn of this.sim.connections.values()) {
            if (conn.from.componentId === client.id && conn.direction === "forward") {
              const targetPos = this.positions.get(conn.to.componentId);
              if (targetPos) {
                const dx = targetPos.x - clientPos.x;
                const dy = targetPos.y - clientPos.y;
                const len = Math.hypot(dx, dy);
                if (len > 0) trailDirection = { dx: -dx / len, dy: -dy / len };
              }
              break;
            }
          }
        }
        const snakeView = client.snake.map((p) => ({
          id: p.id as unknown as string,
          type: inferRequestType(p),
          count: p.requests.length,
        }));
        this.renderer.updateClientSnake(client.id, snakeView, { trailDirection });
      }
    }
  }
}

function inferRequestType(packet: Packet): string {
  const first = packet.requests[0];
  if (!first) return "api_read";
  if (first.stream !== undefined) return "stream";
  if (first.requiresAuth) return "auth_required";
  if (first.isLarge) return "static_asset";
  if (first.isWrite) return "api_write";
  if (first.isAsync) return "batch";
  return "api_read";
}

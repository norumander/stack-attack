// src/dashboard/sim-demo/sim-to-renderer.ts
import type { Sim } from "@sim/sim";
import type { TopologyRenderer } from "@dashboard/render/topology-renderer";
import type { Packet, PacketId } from "@sim/types";
import type { RequestId } from "@core/types/ids";

export class SimToRendererAdapter {
  private readonly trackedPackets: Set<PacketId> = new Set();

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
  ) {}

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
      if (ev.kind === "drop") this.renderer.flashDrop(ev.componentId);
      else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
        this.renderer.flashResponded(ev.componentId);
      }
    }

    const maybeUpdateSnake = (this.renderer as TopologyRenderer & {
      updateClientSnake?: (
        clientId: string,
        snake: ReadonlyArray<{ id: string; type: string; count: number }>,
      ) => void;
    }).updateClientSnake;
    if (maybeUpdateSnake) {
      for (const client of this.sim.clients.values()) {
        maybeUpdateSnake.call(
          this.renderer,
          client.id,
          client.snake.map((p) => ({
            id: p.id as unknown as string,
            type: inferRequestType(p),
            count: p.requests.length,
          })),
        );
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

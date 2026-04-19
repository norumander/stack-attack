import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { Packet } from "./types";
import type { SimClient } from "./client";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";
import { effectiveEdgeSpeed } from "./zone-latency";

export function populateSnakes(clients: ReadonlyMap<ComponentId, SimClient>, _simTime: number): void {
  for (const client of clients.values()) {
    if (!client.trafficSource) continue;
    // Generation runs AHEAD of sim time to keep the snake visibly full.
    // We stop when the snake is at capacity OR we'd be generating beyond the
    // wave's end. Each generated packet's spawnedAt remains nextGenerateTime
    // so latency math stays honest (a packet at the back of the snake will
    // appear "spawned" when it would have been generated, not when it launches).
    while (
      client.nextGenerateTime < client.waveEndTime &&
      client.snake.length < client.snakeMax
    ) {
      const pkt = client.trafficSource.generatePacketForTest(client.id, client.nextGenerateTime);
      client.snake.push(pkt);
      client.nextGenerateTime += 1 / client.packetRate;
    }
  }
}

/**
 * Per-step snake-launch routine. For each client that's due, pop snake.head,
 * pick a random forward egress, assign edgeId/speed, push to activePackets.
 */
export function launchDueSnakes(
  clients: ReadonlyMap<ComponentId, SimClient>,
  connections: ReadonlyMap<ConnectionId, SimConnection>,
  activePackets: Packet[],
  simTime: number,
  rng: () => number,
  components?: ReadonlyMap<ComponentId, SimComponent>,
): void {
  for (const client of clients.values()) {
    while (client.nextLaunchTime <= simTime && client.snake.length > 0) {
      const head = client.snake.shift()!;
      const egresses = collectForwardEgresses(connections, client.id);
      if (egresses.length === 0) {
        client.nextLaunchTime += 1 / client.packetRate;
        continue;
      }
      const idx = Math.floor(rng() * egresses.length);
      const chosen = egresses[idx]!;
      head.edgeId = chosen.id;
      head.speed = components ? effectiveEdgeSpeed(chosen, components) : chosen.speed;
      head.progress = 0;
      activePackets.push(head);
      client.nextLaunchTime += 1 / client.packetRate;
    }
  }
}

function collectForwardEgresses(
  connections: ReadonlyMap<ConnectionId, SimConnection>,
  clientId: ComponentId,
): SimConnection[] {
  const egresses: SimConnection[] = [];
  for (const c of connections.values()) {
    if (c.from.componentId === clientId && c.direction === "forward") {
      egresses.push(c);
    }
  }
  return egresses;
}

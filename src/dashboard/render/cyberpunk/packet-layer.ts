import { Assets, Container, Sprite, Text, Texture } from "pixi.js";
import type { ConnectionId, RequestId } from "@core/types/ids.js";
import type { SpawnRequestDotArgs } from "../topology-renderer.js";
import type { ConnectionLayer } from "./connection-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export type PacketSpriteType = "read" | "write";

const PACKET_URLS: Record<PacketSpriteType, string> = {
  read: new URL("../../assets/packet_read.png", import.meta.url).href,
  write: new URL("../../assets/packet_write.png", import.meta.url).href,
};

export type PacketTextureMap = Record<PacketSpriteType, Texture>;

export async function loadPacketTextures(): Promise<PacketTextureMap> {
  const entries = await Promise.all(
    (Object.entries(PACKET_URLS) as [PacketSpriteType, string][]).map(async ([type, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest";
      return [type, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as PacketTextureMap;
}

const PACKET_BY_REQUEST_TYPE: Record<string, PacketSpriteType> = {
  api_read: "read",
  api_write: "write",
  static_asset: "read",
  auth_required: "read",
  stream_init: "read",
};

function classify(requestType: string): PacketSpriteType {
  return PACKET_BY_REQUEST_TYPE[requestType] ?? "read";
}

interface ActivePacket {
  readonly sprite: Sprite;
  readonly label: Text | null;
  readonly connection: ConnectionId;
  readonly requestId: RequestId;
  readonly spawnMs: number;
  readonly spawnOffsetMs: number;
  readonly durationMs: number;
  onRetire: (() => void) | null;
}

export interface PacketLayer {
  readonly container: Container;
  spawn(args: SpawnRequestDotArgs): void;
  tick(deltaMs: number): void;
  cleanup(): void;
  getByRequest(requestId: RequestId): ActivePacket | null;
  registerRetireHandler(requestId: RequestId, handler: () => void): void;
}

export function createPacketLayer(
  connections: ConnectionLayer,
  textures: PacketTextureMap,
): PacketLayer {
  const container = new Container();
  const packets: ActivePacket[] = [];
  const byRequest = new Map<RequestId, ActivePacket>();
  let clockMs = 0;

  const spawn = (args: SpawnRequestDotArgs): void => {
    const type = classify(args.requestType);
    const texture = textures[type];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.6);
    sprite.scale.set(1);

    let label: Text | null = null;
    if (args.count && args.count > 1) {
      label = new Text({
        text: `x${args.count}`,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 9,
          fill: 0xaef7ff,
        },
      });
      label.anchor.set(0.5, 1);
      label.y = -10;
      sprite.addChild(label);
    }

    const path = connections.pathFor(args.connectionId);
    if (path && path.length > 0) {
      sprite.x = path[0]!.x;
      sprite.y = path[0]!.y;
    }
    container.addChild(sprite);

    const packet: ActivePacket = {
      sprite,
      label,
      connection: args.connectionId,
      requestId: args.requestId,
      spawnMs: clockMs,
      spawnOffsetMs: args.spawnOffsetMs ?? 0,
      durationMs:
        args.durationMs > 0 ? args.durationMs : CYBERPUNK_TOKENS.timing.defaultPacketTraversalMs,
      onRetire: null,
    };
    packets.push(packet);
    byRequest.set(args.requestId, packet);
  };

  /**
   * Walks a multi-segment path and returns the point at t∈[0,1] weighted by
   * segment lengths (so the packet moves at a constant screen-space speed
   * regardless of which leg of the L it's on).
   */
  const pointAlongPath = (path: readonly { x: number; y: number }[], t: number): { x: number; y: number } => {
    if (path.length === 0) return { x: 0, y: 0 };
    if (path.length === 1) return path[0]!;
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const dx = path[i + 1]!.x - path[i]!.x;
      const dy = path[i + 1]!.y - path[i]!.y;
      const len = Math.hypot(dx, dy);
      lens.push(len);
      total += len;
    }
    if (total === 0) return path[0]!;
    let target = t * total;
    for (let i = 0; i < lens.length; i++) {
      const segLen = lens[i]!;
      if (target <= segLen) {
        const segT = segLen === 0 ? 0 : target / segLen;
        return {
          x: path[i]!.x + (path[i + 1]!.x - path[i]!.x) * segT,
          y: path[i]!.y + (path[i + 1]!.y - path[i]!.y) * segT,
        };
      }
      target -= segLen;
    }
    return path[path.length - 1]!;
  };

  const retire = (packet: ActivePacket): void => {
    const idx = packets.indexOf(packet);
    if (idx >= 0) packets.splice(idx, 1);
    const current = byRequest.get(packet.requestId);
    if (current === packet) byRequest.delete(packet.requestId);
    container.removeChild(packet.sprite);
    packet.sprite.destroy({ children: true });
    if (packet.onRetire) packet.onRetire();
  };

  const tick = (deltaMs: number): void => {
    clockMs += deltaMs;
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]!;
      const elapsed = clockMs - p.spawnMs - p.spawnOffsetMs;
      const path = connections.pathFor(p.connection);
      if (!path) {
        retire(p);
        continue;
      }
      if (elapsed < 0) {
        p.sprite.x = path[0]!.x;
        p.sprite.y = path[0]!.y;
        continue;
      }
      const t = Math.min(1, elapsed / p.durationMs);
      const pt = pointAlongPath(path, t);
      p.sprite.x = pt.x;
      p.sprite.y = pt.y;
      if (t >= 1) retire(p);
    }
  };

  const cleanup = (): void => {
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]!;
      if (!connections.pathFor(p.connection)) retire(p);
    }
  };

  const getByRequest = (requestId: RequestId): ActivePacket | null =>
    byRequest.get(requestId) ?? null;

  const registerRetireHandler = (requestId: RequestId, handler: () => void): void => {
    const p = byRequest.get(requestId);
    if (p) p.onRetire = handler;
  };

  return { container, spawn, tick, cleanup, getByRequest, registerRetireHandler };
}

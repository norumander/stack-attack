import { Container, Graphics } from "pixi.js";
import type { ComponentId, RequestId } from "@core/types/ids.js";
import type { ComponentLayer } from "./component-layer.js";
import type { PacketLayer } from "./packet-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export type FlashKind = "served" | "drop" | "overload";

interface ActiveFlash {
  readonly gfx: Graphics;
  readonly componentId: ComponentId;
  readonly color: number;
  age: number;
  readonly duration: number;
}

interface PendingFlash {
  readonly requestId: RequestId;
  readonly componentId: ComponentId;
  readonly kind: FlashKind;
  age: number;
}

function colorForKind(kind: FlashKind): number {
  switch (kind) {
    case "served":
      return CYBERPUNK_TOKENS.palette.flashResponded;
    case "drop":
      return CYBERPUNK_TOKENS.palette.flashDrop;
    case "overload":
      return CYBERPUNK_TOKENS.palette.flashOverload;
  }
}

export interface FlashFx {
  readonly container: Container;
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;
  flashResponded(id: ComponentId): void;
  queueOnArrival(requestId: RequestId, componentId: ComponentId, kind: FlashKind): void;
  tick(deltaMs: number): void;
}

export function createFlashFx(components: ComponentLayer, packets: PacketLayer): FlashFx {
  const container = new Container();
  const active: ActiveFlash[] = [];
  const pending: PendingFlash[] = [];

  const fireFlash = (id: ComponentId, kind: FlashKind): void => {
    const state = components.get(id);
    if (!state) return;
    const gfx = new Graphics();
    gfx.x = state.container.x;
    gfx.y = state.container.y;
    container.addChild(gfx);
    active.push({
      gfx,
      componentId: id,
      color: colorForKind(kind),
      age: 0,
      duration: 500,
    });
  };

  const flashOverload = (id: ComponentId): void => fireFlash(id, "overload");
  const flashDrop = (id: ComponentId): void => fireFlash(id, "drop");
  const flashResponded = (id: ComponentId): void => fireFlash(id, "served");

  const queueOnArrival = (
    requestId: RequestId,
    componentId: ComponentId,
    kind: FlashKind,
  ): void => {
    packets.registerRetireHandler(requestId, () => fireFlash(componentId, kind));
    pending.push({ requestId, componentId, kind, age: 0 });
  };

  const tick = (deltaMs: number): void => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      p.age += deltaMs;
      const stillActive = packets.getByRequest(p.requestId) !== null;
      if (!stillActive && p.age > 0) {
        pending.splice(i, 1);
        continue;
      }
      if (p.age > CYBERPUNK_TOKENS.timing.maxPendingFlashAgeMs) {
        fireFlash(p.componentId, p.kind);
        pending.splice(i, 1);
      }
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i]!;
      a.age += deltaMs;
      const t = a.age / a.duration;
      if (t >= 1) {
        container.removeChild(a.gfx);
        a.gfx.destroy();
        active.splice(i, 1);
        continue;
      }
      const radius = 18 + t * 34;
      const alpha = 1 - t;
      a.gfx.clear();
      a.gfx.circle(0, 0, radius).stroke({ color: a.color, width: 3, alpha });
    }
  };

  return { container, flashOverload, flashDrop, flashResponded, queueOnArrival, tick };
}

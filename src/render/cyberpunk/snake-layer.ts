import { Container, Sprite, Text, type Texture } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentLayer } from "./component-layer.js";
import type { PacketTextureMap, PacketSpriteType } from "./packet-layer.js";

export type SnakePacket = { readonly id: string; readonly type: string; readonly count: number };

type SpriteAnim = {
  /** Where the sprite is currently drawn (animated). */
  curX: number;
  curY: number;
  /** Resting slot position the sprite is sliding toward. */
  targetX: number;
  targetY: number;
};

type ClientSnakeState = {
  readonly container: Container;
  readonly sprites: Sprite[];
  readonly labels: (Text | null)[];
  readonly anims: SpriteAnim[];
  /** Last trail direction so newly-spawned sprites can be placed further-out. */
  lastDir: { dx: number; dy: number };
};

const TRAIL_SPACING_PX = 24;
const MAX_VISIBLE = 10;
/** Per-frame lerp factor: ~0.2 → converges in ~5 frames at 60fps. */
const SLIDE_LERP = 0.2;

/**
 * Snake layer: renders a desaturated trail of up-to-10 upcoming packets
 * behind each client sprite, visualizing the client's pending queue.
 */
const PACKET_BY_REQUEST_TYPE: Record<string, PacketSpriteType> = {
  api_read: "read",
  api_write: "write",
  static_asset: "read",
  auth_required: "read",
  stream_init: "read",
  stream: "read",
};

function classify(requestType: string): PacketSpriteType {
  return PACKET_BY_REQUEST_TYPE[requestType] ?? "read";
}

export class SnakeLayer {
  readonly container: Container;
  private readonly states: Map<ComponentId, ClientSnakeState> = new Map();

  constructor(
    private readonly componentLayer: ComponentLayer,
    private readonly textures: PacketTextureMap,
  ) {
    this.container = new Container();
  }

  update(
    clientId: ComponentId,
    packets: ReadonlyArray<SnakePacket>,
    options: { trailDirection: { dx: number; dy: number } } = { trailDirection: { dx: -1, dy: 0 } },
  ): void {
    const clientState = this.componentLayer.get(clientId);
    if (!clientState) {
      this.dispose(clientId);
      return;
    }
    const dir = options.trailDirection;
    let state = this.states.get(clientId);
    if (!state) {
      const container = new Container();
      this.container.addChild(container);
      state = { container, sprites: [], labels: [], anims: [], lastDir: dir };
      this.states.set(clientId, state);
    }
    state.lastDir = dir;
    state.container.x = clientState.container.x;
    state.container.y = clientState.container.y;

    const visible = packets.slice(0, MAX_VISIBLE);
    while (state.sprites.length > visible.length) {
      const s = state.sprites.pop()!;
      state.container.removeChild(s);
      s.destroy();
      const lbl = state.labels.pop();
      lbl?.destroy();
      state.anims.pop();
    }
    const fallbackTex = this.textures.read;
    while (state.sprites.length < visible.length) {
      const idx = state.sprites.length;
      const tex: Texture = this.textures[classify(visible[idx]!.type)] ?? fallbackTex;
      if (!tex) break;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.alpha = 0.45;
      state.container.addChild(sprite);
      state.sprites.push(sprite);
      state.labels.push(null);
      // Spawn one slot further out from the client than its eventual resting
      // slot — the tick loop will lerp it inward toward its target.
      const spawnOffset = (idx + 2) * TRAIL_SPACING_PX;
      const spawnX = dir.dx * spawnOffset;
      const spawnY = dir.dy * spawnOffset - 8;
      sprite.x = spawnX;
      sprite.y = spawnY;
      state.anims.push({ curX: spawnX, curY: spawnY, targetX: spawnX, targetY: spawnY });
    }
    for (let i = 0; i < visible.length; i += 1) {
      const sprite = state.sprites[i];
      if (!sprite) continue;
      const anim = state.anims[i]!;
      const offset = (i + 1) * TRAIL_SPACING_PX;
      // Update target for current frame; tick() will animate toward it.
      anim.targetX = dir.dx * offset;
      anim.targetY = dir.dy * offset - 8;
      sprite.alpha = Math.max(0.15, 0.5 - i * 0.035);
      const tex = this.textures[classify(visible[i]!.type)];
      if (tex && sprite.texture !== tex) sprite.texture = tex;
      const count = visible[i]!.count;
      let label = state.labels[i] ?? null;
      if (count >= 5) {
        if (!label) {
          label = new Text({ text: `x${count}`, style: { fontFamily: "monospace", fontSize: 10, fill: 0xaaaaaa } });
          label.anchor.set(0.5, 1);
          label.y = -14;
          sprite.addChild(label);
          state.labels[i] = label;
        } else {
          label.text = `x${count}`;
        }
      } else if (label) {
        label.destroy();
        state.labels[i] = null;
      }
    }
  }

  /**
   * Per-frame animation step — lerps each sprite's drawn position toward its
   * target slot. Called from the renderer's main ticker. deltaMs is unused
   * (fixed lerp factor per frame); kept for symmetry with PacketLayer.tick.
   */
  tick(_deltaMs: number): void {
    for (const state of this.states.values()) {
      for (let i = 0; i < state.sprites.length; i += 1) {
        const sprite = state.sprites[i]!;
        const anim = state.anims[i]!;
        anim.curX += (anim.targetX - anim.curX) * SLIDE_LERP;
        anim.curY += (anim.targetY - anim.curY) * SLIDE_LERP;
        sprite.x = anim.curX;
        sprite.y = anim.curY;
      }
    }
  }

  dispose(clientId: ComponentId): void {
    const state = this.states.get(clientId);
    if (!state) return;
    this.container.removeChild(state.container);
    for (const s of state.sprites) s.destroy();
    for (const l of state.labels) l?.destroy();
    state.container.destroy();
    this.states.delete(clientId);
  }

  cleanup(): void {
    for (const id of [...this.states.keys()]) this.dispose(id);
  }
}

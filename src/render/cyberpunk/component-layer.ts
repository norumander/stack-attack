import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentVisual, ComponentUpdate } from "../topology-renderer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";
import { utilizationColor } from "../utilization-color.js";

// NOTE: Cyberpunk sprite URLs archived for rollback. To revert the retheme:
//   1. cp src/assets/_cyberpunk-archive/*.png src/assets/
//   2. Uncomment CYBERPUNK_SPRITE_URLS below, delete the live SPRITE_URLS,
//      and rename the archive back to SPRITE_URLS.
// See docs/superpowers/specs/2026-04-20-pico8-retheme-design.md
//
// const CYBERPUNK_SPRITE_URLS: Record<string, string> = {
//   client: new URL("../../assets/_cyberpunk-archive/client.png", import.meta.url).href,
//   server: new URL("../../assets/_cyberpunk-archive/server.png", import.meta.url).href,
//   database: new URL("../../assets/_cyberpunk-archive/database.png", import.meta.url).href,
//   data_cache: new URL("../../assets/_cyberpunk-archive/data-cache.png", import.meta.url).href,
//   load_balancer: new URL("../../assets/_cyberpunk-archive/load_balancer.png", import.meta.url).href,
//   cdn: new URL("../../assets/_cyberpunk-archive/cdn.png", import.meta.url).href,
//   api_gateway: new URL("../../assets/_cyberpunk-archive/api_gateway.png", import.meta.url).href,
//   queue: new URL("../../assets/_cyberpunk-archive/queue.png", import.meta.url).href,
//   worker: new URL("../../assets/_cyberpunk-archive/worker.png", import.meta.url).href,
//   streaming_server: new URL("../../assets/_cyberpunk-archive/streaming_server.png", import.meta.url).href,
//   edge_cache: new URL("../../assets/_cyberpunk-archive/edge_cache.png", import.meta.url).href,
//   dns_gtm: new URL("../../assets/_cyberpunk-archive/dns_gtm.png", import.meta.url).href,
//   blob_storage: new URL("../../assets/_cyberpunk-archive/blob_storage.png", import.meta.url).href,
//   circuit_breaker: new URL("../../assets/_cyberpunk-archive/circuit_breaker.png", import.meta.url).href,
// };

const SPRITE_URLS: Record<string, string> = {
  client: new URL("../../assets/client.png", import.meta.url).href,
  server: new URL("../../assets/server.png", import.meta.url).href,
  database: new URL("../../assets/database.png", import.meta.url).href,
  data_cache: new URL("../../assets/data-cache.png", import.meta.url).href,
  load_balancer: new URL("../../assets/load_balancer.png", import.meta.url).href,
  cdn: new URL("../../assets/cdn.png", import.meta.url).href,
  api_gateway: new URL("../../assets/api_gateway.png", import.meta.url).href,
  queue: new URL("../../assets/queue.png", import.meta.url).href,
  worker: new URL("../../assets/worker.png", import.meta.url).href,
  streaming_server: new URL("../../assets/streaming_server.png", import.meta.url).href,
  edge_cache: new URL("../../assets/edge_cache.png", import.meta.url).href,
  dns_gtm: new URL("../../assets/dns_gtm.png", import.meta.url).href,
  blob_storage: new URL("../../assets/blob_storage.png", import.meta.url).href,
  circuit_breaker: new URL("../../assets/circuit_breaker.png", import.meta.url).href,
};

const FALLBACK_BY_TYPE: Record<string, string> = {};

/**
 * Each component texture is split into two layers at load time:
 *  - `base` — all non-cyan pixels, rendered untinted so dark frames stay dark
 *  - `highlight` — cyan pixels flattened to grayscale, rendered with a tint
 *    that represents utilization color (green → yellow → red)
 *
 * Stacking base + highlight per component gives us selective hue shifting
 * without a custom shader.
 */
export interface ComponentSplitTextures {
  readonly base: Texture;
  readonly highlight: Texture;
}

export type ComponentTextureMap = Record<string, ComponentSplitTextures>;

/**
 * Per-frame base/highlight textures for the client typing animation, baked
 * from client-typing.gif into a horizontal PNG strip via
 * scripts/bake-client-typing-strip.mjs. Each frame is run through the same
 * splitBitmap() treatment as static component sprites so the highlight tint
 * stays consistent with the rest of the scene.
 */
export interface ClientTypingTextures {
  readonly base: Texture[];
  readonly highlight: Texture[];
  readonly frameDurationsMs: number[];
}

const CLIENT_TYPING_STRIP_URL = new URL(
  "../../assets/stack-attack/client-typing.png",
  import.meta.url,
).href;
const CLIENT_TYPING_JSON_URL = new URL(
  "../../assets/stack-attack/client-typing.json",
  import.meta.url,
).href;

async function loadAndSplit(url: string): Promise<ComponentSplitTextures> {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return splitBitmap(bitmap);
}

function splitBitmap(bitmap: ImageBitmap): ComponentSplitTextures {
  const w = bitmap.width;
  const h = bitmap.height;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("2d context unavailable");
  srcCtx.drawImage(bitmap, 0, 0);
  const src = srcCtx.getImageData(0, 0, w, h);

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = w;
  baseCanvas.height = h;
  const baseCtx = baseCanvas.getContext("2d")!;
  const base = baseCtx.createImageData(w, h);

  const hiCanvas = document.createElement("canvas");
  hiCanvas.width = w;
  hiCanvas.height = h;
  const hiCtx = hiCanvas.getContext("2d")!;
  const hi = hiCtx.createImageData(w, h);

  for (let i = 0; i < src.data.length; i += 4) {
    const r = src.data[i]!;
    const g = src.data[i + 1]!;
    const b = src.data[i + 2]!;
    const a = src.data[i + 3]!;
    // Pico-8 blue detector (#29ADFF = 41, 173, 255). Exact match — sprites are
    // generated in a fixed 16-color palette so we don't need tolerance.
    const isCyan = a > 0 && r === 0x29 && g === 0xad && b === 0xff;

    if (isCyan) {
      // Flatten to grayscale intensity so sprite.tint shows the target color cleanly.
      const intensity = Math.max(g, b);
      hi.data[i] = intensity;
      hi.data[i + 1] = intensity;
      hi.data[i + 2] = intensity;
      hi.data[i + 3] = a;
      base.data[i + 3] = 0;
    } else {
      base.data[i] = r;
      base.data[i + 1] = g;
      base.data[i + 2] = b;
      base.data[i + 3] = a;
      hi.data[i + 3] = 0;
    }
  }

  baseCtx.putImageData(base, 0, 0);
  hiCtx.putImageData(hi, 0, 0);

  const baseTex = Texture.from(baseCanvas);
  const hiTex = Texture.from(hiCanvas);
  baseTex.source.scaleMode = "nearest";
  hiTex.source.scaleMode = "nearest";
  return { base: baseTex, highlight: hiTex };
}

export async function loadComponentTextures(): Promise<ComponentTextureMap> {
  const entries = await Promise.all(
    Object.entries(SPRITE_URLS).map(async ([type, url]) => {
      const split = await loadAndSplit(url);
      return [type, split] as const;
    }),
  );
  return Object.fromEntries(entries) as ComponentTextureMap;
}

export async function loadClientTypingTextures(): Promise<ClientTypingTextures> {
  const [stripResp, metaResp] = await Promise.all([
    fetch(CLIENT_TYPING_STRIP_URL),
    fetch(CLIENT_TYPING_JSON_URL),
  ]);
  const meta = (await metaResp.json()) as {
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    frameDurationsMs: number[];
  };
  const blob = await stripResp.blob();
  const bitmap = await createImageBitmap(blob);

  const base: Texture[] = [];
  const highlight: Texture[] = [];
  for (let i = 0; i < meta.frameCount; i += 1) {
    const frameBitmap = await createImageBitmap(
      bitmap,
      i * meta.frameWidth,
      0,
      meta.frameWidth,
      meta.frameHeight,
    );
    const split = splitBitmap(frameBitmap);
    base.push(split.base);
    highlight.push(split.highlight);
  }
  return { base, highlight, frameDurationsMs: meta.frameDurationsMs };
}

function shortKey(k: string): string {
  return k.length <= 3 ? k : k.slice(-3);
}

function resolveTextures(textures: ComponentTextureMap, type: string): ComponentSplitTextures {
  if (textures[type]) return textures[type]!;
  const fallback = FALLBACK_BY_TYPE[type];
  if (fallback && textures[fallback]) return textures[fallback]!;
  console.warn(
    `[cyberpunk-renderer] No sprite for component type "${type}", falling back to client`,
  );
  return textures.client!;
}

export interface ComponentRenderState {
  readonly container: Container;
  readonly baseSprite: Sprite;
  readonly highlightSprite: Sprite;
  readonly label: Text;
  readonly pendingLabel: Text;
  /**
   * Short identifier badge rendered above the sprite ("Server 1"). The
   * Container wraps a dark rounded backing (Graphics) + the label (Text)
   * so they translate together; expose them so label updates can refresh
   * the backing geometry.
   */
  readonly nameBadge: Container;
  readonly nameBadgeText: Text;
  readonly nameBadgeBg: Graphics;
  type: string;
  gridX: number;
  gridY: number;
  chipStrip?: Container;
  utilBar?: Graphics;
  stressRing?: Graphics;
  stressPhase?: number;
  stressState?: { stressed: boolean; dropping: boolean };
  /** Static base/highlight textures (the non-typing "idle" frame). */
  idleBaseTexture?: Texture;
  idleHighlightTexture?: Texture;
  /** Per-frame textures for the client typing animation, if loaded. */
  typingFrames?: ClientTypingTextures;
  typingActive?: boolean;
  typingFrameIndex?: number;
  typingFrameElapsedMs?: number;
}

export interface ComponentLayer {
  readonly container: Container;
  add(id: ComponentId, visual: ComponentVisual): void;
  remove(id: ComponentId): void;
  update(id: ComponentId, update: ComponentUpdate): void;
  get(id: ComponentId): ComponentRenderState | undefined;
  all(): IterableIterator<[ComponentId, ComponentRenderState]>;
  /** Per-frame tick for stress-indicator pulse + client typing animation. */
  tick(deltaMs: number): void;
  /**
   * Toggle the client's typing animation. When true, the client sprite cycles
   * through the baked gif frames; when false, it reverts to the static frame.
   * No-op if no client render state exists or typing frames were not loaded.
   */
  setClientTyping(active: boolean): void;
}

export function createComponentLayer(
  textures: ComponentTextureMap,
  clientTypingTextures?: ClientTypingTextures,
): ComponentLayer {
  const container = new Container();
  container.sortableChildren = true;
  const states = new Map<ComponentId, ComponentRenderState>();

  const add = (id: ComponentId, visual: ComponentVisual): void => {
    // Defensive: if this id is already in the scene, remove it first so we
    // don't orphan the old container. Happens when wave cleanup in boot
    // doesn't removeComponent the client (client lives in sim.clients, not
    // sim.components) and setupClientForBuild re-adds it — the old sprite
    // was left behind, reading as an "afterimage" when the client moves.
    const existing = states.get(id);
    if (existing) {
      container.removeChild(existing.container);
      existing.container.destroy({ children: true });
      states.delete(id);
    }

    const tex = resolveTextures(textures, visual.type);

    // Per-type sprite scale override. Client is the landing-page typist
    // (60x60) and reads smaller than the infra components (80x80), so it
    // gets doubled; infra sprites halve to feel like objects sitting on a
    // tile instead of filling it.
    const isClient = visual.type === "client";
    const typeScale = isClient ? 2 : 0.5;
    const finalScale = CYBERPUNK_TOKENS.scale.spriteScale * typeScale;

    // Container is placed at the visual tile center by gridToWorld.
    // Infra sprites sit at the center; the client sprite is nudged 5px south
    // to match its historical hand-tuned placement between center and the
    // south vertex.
    const offsetX = 0;
    const offsetY = isClient ? 15 : 0;

    const baseSprite = new Sprite(tex.base);
    baseSprite.anchor.set(0.5, 0.75);
    baseSprite.scale.set(finalScale);
    baseSprite.position.set(offsetX, offsetY);

    const highlightSprite = new Sprite(tex.highlight);
    highlightSprite.anchor.set(0.5, 0.75);
    highlightSprite.scale.set(finalScale);
    highlightSprite.position.set(offsetX, offsetY);
    // Start untinted — green (healthy) when utilization is 0.
    highlightSprite.tint = utilizationColor(0);

    const label = new Text({
      text: visual.displayName,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: 0x5ef0ff,
        align: "center",
      },
    });
    label.anchor.set(0.5, 0);
    label.y = 16;
    // Display-name label below the sprite is hidden — the short-identifier
    // badge above the sprite is enough chrome. Keep the Text instance alive
    // so downstream update paths that .text = ... don't error.
    label.visible = false;

    const pendingLabel = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 10,
        fill: 0xaef7ff,
        align: "center",
      },
    });
    pendingLabel.anchor.set(0.5, 1);
    pendingLabel.y = -34;
    pendingLabel.visible = false;

    // Short-identifier badge above the sprite ("Server 1", "Profile DB").
    // Rendered with a dark rounded backing so the text stays legible against
    // the busy iso board pattern. Backing sits behind the text in a shared
    // Container so they move together.
    const nameBadgeText = new Text({
      text: visual.label ?? "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
      },
    });
    nameBadgeText.anchor.set(0.5, 0.5);

    const nameBadgeBg = new Graphics();
    const redrawNameBadgeBg = (): void => {
      nameBadgeBg.clear();
      if (!visual.label) return;
      const b = nameBadgeText.getLocalBounds();
      const padX = 5;
      const padY = 2;
      nameBadgeBg
        .roundRect(
          b.x - padX,
          b.y - padY,
          b.width + padX * 2,
          b.height + padY * 2,
          3,
        )
        .fill({ color: 0x0a1420, alpha: 0.92 })
        .stroke({ color: 0x5ef0ff, alpha: 0.6, width: 1 });
    };
    redrawNameBadgeBg();

    // Badge container groups backing + text so they translate together.
    const nameBadge = new Container();
    nameBadge.addChild(nameBadgeBg);
    nameBadge.addChild(nameBadgeText);
    nameBadge.y = -46;
    nameBadge.visible = Boolean(visual.label);

    const inner = new Container();
    inner.addChild(baseSprite);
    inner.addChild(highlightSprite);
    inner.addChild(label);
    inner.addChild(pendingLabel);
    inner.addChild(nameBadge);

    const world = gridToWorld(visual.gridPosition.x, visual.gridPosition.y);
    inner.x = world.x;
    inner.y = world.y;
    inner.zIndex = visual.gridPosition.x + visual.gridPosition.y;

    container.addChild(inner);

    const state: ComponentRenderState = {
      container: inner,
      baseSprite,
      highlightSprite,
      label,
      pendingLabel,
      nameBadge,
      nameBadgeText,
      nameBadgeBg,
      type: visual.type,
      gridX: visual.gridPosition.x,
      gridY: visual.gridPosition.y,
    };

    // Attach typing-animation state for the client. The static textures stay
    // as the "idle" frame; tick() swaps in baked gif frames when typing is
    // active and restores these on toggle-off.
    if (isClient && clientTypingTextures) {
      state.idleBaseTexture = tex.base;
      state.idleHighlightTexture = tex.highlight;
      state.typingFrames = clientTypingTextures;
      state.typingActive = false;
      state.typingFrameIndex = 0;
      state.typingFrameElapsedMs = 0;
    }

    states.set(id, state);
  };

  const remove = (id: ComponentId): void => {
    const state = states.get(id);
    if (!state) return;
    container.removeChild(state.container);
    state.container.destroy({ children: true });
    states.delete(id);
  };

  const applyUtilizationBar = (state: ComponentRenderState, utilization: number): void => {
    if (!state.utilBar) {
      state.utilBar = new Graphics();
      state.utilBar.y = 14;
      state.container.addChild(state.utilBar);
    }
    state.utilBar.clear();
    const u = Math.max(0, Math.min(1, utilization));
    const w = 28;
    const h = 3;
    state.utilBar.rect(-w / 2, 0, w, h).fill({ color: 0x223344, alpha: 0.6 });
    const fillColor = u < 0.6 ? 0x4ade80 : u < 0.85 ? 0xfacc15 : 0xef4444;
    state.utilBar.rect(-w / 2, 0, w * u, h).fill({ color: fillColor, alpha: 0.95 });
  };

  const applyCacheKeysImpl = (state: ComponentRenderState, keys: ReadonlyArray<string>): void => {
    if (!state.chipStrip) {
      state.chipStrip = new Container();
      state.chipStrip.y = 24;
      state.container.addChild(state.chipStrip);
    }
    state.chipStrip.removeChildren();
    const visible = keys.slice(0, 8);
    for (let i = 0; i < visible.length; i += 1) {
      const x = (i - (visible.length - 1) / 2) * 22;
      const chip = new Graphics().roundRect(-10, -6, 20, 12, 3).fill({ color: 0x223344, alpha: 0.85 });
      chip.x = x;
      const label = new Text({
        text: shortKey(visible[i]!),
        style: { fontFamily: "monospace", fontSize: 8, fill: 0xaadddd },
      });
      label.anchor.set(0.5);
      chip.addChild(label);
      state.chipStrip.addChild(chip);
    }
  };

  const update = (id: ComponentId, u: ComponentUpdate): void => {
    const state = states.get(id);
    if (!state) return;

    if (u.gridPosition) {
      state.gridX = u.gridPosition.x;
      state.gridY = u.gridPosition.y;
      const w = gridToWorld(u.gridPosition.x, u.gridPosition.y);
      state.container.x = w.x;
      state.container.y = w.y;
      state.container.zIndex = u.gridPosition.x + u.gridPosition.y;
    }

    if (u.utilization !== undefined) {
      // Only tint the highlight layer; base stays its original dark navy.
      state.highlightSprite.tint = utilizationColor(u.utilization);
      applyUtilizationBar(state, u.utilization);
    }

    if (u.pendingCount !== undefined) {
      if (u.pendingCount > 0) {
        state.pendingLabel.text = String(u.pendingCount);
        state.pendingLabel.visible = true;
      } else {
        state.pendingLabel.visible = false;
      }
    }

    if (u.label !== undefined) {
      state.nameBadgeText.text = u.label;
      state.nameBadge.visible = Boolean(u.label);
      // Redraw the backing rectangle to fit the new text.
      state.nameBadgeBg.clear();
      if (u.label) {
        const b = state.nameBadgeText.getLocalBounds();
        const padX = 5, padY = 2;
        state.nameBadgeBg
          .roundRect(b.x - padX, b.y - padY, b.width + padX * 2, b.height + padY * 2, 3)
          .fill({ color: 0x0a1420, alpha: 0.92 })
          .stroke({ color: 0x5ef0ff, alpha: 0.6, width: 1 });
      }
    }

    if (u.cacheKeys !== undefined) {
      applyCacheKeysImpl(state, u.cacheKeys);
    }

    if (u.stress !== undefined) {
      applyStress(state, u.stress);
    }
  };

  const applyStress = (
    state: ComponentRenderState,
    stress: { stressed: boolean; dropping: boolean },
  ): void => {
    state.stressState = stress;
    if (!stress.stressed && !stress.dropping) {
      if (state.stressRing) {
        state.stressRing.clear();
        state.stressRing.visible = false;
      }
      return;
    }
    if (!state.stressRing) {
      state.stressRing = new Graphics();
      state.stressRing.y = -4;
      state.stressPhase = 0;
      // Draw below label so it doesn't cover text.
      state.container.addChildAt(state.stressRing, 0);
    }
    state.stressRing.visible = true;
    redrawStressRing(state);
  };

  const redrawStressRing = (state: ComponentRenderState): void => {
    if (!state.stressRing || !state.stressState) return;
    const { stressed, dropping } = state.stressState;
    state.stressRing.clear();
    if (!stressed && !dropping) return;
    // Dropping wins visually — red pulsing outline; otherwise orange.
    const color = dropping ? 0xef4444 : 0xff9500;
    const phase = state.stressPhase ?? 0;
    // 0..1 oscillation (stopped at 1 when not dropping).
    const pulse = dropping ? 0.5 + 0.5 * Math.sin(phase) : 1;
    const alpha = dropping ? 0.35 + 0.55 * pulse : 0.55;
    const radius = 22 + (dropping ? 3 * pulse : 0);
    state.stressRing.circle(0, 0, radius).stroke({ color, width: 2, alpha });
  };

  const tick = (deltaMs: number): void => {
    const dt = deltaMs / 1000;
    for (const state of states.values()) {
      // Stress-indicator pulse.
      if (state.stressState && state.stressRing && state.stressState.dropping) {
        state.stressPhase = (state.stressPhase ?? 0) + dt * 6; // ~1 Hz × 2π≈6.28
        redrawStressRing(state);
      }

      // Client typing animation — advance frame per baked durations.
      if (state.typingActive && state.typingFrames) {
        const frames = state.typingFrames;
        let elapsed = (state.typingFrameElapsedMs ?? 0) + deltaMs;
        let idx = state.typingFrameIndex ?? 0;
        let dur = frames.frameDurationsMs[idx] ?? 100;
        while (elapsed >= dur) {
          elapsed -= dur;
          idx = (idx + 1) % frames.base.length;
          dur = frames.frameDurationsMs[idx] ?? 100;
        }
        if (idx !== state.typingFrameIndex) {
          state.baseSprite.texture = frames.base[idx]!;
          state.highlightSprite.texture = frames.highlight[idx]!;
        }
        state.typingFrameIndex = idx;
        state.typingFrameElapsedMs = elapsed;
      }
    }
  };

  const setClientTyping = (active: boolean): void => {
    for (const state of states.values()) {
      if (!state.typingFrames) continue;
      if (state.typingActive === active) continue;
      state.typingActive = active;
      state.typingFrameElapsedMs = 0;
      if (active) {
        state.typingFrameIndex = 0;
        state.baseSprite.texture = state.typingFrames.base[0]!;
        state.highlightSprite.texture = state.typingFrames.highlight[0]!;
      } else {
        if (state.idleBaseTexture) state.baseSprite.texture = state.idleBaseTexture;
        if (state.idleHighlightTexture) {
          state.highlightSprite.texture = state.idleHighlightTexture;
        }
      }
    }
  };

  return {
    container,
    add,
    remove,
    update,
    get: (id) => states.get(id),
    all: () => states.entries(),
    tick,
    setClientTyping,
  };
}

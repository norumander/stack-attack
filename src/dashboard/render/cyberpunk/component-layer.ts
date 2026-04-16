import { Container, Sprite, Text, Texture, Ticker } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentVisual, ComponentUpdate } from "../topology-renderer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";
import { utilizationColor } from "../utilization-color.js";
import { frameRects } from "./sprite-sheet.js";

const SPRITE_URLS: Record<string, string> = {
  client: new URL("../../assets/client.png", import.meta.url).href,
  server: new URL("../../assets/server.png", import.meta.url).href,
  database: new URL("../../assets/database.png", import.meta.url).href,
  data_cache: new URL("../../assets/data-cache.png", import.meta.url).href,
  load_balancer: new URL("../../assets/load_balancer.png", import.meta.url).href,
  cdn: new URL("../../assets/cdn.png", import.meta.url).href,
  api_gateway: new URL("../../assets/api_gateway.png", import.meta.url).href,
};

const FALLBACK_BY_TYPE: Record<string, string> = {
  streaming_server: "server",
  blob_storage: "database",
};

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

/** A component's textures: 1 entry = static, >1 entries = animated frames in playback order. */
export type ComponentFrames = readonly ComponentSplitTextures[];
export type ComponentTextureMap = Record<string, ComponentFrames>;

async function loadAndSplit(url: string): Promise<ComponentFrames> {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const rects = frameRects(bitmap.width, bitmap.height);
  return rects.map((rect) => splitBitmapRect(bitmap, rect));
}

function splitBitmapRect(
  bitmap: ImageBitmap,
  rect: { x: number; y: number; w: number; h: number },
): ComponentSplitTextures {
  const { x, y, w, h } = rect;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("2d context unavailable");
  srcCtx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
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
    // Cyan heuristic: alpha present, green+blue bright and similar, red well below both.
    const isCyan =
      a > 0 && g > 100 && b > 100 && r < g - 20 && r < b - 20 && Math.abs(g - b) < 60;

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
      const frames = await loadAndSplit(url);
      return [type, frames] as const;
    }),
  );
  return Object.fromEntries(entries) as ComponentTextureMap;
}

function resolveTextures(textures: ComponentTextureMap, type: string): ComponentFrames {
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
  readonly frames: ComponentFrames;
  frameIndex: number;
  type: string;
  gridX: number;
  gridY: number;
}

export interface ComponentLayer {
  readonly container: Container;
  add(id: ComponentId, visual: ComponentVisual): void;
  remove(id: ComponentId): void;
  update(id: ComponentId, update: ComponentUpdate): void;
  get(id: ComponentId): ComponentRenderState | undefined;
  all(): IterableIterator<[ComponentId, ComponentRenderState]>;
}

export function createComponentLayer(textures: ComponentTextureMap): ComponentLayer {
  const container = new Container();
  container.sortableChildren = true;
  const states = new Map<ComponentId, ComponentRenderState>();

  const FRAME_DURATION_MS = 250;

  // Ping-pong over N frames: 0,1,...,N-1,N-2,...,1, then repeats.
  function pingPongIndex(elapsedMs: number, frameCount: number): number {
    if (frameCount <= 1) return 0;
    const period = (frameCount - 1) * 2;
    const tick = Math.floor(elapsedMs / FRAME_DURATION_MS) % period;
    return tick < frameCount ? tick : period - tick;
  }

  let elapsed = 0;
  Ticker.shared.add(() => {
    elapsed += Ticker.shared.deltaMS;
    for (const state of states.values()) {
      if (state.frames.length <= 1) continue;
      const idx = pingPongIndex(elapsed, state.frames.length);
      if (idx === state.frameIndex) continue;
      state.frameIndex = idx;
      const frame = state.frames[idx]!;
      state.baseSprite.texture = frame.base;
      state.highlightSprite.texture = frame.highlight;
    }
  });

  const add = (id: ComponentId, visual: ComponentVisual): void => {
    const frames = resolveTextures(textures, visual.type);
    const frame0 = frames[0]!;

    const baseSprite = new Sprite(frame0.base);
    baseSprite.anchor.set(0.5, 0.75);
    baseSprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);

    const highlightSprite = new Sprite(frame0.highlight);
    highlightSprite.anchor.set(0.5, 0.75);
    highlightSprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);
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

    const inner = new Container();
    inner.addChild(baseSprite);
    inner.addChild(highlightSprite);
    inner.addChild(label);
    inner.addChild(pendingLabel);

    const world = gridToWorld(visual.gridPosition.x, visual.gridPosition.y);
    inner.x = world.x;
    inner.y = world.y;
    inner.zIndex = visual.gridPosition.x + visual.gridPosition.y;

    container.addChild(inner);

    states.set(id, {
      container: inner,
      baseSprite,
      highlightSprite,
      label,
      pendingLabel,
      frames,
      frameIndex: 0,
      type: visual.type,
      gridX: visual.gridPosition.x,
      gridY: visual.gridPosition.y,
    });
  };

  const remove = (id: ComponentId): void => {
    const state = states.get(id);
    if (!state) return;
    container.removeChild(state.container);
    state.container.destroy({ children: true });
    states.delete(id);
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
    }

    if (u.pendingCount !== undefined) {
      if (u.pendingCount > 0) {
        state.pendingLabel.text = String(u.pendingCount);
        state.pendingLabel.visible = true;
      } else {
        state.pendingLabel.visible = false;
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
  };
}

import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentVisual, ComponentUpdate } from "../topology-renderer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";
import { utilizationColor } from "../utilization-color.js";

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

export type ComponentTextureMap = Record<string, ComponentSplitTextures>;

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
      const split = await loadAndSplit(url);
      return [type, split] as const;
    }),
  );
  return Object.fromEntries(entries) as ComponentTextureMap;
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
  /** Short identifier badge rendered above the sprite ("Server 1"). */
  readonly nameBadge: Text;
  type: string;
  gridX: number;
  gridY: number;
  chipStrip?: Container;
  utilBar?: Graphics;
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

  const add = (id: ComponentId, visual: ComponentVisual): void => {
    const tex = resolveTextures(textures, visual.type);

    const baseSprite = new Sprite(tex.base);
    baseSprite.anchor.set(0.5, 0.75);
    baseSprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);

    const highlightSprite = new Sprite(tex.highlight);
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

    // Short-identifier badge above the sprite ("Server 1", "Profile DB").
    // Rendered in muted cyan to fit the cyberpunk palette without competing
    // with utilization color on the sprite itself.
    const nameBadge = new Text({
      text: visual.label ?? "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 10,
        fontWeight: "600",
        fill: 0xcdeeff,
        align: "center",
      },
    });
    nameBadge.anchor.set(0.5, 1);
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

    states.set(id, {
      container: inner,
      baseSprite,
      highlightSprite,
      label,
      pendingLabel,
      nameBadge,
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

    if (u.cacheKeys !== undefined) {
      applyCacheKeysImpl(state, u.cacheKeys);
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

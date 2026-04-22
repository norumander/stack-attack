import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";

// Source of truth: SPRITE_URLS in src/render/cyberpunk/component-layer.ts
// This test duplicates the path list on purpose — if the real one drifts
// and a file is missing, the renderer falls back silently. We want noise.
const COMPONENT_SPRITES = [
  "client.png",
  "server.png",
  "database.png",
  "data-cache.png",
  "load_balancer.png",
  "cdn.png",
  "api_gateway.png",
  "queue.png",
  "worker.png",
  "streaming_server.png",
  "edge_cache.png",
  "dns_gtm.png",
  "blob_storage.png",
  "circuit_breaker.png",
];

const FLOOR = ["tile_light.png", "tile_dark.png"];
const PACKETS = ["packet_read.png", "packet_write.png"];

describe("asset presence — every sprite referenced by the renderer exists on disk", () => {
  it.each([...COMPONENT_SPRITES, ...FLOOR, ...PACKETS])("src/assets/%s exists", (name) => {
    expect(existsSync(`src/assets/${name}`)).toBe(true);
  });
});

describe("HTML pages — every entry point exists", () => {
  const PAGES = ["index.html", "levels.html", "game.html", "diagnose.html", "sandbox.html"];
  it.each(PAGES)("src/%s exists", (name) => {
    expect(existsSync(`src/${name}`)).toBe(true);
  });
});

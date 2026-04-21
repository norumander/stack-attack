#!/usr/bin/env node
// Bake src/assets/stack-attack/client-typing.gif into a horizontal PNG frame
// strip + JSON sidecar so the runtime can load it as a Pixi spritesheet
// without a GIF decoder dep. Re-run only if the gif is re-exported.
//
// Usage: node scripts/bake-client-typing-strip.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { parseGIF, decompressFrames } from "gifuct-js";
import { PNG } from "pngjs";

const GIF_PATH = "src/assets/stack-attack/client-typing.gif";
const PNG_OUT = "src/assets/stack-attack/client-typing.png";
const JSON_OUT = "src/assets/stack-attack/client-typing.json";

const buf = readFileSync(GIF_PATH);
const gif = parseGIF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const frames = decompressFrames(gif, true);

if (frames.length === 0) {
  console.error("No frames decoded from", GIF_PATH);
  process.exit(1);
}

const w = gif.lsd.width;
const h = gif.lsd.height;
const n = frames.length;

// Composite each frame onto a persistent canvas honoring GIF disposal methods.
// gifuct-js returns patch + dims; we manage the full canvas ourselves.
const canvas = new Uint8Array(w * h * 4); // full-frame RGBA, persists across frames
const strip = new PNG({ width: w * n, height: h });
strip.data.fill(0);

const frameDurationsMs = [];

for (let i = 0; i < n; i++) {
  const frame = frames[i];
  const { dims, patch, disposalType } = frame;

  // Save pre-paint region if disposalType === 3 (restore to previous).
  let saved = null;
  if (disposalType === 3) {
    saved = new Uint8Array(dims.width * dims.height * 4);
    for (let row = 0; row < dims.height; row++) {
      const srcOff = ((dims.top + row) * w + dims.left) * 4;
      saved.set(canvas.subarray(srcOff, srcOff + dims.width * 4), row * dims.width * 4);
    }
  }

  // Paint patch onto canvas.
  for (let row = 0; row < dims.height; row++) {
    for (let col = 0; col < dims.width; col++) {
      const pIdx = (row * dims.width + col) * 4;
      const a = patch[pIdx + 3];
      if (a === 0) continue; // transparent — keep previous pixel
      const cIdx = ((dims.top + row) * w + (dims.left + col)) * 4;
      canvas[cIdx] = patch[pIdx];
      canvas[cIdx + 1] = patch[pIdx + 1];
      canvas[cIdx + 2] = patch[pIdx + 2];
      canvas[cIdx + 3] = a;
    }
  }

  // Copy composited canvas into strip at column i.
  for (let row = 0; row < h; row++) {
    const srcOff = row * w * 4;
    const dstOff = (row * w * n + i * w) * 4;
    strip.data.set(canvas.subarray(srcOff, srcOff + w * 4), dstOff);
  }

  frameDurationsMs.push(frame.delay && frame.delay > 0 ? frame.delay : 100);

  // Apply disposal for next frame.
  if (disposalType === 2) {
    // Restore region to background (transparent).
    for (let row = 0; row < dims.height; row++) {
      const off = ((dims.top + row) * w + dims.left) * 4;
      canvas.fill(0, off, off + dims.width * 4);
    }
  } else if (disposalType === 3 && saved) {
    for (let row = 0; row < dims.height; row++) {
      const off = ((dims.top + row) * w + dims.left) * 4;
      canvas.set(saved.subarray(row * dims.width * 4, (row + 1) * dims.width * 4), off);
    }
  }
}

writeFileSync(PNG_OUT, PNG.sync.write(strip));
writeFileSync(
  JSON_OUT,
  JSON.stringify({ frameWidth: w, frameHeight: h, frameCount: n, frameDurationsMs }, null, 2) +
    "\n",
);

console.log(`baked ${n} frames → ${PNG_OUT} (${w * n}x${h}), durations ${frameDurationsMs.join(",")}ms`);

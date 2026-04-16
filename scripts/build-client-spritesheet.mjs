#!/usr/bin/env node
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const frames = [
  resolve(root, "tmp/client_frame_0.png"),
  resolve(root, "tmp/client_frame_1.png"),
  resolve(root, "tmp/client_frame_2.png"),
];
const out = resolve(root, "src/dashboard/assets/client.png");

const FRAME = 64;
const SHEET_W = FRAME * frames.length;
const SHEET_H = FRAME;

const composites = await Promise.all(
  frames.map(async (path, i) => {
    const buf = await sharp(path)
      .resize(FRAME, FRAME, {
        kernel: "nearest",
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return { input: buf, top: 0, left: i * FRAME };
  }),
);

await sharp({
  create: {
    width: SHEET_W,
    height: SHEET_H,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(out);

console.log(`Wrote ${out} (${SHEET_W}x${SHEET_H})`);

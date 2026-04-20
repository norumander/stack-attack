// Tint a PNG toward a target color using a luminance-preserving duotone.
// For each opaque pixel: compute its luminance (0..1) and blend
// between black (L=0) and the target color (L=1). Keeps detail
// (dark/light variation) while shifting hue to the target.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [ , , inPath, outPath, hexColor = "83769C" ] = process.argv;
const r = parseInt(hexColor.slice(0, 2), 16);
const g = parseInt(hexColor.slice(2, 4), 16);
const b = parseInt(hexColor.slice(4, 6), 16);

const src = PNG.sync.read(readFileSync(inPath));
const dst = new PNG({ width: src.width, height: src.height });

for (let i = 0; i < src.data.length; i += 4) {
  const a = src.data[i + 3];
  if (a === 0) {
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = 0;
    dst.data[i + 3] = 0;
    continue;
  }
  // Rec. 709 luminance
  const L = (0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]) / 255;
  dst.data[i]     = Math.round(r * L);
  dst.data[i + 1] = Math.round(g * L);
  dst.data[i + 2] = Math.round(b * L);
  dst.data[i + 3] = a;
}
writeFileSync(outPath, PNG.sync.write(dst));
console.log(`${inPath} → ${outPath} (tinted #${hexColor})`);

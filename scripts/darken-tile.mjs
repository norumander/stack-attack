// Darken a PNG by multiplying RGB channels by a factor. Keeps alpha.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [ , , inPath, outPath, factorStr = "0.85" ] = process.argv;
const f = parseFloat(factorStr);

const src = PNG.sync.read(readFileSync(inPath));
const dst = new PNG({ width: src.width, height: src.height });
for (let i = 0; i < src.data.length; i += 4) {
  dst.data[i]     = Math.max(0, Math.min(255, Math.round(src.data[i] * f)));
  dst.data[i + 1] = Math.max(0, Math.min(255, Math.round(src.data[i + 1] * f)));
  dst.data[i + 2] = Math.max(0, Math.min(255, Math.round(src.data[i + 2] * f)));
  dst.data[i + 3] = src.data[i + 3];
}
writeFileSync(outPath, PNG.sync.write(dst));
console.log(`${inPath} × ${f} → ${outPath}`);

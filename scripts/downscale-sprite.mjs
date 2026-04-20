// Nearest-neighbor downscale for pixel art. Uses pngjs, already a devDep.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [ , , inPath, outPath, targetSize = "80" ] = process.argv;
const target = parseInt(targetSize, 10);

const src = PNG.sync.read(readFileSync(inPath));
const dst = new PNG({ width: target, height: target });

const sx = src.width / target;
const sy = src.height / target;

for (let y = 0; y < target; y++) {
  for (let x = 0; x < target; x++) {
    const sxPix = Math.floor(x * sx + sx / 2);
    const syPix = Math.floor(y * sy + sy / 2);
    const si = (syPix * src.width + sxPix) * 4;
    const di = (y * target + x) * 4;
    dst.data[di] = src.data[si];
    dst.data[di+1] = src.data[si+1];
    dst.data[di+2] = src.data[si+2];
    dst.data[di+3] = src.data[si+3];
  }
}
writeFileSync(outPath, PNG.sync.write(dst));
console.log(`${inPath} (${src.width}x${src.height}) → ${outPath} (${target}x${target})`);

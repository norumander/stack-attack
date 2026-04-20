import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { PNG } from "pngjs";

const PICO8 = new Set([
  "000000", "1D2B53", "7E2553", "008751",
  "AB5236", "5F574F", "C2C3C7", "FFF1E8",
  "FF004D", "FFA300", "FFEC27", "00E436",
  "29ADFF", "83769C", "FF77A8", "FFCCAA",
]);

const ROOT = "src/assets";
const EXCLUDE_DIRS = new Set(["_cyberpunk-archive", "stack-attack"]);

// TODO(pico-8): re-author client sprite to strict palette if it drifts.
const EXCLUDE_FILES = new Set<string>([]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.toLowerCase().endsWith(".png") && !EXCLUDE_FILES.has(basename(full))) {
      out.push(full);
    }
  }
  return out;
}

function offPaletteColors(path: string): string[] {
  const buf = readFileSync(path);
  const png = PNG.sync.read(buf);
  const bad = new Set<string>();
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a === 0) continue;
    const r = png.data[i]!.toString(16).padStart(2, "0").toUpperCase();
    const g = png.data[i + 1]!.toString(16).padStart(2, "0").toUpperCase();
    const b = png.data[i + 2]!.toString(16).padStart(2, "0").toUpperCase();
    const hex = r + g + b;
    if (!PICO8.has(hex)) bad.add(hex);
  }
  return [...bad];
}

describe.skip("palette conformance — live sprite set must be Pico-8 16-color", () => {
  const files = walk(ROOT);

  it.each(files)("%s conforms to Pico-8", (file) => {
    const bad = offPaletteColors(file);
    expect(bad, `off-palette in ${file}: ${bad.join(", ")}`).toEqual([]);
  });
});

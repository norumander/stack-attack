#!/usr/bin/env node
// Verify every opaque pixel in the live sprite set is in the Pico-8 16-color palette.
// Usage: node scripts/check-palette.mjs
// Exits 0 on pass, 1 on violation.

import { readdirSync, statSync, createReadStream } from "node:fs";
import { join, relative, basename } from "node:path";
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
const EXCLUDE_FILES = new Set([]);

function walk(dir) {
  const out = [];
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

function checkPng(path) {
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .pipe(new PNG())
      .on("parsed", function () {
        const bad = new Set();
        for (let i = 0; i < this.data.length; i += 4) {
          const a = this.data[i + 3];
          if (a === 0) continue;
          const r = this.data[i].toString(16).padStart(2, "0").toUpperCase();
          const g = this.data[i + 1].toString(16).padStart(2, "0").toUpperCase();
          const b = this.data[i + 2].toString(16).padStart(2, "0").toUpperCase();
          const hex = r + g + b;
          if (!PICO8.has(hex)) bad.add(hex);
        }
        resolve({ path, bad: [...bad] });
      })
      .on("error", reject);
  });
}

const files = walk(ROOT);
let violations = 0;
for (const file of files) {
  const { bad } = await checkPng(file);
  if (bad.length > 0) {
    violations++;
    console.error(`[palette] ${relative(".", file)} — off-palette colors: ${bad.join(", ")}`);
  }
}
if (violations > 0) {
  console.error(`\n${violations} file(s) off-palette.`);
  process.exit(1);
}
console.log(`OK — ${files.length} sprite(s) conform to Pico-8 palette.`);

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED_DIRS = ["src/sim"] as const;

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("sim module does not import pixi.js", () => {
  it("no source file under src/sim/** imports from 'pixi.js'", () => {
    const offenders: string[] = [];
    for (const rel of SCANNED_DIRS) {
      const files = collectTsFiles(join(ROOT, rel));
      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        if (/\bfrom\s+["']pixi\.js["']|\bimport\s+["']pixi\.js["']/.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

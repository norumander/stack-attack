import { describe, it, expect } from "vitest";
import {
  readDiagnoseLevelFromUrl,
  resolveDiagnoseLevel,
} from "../../../src/diagnose/url";
import { PLACEHOLDER_DIAGNOSE_LEVEL } from "../../../src/diagnose/placeholder-level";
import type { DiagnoseLevel } from "../../../src/diagnose/diagnose-level";

const sampleA: DiagnoseLevel = {
  ...PLACEHOLDER_DIAGNOSE_LEVEL,
  id: "instagram-1",
  title: "Instagram — Level 1",
};
const sampleB: DiagnoseLevel = {
  ...PLACEHOLDER_DIAGNOSE_LEVEL,
  id: "reddit-1",
  title: "Reddit — Level 1",
};

describe("diagnose boot URL helpers", () => {
  it("readDiagnoseLevelFromUrl returns matching level by id", () => {
    const found = readDiagnoseLevelFromUrl("?level=instagram-1", [sampleA, sampleB]);
    expect(found?.id).toBe("instagram-1");
  });

  it("readDiagnoseLevelFromUrl is case-insensitive on the id", () => {
    const found = readDiagnoseLevelFromUrl("?level=INSTAGRAM-1", [sampleA, sampleB]);
    expect(found?.id).toBe("instagram-1");
  });

  it("readDiagnoseLevelFromUrl returns null for unknown or missing ids", () => {
    expect(readDiagnoseLevelFromUrl("", [sampleA])).toBeNull();
    expect(readDiagnoseLevelFromUrl("?level=nope", [sampleA])).toBeNull();
    expect(readDiagnoseLevelFromUrl("?level=", [sampleA])).toBeNull();
  });

  it("resolveDiagnoseLevel falls back to first catalogue entry when no param", () => {
    expect(resolveDiagnoseLevel("", [sampleA, sampleB]).id).toBe("instagram-1");
  });

  it("resolveDiagnoseLevel falls back to placeholder when catalogue is empty", () => {
    const level = resolveDiagnoseLevel("", []);
    expect(level.id).toBe(PLACEHOLDER_DIAGNOSE_LEVEL.id);
  });

  it("resolveDiagnoseLevel honors ?level= when present", () => {
    expect(resolveDiagnoseLevel("?level=reddit-1", [sampleA, sampleB]).id).toBe("reddit-1");
  });
});

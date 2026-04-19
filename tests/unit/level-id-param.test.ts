import { describe, expect, it } from "vitest";
import { readLevelIdFromUrl } from "../../src/physics-td/physics-td";

describe("readLevelIdFromUrl", () => {
  it("returns 'url-shortener' when ?level=url-shortener", () => {
    expect(readLevelIdFromUrl("?level=url-shortener")).toBe("url-shortener");
  });

  it("returns 'netflix' when ?level=netflix", () => {
    expect(readLevelIdFromUrl("?level=netflix")).toBe("netflix");
  });

  it("returns null when the param is missing", () => {
    expect(readLevelIdFromUrl("")).toBeNull();
    expect(readLevelIdFromUrl("?wave=3")).toBeNull();
  });

  it("returns null for unknown or empty level ids", () => {
    expect(readLevelIdFromUrl("?level=bogus")).toBeNull();
    expect(readLevelIdFromUrl("?level=")).toBeNull();
  });

  it("normalizes casing on the value", () => {
    expect(readLevelIdFromUrl("?level=URL-SHORTENER")).toBe("url-shortener");
    expect(readLevelIdFromUrl("?level=Netflix")).toBe("netflix");
  });
});

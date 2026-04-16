import { describe, it, expect } from "vitest";

describe("dashboard test environment", () => {
  it("exposes window and document", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
    expect(document.createElement("div")).toBeInstanceOf(HTMLElement);
  });
});

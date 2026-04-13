import { describe, it, expect } from "vitest";
import { SERVER_ENTRY } from "@modes/td/td-component-entries.js";

describe("SERVER_ENTRY.p-in capacity", () => {
  it("has capacity 2 so Wave 3 cache-rescue can land two connections on p-in", () => {
    const pIn = SERVER_ENTRY.ports.find((p) => p.id === "p-in");
    expect(pIn).toBeDefined();
    expect(pIn!.capacity).toBe(2);
  });
});

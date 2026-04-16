import { describe, it, expect } from "vitest";
import {
  StorageCapability,
  type StorageCapabilityOptions,
} from "@capabilities/storage/storage-capability";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import type { CapabilityId } from "@core/types/ids";

describe("StorageCapability handledTypes option", () => {
  it("defaults to both api_read and api_write (sandbox/legacy behavior)", () => {
    const cap = new StorageCapability("s" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_other")).toBe(false);
  });

  it("restricts to only the listed types when handledTypes is passed", () => {
    const opts: StorageCapabilityOptions = { handledTypes: ["api_write"] };
    const cap = new StorageCapability("s" as CapabilityId, opts);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
});

describe("registerTDDefaults storage factory", () => {
  it("handles both api_read and api_write post Data Cache redesign", () => {
    // Post Data Cache redesign: DB handles forwarded reads (on Data Cache
    // miss, or directly from Server when no Data Cache is present).
    const capReg = new CapabilityRegistry();
    const compReg = new ComponentRegistry(capReg);
    registerTDDefaults(capReg, compReg);

    const entry = capReg.get("storage" as CapabilityId);
    expect(entry).toBeDefined();
    const storage = entry!.factory();
    expect(storage.canHandle("api_write")).toBe(true);
    expect(storage.canHandle("api_read")).toBe(true);
  });
});

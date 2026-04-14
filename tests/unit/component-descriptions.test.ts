import { describe, it, expect } from "vitest";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";

const TD_ENTRIES = [
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
];

describe("TD component entries have long descriptions and capability bullets", () => {
  it.each(TD_ENTRIES.map((e) => [e.name, e]))(
    "%s has non-empty longDescription",
    (_name, entry) => {
      expect(entry.longDescription).toBeDefined();
      expect(entry.longDescription!.length).toBeGreaterThan(20);
    },
  );

  it.each(TD_ENTRIES.map((e) => [e.name, e]))(
    "%s has at least 2 capability bullets",
    (_name, entry) => {
      expect(entry.capabilitiesHuman).toBeDefined();
      expect(entry.capabilitiesHuman!.length).toBeGreaterThanOrEqual(2);
      for (const bullet of entry.capabilitiesHuman!) {
        expect(bullet.length).toBeGreaterThan(5);
      }
    },
  );
});

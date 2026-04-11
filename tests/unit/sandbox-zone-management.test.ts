import { describe, it, expect } from "vitest";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";

describe("SandboxModeController zone management", () => {
  describe("addZone", () => {
    it("adds a new zone and returns true", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.addZone("us-east")).toBe(true);
      expect(ctrl.getZones()).toContain("us-east");
    });

    it("returns false for duplicate zone", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.addZone("default")).toBe(false);
    });

    it("supports multiple zones", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.addZone("eu-west");
      expect(ctrl.getZones()).toEqual(["default", "us-east", "eu-west"]);
    });
  });

  describe("removeZone", () => {
    it("removes an existing zone and returns true", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      expect(ctrl.removeZone("us-east")).toBe(true);
      expect(ctrl.getZones()).not.toContain("us-east");
    });

    it("returns false when removing the last zone", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.removeZone("default")).toBe(false);
      expect(ctrl.getZones()).toEqual(["default"]);
    });

    it("returns false for nonexistent zone", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.removeZone("nonexistent")).toBe(false);
    });

    it("removes pair latencies involving the removed zone", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.addZone("eu-west");
      ctrl.setZonePairLatency("default", "us-east", 50);
      ctrl.setZonePairLatency("default", "eu-west", 100);
      ctrl.setZonePairLatency("us-east", "eu-west", 80);

      ctrl.removeZone("us-east");

      // Only default|eu-west should remain
      expect(ctrl.getZonePairLatencies().size).toBe(1);
      expect(ctrl.getZonePairLatencies().has("default|eu-west")).toBe(true);
    });
  });

  describe("setZonePairLatency", () => {
    it("sets latency between two existing zones", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      expect(ctrl.setZonePairLatency("default", "us-east", 50)).toBe(true);
      expect(ctrl.getZonePairLatencies().get("default|us-east")).toBe(50);
    });

    it("is order-independent", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.setZonePairLatency("us-east", "default", 75);
      // zonePairKey sorts alphabetically: "default|us-east"
      expect(ctrl.getZonePairLatencies().get("default|us-east")).toBe(75);
    });

    it("returns false for nonexistent zone", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.setZonePairLatency("default", "nonexistent", 50)).toBe(false);
    });

    it("returns false for same zone", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.setZonePairLatency("default", "default", 50)).toBe(false);
    });

    it("overwrites existing latency", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.setZonePairLatency("default", "us-east", 50);
      ctrl.setZonePairLatency("default", "us-east", 100);
      expect(ctrl.getZonePairLatencies().get("default|us-east")).toBe(100);
    });
  });

  describe("removeZonePairLatency", () => {
    it("removes an existing pair latency", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.setZonePairLatency("default", "us-east", 50);
      expect(ctrl.removeZonePairLatency("default", "us-east")).toBe(true);
      expect(ctrl.getZonePairLatencies().size).toBe(0);
    });

    it("returns false for nonexistent pair", () => {
      const ctrl = new SandboxModeController();
      expect(ctrl.removeZonePairLatency("default", "us-east")).toBe(false);
    });
  });

  describe("getInitialZoneTopology", () => {
    it("returns current mutable zone state", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.setZonePairLatency("default", "us-east", 50);

      const topo = ctrl.getInitialZoneTopology();
      expect(topo.zones).toEqual(["default", "us-east"]);
      expect(topo.pairLatency.get("default|us-east")).toBe(50);
    });
  });

  describe("multi-zone topology", () => {
    it("supports 3 zones with cross-zone latencies", () => {
      const ctrl = new SandboxModeController();
      ctrl.addZone("us-east");
      ctrl.addZone("eu-west");

      ctrl.setZonePairLatency("default", "us-east", 30);
      ctrl.setZonePairLatency("default", "eu-west", 100);
      ctrl.setZonePairLatency("us-east", "eu-west", 80);

      expect(ctrl.getZones()).toHaveLength(3);
      expect(ctrl.getZonePairLatencies().size).toBe(3);

      const topo = ctrl.getInitialZoneTopology();
      expect(topo.pairLatency.get("default|us-east")).toBe(30);
      expect(topo.pairLatency.get("default|eu-west")).toBe(100);
      expect(topo.pairLatency.get("eu-west|us-east")).toBe(80);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  CROSS_ZONE_PENALTY_SECONDS,
  effectiveEdgeSpeed,
  getZonePairLatency,
} from "@sim/zone-latency";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("getZonePairLatency", () => {
  it("returns 0 for the same zone", () => {
    expect(getZonePairLatency("us-east", "us-east")).toBe(0);
  });

  it("returns the cross-zone penalty for different zones", () => {
    expect(getZonePairLatency("us-east", "us-west")).toBe(
      CROSS_ZONE_PENALTY_SECONDS,
    );
  });

  it("returns 0 when either zone is null (backward-compatible for unzoned components)", () => {
    expect(getZonePairLatency(null, "us-east")).toBe(0);
    expect(getZonePairLatency("us-east", null)).toBe(0);
    expect(getZonePairLatency(null, null)).toBe(0);
  });

  it("returns 0 when either zone is undefined", () => {
    expect(getZonePairLatency(undefined, "us-east")).toBe(0);
    expect(getZonePairLatency("us-east", undefined)).toBe(0);
    expect(getZonePairLatency(undefined, undefined)).toBe(0);
  });
});

describe("effectiveEdgeSpeed", () => {
  const fromId = "c-from" as ComponentId;
  const toId = "c-to" as ComponentId;
  const portId = "p" as PortId;
  const connId = "e-1" as ConnectionId;
  const twinId = "e-2" as ConnectionId;

  function makeConn(latencySeconds: number): SimConnection {
    return new SimConnection({
      id: connId,
      from: { componentId: fromId, portId },
      to: { componentId: toId, portId },
      bandwidth: 500,
      latencySeconds,
      twinId,
      direction: "forward",
    });
  }

  function makeComp(id: ComponentId, zone?: string): SimComponent {
    return new SimComponent(
      zone === undefined
        ? { id, capabilities: [] }
        : { id, capabilities: [], zone },
    );
  }

  it("returns the base connection speed when both endpoints share a zone", () => {
    const components = new Map<ComponentId, SimComponent>([
      [fromId, makeComp(fromId, "us-east")],
      [toId, makeComp(toId, "us-east")],
    ]);
    const conn = makeConn(0.5);
    expect(effectiveEdgeSpeed(conn, components)).toBe(conn.speed);
    expect(effectiveEdgeSpeed(conn, components)).toBe(1 / 0.5);
  });

  it("applies the cross-zone penalty additively to the base latency", () => {
    const components = new Map<ComponentId, SimComponent>([
      [fromId, makeComp(fromId, "us-east")],
      [toId, makeComp(toId, "eu-west")],
    ]);
    const conn = makeConn(0.5);
    const expected = 1 / (0.5 + CROSS_ZONE_PENALTY_SECONDS);
    expect(effectiveEdgeSpeed(conn, components)).toBeCloseTo(expected, 10);
  });

  it("treats unzoned components as same-zone (backward compat)", () => {
    const components = new Map<ComponentId, SimComponent>([
      [fromId, makeComp(fromId)],
      [toId, makeComp(toId)],
    ]);
    const conn = makeConn(0.5);
    expect(effectiveEdgeSpeed(conn, components)).toBe(conn.speed);
  });

  it("treats a mix of zoned+unzoned as same-zone (backward compat)", () => {
    const components = new Map<ComponentId, SimComponent>([
      [fromId, makeComp(fromId, "us-east")],
      [toId, makeComp(toId)],
    ]);
    const conn = makeConn(0.5);
    expect(effectiveEdgeSpeed(conn, components)).toBe(conn.speed);
  });
});

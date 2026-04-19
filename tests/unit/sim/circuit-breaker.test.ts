import { describe, it, beforeEach, expect } from "vitest";
import { CircuitBreakerCapability, type CircuitOpenEvent } from "@sim/capabilities/circuit-breaker";
import { makePacket, resetIdCountersForTest, mintRequestId, mintPacketId } from "@sim/packet";
import type { ArrivalContext, Packet, Request } from "@sim/types";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";

function mkReq(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

function mkPacket(edgeId: ConnectionId = "ab" as ConnectionId): Packet {
  return makePacket({ requests: [mkReq()], edgeId, speed: 1, spawnedAt: 0, direction: "forward" });
}

function mkCtx(simTime: number, egress: boolean = true): ArrivalContext {
  return {
    componentId: "b" as ComponentId,
    ingressEdgeId: "ab" as ConnectionId,
    egressEdges: egress
      ? [{ id: "bc" as ConnectionId, speed: 1, targetZone: null }]
      : [],
    simTime,
    rng: () => 0,
    bucket: null,
    mintPacketId: () => mintPacketId(),
    mintRequestId: () => mintRequestId() as RequestId,
  };
}

describe("CircuitBreakerCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  it("CLOSED forwards to first egress edge", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 3, cooldownSeconds: 1 });
    const out = cb.onArriveRequest(mkPacket(), mkCtx(0));
    expect(out.kind).toBe("forward");
    if (out.kind === "forward") {
      expect(out.emit).toHaveLength(1);
      expect(out.emit[0]!.edgeId).toBe("bc");
      expect(out.emit[0]!.packet.route).toEqual(["ab"]);
    }
    expect(cb.getState()).toBe("CLOSED");
  });

  it("threshold reached trips CLOSED → OPEN and fires circuit_open event", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 3, cooldownSeconds: 1 });
    const events: CircuitOpenEvent[] = [];
    cb.onCircuitOpen((ev) => events.push(ev));

    cb.reportFailure(0.1);
    cb.reportFailure(0.2);
    expect(cb.getState()).toBe("CLOSED");
    cb.reportFailure(0.3);

    expect(cb.getState()).toBe("OPEN");
    expect(events).toEqual([{ kind: "circuit_open", at: 0.3 }]);
  });

  it("OPEN drops incoming packets", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 1, cooldownSeconds: 10 });
    cb.reportFailure(0);
    expect(cb.getState()).toBe("OPEN");

    const out = cb.onArriveRequest(mkPacket(), mkCtx(0.5));
    expect(out).toMatchObject({ kind: "drop", reason: "circuit_open", count: 1 });
  });

  it("cooldown elapsed: OPEN → HALF_OPEN on next arrival (admits probe)", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 1, cooldownSeconds: 1 });
    cb.reportFailure(0);
    expect(cb.getState()).toBe("OPEN");

    // Before cooldown: still drops.
    const early = cb.onArriveRequest(mkPacket(), mkCtx(0.5));
    expect(early.kind).toBe("drop");

    // After cooldown: admits one probe (HALF_OPEN).
    const probe = cb.onArriveRequest(mkPacket(), mkCtx(1.0));
    expect(probe.kind).toBe("forward");
    expect(cb.getState()).toBe("HALF_OPEN");

    // Second arrival while probe in flight: dropped (limit=1 default).
    const second = cb.onArriveRequest(mkPacket(), mkCtx(1.1));
    expect(second).toMatchObject({ kind: "drop", reason: "circuit_open" });
  });

  it("probe success in HALF_OPEN → CLOSED", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 1, cooldownSeconds: 1 });
    cb.reportFailure(0);
    cb.onArriveRequest(mkPacket(), mkCtx(1.0)); // enters HALF_OPEN, admits probe
    expect(cb.getState()).toBe("HALF_OPEN");

    cb.reportSuccess();
    expect(cb.getState()).toBe("CLOSED");

    // Forwards normally again.
    const out = cb.onArriveRequest(mkPacket(), mkCtx(2.0));
    expect(out.kind).toBe("forward");
  });

  it("probe failure in HALF_OPEN → OPEN (re-trips)", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 1, cooldownSeconds: 1 });
    cb.reportFailure(0);
    cb.onArriveRequest(mkPacket(), mkCtx(1.0)); // HALF_OPEN probe admitted
    expect(cb.getState()).toBe("HALF_OPEN");

    const events: CircuitOpenEvent[] = [];
    cb.onCircuitOpen((ev) => events.push(ev));
    cb.reportFailure(1.2);

    expect(cb.getState()).toBe("OPEN");
    expect(events).toEqual([{ kind: "circuit_open", at: 1.2 }]);

    // And it drops arrivals again.
    const out = cb.onArriveRequest(mkPacket(), mkCtx(1.3));
    expect(out).toMatchObject({ kind: "drop", reason: "circuit_open" });
  });
});

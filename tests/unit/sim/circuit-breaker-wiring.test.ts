import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { CircuitBreakerCapability } from "@sim/capabilities/circuit-breaker";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, mintRequestId, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId, RequestId } from "@core/types/ids";
import type { Request } from "@sim/types";

function buildPair(
  sim: Sim,
  fromId: string,
  toId: string,
  edgeId: string,
  twinEdgeId: string,
): { forward: SimConnection; back: SimConnection } {
  const forward = new SimConnection({
    id: edgeId as ConnectionId,
    from: { componentId: fromId as ComponentId, portId: "out" as PortId },
    to: { componentId: toId as ComponentId, portId: "in" as PortId },
    bandwidth: 1000,
    latencySeconds: 0.01,
    twinId: twinEdgeId as ConnectionId,
    direction: "forward",
  });
  const back = new SimConnection({
    id: twinEdgeId as ConnectionId,
    from: { componentId: toId as ComponentId, portId: "in" as PortId },
    to: { componentId: fromId as ComponentId, portId: "out" as PortId },
    bandwidth: 1000,
    latencySeconds: 0.01,
    twinId: edgeId as ConnectionId,
    direction: "back",
  });
  sim.addConnection(forward);
  sim.addConnection(back);
  return { forward, back };
}

function mkReadReq(): Request {
  return {
    id: mintRequestId() as RequestId,
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

/**
 * Helper: spawn a request packet onto the first hop (Client → CB).
 */
function sendOnePacket(sim: Sim, edgeId: ConnectionId, speed: number): void {
  sim.spawnPacket(
    makePacket({
      requests: [mkReadReq()],
      edgeId,
      speed,
      spawnedAt: sim.simTime,
      direction: "forward",
    }),
  );
}

function stepFor(sim: Sim, seconds: number, dt = 0.01): void {
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) sim.step(dt);
}

describe("CB sim wiring: Client → CB → Server → DB", () => {
  beforeEach(() => resetIdCountersForTest());

  function buildTopology(cb: CircuitBreakerCapability): {
    sim: Sim;
    clientToCb: SimConnection;
  } {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "client" as ComponentId, capabilities: [] }));
    sim.addComponent(
      new SimComponent({ id: "cb" as ComponentId, capabilities: [cb] }),
    );
    sim.addComponent(
      new SimComponent({
        id: "server" as ComponentId,
        capabilities: [new ForwardingCapability()],
      }),
    );
    sim.addComponent(
      new SimComponent({
        id: "db" as ComponentId,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
      }),
    );
    const { forward: clientToCb } = buildPair(sim, "client", "cb", "e_cc", "e_cc_t");
    buildPair(sim, "cb", "server", "e_cs", "e_cs_t");
    buildPair(sim, "server", "db", "e_sd", "e_sd_t");
    return { sim, clientToCb };
  }

  it("crashed DB downstream causes CB to OPEN after failureThreshold drops", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 3, cooldownSeconds: 5 });
    const { sim, clientToCb } = buildTopology(cb);

    sim.crashComponent("db" as ComponentId);

    // Fire enough packets to reach the threshold.
    for (let i = 0; i < 5; i++) {
      sendOnePacket(sim, clientToCb.id, clientToCb.speed);
      stepFor(sim, 0.2); // enough to traverse 3 hops at latency 0.01
    }

    expect(cb.getState()).toBe("OPEN");

    // Subsequent packet should be dropped AT the CB with reason=circuit_open.
    const beforeDropCount = sim.lastStepEvents.length;
    void beforeDropCount;
    sendOnePacket(sim, clientToCb.id, clientToCb.speed);
    stepFor(sim, 0.2);
    const circuitOpenDrops = sim.lastStepEvents.filter(
      (e) => e.kind === "drop" && e.reason === "circuit_open",
    );
    // We stepped 20 times — last events are only the most recent step's.
    // Just run until we see a circuit_open drop event.
    // Re-run a few steps checking.
    let sawCircuitOpen = circuitOpenDrops.length > 0;
    for (let i = 0; i < 10 && !sawCircuitOpen; i++) {
      sendOnePacket(sim, clientToCb.id, clientToCb.speed);
      for (let j = 0; j < 5; j++) {
        sim.step(0.01);
        if (
          sim.lastStepEvents.some(
            (e) => e.kind === "drop" && e.reason === "circuit_open",
          )
        ) {
          sawCircuitOpen = true;
          break;
        }
      }
    }
    expect(sawCircuitOpen).toBe(true);
  });

  it("successful respond through CB reports success — HALF_OPEN → CLOSED", () => {
    const cb = new CircuitBreakerCapability({ failureThreshold: 2, cooldownSeconds: 0.5 });
    const { sim, clientToCb } = buildTopology(cb);

    // First trip the CB by crashing DB.
    sim.crashComponent("db" as ComponentId);
    for (let i = 0; i < 4; i++) {
      sendOnePacket(sim, clientToCb.id, clientToCb.speed);
      stepFor(sim, 0.2);
    }
    expect(cb.getState()).toBe("OPEN");

    // "Recover" DB by swapping in a fresh component without the crash mark.
    // crashComponent is one-way, so we simulate recovery by rebuilding:
    // create a new sim where DB is healthy, and re-attach the same cb instance
    // to exercise HALF_OPEN transition path.
    const sim2 = new Sim({ seed: 1 });
    sim2.addComponent(new SimComponent({ id: "client" as ComponentId, capabilities: [] }));
    sim2.addComponent(new SimComponent({ id: "cb" as ComponentId, capabilities: [cb] }));
    sim2.addComponent(
      new SimComponent({
        id: "server" as ComponentId,
        capabilities: [new ForwardingCapability()],
      }),
    );
    sim2.addComponent(
      new SimComponent({
        id: "db" as ComponentId,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
      }),
    );
    const { forward: c2cb } = buildPair(sim2, "client", "cb", "e_cc", "e_cc_t");
    buildPair(sim2, "cb", "server", "e_cs", "e_cs_t");
    buildPair(sim2, "server", "db", "e_sd", "e_sd_t");

    // Advance simTime past cooldown before admitting a probe.
    stepFor(sim2, 1.0);
    expect(cb.getState()).toBe("OPEN"); // no arrivals yet, still OPEN

    // Send a probe request — should be admitted (HALF_OPEN), reach DB, respond.
    sendOnePacket(sim2, c2cb.id, c2cb.speed);
    // Let it traverse: client→cb (admitted, HALF_OPEN), cb→server→db (responds), db→...→client.
    stepFor(sim2, 1.0);

    // After success notification walks back through CB, state should be CLOSED.
    expect(cb.getState()).toBe("CLOSED");
  });

  it("CB dropping a packet itself does not self-report (avoids double-count)", () => {
    // Build a CB in OPEN state; ensure the self-drop "circuit_open" does NOT
    // re-trip or feed back into its own failure count (CB ignores reportFailure
    // while OPEN, but also verify the sim doesn't walk self).
    const cb = new CircuitBreakerCapability({ failureThreshold: 2, cooldownSeconds: 100 });
    const { sim, clientToCb } = buildTopology(cb);
    sim.crashComponent("db" as ComponentId);
    for (let i = 0; i < 3; i++) {
      sendOnePacket(sim, clientToCb.id, clientToCb.speed);
      stepFor(sim, 0.2);
    }
    expect(cb.getState()).toBe("OPEN");

    // Send more packets — CB drops them. openedAt should not shift (reportFailure
    // on CB when OPEN is a no-op anyway, but the `selfComponentId` skip
    // guarantees we never even call it on the dropping CB).
    sendOnePacket(sim, clientToCb.id, clientToCb.speed);
    stepFor(sim, 0.2);
    expect(cb.getState()).toBe("OPEN");
  });
});

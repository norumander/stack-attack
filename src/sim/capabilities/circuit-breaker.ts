import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitBreakerOptions = {
  /** Consecutive failures before CLOSED → OPEN. */
  readonly failureThreshold: number;
  /** Cooldown (seconds) before OPEN → HALF_OPEN (on next arrival after elapsed). */
  readonly cooldownSeconds: number;
  /** Max in-flight probes admitted while HALF_OPEN. Default 1. */
  readonly halfOpenProbeLimit?: number;
};

export type CircuitOpenEvent = {
  readonly kind: "circuit_open";
  readonly at: number;
};

// TODO(lane-e): reportFailure/reportSuccess not yet wired — chaos integration will hook into downstream drops/timeouts

/**
 * Sim-compatible circuit breaker.
 *
 * CLOSED: forwards onto the first egress edge (same shape as ForwardingCapability).
 * OPEN: drops incoming packets immediately with reason "circuit_open" until cooldown elapses.
 * HALF_OPEN: admits a limited number of probe packets (by forwarding). reportSuccess()
 *   promotes back to CLOSED; reportFailure() demotes back to OPEN.
 *
 * reportFailure / reportSuccess are exposed for future wiring by the chaos lane — they
 * are what flips CLOSED → OPEN (threshold) and HALF_OPEN → CLOSED (probe success).
 */
export class CircuitBreakerCapability implements SimCapability {
  readonly id = "circuit_breaker";

  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private openedAt = -Infinity;
  private probesInFlight = 0;
  private readonly listeners: Array<(ev: CircuitOpenEvent) => void> = [];

  constructor(private readonly opts: CircuitBreakerOptions) {}

  getState(): CircuitBreakerState {
    return this.state;
  }

  /** Subscribe to "circuit_open" transitions. Returns an unsubscribe fn. */
  onCircuitOpen(listener: (ev: CircuitOpenEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    // Lazy OPEN → HALF_OPEN promotion when cooldown has elapsed.
    if (this.state === "OPEN" && ctx.simTime - this.openedAt >= this.opts.cooldownSeconds) {
      this.state = "HALF_OPEN";
      this.probesInFlight = 0;
    }

    if (this.state === "OPEN") {
      return { kind: "drop", reason: "circuit_open", count: packet.requests.length };
    }

    if (this.state === "HALF_OPEN") {
      const limit = this.opts.halfOpenProbeLimit ?? 1;
      if (this.probesInFlight >= limit) {
        return { kind: "drop", reason: "circuit_open", count: packet.requests.length };
      }
      this.probesInFlight += 1;
    }

    // CLOSED or admitted HALF_OPEN probe: forward onto first egress edge.
    const egress = ctx.egressEdges[0];
    if (!egress) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: egress.id,
      progress: 0,
      speed: egress.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }

  /** Called by future wiring when a downstream failure is observed. */
  reportFailure(now: number): void {
    if (this.state === "HALF_OPEN") {
      this.trip(now);
      return;
    }
    if (this.state === "CLOSED") {
      this.failureCount += 1;
      if (this.failureCount >= this.opts.failureThreshold) {
        this.trip(now);
      }
    }
    // OPEN: ignore — already open.
  }

  /** Called by future wiring when a downstream success is observed. */
  reportSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      this.failureCount = 0;
      this.probesInFlight = 0;
      return;
    }
    if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  private trip(now: number): void {
    this.state = "OPEN";
    this.openedAt = now;
    this.failureCount = 0;
    this.probesInFlight = 0;
    const ev: CircuitOpenEvent = { kind: "circuit_open", at: now };
    for (const l of this.listeners) l(ev);
  }
}

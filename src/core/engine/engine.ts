import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
} from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessContext } from "../capability/process-context.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { SimulationState } from "../state/simulation-state.js";
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { createRng } from "./rng.js";

/**
 * Stage 1 walking-skeleton Engine.
 *
 * Runs a minimal tick loop sufficient to thread requests end-to-end
 * through a Client → Server topology for the smoke test. No backpressure,
 * TTL, condition, throughput gate, upkeep, metrics, or chaos — those
 * land in Stage 2 (which replaces this class's internals).
 */
export class Engine {
  tick(state: SimulationState, modeController: ModeController): void {
    this.injectTraffic(state, modeController);
    this.processPending(state, modeController);
    this.advanceTick(state);
  }

  private injectTraffic(state: SimulationState, modeController: ModeController): void {
    const source = modeController.getTrafficSource();
    const subSources =
      typeof source.getSubSources === "function" ? source.getSubSources() : [source];

    for (const sub of subSources) {
      const requests = sub.generate(state.currentTick);
      const target = sub.targetEntryPointId;
      if (target === null) continue;
      for (const req of requests) {
        state.enqueuePending(target, req);
        state.appendEvent(req.id, {
          tick: state.currentTick,
          componentId: target,
          capabilityId: null,
          connectionId: null,
          type: "ENTERED",
          latencyAdded: 0,
        });
      }
    }
  }

  private processPending(state: SimulationState, modeController: ModeController): void {
    const MAX_ITERATIONS = 32; // walking-skeleton safety cap
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const snapshot: Array<[ComponentId, Request[]]> = [];
      for (const [id, queue] of state.pending) {
        if (queue.length === 0) continue;
        snapshot.push([id, [...queue]]);
        state.pending.set(id, []);
      }
      if (snapshot.length === 0) return;

      for (const [componentId, queue] of snapshot) {
        const component = state.components.get(componentId);
        if (!component) continue;
        const activeCapabilityIds = modeController.getActiveCapabilities(component);
        const effectiveTiers = computeEffectiveTiers(component, modeController);

        for (const request of queue) {
          const context = this.buildProcessContext(
            state,
            componentId,
            activeCapabilityIds,
            effectiveTiers,
            request,
          );
          const result = component.process(request, context);

          for (const ev of result.events) state.appendEvent(request.id, ev);

          switch (result.outcome.kind) {
            case "RESPOND":
              state.appendEvent(request.id, {
                tick: state.currentTick,
                componentId,
                capabilityId: null,
                connectionId: null,
                type: "RESPONDED",
                latencyAdded: 0,
              });
              break;
            case "FORWARD":
            case "PASS":
              if (!this.routeForward(state, componentId, request)) {
                state.appendEvent(request.id, {
                  tick: state.currentTick,
                  componentId,
                  capabilityId: null,
                  connectionId: null,
                  type: "DROPPED",
                  latencyAdded: 0,
                  metadata: { reason: "no_outcome" },
                });
              }
              break;
            case "DROP":
              state.appendEvent(request.id, {
                tick: state.currentTick,
                componentId,
                capabilityId: null,
                connectionId: null,
                type: "DROPPED",
                latencyAdded: 0,
                metadata: { reason: result.outcome.reason },
              });
              break;
            case "QUEUE_HOLD":
              state.appendEvent(request.id, {
                tick: state.currentTick,
                componentId,
                capabilityId: null,
                connectionId: null,
                type: "QUEUED",
                latencyAdded: 0,
              });
              break;
          }
        }
      }
    }
  }

  private routeForward(
    state: SimulationState,
    fromId: ComponentId,
    request: Request,
  ): boolean {
    const component = state.components.get(fromId);
    if (!component) return false;
    const egressPort = component.ports.find((p) => p.direction === "egress");
    if (!egressPort) return false;
    const connectionId: ConnectionId | undefined = egressPort.connections[0];
    if (!connectionId) return false;
    const conn = state.connections.get(connectionId);
    if (!conn) return false;

    state.enqueuePending(conn.target.componentId, request);
    state.appendEvent(request.id, {
      tick: state.currentTick,
      componentId: fromId,
      capabilityId: null,
      connectionId,
      type: "TRAVERSED",
      latencyAdded: conn.latency,
    });
    return true;
  }

  private buildProcessContext(
    state: SimulationState,
    componentId: ComponentId,
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>,
    request: Request,
  ): ProcessContext {
    return {
      state: state.asReader(),
      componentId,
      effectiveTier: 0,
      effectiveTiers,
      activeCapabilityIds,
      currentTick: state.currentTick,
      rng: createRng(`${state.currentTick}:${componentId}:${request.id}`),
      directories: [],
      childResponses: new Map(),
    };
  }

  private advanceTick(state: SimulationState): void {
    state.advanceTick();
  }
}

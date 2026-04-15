import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { makePort, makeConnection } from "@harness/fixtures";
import { makeRng, bootTDRegistry } from "@harness/td-fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, PortId } from "@core/types/ids";
import type { OutcomeReport } from "@core/types/outcome";
import type { ConditionProfile } from "@core/types/condition";
import type { ComponentRegistry } from "@core/registry/component-registry";

const DEFAULT_CONDITION: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
  criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
};

/**
 * Looks up a component's first ingress and egress port ids.
 * Registry-minted TD Server/Database/Cache have exactly one of each.
 */
function singlePortIds(component: Component): {
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const ingress = component.ports.find((p) => p.direction === "ingress");
  const egress = component.ports.find((p) => p.direction === "egress");
  if (!ingress || !egress) {
    throw new Error(`singlePortIds: missing port on ${component.type}`);
  }
  return { ingressPortId: ingress.id, egressPortId: egress.id };
}

export interface WaveRunResult {
  readonly outcome: OutcomeReport;
  readonly state: SimulationState;
  readonly mode: TDModeController;
  readonly totalRequests: number;
  readonly droppedCount: number;
  readonly timedOutCount: number;
  readonly eventCountsByType: ReadonlyMap<string, number>;
  readonly forwardedCountByComponent: ReadonlyMap<ComponentId, number>;
  readonly processedCountByComponent: ReadonlyMap<ComponentId, number>;
  readonly terminalState: "running" | "wave_passed" | "dead";
  readonly finalViability: number;
  readonly finalBudget: number;
}

/**
 * Runs a full wave: constructs TDModeController, advances to simulate,
 * ticks engine for wave.duration ticks, runs evaluateOutcome, and
 * returns an aggregated result for assertions.
 *
 * The caller must pre-build topology on `state` before calling runWave.
 */
export function runWave(
  state: SimulationState,
  wave: TDWaveDefinition,
  entryPointId: ComponentId,
): WaveRunResult {
  // NOTE: runWave does NOT call mode.onTick() per tick. The engine doesn't
  // call onTick internally, and runWave deliberately doesn't either.
  // Viability damage (emitted by TDModeController.onTick) is covered by
  // unit tests in tests/unit/td-mode-controller-viability-and-rent.test.ts.
  // Wave integration tests validate request-routing and SLA verdict
  // contracts — not the viability damage path. Only the dashboard SimLoop
  // calls onTick during real play.
  const economy = new TDEconomy({
    startingBudget: 100000, // generous override — integration tests assert on request counts, not budget arithmetic
    revenuePerRequestType: wave.revenuePerRequestType,
  });
  const mode = new TDModeController({
    waves: [wave],
    economy,
    entryPointId,
    rng: makeRng(1),
    componentRegistry: bootTDRegistry(),
  });
  // Pay rent before advancing phase (atomic precondition to simulate).
  const rentResult = mode.payRent(state);
  if (!rentResult.ok) {
    throw new Error(
      `runWave: insufficient budget for rent ($${rentResult.bill} > $${rentResult.budget})`,
    );
  }
  mode.advancePhase(state); // build → simulate (passes state for chaos resolution + metrics index)

  const engine = new Engine(state);
  for (let i = 0; i < wave.duration; i++) {
    engine.tick(mode);
  }
  // Drain active streams past wave duration. Streams persist for
  // streamConfig.duration ticks after their creation tick. The engine's
  // isWaveDrained checks state.activeStreams.size > 0.
  const maxDrainTicks = (wave.streamConfig?.duration ?? 0) + 10; // safety margin
  for (let i = 0; i < maxDrainTicks && !mode.isWaveDrained(state); i++) {
    engine.tick(mode);
  }

  const eventCountsByType = new Map<string, number>();
  const forwardedCountByComponent = new Map<ComponentId, number>();
  const processedCountByComponent = new Map<ComponentId, number>();
  let droppedCount = 0;
  let timedOutCount = 0;

  for (const events of state.requestLog.values()) {
    for (const ev of events) {
      eventCountsByType.set(ev.type, (eventCountsByType.get(ev.type) ?? 0) + 1);
      if (ev.type === "FORWARDED" && ev.capabilityId !== null) {
        // Source-side FORWARDED: emitted by ForwardingCapability.process() with
        // capabilityId set. Engine also emits FORWARDED at delivery time with
        // capabilityId=null — we filter those out to get "who forwarded" counts.
        forwardedCountByComponent.set(
          ev.componentId,
          (forwardedCountByComponent.get(ev.componentId) ?? 0) + 1,
        );
      } else if (ev.type === "PROCESSED") {
        // PROCESSED is capability-emitted (ProcessingCapability, StorageCapability).
        // The engine does not emit PROCESSED events directly.
        processedCountByComponent.set(
          ev.componentId,
          (processedCountByComponent.get(ev.componentId) ?? 0) + 1,
        );
      } else if (ev.type === "DROPPED") {
        droppedCount += 1;
      } else if (ev.type === "TIMED_OUT") {
        timedOutCount += 1;
      }
    }
  }

  const totalRequests = state.requestLog.size;
  const outcome = mode.evaluateOutcome(state.metricsHistory);

  const terminalState = mode.getTerminalState(state);
  const finalViability = mode.getViability().value;
  const finalBudget = economy.getBudget();

  return {
    outcome,
    state,
    mode,
    totalRequests,
    droppedCount,
    timedOutCount,
    eventCountsByType,
    forwardedCountByComponent,
    processedCountByComponent,
    terminalState,
    finalViability,
    finalBudget,
  };
}

// makeRng is re-exported from @harness/td-fixtures for any callers still
// importing it from this module.
export { makeRng } from "@harness/td-fixtures";

/**
 * Build a Server component from the TD registry. Processing+Forwarding+Monitoring
 * shape (read cap 20/tick, write forward 12/tick) comes from `registerTDDefaults`.
 */
export function buildServer(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("server", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Database component from the TD registry (Storage 25/tick + Monitoring).
 */
export function buildDatabase(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("database", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Cache component from the TD registry (Caching + forwarding-pipe 200/tick).
 */
export function buildCache(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("cache", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a CDN component from the TD registry (Caching + forwarding-pipe + Monitoring).
 */
export function buildCDN(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("cdn", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build an API Gateway component from the TD registry (Auth + forwarding-pipe + Monitoring).
 * The auth capability is configured with terminateAuthRequired: true via registerTDDefaults.
 */
export function buildAPIGateway(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("api_gateway", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Queue component from the TD registry (QueueCapability + forwarding-pipe + Monitoring).
 * Tier-1 capacity: 32 slots. Buffers backpressured requests via EngineBufferable.
 */
export function buildQueue(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("queue", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Worker component from the TD registry (BatchProcessingCapability + Monitoring).
 * Processes "batch" requests at tier×5 per tick via PROCESS phase.
 */
export function buildWorker(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("worker", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a CircuitBreaker component from the TD registry (CircuitBreakerCapability + forwarding-pipe + Monitoring).
 * INTERCEPT phase: CLOSED passes through, OPEN fast-fails (DROP/circuit_open).
 * Tier-1: threshold 5 failures, cooldown 10 ticks.
 */
export function buildCircuitBreaker(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("circuit_breaker", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}


/**
 * Build a Streaming Media Server from the TD registry (StreamingCapability +
 * forwarding-pipe + Monitoring). Handles "stream" requests inline (RESPOND) and
 * forwards all other traffic types downstream. Inline filter pattern.
 */
export function buildStreamingServer(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("streaming_media_server", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Blob Storage component from the TD registry (BlobStorageCapability + Monitoring).
 * Handles "static_asset" requests. Decorative in the streaming path — Streaming Server
 * does the actual stream processing.
 */
export function buildBlobStorage(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("blob_storage", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a DNS/GTM component from the TD registry (GeoRoutingCapability +
 * forwarding-pipe + Monitoring). Routes requests to nearest zone via
 * EngineConsultable.selectConnection(). Zone-agnostic — sits at entry point.
 */
export function buildDNSGTM(compRegistry: ComponentRegistry): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("dns_gtm", { x: 0, y: 0 }, null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a LoadBalancer component with Routing (INTERCEPT) + Forwarding (all traffic) + Monitoring.
 * egressCount controls how many egress ports (and downstream servers) can be wired.
 */
export function buildLoadBalancer(
  id: string,
  egressCount: number,
): {
  component: Component;
  ingressPortId: string;
  egressPortIds: string[];
} {
  const ingressPortId = `${id}-in`;
  const ingress = makePort(ingressPortId, "ingress");

  const egressPortIds: string[] = [];
  const egressPorts = [];
  for (let i = 0; i < egressCount; i++) {
    const egressPortId = `${id}-out-${i}`;
    egressPortIds.push(egressPortId);
    egressPorts.push(makePort(egressPortId, "egress"));
  }

  const routingCap = new RoutingCapability("routing" as CapabilityId);
  // LB's Forwarding handles ALL inbound traffic with high throughput
  // (200/tick) — pass-through pipe feeding both servers. Emits source-side
  // FORWARDED events for runWave.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write", "static_asset", "auth_required", "batch", "event", "stream"],
    throughputPerTier: 500,
    emitForwardedEvent: true,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["routing" as CapabilityId, routingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["routing" as CapabilityId, 1],
    ["forwarding" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "load_balancer",
    name: "Load Balancer",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, ...egressPorts],
    placementCost: 175,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortIds };
}

/**
 * Wires a source component's egress port to a target component's ingress port.
 * Returns the created Connection so the caller can add it to state.
 *
 * @param opts.bandwidth  Connection bandwidth (requests/tick). Default: 100.
 *   Pass a higher value when the topology must carry more than 100 req/tick
 *   on a single link — e.g. Wave 5 injects 150/tick so client→CDN needs ≥ 150.
 */
export function wire(
  state: SimulationState,
  source: { component: Component; egressPortId: string },
  target: { component: Component; ingressPortId: string },
  connId: string,
  opts: { bandwidth?: number } = {},
): void {
  const sourcePort = source.component.ports.find((p) => p.id === source.egressPortId);
  const targetPort = target.component.ports.find((p) => p.id === target.ingressPortId);
  if (!sourcePort || !targetPort) {
    throw new Error(`wire: port not found (${connId})`);
  }
  const conn = makeConnection(
    connId,
    { componentId: source.component.id, portId: source.egressPortId },
    { componentId: target.component.id, portId: target.ingressPortId },
    opts,
  );
  sourcePort.connections.push(conn.id);
  targetPort.connections.push(conn.id);
  state.addConnection(conn);
}

import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { StorageCapability } from "@capabilities/storage/storage-capability";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { makePort, makeConnection } from "@harness/fixtures";
import { makeRng } from "@harness/td-fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { OutcomeReport } from "@core/types/outcome";
import type { ConditionProfile } from "@core/types/condition";

const DEFAULT_CONDITION: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
  criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
};

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
  const economy = new TDEconomy({
    startingBudget: wave.startingBudget,
    revenuePerRequestType: wave.revenuePerRequestType,
  });
  const mode = new TDModeController({
    wave,
    economy,
    entryPointId,
    rng: makeRng(1),
  });
  mode.advancePhase(); // build → simulate

  const engine = new Engine(state);
  for (let i = 0; i < wave.duration; i++) {
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
  };
}

// makeRng is re-exported from @harness/td-fixtures for any callers still
// importing it from this module.
export { makeRng } from "@harness/td-fixtures";

/**
 * Build a Server component with Processing + Forwarding(writes) + Monitoring.
 */
export function buildServer(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  // TD Server: Processing handles reads only (`handledTypes: ["api_read"]`),
  // bounded at 20/tick, emits PROCESSED events for runWave to count.
  // Forwarding handles writes only, bounded at 12/tick, emits source-side
  // FORWARDED events. Server total budget = 20 + 12 = 32 < Wave 3's 50 req/tick
  // → lone-server loses as required by the learning arc.
  const processingCap = new ProcessingCapability("processing" as CapabilityId, {
    handledTypes: ["api_read"],
    throughputPerTier: 20,
    emitProcessedEvent: true,
  });
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_write"],
    throughputPerTier: 12,
    emitForwardedEvent: true,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>();
  capabilities.set("processing" as CapabilityId, processingCap);
  capabilities.set("forwarding" as CapabilityId, forwardingCap);
  capabilities.set("monitoring" as CapabilityId, monitoringCap);

  const tiers = new Map<CapabilityId, number>();
  tiers.set("processing" as CapabilityId, 1);
  tiers.set("forwarding" as CapabilityId, 1);
  tiers.set("monitoring" as CapabilityId, 1);

  const component = new Component({
    id: id as ComponentId,
    type: "server",
    name: "Server",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 100,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
}

/**
 * Build a Database component with Storage + Monitoring.
 */
export function buildDatabase(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  // TD Database: Storage bounded at 25/tick (default is 5, too low for Wave 3's
  // 15 writes/tick — Database must not be the bottleneck). Emits PROCESSED
  // events for runWave to count writes.
  const storageCap = new StorageCapability("storage" as CapabilityId, {
    throughputPerTier: 25,
    emitProcessedEvent: true,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["storage" as CapabilityId, storageCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["storage" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "database",
    name: "Database",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 200,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
}

/**
 * Build a Cache component with Caching (INTERCEPT) + Forwarding (all traffic) + Monitoring.
 */
export function buildCache(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  const cachingCap = new CachingCapability("caching" as CapabilityId);
  // Cache's Forwarding handles ALL traffic passing through (cache misses
  // for reads, pass-through for writes), needs high throughput (~55/tick
  // to handle Wave 3's 50 req/tick). Emits source-side FORWARDED events.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write"],
    throughputPerTier: 55,
    emitForwardedEvent: true,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["caching" as CapabilityId, cachingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["caching" as CapabilityId, 1],
    ["forwarding" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "cache",
    name: "Cache",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 150,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
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
  // (~55/tick) — pass-through pipe feeding both servers. Emits source-side
  // FORWARDED events for runWave.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write"],
    throughputPerTier: 55,
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
 */
export function wire(
  state: SimulationState,
  source: { component: Component; egressPortId: string },
  target: { component: Component; ingressPortId: string },
  connId: string,
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
  );
  sourcePort.connections.push(conn.id);
  targetPort.connections.push(conn.id);
  state.addConnection(conn);
}

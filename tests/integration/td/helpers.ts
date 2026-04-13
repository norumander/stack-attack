import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { makePort, makeConnection } from "@harness/fixtures";
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

/**
 * Deterministic LCG for test determinism.
 */
export function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

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

  const processingCap = new ProcessingCapability("processing" as CapabilityId);
  // Server's Forwarding handles writes only, with small throughput (12/tick)
  // so Server's total budget = Processing(20) + Forwarding(12) = 32 < Wave 3's
  // 50 req/tick → lone-server fails as required by the learning arc.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_write"],
    throughputPerTier: 12,
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

// Placeholders for later slices:
// export function buildDatabase(id: string): ... (Slice B)
// export function buildCache(id: string): ... (Slice C)
// export function buildLoadBalancer(id: string): ... (Slice C)

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

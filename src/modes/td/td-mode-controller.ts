import type { ModeController } from "@core/mode/mode-controller.js";
import type { ComponentReader } from "@core/component/component-reader.js";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
} from "@core/types/ids.js";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { OutcomeReport, SLAResult } from "@core/types/outcome.js";
import type { SimulationStateReader } from "@core/state/state-reader.js";
import type { ZoneTopology } from "@core/types/zone.js";
import type { ChaosEvent } from "@core/types/chaos.js";
import type { Position } from "@core/types/position.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TrafficSource } from "@core/mode/traffic-source.js";
import type { Connection } from "@core/types/connection.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import { isEngineBufferable } from "@core/capability/engine-interfaces.js";
import type { TDEconomy } from "./td-economy.js";
import type { TDWaveDefinition } from "./td-waves.js";
import { TDTrafficSource } from "./td-traffic-source.js";

export interface TDModeControllerOptions {
  readonly waves: readonly TDWaveDefinition[];
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  readonly componentRegistry: ComponentRegistry;
  /**
   * Jump-start the campaign at this wave index instead of 0. Test-mode
   * affordance for the dashboard's "Start at Wave N" dev buttons so
   * iteration on wave 2 / wave 3 doesn't require completing wave 1 each
   * time. The traffic source is seeded to `waves[startingWaveIndex]` and
   * `getCurrentWaveIndex()` begins there. Must be in `[0, waves.length)`.
   */
  readonly startingWaveIndex?: number;
}

export type ConnectResult =
  | { ok: true; connectionId: ConnectionId }
  | {
      ok: false;
      reason:
        | "wrong_phase"
        | "unknown_source"
        | "unknown_target"
        | "no_egress_port"
        | "no_ingress_port"
        | "duplicate_connection"
        | "port_capacity_exceeded";
      detail?: string;
    };

export class TDModeController implements ModeController {
  // economy is mutable so the dashboard can swap in a fresh per-wave economy
  economy: TDEconomy;

  private readonly waves: readonly TDWaveDefinition[];
  private currentWaveIndex = 0;
  private trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private waveStartMetricsIndex = 0;
  private placementSerial = 0;
  private readonly componentRegistry: ComponentRegistry;
  private readonly entryPointId: ComponentId;
  private readonly rng: () => number;

  constructor(options: TDModeControllerOptions) {
    if (options.waves.length === 0) {
      throw new Error("TDModeController: waves array must be non-empty");
    }
    const startingIndex = options.startingWaveIndex ?? 0;
    if (startingIndex < 0 || startingIndex >= options.waves.length) {
      throw new Error(
        `TDModeController: startingWaveIndex ${startingIndex} out of range [0, ${options.waves.length})`,
      );
    }
    this.waves = options.waves;
    this.componentRegistry = options.componentRegistry;
    this.economy = options.economy;
    this.entryPointId = options.entryPointId;
    this.rng = options.rng;
    this.currentWaveIndex = startingIndex;
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[startingIndex]!,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  /** Dashboard calls this on assess→build to swap in the next wave's economy. */
  setEconomy(economy: TDEconomy): void {
    this.economy = economy;
  }

  // === New multi-wave getters ===

  getCurrentWaveIndex(): number {
    return this.currentWaveIndex;
  }

  getCurrentWave(): TDWaveDefinition {
    if (this.isCampaignComplete()) {
      throw new Error("TDModeController: campaign complete; no current wave");
    }
    return this.waves[this.currentWaveIndex]!;
  }

  isCampaignComplete(): boolean {
    return this.currentWaveIndex >= this.waves.length;
  }

  getWaveCount(): number {
    return this.waves.length;
  }

  /**
   * Reset the controller from any phase back to "build" for the SAME wave
   * (no waveIndex advancement). Used by the dashboard's Retry flow after a
   * wave loss. Reconstructs the traffic source so the wave can be re-run.
   */
  restartCurrentWave(): void {
    if (this.isCampaignComplete()) {
      throw new Error("TDModeController: campaign complete; cannot restart");
    }
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[this.currentWaveIndex]!,
      targetEntryPointId: this.entryPointId,
      rng: this.rng,
    });
    this.phase = "build";
  }

  // === Existing methods, updated to read this.getCurrentWave() ===

  getActiveCapabilities(
    component: ComponentReader,
  ): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds() as CapabilityId[]);
  }

  getTierCap(
    _component: ComponentReader,
    _capabilityId: CapabilityId,
  ): number {
    return 1;
  }

  getBuildConstraints(): BuildConstraints {
    const wave = this.getCurrentWave();
    return wave.maxPlacements !== undefined
      ? {
          availableComponentTypes: wave.availableComponents,
          maxPlacements: wave.maxPlacements,
        }
      : {
          availableComponentTypes: wave.availableComponents,
        };
  }

  getTrafficSource(): TrafficSource {
    return this.trafficSource;
  }

  evaluateSLA(metrics: readonly TickMetrics[]): SLAResult {
    const wave = this.getCurrentWave();
    const sla = wave.sla;

    let dropped = 0;
    let timedOut = 0;
    let resolved = 0;
    let weightedLatencySum = 0;

    for (const m of metrics) {
      dropped += m.requestsDropped;
      timedOut += m.requestsTimedOut;
      resolved += m.requestsResolved;
      weightedLatencySum += m.avgLatency * m.requestsResolved;
    }

    const accountedTotal = dropped + timedOut + resolved;
    // Availability is measured against what the traffic source was scheduled
    // to generate, not against what ended up in the counters. Requests that
    // vanish via silent PASS (a component's PROCESS phase produces PASS with
    // no downstream handler) do not increment `dropped` — but they're still
    // unserved, and the player's architecture is at fault. Max() keeps us
    // honest if a future variable-intensity wave under-generates the scheduled
    // count (e.g. rate limiter in front of traffic source).
    const expectedGenerated = wave.intensity * wave.duration;
    const denominator = Math.max(accountedTotal, expectedGenerated, 1);
    const actualAvailability = resolved / denominator;
    const actualLatency = resolved > 0 ? weightedLatencySum / resolved : 0;
    const actualBudget = this.economy.getBudget();

    const availTarget = sla?.availabilityTarget ?? 0;
    const latTarget = sla?.maxAvgLatency ?? Infinity;
    const budgetTarget = sla?.minBudget ?? -Infinity;

    const availPassed = actualAvailability >= availTarget;
    const latPassed = actualLatency <= latTarget;
    const budgetPassed = actualBudget >= budgetTarget;

    return {
      availability: { target: availTarget, actual: actualAvailability, passed: availPassed },
      latency: { target: latTarget, actual: actualLatency, passed: latPassed },
      budget: { target: budgetTarget, actual: actualBudget, passed: budgetPassed },
      allPassed: availPassed && latPassed && budgetPassed,
    };
  }

  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport {
    const wave = this.getCurrentWave();
    const sla = this.evaluateSLA(metrics);

    let dropped = 0;
    let timedOut = 0;
    let resolved = 0;
    for (const m of metrics) {
      dropped += m.requestsDropped;
      timedOut += m.requestsTimedOut;
      resolved += m.requestsResolved;
    }
    const accountedTotal = dropped + timedOut + resolved;
    // Same denominator discipline as evaluateSLA: measure drop rate against
    // what was scheduled, not just what was counted. Prevents a silent-PASS
    // topology from producing dropRate = 0 → WIN under the legacy threshold.
    const expectedGenerated = wave.intensity * wave.duration;
    const denominator = Math.max(accountedTotal, expectedGenerated, 1);
    const dropRate = (dropped + timedOut + (denominator - accountedTotal)) / denominator;
    const budget = this.economy.getBudget();

    // SLA gate: if SLAs are defined, they determine the verdict.
    // Fallback to legacy dropThreshold for waves without SLA configs.
    const verdict: "win" | "lose" | "neutral" = wave.sla
      ? (sla.allPassed ? "win" : "lose")
      : (dropRate < wave.dropThreshold ? "win" : "lose");

    const performance = 1 - dropRate;
    const reliability = resolved / denominator;
    const cost = budget;
    const composite =
      0.4 * performance +
      0.4 * reliability +
      0.2 * (cost / wave.startingBudget);

    const notes: string[] = [
      `availability: ${(sla.availability.actual * 100).toFixed(1)}% (target: ${(sla.availability.target * 100).toFixed(0)}%)`,
      `latency: ${sla.latency.actual.toFixed(1)} (max: ${sla.latency.target})`,
      `budget: $${sla.budget.actual} (min: $${sla.budget.target})`,
    ];
    if (!sla.allPassed) {
      const failed: string[] = [];
      if (!sla.availability.passed) failed.push("availability");
      if (!sla.latency.passed) failed.push("latency");
      if (!sla.budget.passed) failed.push("budget");
      notes.push(`FAILED SLA: ${failed.join(", ")}`);
    }

    return {
      verdict,
      score: { cost, performance, reliability, composite },
      slaResults: sla,
      notes,
    };
  }

  getCurrentWaveMetrics(state: SimulationState): readonly TickMetrics[] {
    return state.metricsHistory.slice(this.waveStartMetricsIndex);
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  /**
   * Advance the phase machine. Optional `state` parameter is used by the
   * dashboard to snapshot the metrics index at build→simulate. Call sites
   * that don't need per-wave metric slicing (e.g. `runWave`) may omit it.
   *
   * Throws if called after the campaign is complete — callers must check
   * `isCampaignComplete()` before re-entering the phase machine. On the
   * final wave's assess→build transition, the wave index is bumped past
   * the end and the phase is left at "assess" — there is no next build
   * phase to enter. Subsequent `advancePhase` calls will throw.
   */
  advancePhase(state?: SimulationState): void {
    if (this.isCampaignComplete()) {
      throw new Error(
        "TDModeController: campaign complete; cannot advance phase",
      );
    }
    switch (this.phase) {
      case "build":
        if (state !== undefined) {
          this.waveStartMetricsIndex = state.metricsHistory.length;
        }
        this.phase = "simulate";
        break;
      case "simulate":
        this.phase = "assess";
        break;
      case "assess":
        this.currentWaveIndex += 1;
        if (this.currentWaveIndex < this.waves.length) {
          this.trafficSource = new TDTrafficSource({
            wave: this.waves[this.currentWaveIndex]!,
            targetEntryPointId: this.entryPointId,
            rng: this.rng,
          });
          this.phase = "build";
        }
        // Final wave cleared: stay in assess; isCampaignComplete() is now true.
        break;
    }
  }

  /**
   * Walks every place a request can live between ticks: pending queues,
   * blocked-parent pool, active streams, and EngineBufferable partitions.
   */
  isWaveDrained(state: SimulationState): boolean {
    if (!this.trafficSource.isExhausted()) return false;
    for (const arr of state.pending.values()) {
      if (arr.length > 0) return false;
    }
    if (state.blockedParents.size > 0) return false;
    if (state.activeStreams.size > 0) return false;
    for (const componentId of state.visitOrder) {
      const component = state.components.get(componentId);
      if (!component) continue;
      for (const cap of component.capabilities.values()) {
        if (isEngineBufferable(cap) && cap.peekBuffered().length > 0)
          return false;
      }
    }
    return true;
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: ["default"], pairLatency: new Map() };
  }

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult {
    // 1. Phase check
    if (this.phase !== "build") {
      return { ok: false, reason: "disallowed_by_mode", detail: "wrong phase" };
    }
    // 2. Allowlist check
    const wave = this.getCurrentWave();
    if (!wave.availableComponents.includes(type)) {
      return {
        ok: false,
        reason: "disallowed_by_mode",
        detail: "type not in current wave's allowlist",
      };
    }
    // 3. Registry mint
    const component = this.componentRegistry.tryCreate(type, position, zone);
    if (!component) {
      return { ok: false, reason: "registry_unknown_type", detail: type };
    }
    // 4. Budget check
    if (!this.economy.canAfford(component.placementCost)) {
      return { ok: false, reason: "insufficient_budget" };
    }
    // 5. Debit + place
    this.economy.debitPlacement(component);
    state.placeComponent(component);
    this.placementSerial += 1;
    // 6. Return
    return { ok: true, componentId: component.id };
  }

  tryConnect(
    state: SimulationState,
    sourceComponentId: ComponentId,
    targetComponentId: ComponentId,
  ): ConnectResult {
    // 1. Phase check
    if (this.phase !== "build") {
      return { ok: false, reason: "wrong_phase" };
    }
    // 2. Endpoint existence
    const source = state.components.get(sourceComponentId);
    if (!source) return { ok: false, reason: "unknown_source" };
    const target = state.components.get(targetComponentId);
    if (!target) return { ok: false, reason: "unknown_target" };
    // 3. Port discovery — first matching egress on source, first ingress on target
    const sourcePort = source.ports.find((p) => p.direction === "egress");
    if (!sourcePort) return { ok: false, reason: "no_egress_port" };
    const targetPort = target.ports.find((p) => p.direction === "ingress");
    if (!targetPort) return { ok: false, reason: "no_ingress_port" };
    // 4. Duplicate check
    for (const conn of state.connections.values()) {
      if (
        conn.source.componentId === sourceComponentId &&
        conn.target.componentId === targetComponentId
      ) {
        return { ok: false, reason: "duplicate_connection" };
      }
    }
    // 5. Port capacity check
    if (sourcePort.connections.length >= sourcePort.capacity) {
      return { ok: false, reason: "port_capacity_exceeded", detail: "source" };
    }
    if (targetPort.connections.length >= targetPort.capacity) {
      return { ok: false, reason: "port_capacity_exceeded", detail: "target" };
    }
    // 6. Mint connection
    this.placementSerial += 1;
    const connectionId = `td-conn-${this.placementSerial}` as ConnectionId;
    const conn: Connection = {
      id: connectionId,
      source: { componentId: sourceComponentId, portId: sourcePort.id },
      target: { componentId: targetComponentId, portId: targetPort.id },
      bandwidth: 100,
      latency: 1,
      currentLoad: 0,
    };
    // 7. Add to state
    state.addConnection(conn);
    // 8. Update port state
    sourcePort.connections.push(connectionId);
    targetPort.connections.push(connectionId);
    // 9. Return
    return { ok: true, connectionId };
  }

  tryUpgrade(
    _state: SimulationState,
    _componentId: ComponentId,
    _capabilityId: CapabilityId,
  ): UpgradeResult {
    // TD upgrade is not yet implemented. The previous stub returned a bumped
    // playerTier without calling component.upgrade() or debiting the economy,
    // which would silently desync any future UI code. Throw until the real
    // impl lands (Stage 3c).
    throw new Error(
      "TDModeController.tryUpgrade is not implemented yet",
    );
  }

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }

  /**
   * Mid-wave SLA penalty. Called by the engine at the end of each tick.
   * If the rolling availability or latency is breaching the SLA target,
   * deduct a penalty from the budget — creating real economic pressure
   * during the wave, not just at the end.
   */
  onTick(state: SimulationStateReader): void {
    if (this.phase !== "simulate") return;
    const wave = this.getCurrentWave();
    if (!wave.sla) return;

    const metrics = (state as unknown as SimulationState).metricsHistory.slice(
      this.waveStartMetricsIndex,
    );
    if (metrics.length === 0) return;

    let resolved = 0;
    let dropped = 0;
    let timedOut = 0;
    for (const m of metrics) {
      resolved += m.requestsResolved;
      dropped += m.requestsDropped;
      timedOut += m.requestsTimedOut;
    }

    // Rolling availability uses the same denominator discipline as the final
    // verdict: scheduled-generated through this tick, capped at the wave
    // duration (drain ticks don't generate new requests). This means a
    // topology that silently drops every request STILL accrues mid-wave
    // penalty ticks — the old `if (total === 0) return` short-circuit hid
    // broken architectures from the player's budget.
    const ticksInWave = metrics.length;
    const generatingTicks = Math.min(ticksInWave, wave.duration);
    const expectedGeneratedSoFar = wave.intensity * generatingTicks;
    const accountedTotal = resolved + dropped + timedOut;
    const denominator = Math.max(accountedTotal, expectedGeneratedSoFar, 1);
    const rollingAvailability = resolved / denominator;

    if (rollingAvailability < wave.sla.availabilityTarget) {
      this.economy.debitUpkeep(wave.sla.penaltyPerTick);
    }
  }
}
